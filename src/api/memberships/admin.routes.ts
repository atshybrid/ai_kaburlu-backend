import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin } from '../middlewares/authz';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';

const router = Router();

// Note: Admin APIs tag is defined in payfirst.routes.ts

/**
 * @swagger
 * /memberships/admin:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: List memberships (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING_PAYMENT, PENDING_APPROVAL, ACTIVE, EXPIRED, REVOKED]
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL]
 *       - in: query
 *         name: cellId
 *         schema: { type: string }
 *       - in: query
 *         name: designationId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Membership list
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, status, level, cellId, designationId } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;
    const where: any = {};
    if (userId) where.userId = String(userId);
    if (status) where.status = String(status);
    if (level) where.level = String(level);
    if (cellId) where.cellId = String(cellId);
    if (designationId) where.designationId = String(designationId);
    const rows = await prisma.membership.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { designation: true, cell: true, idCard: true }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    return res.json({ success: true, count: rows.length, nextCursor, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/{id}:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Get membership by ID (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Membership details }
 *       404: { description: Not found }
 */
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const m = await prisma.membership.findUnique({ where: { id: req.params.id }, include: { designation: true, cell: true, idCard: true, payments: true } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: m });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/{id}/status:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Update membership status (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING_PAYMENT, PENDING_APPROVAL, ACTIVE, EXPIRED, REVOKED]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *               note:
 *                 type: string
 *     responses:
 *       200: { description: Status updated }
 */
router.put('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, expiresAt } = req.body || {};
    if (!status) return res.status(400).json({ success: false, error: 'STATUS_REQUIRED' });
    const data: any = { status: String(status) };
    if (expiresAt) data.expiresAt = new Date(expiresAt);
    // If moving to ACTIVE without a card, issue a card
    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.update({ where: { id: req.params.id }, data });
      const hasCard = await tx.iDCard.findUnique({ where: { membershipId: m.id } }).catch(() => null);
      if (m.status === 'ACTIVE' && !hasCard) {
        const cardNumber = `ID-${Date.now().toString(36)}-${m.id.slice(-6)}`;
        await tx.iDCard.create({ data: { membershipId: m.id, cardNumber, expiresAt: new Date(Date.now() + 365*24*60*60*1000) } });
      }
      return m;
    });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STATUS_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/{id}/idcard:
 *   post:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Reissue ID card (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Card issued }
 */
router.post('/:id/idcard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const m = await prisma.membership.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const existing = await prisma.iDCard.findUnique({ where: { membershipId: m.id } }).catch(() => null);
    if (existing) return res.json({ success: true, data: existing });
    // Enforce profile photo requirement
    const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: true } });
    const hasPhoto = !!(user?.profile?.profilePhotoUrl || user?.profile?.profilePhotoMediaId);
    if (!user?.profile || !hasPhoto) return res.status(400).json({ success: false, error: 'PROFILE_PHOTO_REQUIRED' });
  const cardNumber = await generateNextIdCardNumber(prisma as any);
    const card = await prisma.iDCard.create({ data: { membershipId: m.id, cardNumber, expiresAt: new Date(Date.now() + 365*24*60*60*1000) } });
    return res.json({ success: true, data: card });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CARD_ISSUE_FAILED', message: e?.message });
  }
});

export default router;
