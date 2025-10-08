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

export const createUser = async (data: any) => {
    const toCreate = { ...data };
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
  return prisma.user.findUnique({ where: { mobileNumber }, include: { role: true } });
};

export const updateUser = async (id: string, data: any) => {
    const { roleId, languageId, ...rest } = data;
    const updateData: any = { ...rest };
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

    let user = await prisma.user.findFirst({
        where: {
            devices: { some: { deviceId } },
            roleId: guestRole.id,
        },
        include: { devices: true }
    });

    if (user) {
        // If device already exists, just update user and mark guest as upgraded
    let hashed = mpin ? await hashMpin(mpin) : undefined;
    return (prisma as any).user.update({
            where: { id: user.id },
            data: {
                mobileNumber,
                mpinHash: hashed,
                mpin: null,
                email,
                roleId: citizenReporterRole.id,
                status: 'ACTIVE',
                upgradedAt: new Date(), // If you have this field
                devices: {
                    upsert: {
                        where: { deviceId },
                        update: {
                            deviceModel,
                            pushToken
                        },
                        create: {
                            deviceId,
                            deviceModel,
                            pushToken
                        }
                    }
                }
            },
        });
    } else {
        // Create user and device together
    let hashed = mpin ? await hashMpin(mpin) : undefined;
    return (prisma as any).user.create({
            data: {
                mobileNumber,
    mpinHash: hashed,
    mpin: null,
                email,
                roleId: citizenReporterRole.id,
                languageId,
                status: 'ACTIVE',
                devices: {
                    create: [{
                        deviceId,
                        deviceModel,
                        pushToken
                    }]
                }
            },
        });
    }
};
