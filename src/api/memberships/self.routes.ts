import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';

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
    // Resolve holder fields (from snapshot or live)
    let fullName = (card as any).fullName || '';
    let designationName = (card as any).designationName || '';
    let cellName = (card as any).cellName || '';
    let mobileNumber = (card as any).mobileNumber || '';
    if (!fullName || !designationName || !cellName || !mobileNumber) {
      const m = await prisma.membership.findUnique({ where: { id: picked.id }, include: { designation: true, cell: true } });
      if (m) {
        try {
          const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: true } });
          fullName = fullName || (user as any)?.profile?.fullName || '';
          mobileNumber = mobileNumber || (user as any)?.mobileNumber || '';
        } catch {}
        designationName = designationName || (m as any).designation?.name || '';
        cellName = cellName || (m as any).cell?.name || '';
      }
    }

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
          paths: buildCardPaths(card.cardNumber)
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
      include: { designation: true, cell: true, idCard: true }
    });

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
          profile: {
            fullName: (user as any).profile?.fullName || null,
            gender: (user as any).profile?.gender || null,
            dob: (user as any).profile?.dob || null,
            profilePhotoUrl: photoUrl
          }
        },
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
          })()
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
