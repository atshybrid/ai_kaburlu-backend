import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
import { ensureAppointmentLetterForUser } from '../auth/auth.service';

const router = Router();

// Helper to build public paths for a card
function buildCardPaths(cardNumber: string) {
  return {
    json: `/hrci/idcard/${encodeURIComponent(cardNumber)}`,
    html: `/hrci/idcard/${encodeURIComponent(cardNumber)}/html`,
    qr: `/hrci/idcard/${encodeURIComponent(cardNumber)}/qr`,
  };
}

/**
 * @swagger
 * /memberships/me/idcard:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get your ID card info (if issued)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Card info or hint }
 */
router.get('/me/idcard', requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    // Fetch all memberships for the user (lightweight) with potential card relation
    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: { idCard: true },
      orderBy: { updatedAt: 'desc' }
    });
    if (!memberships || memberships.length === 0) {
      return res.json({ success: true, data: { hasMembership: false, message: 'No membership found' } });
    }

    // Prefer a membership that already has a card; else take the most recent
    let picked = memberships.find(m => !!(m as any).idCard) || memberships[0];
    const card = (picked as any).idCard || null;

    // Reconcile: if card exists but membership.idCardStatus is not GENERATED, fix it silently
    if (card && picked.idCardStatus !== 'GENERATED') {
      try { await prisma.membership.update({ where: { id: picked.id }, data: { idCardStatus: 'GENERATED' as any } }); } catch {}
    }

    if (!card) {
      return res.json({
        success: true,
        data: {
          hasMembership: true,
          hasCard: false,
          membershipId: picked.id,
          idCardStatus: picked.idCardStatus,
          message: picked.idCardStatus === 'NOT_CREATED' ? 'Upload a profile photo and issue your ID card.' : 'ID card not available.'
        }
      });
    }

    // Include current active IdCardSetting in response for the client to style/render
    const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
    const baseUrl = (setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    // Resolve holder fields (from snapshot or live)
    let fullName = (card as any).fullName || '';
    let designationName = (card as any).designationName || '';
    let cellName = (card as any).cellName || '';
    let mobileNumber = (card as any).mobileNumber || '';
    let profilePhotoUrl: string | null = (card as any).profilePhotoUrl || null;
    // Membership/location enrichment scaffolding
    let membershipLevel: string | null = null;
    let zoneValue: string | null = null;
    let hrcCountryId: string | null = null;
    let hrcStateId: string | null = null;
    let hrcDistrictId: string | null = null;
    let hrcMandalId: string | null = null;
    if (!fullName || !designationName || !cellName || !mobileNumber || !profilePhotoUrl) {
      const m = await prisma.membership.findUnique({ where: { id: picked.id }, include: { designation: true, cell: true } });
      if (m) {
        try {
          const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
          fullName = fullName || (user as any)?.profile?.fullName || '';
          mobileNumber = mobileNumber || (user as any)?.mobileNumber || '';
          profilePhotoUrl = profilePhotoUrl || (user as any)?.profile?.profilePhotoUrl || (user as any)?.profile?.profilePhotoMedia?.url || null;
        } catch {}
        designationName = designationName || (m as any).designation?.name || '';
        cellName = cellName || (m as any).cell?.name || '';
        membershipLevel = (m as any).level || null;
        zoneValue = (m as any).zone || null;
        hrcCountryId = (m as any).hrcCountryId || null;
        hrcStateId = (m as any).hrcStateId || null;
        hrcDistrictId = (m as any).hrcDistrictId || null;
        hrcMandalId = (m as any).hrcMandalId || null;
      }
    }
    // Normalize relative profile photo path to absolute
    if (profilePhotoUrl && /^\//.test(profilePhotoUrl)) profilePhotoUrl = `${baseUrl}${profilePhotoUrl}`;
    // Build designation display with level prefix
    const zoneMap: Record<string,string> = { NORTH:'North Zone', SOUTH:'South Zone', EAST:'East Zone', WEST:'West Zone', CENTRAL:'Central Zone' };
    let prefix = '';
    if (membershipLevel === 'ZONE') prefix = zoneValue ? (zoneMap[String(zoneValue).toUpperCase()] || `${String(zoneValue).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} Zone`) : 'Zone';
    else if (membershipLevel === 'NATIONAL') prefix = 'National';
    else if (membershipLevel === 'STATE') prefix = 'State';
    else if (membershipLevel === 'DISTRICT') prefix = 'District';
    else if (membershipLevel === 'MANDAL') prefix = 'Mandal';
    const designationNameFormatted = designationName && prefix ? `${prefix} ${designationName}` : designationName || '';
    const designationDisplay = designationNameFormatted || null;
    // Resolve level location/title
    let levelTitle: string | null = null;
    let levelLocation: any = null;
    let locationTitle: string | null = null;
    let memberLocationName: string | null = null;
    try {
      if (membershipLevel === 'NATIONAL') {
        levelTitle = 'National';
        if (hrcCountryId) {
          const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
          levelLocation = { countryId: hrcCountryId, countryName: c?.name };
          locationTitle = c?.name || 'India';
          memberLocationName = c?.name || 'India';
        } else { locationTitle = memberLocationName = 'India'; }
      } else if (membershipLevel === 'ZONE') {
        levelTitle = 'Zone';
        const c = hrcCountryId ? await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } }) : null;
        const zoneTitle = prefix || '';
        levelLocation = { countryId: hrcCountryId, countryName: c?.name, zone: zoneValue, zoneTitle };
        locationTitle = [c?.name, zoneTitle].filter(Boolean).join(', ') || zoneTitle;
        memberLocationName = zoneTitle || null;
      } else if (membershipLevel === 'STATE' && hrcStateId) {
        levelTitle = 'State';
        const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
        levelLocation = { stateId: hrcStateId, stateName: st?.name, stateCode: st?.code };
        locationTitle = st?.name || null;
        memberLocationName = st?.name || null;
      } else if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
        levelTitle = 'District';
        const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
        const st = dist?.stateId ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
        levelLocation = { stateId: hrcStateId, districtId: hrcDistrictId, districtName: dist?.name, stateName: st?.name };
        locationTitle = [dist?.name, st?.name].filter(Boolean).join(', ') || null;
        memberLocationName = dist?.name || null;
      } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
        levelTitle = 'Mandal';
        const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
        const dist = mandal?.districtId ? await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } }) : null;
        const st = dist?.stateId ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
        levelLocation = { stateId: hrcStateId, districtId: hrcDistrictId, mandalId: hrcMandalId, mandalName: mandal?.name, districtName: dist?.name, stateName: st?.name };
        locationTitle = [mandal?.name, dist?.name, st?.name].filter(Boolean).join(', ') || null;
        memberLocationName = mandal?.name || null;
      }
    } catch {}

    return res.json({
      success: true,
      data: {
        hasMembership: true,
        hasCard: true,
        membershipId: picked.id,
        idCardStatus: 'GENERATED',
        card: {
          id: card.id,
          cardNumber: card.cardNumber,
          status: card.status,
          issuedAt: card.issuedAt,
          expiresAt: card.expiresAt,
          holder: { fullName, mobileNumber, designationName, cellName },
          paths: buildCardPaths(card.cardNumber),
          // Enriched fields similar to public card JSON
          membershipLevel,
          levelTitle,
          levelLocation,
          locationTitle,
          memberLocationName,
          designationDisplay,
          designationNameFormatted,
          profilePhotoUrl,
          photoUrl: profilePhotoUrl,
        },
        setting
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'FETCH_CARD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/me/idcard/issue:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Issue your ID card (requires active membership and profile photo)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Issued card }
 */
router.post('/me/idcard/issue', requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    // Find active membership without a card
    const membership = await prisma.membership.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      include: { idCard: true, designation: true, cell: true }
    });
    if (!membership) return res.status(400).json({ success: false, error: 'NO_ACTIVE_MEMBERSHIP' });
    if (membership.idCard) return res.json({ success: true, data: { alreadyIssued: true, card: { cardNumber: membership.idCard.cardNumber, paths: buildCardPaths(membership.idCard.cardNumber) } } });

    // Ensure profile with photo
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const hasPhoto = !!(user?.profile?.profilePhotoUrl || user?.profile?.profilePhotoMediaId);
    if (!user?.profile || !hasPhoto) return res.status(400).json({ success: false, error: 'PROFILE_PHOTO_REQUIRED', message: 'Please upload a profile photo first.' });

    const cardNumber = await generateNextIdCardNumber(prisma as any);
    // Snapshot details
    const fullName = user.profile.fullName || undefined;
    const mobileNumber = user.mobileNumber || undefined;
    const designationName = (membership as any).designation?.name || undefined;
    const cellName = (membership as any).cell?.name || undefined;
    const validityDays = (membership as any).designation?.validityDays || 365;
    const expiresAt = new Date(Date.now() + (validityDays * 24 * 60 * 60 * 1000));

    const card = await prisma.iDCard.create({
      data: { membershipId: membership.id, cardNumber, expiresAt, fullName, mobileNumber, designationName, cellName } as any
    });
    // Update membership idCardStatus
    await prisma.membership.update({ where: { id: membership.id }, data: { idCardStatus: 'GENERATED' as any } });
    return res.json({ success: true, data: { card: { id: card.id, cardNumber: card.cardNumber, expiresAt: card.expiresAt, paths: buildCardPaths(card.cardNumber) } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ISSUE_CARD_FAILED', message: e?.message });
  }
});

export default router;

/**
 * @swagger
 * /memberships/me/appointment-letter:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get your appointment letter status and URL
 *     description: "Returns whether the appointment letter is generated and the public URL if available. If eligible (ACTIVE membership + KYC APPROVED) and no letter exists yet, the server may generate it on demand. You can force regeneration with ?generate=true."
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: generate
 *         required: false
 *         schema: { type: boolean }
 *         description: "If true, force regeneration even if a URL already exists. Default: false"
 *     responses:
 *       200:
 *         description: Appointment letter status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     hasMembership: { type: boolean }
 *                     eligible: { type: boolean }
 *                     generated: { type: boolean }
 *                     appointmentLetterPdfUrl: { type: string, nullable: true }
 *                     idCardPresent: { type: boolean }
 *                     cardNumber: { type: string, nullable: true }
 *                     kycStatus: { type: string, nullable: true }
 *                     message: { type: string, nullable: true }
 */
router.get('/me/appointment-letter', requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id as string;
    const m = await prisma.membership.findFirst({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: { idCard: true, kyc: true }
    });
    if (!m) return res.json({ success: true, data: { hasMembership: false, eligible: false, generated: false, appointmentLetterPdfUrl: null, message: 'No membership found' } });

    const idCard = (m as any).idCard || null;
    const kyc = (m as any).kyc || null;
    const kycApproved = (kyc?.status || '').toUpperCase() === 'APPROVED';
    const active = m.status === 'ACTIVE' && !(m.expiresAt && m.expiresAt < new Date());
    const eligible = active && kycApproved;

    let url: string | null = (idCard?.appointmentLetterPdfUrl as any) || null;
    const force = String(req.query.generate || '').toLowerCase() === 'true';

    // Generate on demand when eligible and not yet generated, or force = true
    if ((eligible && !url) || (eligible && force)) {
      try {
        url = await ensureAppointmentLetterForUser(userId, force);
      } catch (e) {
        // keep url as-is; attach a message below
      }
    }

    let message: string | null = null;
    if (!eligible) {
      if (!kycApproved) message = 'KYC not approved yet.';
      if (!active) message = message ? `${message} Also, membership is not ACTIVE.` : 'Membership is not ACTIVE.';
    } else if (!url) {
      message = 'Eligible, but appointment letter is not generated yet.';
    }

    return res.json({
      success: true,
      data: {
        hasMembership: true,
        eligible,
        generated: Boolean(url),
        appointmentLetterPdfUrl: url || null,
        idCardPresent: Boolean(idCard),
        cardNumber: idCard?.cardNumber || null,
        kycStatus: kyc?.status || null,
        message
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'APPT_LETTER_STATUS_FAILED', message: e?.message });
  }
});

// Consolidated member profile for front-end ease
/**
 * @swagger
 * /memberships/me/profile:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get consolidated member profile (designation, user profile, id card)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Consolidated member profile
 */
router.get('/me/profile', requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, profile: { include: { profilePhotoMedia: true } } } as any });
    if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { designation: true, cell: true, idCard: true, kyc: true }
    });

    // Resolve language details
    const language = user.languageId ? await prisma.language.findUnique({ where: { id: user.languageId } }) : null;
    // Pull latest device and location for convenience
    const device = await prisma.device.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    const preciseLocation = await prisma.userLocation.findUnique({ where: { userId } });

    // Profile photo resolution
    const photoUrl = (user as any).profile?.profilePhotoUrl || (user as any).profile?.profilePhotoMedia?.url || null;

    // Build clear structures
    const designation = membership?.designation ? {
      id: membership.designation.id,
      code: membership.designation.code,
      name: membership.designation.name,
      validityDays: membership.designation.validityDays,
      defaultCapacity: membership.designation.defaultCapacity
    } : null;

    const cell = membership?.cell ? { id: membership.cell.id, code: membership.cell.code, name: membership.cell.name } : null;

    let hrci: any = null;
    if (membership) {
      // resolve geo names for convenience
      const [state, district, mandal] = await Promise.all([
        membership.hrcStateId ? (prisma as any).hrcState.findUnique({ where: { id: membership.hrcStateId } }) : Promise.resolve(null),
        membership.hrcDistrictId ? (prisma as any).hrcDistrict.findUnique({ where: { id: membership.hrcDistrictId } }) : Promise.resolve(null),
        membership.hrcMandalId ? (prisma as any).hrcMandal.findUnique({ where: { id: membership.hrcMandalId } }) : Promise.resolve(null)
      ]);
      hrci = {
        zone: membership.zone || null,
        country: membership.hrcCountryId || null,
        state: state ? { id: state.id, name: state.name } : null,
        district: district ? { id: district.id, name: district.name } : null,
        mandal: mandal ? { id: mandal.id, name: mandal.name, districtId: mandal.districtId } : null
      };
    }

    const card = membership?.idCard ? {
      id: membership.idCard.id,
      cardNumber: membership.idCard.cardNumber,
      status: membership.idCard.status,
      issuedAt: membership.idCard.issuedAt,
      expiresAt: membership.idCard.expiresAt,
      paths: membership.idCard.cardNumber ? buildCardPaths(membership.idCard.cardNumber) : null
    } : null;

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          mobileNumber: user.mobileNumber,
          role: (user as any).role?.name || null,
          languageId: user.languageId,
          language: language ? { id: language.id, code: (language as any).code || null, name: (language as any).name || null } : null,
          profile: {
            fullName: (user as any).profile?.fullName || null,
            gender: (user as any).profile?.gender || null,
            dob: (user as any).profile?.dob || null,
            profilePhotoUrl: photoUrl
          }
        },
        device: device ? {
          deviceId: device.deviceId,
          deviceModel: device.deviceModel,
          pushToken: (device as any).pushToken || null,
          hasPushToken: Boolean((device as any).pushToken)
        } : null,
        location: preciseLocation ? {
          latitude: preciseLocation.latitude,
          longitude: preciseLocation.longitude,
          accuracyMeters: preciseLocation.accuracyMeters,
          provider: preciseLocation.provider,
          timestampUtc: preciseLocation.timestampUtc,
          placeId: preciseLocation.placeId,
          placeName: preciseLocation.placeName,
          address: preciseLocation.address,
          source: preciseLocation.source
        } : null,
        membership: membership ? {
          id: membership.id,
          level: membership.level,
          status: membership.status,
          paymentStatus: membership.paymentStatus,
          idCardStatus: membership.idCardStatus,
          activatedAt: membership.activatedAt,
          expiresAt: membership.expiresAt,
          cell,
          designation,
          hrci,
          lastPayment: await (async () => {
            const mp = await (prisma as any).membershipPayment.findFirst({ where: { membershipId: membership.id }, orderBy: { updatedAt: 'desc' } });
            return mp ? { amount: mp.amount, status: mp.status, providerRef: mp.providerRef, createdAt: mp.createdAt } : null;
          })(),
          kyc: membership.kyc ? { hasKyc: true, status: (membership as any).kyc?.status || 'PENDING', updatedAt: (membership as any).kyc?.updatedAt } : { hasKyc: false, status: 'NOT_SUBMITTED' }
        } : null,
        card,
        nextAction: !photoUrl && membership && membership.idCardStatus === 'NOT_CREATED'
          ? { type: 'UPLOAD_PHOTO', reason: 'Upload a profile photo to generate your ID card.' }
          : null
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'PROFILE_FETCH_FAILED', message: e?.message });
  }
});

