export const logout = async (refreshToken: string, deviceId: string) => {
  // TODO: Implement token invalidation and device/session tracking if needed
  // For now, just scaffold (no-op)
  return true;
};
export const checkUserExists = async (mobile: string) => {
  const user = await prisma.user.findUnique({ where: { mobileNumber: mobile } });
  return !!user;
};

import { findUserByMobileNumber } from '../users/users.service';
import { MpinLoginDto } from './mpin-login.dto';
import { RefreshDto } from './refresh.dto';
import { GuestRegistrationDto } from './guest-registration.dto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import prisma from '../../lib/prisma';

// A simple exception class for HTTP errors
class HttpException extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// This is a placeholder. In a real app, you would have a robust OTP system.
const validateOtp = async (mobileNumber: string, otp: string): Promise<boolean> => {
  console.log(`Validating OTP ${otp} for ${mobileNumber}`);
  return true;
};

export const login = async (loginDto: MpinLoginDto) => {
    console.log("loginDto", loginDto)
  console.log("Attempting to log in with mobile number:", loginDto.mobileNumber);
  const user = await findUserByMobileNumber(loginDto.mobileNumber);
  if (!user) {
    console.log("User not found for mobile number:", loginDto.mobileNumber);
    return null; // User not found
  }
  console.log("User found:", user);

  // Securely compare the provided mpin with the hashed mpin from the database
  console.log("Provided mpin:", loginDto.mpin);
  console.log("Hashed mpin from DB (mpin):", user.mpin);
  console.log("Hashed mpin from DB (mpinHash):", (user as any).mpinHash);
  // Support both legacy 'mpin' (hashed) and new 'mpinHash' field
  const storedHash = user.mpin || (user as any).mpinHash || null;
  if (!storedHash) {
    return null;
  }
  const isMpinValid = await bcrypt.compare(loginDto.mpin, storedHash);
  console.log("isMpinValid:", isMpinValid);
  if (!isMpinValid) {
    console.log("Invalid mpin for user:", user.id);
    return null; // Invalid credentials
  }

  const role = await prisma.role.findUnique({
    where: {
      id: user.roleId,
    },
  });
  console.log("User role:", role);

  const payload = {
    sub: user.id,
    role: role?.name,
    permissions: role?.permissions,
  };

  // Access token: 1 hour; Refresh token: 30 days
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
  const refreshToken = jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });

  // Fetch user profile and device data for enhanced response
  const userProfile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  const userLocation = await prisma.userLocation.findUnique({ where: { userId: user.id } });
  const device = await prisma.device.findFirst({ 
    where: { userId: user.id }, 
    orderBy: { updatedAt: 'desc' } 
  }); // Get most recent device

  // Build membership/payment/ID card summary for login UX
  const membershipSummary = await getMembershipSummary(user.id, !!userProfile?.profilePhotoUrl);

  const result: any =  {
    jwt: accessToken,
    refreshToken: refreshToken,
    expiresIn: 86400, // seconds (1 day)
    user: {
      userId: user.id,
      role: role?.name,
      languageId: user.languageId,
      fullName: userProfile?.fullName || null,
      profilePhotoUrl: userProfile?.profilePhotoUrl || null
    },
    device: device ? {
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      pushToken: device.pushToken,
      hasPushToken: Boolean(device.pushToken)
    } : null,
    location: userLocation ? {
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      accuracyMeters: userLocation.accuracyMeters,
      provider: userLocation.provider,
      timestampUtc: userLocation.timestampUtc?.toISOString(),
      placeId: userLocation.placeId,
      placeName: userLocation.placeName,
      address: userLocation.address,
      source: userLocation.source
    } : null
  };
  // Only attach membership section for actual members
  if (membershipSummary?.hasMembership) {
    result.membership = membershipSummary;
  }
  console.log("result", result)
  return result
};

export const refresh = async (refreshDto: RefreshDto) => {
  try {
    const decoded = jwt.verify(refreshDto.refreshToken, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret') as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });

    if (!user) {
      return null;
    }

    const role = await prisma.role.findUnique({
      where: {
        id: user.roleId,
      },
    });

    const payload = {
      sub: user.id,
      role: role?.name,
      permissions: role?.permissions,
    };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });

    return {
      jwt: accessToken,
  expiresIn: 86400, // seconds (1 day)
    };
  } catch (error) {
    return null;
  }
};

