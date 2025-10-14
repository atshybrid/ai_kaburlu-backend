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
    // Prefer the latest active membership
    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { idCard: true, designation: true, cell: true }
    });
    if (!membership) return res.json({ success: true, data: { hasMembership: false, message: 'No membership found' } });
    const card = membership.idCard || null;
    if (!card) {
      return res.json({ success: true, data: { hasMembership: true, hasCard: false, membershipId: membership.id, idCardStatus: membership.idCardStatus, message: membership.idCardStatus === 'NOT_CREATED' ? 'Upload a profile photo and issue your ID card.' : 'ID card not available.' } });
    }
    return res.json({ success: true, data: { hasMembership: true, hasCard: true, card: { id: card.id, cardNumber: card.cardNumber, status: card.status, issuedAt: card.issuedAt, expiresAt: card.expiresAt, paths: buildCardPaths(card.cardNumber) } } });
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
