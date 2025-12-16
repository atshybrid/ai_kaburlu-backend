export const logout = async (refreshToken: string, deviceId: string) => {
  // TODO: Implement token invalidation and device/session tracking if needed
  // For now, just scaffold (no-op)
  return true;
};
import { buildUserMobileLookupWhere, normalizeMobileNumber } from '../../lib/mobileNumber';
export const checkUserExists = async (mobile: string) => {
  const norm = normalizeMobileNumber(mobile);
  if (!norm) return false;
  const user = await prisma.user.findFirst({ where: buildUserMobileLookupWhere(norm) as any });
  return !!user;
};

import { findUserByMobileNumber } from '../users/users.service';
import { MpinLoginDto } from './mpin-login.dto';
import { RefreshDto } from './refresh.dto';
import { GuestRegistrationDto } from './guest-registration.dto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import prisma from '../../lib/prisma';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { generateAppointmentLetterPdf, generateAppointmentLetterPdfHtmlBg, buildAppointmentLetterHtml } from '../../lib/pdf/generateAppointmentLetter';

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
  const normMobile = normalizeMobileNumber(loginDto.mobileNumber);
  console.log("Attempting to log in with mobile number:", normMobile || loginDto.mobileNumber);
  const user = await findUserByMobileNumber(normMobile || loginDto.mobileNumber);
  if (!user) {
    console.log("User not found for mobile number:", normMobile || loginDto.mobileNumber);
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
  // Resolve user's language details (id, code, name)
  const userLanguage = user.languageId ? await prisma.language.findUnique({ where: { id: user.languageId } }) : null;
  const device = await prisma.device.findFirst({ 
    where: { userId: user.id }, 
    orderBy: { updatedAt: 'desc' } 
  }); // Get most recent device

  // Build membership/payment/ID card summary for login UX
  const membershipSummary = await getMembershipSummary(user.id, !!userProfile?.profilePhotoUrl);
  // Ensure appointment letter URL if eligible; attach to response
  let appointmentLetterUrl: string | null = null;
  try {
    appointmentLetterUrl = await ensureAppointmentLetterForUser(user.id);
  } catch {}

  const result: any =  {
    jwt: accessToken,
    refreshToken: refreshToken,
    expiresIn: 86400, // seconds (1 day)
    user: {
      userId: user.id,
      role: role?.name,
      languageId: user.languageId,
      language: userLanguage ? { id: userLanguage.id, code: (userLanguage as any).code || null, name: (userLanguage as any).name || null } : null,
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
    result.membership = { ...membershipSummary, appointmentLetterPdfUrl: appointmentLetterUrl };
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

/**
 * If the user has an ACTIVE membership with ID card issued and KYC approved,
 * generate an appointment letter PDF (if not already generated), upload to R2, and persist URL on IDCard.
 * Returns the public URL, or null if not eligible.
 */
 
export async function ensureAppointmentLetterForUser(userId: string, force = false): Promise<string | null> {
  const m = await prisma.membership.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: { idCard: true, kyc: true, designation: true, cell: true }
  });
  if (!m) return null;
  const idCard = (m as any).idCard || null;
  const kyc = (m as any).kyc || null;
  const kycApproved = (kyc?.status || '').toUpperCase() === 'APPROVED';
  const active = m.status === 'ACTIVE' && !((m.expiresAt && m.expiresAt < new Date()));
  // Relax eligibility: generate letter when membership is ACTIVE and KYC is approved,
  // even if ID card is not yet generated. Persist URL on IDCard if present.
  if (!(active && kycApproved)) return null;

  // If we already have a stored PDF URL and we're not forcing regeneration,
  // auto-fix legacy PDFs (old layout like left-side stamp) by regenerating once.
  if (idCard && !force && idCard.appointmentLetterPdfUrl) {
    const url: string = idCard.appointmentLetterPdfUrl as string;
    const generatedAt: Date | null = (idCard as any).appointmentLetterGeneratedAt || null;
    // Heuristics for legacy PDFs to regenerate automatically once:
    // 1) URL missing a timestamp suffix (e.g., -<digits>.pdf)
    // 2) URL not under the expected path 'memberships/appointments/'
    // 3) Generated before the stamp alignment fix rollout cutoff
    const hasTimestamp = /-\d+\.pdf$/i.test(url);
    const inNewPath = url.includes('/memberships/appointments/');
  const cutoff = new Date('2025-10-25T00:00:00Z');
    const beforeCutoff = !!(generatedAt && generatedAt.getTime() < cutoff.getTime());
    const looksLegacy = !hasTimestamp || !inNewPath || beforeCutoff;
    if (!looksLegacy) {
      return url;
    }
    // else fall-through to regenerate
  }

  // Build organization info
  const org = await prisma.orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
  // Fetch active ID card setting for asset fallbacks (logo/stamp)
  const idcardSetting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  // Try to resolve letterhead PDF and image URLs from org.documents
  let letterheadPdfUrl: string | null = null;
  let letterheadImageUrl: string | null = null;
  try {
    const docs = Array.isArray((org as any)?.documents) ? ((org as any).documents as any[]) : [];
    for (const d of docs) {
      const t = String(d?.type || '').toLowerCase();
      const title = String(d?.title || '').toLowerCase();
      const url = String(d?.url || '');
      if ((t === 'letterhead' || title.includes('letterhead')) && url) {
        if (/\.pdf($|\?)/i.test(url)) letterheadPdfUrl = url;
        if (/\.(png|jpe?g|webp)($|\?)/i.test(url)) letterheadImageUrl = url;
      }
    }
  } catch {}
  const orgPublic = {
    orgName: org?.orgName || 'HRCI',
    addressLine1: org?.addressLine1 || null,
    addressLine2: org?.addressLine2 || null,
    city: org?.city || null,
    state: org?.state || null,
    pincode: org?.pincode || null,
    country: org?.country || null,
    email: (org as any)?.email || null,
    website: (org as any)?.website || null,
    phone: (org as any)?.phone || null,
    // Default registration line if not configured
    orgRegd: ((org as any)?.documents && (Array.isArray((org as any).documents) ? (org as any).documents.find((d: any) => d?.type === 'registration')?.title : null)) ||
             'Regd. No: 4396 / 2022 under Trust Act 1882, Govt. of India, NCT Delhi',
    authorizedSignatoryName: org?.authorizedSignatoryName || null,
    authorizedSignatoryTitle: org?.authorizedSignatoryTitle || null,
    // Prefer OrgSetting assets; fallback to ID card setting assets when org is missing
    hrciLogoUrl: (org?.hrciLogoUrl || (idcardSetting as any)?.frontLogoUrl || null),
    stampRoundUrl: (org?.stampRoundUrl || (idcardSetting as any)?.hrciStampUrl || null),
    letterheadPdfUrl,
    letterheadImageUrl,
  } as any;

  // Build letter data
  // Build jurisdiction emphasis: prefer District name specifically (as requested), fallback to a combined path.
  const jurisdictionParts: string[] = [];
  let districtName: string | null = null;
  if ((m as any).hrcStateId) {
    try {
      const s = await (prisma as any).hrcState.findUnique({ where: { id: (m as any).hrcStateId } });
      if (s) jurisdictionParts.push(s.name);
    } catch {}
  }
  if ((m as any).hrcDistrictId) {
    try {
      const d = await (prisma as any).hrcDistrict.findUnique({ where: { id: (m as any).hrcDistrictId } });
      if (d) {
        districtName = d.name;
        jurisdictionParts.push(d.name);
      }
    } catch {}
  }
  if ((m as any).hrcMandalId) {
    try {
      const md = await (prisma as any).hrcMandal.findUnique({ where: { id: (m as any).hrcMandalId } });
      if (md) jurisdictionParts.push(md.name);
    } catch {}
  }
  // Build recipient address lines from profile if present
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { fullName: true, address: true, gender: true } }).catch(() => null) as any;
  let address1: string | null = null;
  let address2: string | null = null;
  try {
    const a = (profile?.address || null) as any;
    if (a) {
      const line1 = a.addressLine1 || a.line1 || a.address1 || null;
      const city = a.city || null;
      const st = a.state || null;
      const pin = a.pincode || a.pin || a.zip || null;
      address1 = line1 || null;
      address2 = [city, st, pin].filter(Boolean).join(', ') || null;
    }
  } catch {}
  const salutationPrefix = 'Mr./Ms.'; // we can enhance via profile.gender
  const levelText = String(m.level);
  const subjectLine = `Appointment as ${levelText} Member of Human Rights Council for India (HRCI)`;
  const effectiveFromDate = (idCard?.issuedAt || m.activatedAt || new Date());
  const fmt = (d: Date | null | undefined) => {
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  // validity period label
  let validityPeriod: string | null = null;
  if (idCard?.expiresAt && effectiveFromDate) {
    const days = Math.round((idCard.expiresAt.getTime() - effectiveFromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 700) validityPeriod = 'Two Years';
    else if (days >= 360) validityPeriod = 'One Year';
  }

  const letterData = {
    letterNo: `HRCI/APPT/${new Date().getFullYear()}/${((idCard?.cardNumber || m.id) as string).slice(-6).toUpperCase()}`,
    letterDate: fmt(new Date()) || '',
    recipientSalutation: salutationPrefix,
    memberName: (idCard?.fullName || profile?.fullName || 'Member'),
    recipientAddress1: address1,
    recipientAddress2: address2,
    subjectLine,
    designationName: (idCard?.designationName || (m as any).designation?.name || 'Member'),
    cellName: (idCard?.cellName || (m as any).cell?.name || null),
    level: levelText,
    effectiveFrom: fmt(effectiveFromDate),
    validityPeriod,
    cardNumber: (idCard?.cardNumber || null),
    validityTo: (fmt(idCard?.expiresAt || null) || fmt(m.expiresAt) || null),
    mobileNumber: (idCard?.mobileNumber || (await prisma.user.findUnique({ where: { id: userId }, select: { mobileNumber: true } }))?.mobileNumber || null),
    placeLine: districtName ? `| Place: ${districtName}` : '',
    joiningDate: (fmt(m.activatedAt || idCard?.issuedAt || null) || null),
    memberCreatedDate: fmt(m.createdAt) || null,
    locationDisplay: await (async () => {
      try {
        const loc = await prisma.userLocation.findUnique({ where: { userId } }).catch(() => null) as any;
        const profileAddr = (profile?.address || null) as any;
        const profileCityState = [profileAddr?.city, profileAddr?.state].filter(Boolean).join(', ');
        return (loc?.placeName || profileCityState || null);
      } catch { return null; }
    })(),
  } as any;

  // Choose generation mode: default to PDF overlay; allow env override to 'html'
  const mode = (process.env.APPT_LETTER_MODE || '').toLowerCase();
  const useHtmlBg = (mode === 'html' && !!letterheadImageUrl);
  const pdf = useHtmlBg && letterheadImageUrl
    ? await generateAppointmentLetterPdfHtmlBg(orgPublic, letterData, letterheadImageUrl)
    : await generateAppointmentLetterPdf(orgPublic, letterData);
  if (!R2_BUCKET) throw new Error('STORAGE_NOT_CONFIGURED');
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const safeId = (idCard.cardNumber || m.id).replace(/[^A-Za-z0-9_-]/g, '_');
  // Use a timestamped filename to avoid CDN/browser cache serving older A5 PDFs
  const key = `memberships/appointments/${datePath}/${safeId}-${now.getTime()}.pdf`;
  await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: Buffer.from(pdf), ContentType: 'application/pdf', CacheControl: 'public, max-age=31536000' }));
  const pdfUrl = getPublicUrl(key);
  // Cast data as any to avoid transient TS mismatch when Prisma Client types are stale in the editor.
  // Runtime is safe because the schema and generated client support these fields.
  // Persist on IDCard when available; otherwise, return URL without persistence
  if (idCard) {
    await prisma.iDCard.update({ where: { id: idCard.id }, data: { appointmentLetterPdfUrl: pdfUrl, appointmentLetterGeneratedAt: new Date() } as any });
  }
  return pdfUrl;
}