export const registerGuestUser = async (guestDto: GuestRegistrationDto, existingAnonId?: string) => {
  try {
    const language = await prisma.language.findUnique({ where: { id: guestDto.languageId } });
    if (!language) throw new HttpException(400, `Invalid languageId: '${guestDto.languageId}'.`);
    const guestRole = await prisma.role.findUnique({ where: { name: 'GUEST' } });
    if (!guestRole) throw new Error('Critical server error: GUEST role not found.');

    // Find device precedence: explicit anonId header -> fallback to provided deviceId
    let device = null as any;
    if (existingAnonId) {
      device = await prisma.device.findUnique({ where: { id: existingAnonId } });
    }
    if (!device) {
      device = await prisma.device.findUnique({ where: { deviceId: guestDto.deviceDetails.deviceId } });
    }
    let linkedUser: any = null;
    let deviceRole: any = null;
    if (device?.userId) {
      linkedUser = await prisma.user.findUnique({ where: { id: device.userId }, include: { role: true } });
    }
    if ((device as any)?.roleId) {
      deviceRole = await prisma.role.findUnique({ where: { id: (device as any).roleId } });
    }

    // If device linked to a user already => return user token (upgraded flow)
    if (linkedUser) {
      const user = linkedUser;
      const role = user.role;
      const payload = { sub: user.id, subType: 'user', role: role?.name, permissions: role?.permissions };
      const jwtToken = jwt.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
      const refreshToken = jwt.sign({ sub: user.id, subType: 'user' }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });
  return { jwt: jwtToken, refreshToken, expiresIn: 86400, anonId: device.id, user: { userId: user.id, role: role?.name, languageId: user.languageId } };
    }

    // Create or update a pure guest device (no user row)
    if (!device) {
      device = await prisma.device.create({
        data: {
          deviceId: guestDto.deviceDetails.deviceId,
          deviceModel: guestDto.deviceDetails.deviceModel,
          pushToken: guestDto.deviceDetails.pushToken,
          roleId: guestRole.id,
          languageId: language.id,
          latitude: guestDto.deviceDetails.location?.latitude,
          longitude: guestDto.deviceDetails.location?.longitude,
          accuracyMeters: guestDto.deviceDetails.location?.accuracyMeters as any,
          placeId: guestDto.deviceDetails.location?.placeId,
          placeName: guestDto.deviceDetails.location?.placeName,
          address: guestDto.deviceDetails.location?.address,
          source: guestDto.deviceDetails.location?.source,
        } as any,
      });
    } else {
      device = await prisma.device.update({
        where: { id: device.id },
        data: {
          pushToken: guestDto.deviceDetails.pushToken,
          roleId: guestRole.id,
          languageId: language.id,
          latitude: guestDto.deviceDetails.location?.latitude,
          longitude: guestDto.deviceDetails.location?.longitude,
          accuracyMeters: guestDto.deviceDetails.location?.accuracyMeters as any,
          placeId: guestDto.deviceDetails.location?.placeId,
          placeName: guestDto.deviceDetails.location?.placeName,
          address: guestDto.deviceDetails.location?.address,
          source: guestDto.deviceDetails.location?.source,
        } as any,
      });
    }

    // Re-fetch role for payload
    deviceRole = await prisma.role.findUnique({ where: { id: (device as any).roleId } });
    const payload = { sub: device.id, subType: 'device', role: deviceRole?.name, permissions: deviceRole?.permissions };
    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
    const refreshToken = jwt.sign({ sub: device.id, subType: 'device' }, process.env.JWT_REFRESH_SECRET || 'your-default-refresh-secret', { expiresIn: '30d' });

    return {
      jwt: jwtToken,
      refreshToken,
      expiresIn: 86400,
      anonId: device.id,
      device: {
        deviceId: device.deviceId,
        role: deviceRole?.name,
        languageId: (device as any).languageId ?? null,
      }
    };
  } catch (error) {
    console.error('[FATAL] Unhandled error in registerGuestUser:', error);
    throw error;
  }
};

/**
 * Compute a concise summary of the user's most relevant membership, payment, and ID card status,
 * plus a suggested nextAction to help the client decide navigation.
 */
