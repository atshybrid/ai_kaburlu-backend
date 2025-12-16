// Push Notification CRUD
export const addPushToken = async (userId: string, deviceId: string, deviceModel: string, pushToken: string) => {
    return prisma.device.upsert({
        where: { deviceId },
        update: { pushToken, deviceModel },
        create: { deviceId, deviceModel, pushToken, userId }
    });
};

export const removePushToken = async (userId: string, pushToken: string) => {
    return prisma.device.deleteMany({
        where: { deviceId: userId, pushToken }
    });
};

// Location CRUD
export const updateLocation = async (userId: string, latitude: number, longitude: number) => {
    return prisma.userLocation.upsert({
        where: { userId },
        update: { latitude, longitude },
        create: { userId, latitude, longitude }
    });
};

export const getLocation = async (userId: string) => {
    return prisma.userLocation.findUnique({ where: { userId } });
};
import prisma from '../../lib/prisma';
import { hashMpin } from '../../lib/mpin';
import { buildUserMobileLookupWhere, normalizeMobileNumber } from '../../lib/mobileNumber';

export const createUser = async (data: any) => {
    const toCreate = { ...data };

    if (toCreate.mobileNumber) {
        const norm = normalizeMobileNumber(toCreate.mobileNumber);
        toCreate.mobileNumber = norm || null;
        if (norm) {
            const existing = await prisma.user.findFirst({ where: buildUserMobileLookupWhere(norm) as any, select: { id: true } });
            if (existing) {
                throw new Error('Mobile number already registered');
            }
        }
    }

    if (toCreate.mpin) {
        const hashed = await hashMpin(toCreate.mpin);
        toCreate.mpinHash = hashed;
        toCreate.mpin = null;
    }
    return (prisma as any).user.create({ data: toCreate as any });
};

export const findAllUsers = async () => {
  return prisma.user.findMany({ include: { role: true } });
};

export const findUserById = async (id: string) => {
    return prisma.user.findUnique({ where: { id }, include: { role: true, language: true } });
};

export const findUserByMobileNumber = async (mobileNumber: string) => {
    const norm = normalizeMobileNumber(mobileNumber);
    const where = buildUserMobileLookupWhere(norm || mobileNumber);
    return prisma.user.findFirst({ where: where as any, include: { role: true } });
};

export const updateUser = async (id: string, data: any) => {
    const { roleId, languageId, ...rest } = data;
    const updateData: any = { ...rest };

    if (Object.prototype.hasOwnProperty.call(updateData, 'mobileNumber')) {
        const norm = normalizeMobileNumber(updateData.mobileNumber);
        updateData.mobileNumber = norm || null;
        if (norm) {
            const existing = await prisma.user.findFirst({ where: buildUserMobileLookupWhere(norm) as any, select: { id: true } });
            if (existing && existing.id !== id) {
                throw new Error('Mobile number already registered');
            }
        }
    }

    if (updateData.mpin) {
        updateData.mpinHash = await hashMpin(updateData.mpin);
        updateData.mpin = null;
    }

    if (roleId) {
        updateData.role = {
            connect: { id: roleId },
        };
    }

    if (languageId) {
        updateData.language = {
            connect: { id: languageId },
        };
    }

    return (prisma as any).user.update({
        where: { id },
        data: updateData as any,
    });
};

export const deleteUser = async (id: string) => {
    return prisma.user.delete({ where: { id } });
};

export const upgradeGuest = async (data: any) => {
    const { deviceId, deviceModel, pushToken, mobileNumber, mpin, email, languageId } = data;
    // Ignore any roleId sent by client

    const guestRole = await prisma.role.findUnique({ where: { name: 'GUEST' } });
    const citizenReporterRole = await prisma.role.findUnique({ where: { name: 'CITIZEN_REPORTER' } });

    if (!guestRole || !citizenReporterRole) {
        throw new Error('Required roles not found');
    }

    const normMobile = normalizeMobileNumber(mobileNumber);
    if (!normMobile) throw new Error('Invalid mobile number');

    // If this mobile already exists (any legacy formatting), reuse that user.
    const existingByMobile = await prisma.user.findFirst({ where: buildUserMobileLookupWhere(normMobile) as any });

    // Otherwise, if device is linked to a guest user, upgrade that guest.
    const guestUser = await prisma.user.findFirst({
        where: {
            devices: { some: { deviceId } },
            roleId: guestRole.id,
        },
    });

    const targetUser = existingByMobile || guestUser;
    const hashed = mpin ? await hashMpin(mpin) : undefined;

    const user = targetUser
        ? await (prisma as any).user.update({
              where: { id: targetUser.id },
              data: {
                  mobileNumber: normMobile,
                  mpinHash: hashed,
                  mpin: null,
                  email,
                  roleId: citizenReporterRole.id,
                  languageId: languageId || targetUser.languageId,
                  status: 'ACTIVE',
                  upgradedAt: new Date(),
              },
          })
        : await (prisma as any).user.create({
              data: {
                  mobileNumber: normMobile,
                  mpinHash: hashed,
                  mpin: null,
                  email,
                  roleId: citizenReporterRole.id,
                  languageId,
                  status: 'ACTIVE',
                  upgradedAt: new Date(),
              },
          });

    // Ensure device is linked to the target user (even if it previously belonged to a guest).
    await prisma.device.upsert({
        where: { deviceId },
        update: { deviceModel, pushToken, userId: user.id },
        create: { deviceId, deviceModel, pushToken, userId: user.id },
    });

    return user;
};