// Simple alias to provide a single, role-aware /me endpoint returning the same payload
router.get('/me', requireAuth, async (req: any, res, next) => {
  // Delegate to the same handler as /me/profile by calling the route function
  // Instead of duplicating logic, re-query and return identical structure
  try {
    const fakeReq: any = req; // reuse same request context
    const userId = fakeReq.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, profile: { include: { profilePhotoMedia: true } } } as any });
    if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { designation: true, cell: true, idCard: true, kyc: true }
    });

    const photoUrl = (user as any).profile?.profilePhotoUrl || (user as any).profile?.profilePhotoMedia?.url || null;
    const designation = membership?.designation ? {
      id: membership.designation.id,
      code: membership.designation.code,
      name: membership.designation.name,
      validityDays: membership.designation.validityDays,
      defaultCapacity: membership.designation.defaultCapacity
    } : null;
    const cell = membership?.cell ? { id: membership.cell.id, code: membership.cell.code, name: membership.cell.name } : null;
    let hrci: any = null;
    if (membership) {
      const [state, district, mandal] = await Promise.all([
        membership.hrcStateId ? (prisma as any).hrcState.findUnique({ where: { id: membership.hrcStateId } }) : Promise.resolve(null),
        membership.hrcDistrictId ? (prisma as any).hrcDistrict.findUnique({ where: { id: membership.hrcDistrictId } }) : Promise.resolve(null),
        membership.hrcMandalId ? (prisma as any).hrcMandal.findUnique({ where: { id: membership.hrcMandalId } }) : Promise.resolve(null)
      ]);
      hrci = {
        zone: membership.zone || null,
        country: membership.hrcCountryId || null,
        state: state ? { id: state.id, name: state.name } : null,
        district: district ? { id: district.id, name: district.name } : null,
        mandal: mandal ? { id: mandal.id, name: mandal.name, districtId: mandal.districtId } : null
      };
    }
    const card = membership?.idCard ? {
      id: membership.idCard.id,
      cardNumber: membership.idCard.cardNumber,
      status: membership.idCard.status,
      issuedAt: membership.idCard.issuedAt,
      expiresAt: membership.idCard.expiresAt,
      paths: membership.idCard.cardNumber ? buildCardPaths(membership.idCard.cardNumber) : null
    } : null;

    const language = user.languageId ? await prisma.language.findUnique({ where: { id: user.languageId } }) : null;
    const device = await prisma.device.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    const preciseLocation = await prisma.userLocation.findUnique({ where: { userId } });

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          mobileNumber: user.mobileNumber,
          role: (user as any).role?.name || null,
          languageId: user.languageId,
          language: language ? { id: language.id, code: (language as any).code || null, name: (language as any).name || null } : null,
          profile: {
            fullName: (user as any).profile?.fullName || null,
            gender: (user as any).profile?.gender || null,
            dob: (user as any).profile?.dob || null,
            profilePhotoUrl: photoUrl
          }
        },
        device: device ? {
          deviceId: device.deviceId,
          deviceModel: device.deviceModel,
          pushToken: (device as any).pushToken || null,
          hasPushToken: Boolean((device as any).pushToken)
        } : null,
        location: preciseLocation ? {
          latitude: preciseLocation.latitude,
          longitude: preciseLocation.longitude,
          accuracyMeters: preciseLocation.accuracyMeters,
          provider: preciseLocation.provider,
          timestampUtc: preciseLocation.timestampUtc,
          placeId: preciseLocation.placeId,
          placeName: preciseLocation.placeName,
          address: preciseLocation.address,
          source: preciseLocation.source
        } : null,
        membership: membership ? {
          id: membership.id,
          level: membership.level,
          status: membership.status,
          paymentStatus: membership.paymentStatus,
          idCardStatus: membership.idCardStatus,
          activatedAt: membership.activatedAt,
          expiresAt: membership.expiresAt,
          cell,
          designation,
          hrci,
          lastPayment: await (async () => {
            const mp = await (prisma as any).membershipPayment.findFirst({ where: { membershipId: membership.id }, orderBy: { updatedAt: 'desc' } });
            return mp ? { amount: mp.amount, status: mp.status, providerRef: mp.providerRef, createdAt: mp.createdAt } : null;
          })(),
          kyc: membership.kyc ? { hasKyc: true, status: (membership as any).kyc?.status || 'PENDING', updatedAt: (membership as any).kyc?.updatedAt } : { hasKyc: false, status: 'NOT_SUBMITTED' }
        } : null,
        card,
        nextAction: !photoUrl && membership && membership.idCardStatus === 'NOT_CREATED'
          ? { type: 'UPLOAD_PHOTO', reason: 'Upload a profile photo to generate your ID card.' }
          : null
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'PROFILE_FETCH_FAILED', message: e?.message });
  }
});