async function getMembershipSummary(userId: string, hasProfilePhoto: boolean) {
  // Pick the most recently updated membership (covers PENDING/PAYMENT/ACTIVE/EXPIRED)
  const m = await prisma.membership.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      designation: true,
      cell: true,
      idCard: true,
      // Use updatedAt to reflect status transitions (PENDING -> SUCCESS)
      payments: { orderBy: { updatedAt: 'desc' }, take: 3 },
      kyc: true,
    },
  });

  if (!m) return { hasMembership: false };

  const now = new Date();
  // Prefer a SUCCESS payment if available among the most recent; else fall back to the latest by updatedAt
  const payments = ((m as any).payments || []) as any[];
  const lastPayment = payments.find(p => p.status === 'SUCCESS') || payments[0] || null;
  const idCard = (m as any).idCard || null;
  const kyc = (m as any).kyc || null;
  const expiresAt: Date | null = (m as any).expiresAt || (idCard?.expiresAt ?? null);
  const isExpired = !!(expiresAt && expiresAt.getTime() < now.getTime()) || m.status === 'EXPIRED' || idCard?.status === 'EXPIRED';

  // Determine if a payment is currently required/blocked
  const requiresPayment = m.status === 'PENDING_PAYMENT' || m.paymentStatus === 'PENDING' || m.paymentStatus === 'FAILED';

  // Compute nextAction hint for UI
  let nextAction: any = { type: 'NONE', reason: null as string | null };
  if (isExpired) {
    nextAction = { type: 'RENEW', reason: 'Membership/ID card expired. Please renew to continue.' };
  } else if (requiresPayment) {
    nextAction = { type: 'PAYMENT', reason: 'Complete payment to activate your membership.' };
  } else if (m.status === 'PENDING_APPROVAL') {
    nextAction = { type: 'AWAIT_APPROVAL', reason: 'Your membership is awaiting admin approval.' };
  } else if (m.status === 'ACTIVE' && m.idCardStatus === 'NOT_CREATED') {
    if (!hasProfilePhoto) {
      nextAction = { type: 'UPLOAD_PHOTO', reason: 'Upload a profile photo to generate your ID card.' };
    } else {
      nextAction = { type: 'ISSUE_ID_CARD', reason: 'ID card can be issued.' };
    }
  }

  // Prepare relative paths for ID card viewing (front-end can prefix base URL; also available under /api/v1)
  const idCardPaths = idCard?.cardNumber
    ? {
        json: `/hrci/idcard/${idCard.cardNumber}`,
        html: `/hrci/idcard/${idCard.cardNumber}/html`,
        qr: `/hrci/idcard/${idCard.cardNumber}/qr`,
      }
    : null;

  // Resolve HRCI geography display names if present
  let country: any = null, state: any = null, district: any = null, mandal: any = null;
  try {
    if ((m as any).hrcCountryId) {
      const c = await (prisma as any).hrcCountry.findUnique({ where: { id: (m as any).hrcCountryId } });
      if (c) country = { id: c.id, name: c.name, code: c.code || null };
    }
    if ((m as any).hrcStateId) {
      const s = await (prisma as any).hrcState.findUnique({ where: { id: (m as any).hrcStateId } });
      if (s) state = { id: s.id, name: s.name, code: s.code || null, zone: s.zone, countryId: s.countryId };
    }
    if ((m as any).hrcDistrictId) {
      const d = await (prisma as any).hrcDistrict.findUnique({ where: { id: (m as any).hrcDistrictId } });
      if (d) district = { id: d.id, name: d.name, stateId: d.stateId };
    }
    if ((m as any).hrcMandalId) {
      const md = await (prisma as any).hrcMandal.findUnique({ where: { id: (m as any).hrcMandalId } });
      if (md) mandal = { id: md.id, name: md.name, districtId: md.districtId };
    }
  } catch {}

  return {
    hasMembership: true,
    role: 'MEMBER',
    membershipId: m.id,
    level: m.level,
    cell: m.cell ? { id: m.cellId, name: (m as any).cell?.name ?? null } : null,
    designation: m.designation ? { id: m.designationId, code: (m as any).designation?.code ?? null, name: (m as any).designation?.name ?? null } : null,
    status: m.status,
    paymentStatus: m.paymentStatus,
    idCardStatus: m.idCardStatus,
    hrci: {
      zone: (m as any).zone || null,
      country,
      state,
      district,
      mandal,
    },
    activatedAt: m.activatedAt ? m.activatedAt.toISOString() : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired: isExpired,
    lastPayment: lastPayment
      ? {
          status: lastPayment.status,
          amount: lastPayment.amount,
          providerRef: lastPayment.providerRef || null,
          createdAt: lastPayment.createdAt?.toISOString?.() ?? null,
        }
      : null,
    amountDue: (m as any).designation?.idCardFee ?? null,
    requiresPayment,
    card: idCard
      ? {
          cardNumber: idCard.cardNumber,
          status: idCard.status,
          issuedAt: idCard.issuedAt?.toISOString?.() ?? null,
          expiresAt: idCard.expiresAt?.toISOString?.() ?? null,
          paths: idCardPaths,
        }
      : null,
    kyc: kyc
      ? {
          hasKyc: true,
          status: kyc.status || 'PENDING',
          updatedAt: kyc.updatedAt?.toISOString?.() ?? null,
        }
      : { hasKyc: false, status: 'NOT_SUBMITTED' },
    nextAction,
  };
}
