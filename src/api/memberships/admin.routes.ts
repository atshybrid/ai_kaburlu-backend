import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin, requireHrcAdmin } from '../middlewares/authz';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
// Redeem codes are no longer used in simplified policy
import { membershipService } from '../../lib/membershipService';

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
router.get('/', requireAuth, requireHrcAdmin, async (req, res) => {
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
 * /memberships/admin/{id}/assign:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Reassign membership seat (level/cell/designation/location)
 *     description: |
 *       Moves an existing membership to a new seat specification after verifying capacity.
 *       - Validates designation capacity and optional cell-level aggregate capacity.
 *       - Computes new fee using DesignationPrice overrides and adjusts payment status accordingly.
 *       - If dryRun=true, returns the computed outcome without persisting changes.
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
 *             required: [cell, level]
 *             properties:
 *               cell: { type: string, description: "Cell id or code or name" }
 *               designationCode: { type: string, nullable: true }
 *               designationId: { type: string, nullable: true }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               zone: { type: string, nullable: true }
 *               hrcCountryId: { type: string, nullable: true }
 *               hrcStateId: { type: string, nullable: true }
 *               hrcDistrictId: { type: string, nullable: true }
 *               hrcMandalId: { type: string, nullable: true }
 *               dryRun: { type: boolean, default: false }
 *     responses:
 *       200: { description: Reassignment result }
 */
router.put('/:id/assign', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const membershipId = String(req.params.id);
    const { cell, designationCode, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId, dryRun } = req.body || {};
    if (!cell) return res.status(400).json({ success: false, error: 'CELL_REQUIRED' });
    if (!level) return res.status(400).json({ success: false, error: 'LEVEL_REQUIRED' });
    if (!designationCode && !designationId) return res.status(400).json({ success: false, error: 'DESIGNATION_REQUIRED' });

    // Level-specific mandatory fields
    const lvl = String(level);
    if (lvl === 'ZONE' && !zone) return res.status(400).json({ success: false, error: 'ZONE_REQUIRED' });
    if (lvl === 'STATE' && !hrcStateId) return res.status(400).json({ success: false, error: 'HRC_STATE_ID_REQUIRED' });
    if (lvl === 'DISTRICT' && !hrcDistrictId) return res.status(400).json({ success: false, error: 'HRC_DISTRICT_ID_REQUIRED' });
    if (lvl === 'MANDAL' && !hrcMandalId) return res.status(400).json({ success: false, error: 'HRC_MANDAL_ID_REQUIRED' });

  const outcome = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { payments: true } });
      if (!m) throw new Error('MEMBERSHIP_NOT_FOUND');

      const cellRow = await tx.cell.findFirst({ where: { OR: [ { id: String(cell) }, { code: String(cell) }, { name: String(cell) } ] } });
      if (!cellRow) throw new Error('CELL_NOT_FOUND');
      const desigRow = designationId
        ? await tx.designation.findUnique({ where: { id: String(designationId) } })
        : await tx.designation.findFirst({ where: { OR: [ { code: String(designationCode) }, { id: String(designationCode) } ] } });
      if (!desigRow) throw new Error('DESIGNATION_NOT_FOUND');

      // Build filters for capacity checks, excluding the current record to simulate move
      const whereBase: any = {
        cellId: cellRow.id,
        designationId: desigRow.id,
        level: lvl,
        status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] },
        NOT: { id: m.id },
      };
      if (lvl === 'ZONE') whereBase.zone = zone || null;
      if (lvl === 'NATIONAL') whereBase.hrcCountryId = hrcCountryId || null;
      if (lvl === 'STATE') whereBase.hrcStateId = hrcStateId || null;
      if (lvl === 'DISTRICT') whereBase.hrcDistrictId = hrcDistrictId || null;
      if (lvl === 'MANDAL') whereBase.hrcMandalId = hrcMandalId || null;

      const used = await tx.membership.count({ where: whereBase });
      if (used >= desigRow.defaultCapacity) {
        return { accepted: false, reason: 'NO_SEATS_DESIGNATION', remaining: 0 };
      }

      // Level aggregate cap (if any). Note: capacity rows stored without geo for STATE/DISTRICT/MANDAL in current design.
      const levelCap = await tx.cellLevelCapacity.findFirst({
        where: {
          cellId: cellRow.id,
          level: lvl as any,
          zone: lvl === 'ZONE' ? (zone || null) : null,
          hrcStateId: null,
          hrcDistrictId: null,
          hrcMandalId: null,
        }
      });
      if (levelCap) {
        const aggWhere: any = {
          cellId: cellRow.id,
          level: lvl,
          status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] },
          NOT: { id: m.id },
        };
        if (lvl === 'ZONE') aggWhere.zone = zone || null;
        if (lvl === 'NATIONAL') aggWhere.hrcCountryId = hrcCountryId || null;
        if (lvl === 'STATE') aggWhere.hrcStateId = hrcStateId || null;
        if (lvl === 'DISTRICT') aggWhere.hrcDistrictId = hrcDistrictId || null;
        if (lvl === 'MANDAL') aggWhere.hrcMandalId = hrcMandalId || null;
        const aggregateUsed = await tx.membership.count({ where: aggWhere });
        if (aggregateUsed >= levelCap.capacity) {
          return { accepted: false, reason: 'NO_SEATS_LEVEL_AGGREGATE', remaining: 0 };
        }
      }

      // Determine next seatSequence for the target bucket (max+1 to avoid collisions)
      const maxSeat = await tx.membership.aggregate({ where: whereBase, _max: { seatSequence: true } });
      const nextSeat = (maxSeat._max.seatSequence || 0) + 1;

      // Price via availability resolver (reuses override logic)
      const availability = await (membershipService as any).getAvailability({
        cellCodeOrName: cellRow.id,
        designationCode: desigRow.id,
        level: lvl,
        zone,
        hrcCountryId,
        hrcStateId,
        hrcDistrictId,
        hrcMandalId,
      });
      const newFee: number = availability?.designation?.fee ?? 0;

      // Payment impact
      const paidSum = (m.payments || []).filter((p: any) => p.status === 'SUCCESS').reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deltaDue = Math.max(0, newFee - paidSum);
      const willRequirePayment = deltaDue > 0;

      // Compute post-update statuses conservatively
      let targetPaymentStatus = m.paymentStatus as any;
      let targetStatus = m.status as any;
      if (willRequirePayment) {
        targetPaymentStatus = 'PENDING';
        targetStatus = 'PENDING_PAYMENT';
      } else {
        // No further amount due. If previously pending payment and now zero-due, move to PENDING_APPROVAL (unless already ACTIVE)
        if (m.status !== 'ACTIVE') {
          targetStatus = 'PENDING_APPROVAL';
        }
        targetPaymentStatus = paidSum > 0 ? 'SUCCESS' : 'NOT_REQUIRED';
      }

      const preview = {
        accepted: true,
        membershipId,
        to: {
          cellId: cellRow.id,
          designationId: desigRow.id,
          level: lvl,
          zone: lvl === 'ZONE' ? (zone || null) : null,
          hrcCountryId: lvl === 'NATIONAL' ? (hrcCountryId || null) : null,
          hrcStateId: lvl === 'STATE' ? (hrcStateId || null) : null,
          hrcDistrictId: lvl === 'DISTRICT' ? (hrcDistrictId || null) : null,
          hrcMandalId: lvl === 'MANDAL' ? (hrcMandalId || null) : null,
          seatSequence: nextSeat,
        },
        pricing: { fee: newFee, paid: paidSum, deltaDue },
        status: { from: { status: m.status, paymentStatus: m.paymentStatus }, to: { status: targetStatus, paymentStatus: targetPaymentStatus } },
      };

      if (dryRun) return preview;

      // Persist assignment
      const updated = await tx.membership.update({
        where: { id: m.id },
        data: {
          cellId: cellRow.id,
          designationId: desigRow.id,
          level: lvl as any,
          zone: lvl === 'ZONE' ? (zone || null) : null,
          hrcCountryId: lvl === 'NATIONAL' ? (hrcCountryId || null) : null,
          hrcStateId: lvl === 'STATE' ? (hrcStateId || null) : null,
          hrcDistrictId: lvl === 'DISTRICT' ? (hrcDistrictId || null) : null,
          hrcMandalId: lvl === 'MANDAL' ? (hrcMandalId || null) : null,
          seatSequence: nextSeat,
          status: targetStatus,
          paymentStatus: targetPaymentStatus,
          lockedAt: new Date(),
        }
      });

      // Create additional payment record if needed
      if (willRequirePayment) {
        await tx.membershipPayment.create({ data: { membershipId: m.id, amount: deltaDue, status: 'PENDING' } });
      }

      return { ...preview, data: updated };
  }, { timeout: 15000 });

    if (!outcome.accepted) return res.status(409).json({ success: false, ...outcome });
    return res.json({ success: true, data: outcome });
  } catch (e: any) {
    const message = e?.message || String(e);
    if (message === 'MEMBERSHIP_NOT_FOUND' || message === 'CELL_NOT_FOUND' || message === 'DESIGNATION_NOT_FOUND') {
      return res.status(404).json({ success: false, error: message });
    }
    return res.status(500).json({ success: false, error: 'ASSIGN_FAILED', message });
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
// Important: avoid matching '/discounts' as ':id' to ensure HRCI discount routes work
router.get('/:id', (req, res, next) => {
  if (req.params.id === 'discounts') return next('route');
  return next();
}, requireAuth, requireHrcAdmin, async (req, res) => {
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
router.put('/:id/status', (req, res, next) => {
  if (req.params.id === 'discounts') return next('route');
  return next();
}, requireAuth, requireHrcAdmin, async (req, res) => {
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
  }, { timeout: 15000 });
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
router.post('/:id/idcard', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const membership = await prisma.membership.findUnique({ where: { id: req.params.id }, include: { designation: true, cell: true } });
    if (!membership) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    // Enforce profile photo requirement
    const user = await prisma.user.findUnique({ where: { id: membership.userId }, include: { profile: true } });
    const hasPhoto = !!(user?.profile?.profilePhotoUrl || user?.profile?.profilePhotoMediaId);
    if (!user?.profile || !hasPhoto) return res.status(400).json({ success: false, error: 'PROFILE_PHOTO_REQUIRED' });

    // Compute new card details
    const cardNumber = await generateNextIdCardNumber(prisma as any);
    const validityDays = (membership as any).designation?.validityDays || 365;
    const expiresAt = new Date(Date.now() + (validityDays * 24 * 60 * 60 * 1000));
    const fullName = (user as any).profile?.fullName || undefined;
    const mobileNumber = (user as any).mobileNumber || undefined;
    const designationName = (membership as any).designation?.name || undefined;
    const cellName = (membership as any).cell?.name || undefined;

    // Reissue: update existing card if present, else create
    const existing = await prisma.iDCard.findUnique({ where: { membershipId: membership.id } }).catch(() => null);
    let card;
    if (existing) {
      card = await prisma.iDCard.update({
        where: { id: existing.id },
        data: {
          cardNumber,
          issuedAt: new Date(),
          expiresAt,
          status: 'GENERATED' as any,
          fullName,
          mobileNumber,
          designationName,
          cellName,
        } as any
      });
    } else {
      card = await prisma.iDCard.create({
        data: {
          membershipId: membership.id,
          cardNumber,
          expiresAt,
          status: 'GENERATED' as any,
          fullName,
          mobileNumber,
          designationName,
          cellName,
        } as any
      });
    }
    // Ensure membership reflects card generated
    try { await prisma.membership.update({ where: { id: membership.id }, data: { idCardStatus: 'GENERATED' as any } }); } catch {}
    return res.json({ success: true, data: card });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CARD_ISSUE_FAILED', message: e?.message });
  }
});

// --------------------
// Discount Management
// --------------------

function pickPercentOnly(d: any, baseAmount: number): { amount: number; type: 'PERCENT' | null; percent?: number | null } {
  if (!d) return { amount: 0, type: null, percent: null };
  const percentOk = typeof d.percentOff === 'number' && d.percentOff > 0;
  if (percentOk) return { amount: Math.max(0, Math.floor((baseAmount * d.percentOff) / 100)), type: 'PERCENT', percent: d.percentOff };
  return { amount: 0, type: null, percent: null };
}

function withinWindow(d: any): boolean {
  const now = new Date();
  if (d.activeFrom && new Date(d.activeFrom) > now) return false;
  if (d.activeTo && new Date(d.activeTo) < now) return false;
  return true;
}

/**
 * @swagger
 * /memberships/admin/discounts:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: List discounts (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *       - in: query
 *         name: mobileNumber
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Discounts list }
 */
// Keep all /discounts routes defined before generic /:id routes
router.get('/discounts', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { status, code, mobileNumber } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;
    const where: any = {};
    if (status) where.status = String(status);
    if (code) where.code = String(code);
    if (mobileNumber) where.mobileNumber = String(mobileNumber);
    const rows = await (prisma as any).discount.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    return res.json({ success: true, count: rows.length, nextCursor, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/discounts:
 *   post:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Create a discount (admin)
 *     description: "Simplified policy: mobile-number-only and percentage-based discounts. Strict rule: only ONE ACTIVE or RESERVED discount per mobileNumber at any time."
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobileNumber, percentOff]
 *             properties:
 *               mobileNumber: { type: string }
 *               percentOff: { type: integer, minimum: 1, maximum: 100 }
 *               currency: { type: string, default: 'INR' }
 *               maxRedemptions: { type: integer, default: 1 }
 *               activeFrom: { type: string, format: date-time, nullable: true }
 *               activeTo: { type: string, format: date-time, nullable: true }
 *               status: { type: string, default: 'ACTIVE' }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200: { description: Created }
 */
router.post('/discounts', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { mobileNumber, percentOff, currency, maxRedemptions, activeFrom, activeTo, status, reason } = req.body || {};
    if (!mobileNumber) return res.status(400).json({ success: false, error: 'mobileNumber required' });
    if (typeof percentOff !== 'number' || percentOff <= 0) return res.status(400).json({ success: false, error: 'percentOff required and must be > 0' });

    // Strict rule: only one ACTIVE/RESERVED discount per mobile
    const desiredStatus = String(status || 'ACTIVE');
    if (desiredStatus === 'ACTIVE' || desiredStatus === 'RESERVED') {
      const existing = await (prisma as any).discount.findFirst({ where: { mobileNumber: String(mobileNumber), status: { in: ['ACTIVE','RESERVED'] } } });
      if (existing) return res.status(409).json({ success: false, error: 'MOBILE_ALREADY_HAS_ACTIVE_DISCOUNT', message: 'Only one ACTIVE/RESERVED discount allowed per mobileNumber.' });
    }

    const user: any = (req as any).user;
    const created = await (prisma as any).discount.create({
      data: {
        mobileNumber: String(mobileNumber),
        code: null,
        amountOff: null,
        percentOff: percentOff,
        currency: currency || 'INR',
        maxRedemptions: Math.max(1, Number(maxRedemptions) || 1),
        activeFrom: activeFrom ? new Date(activeFrom) : null,
        activeTo: activeTo ? new Date(activeTo) : null,
        status: status || 'ACTIVE',
        cell: null,
        designationCode: null,
        level: null,
        zone: null,
        hrcCountryId: null,
        hrcStateId: null,
        hrcDistrictId: null,
        hrcMandalId: null,
        createdByUserId: user?.id || null,
        reason: reason || null,
      }
    });
    return res.json({ success: true, data: created });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/discounts/{id}:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Get discount by ID (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Discount }
 *       404: { description: Not found }
 */
router.get('/discounts/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const d = await (prisma as any).discount.findUnique({ where: { id: String(req.params.id) } });
    if (!d) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: d });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/discounts/{id}:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Update a discount (admin)
 *     description: Only ACTIVE discounts should be edited; changes to REDEEMED or RESERVED may be rejected in future.
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
 *               percentOff: { type: integer, minimum: 1, maximum: 100, nullable: true }
 *               currency: { type: string }
 *               maxRedemptions: { type: integer }
 *               activeFrom: { type: string, format: date-time, nullable: true }
 *               activeTo: { type: string, format: date-time, nullable: true }
 *               status: { type: string }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/discounts/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const d = await (prisma as any).discount.findUnique({ where: { id: String(req.params.id) } });
    if (!d) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const { percentOff } = req.body || {};
    if ('percentOff' in req.body && (typeof percentOff !== 'number' || percentOff <= 0)) {
      return res.status(400).json({ success: false, error: 'percentOff must be > 0 when provided' });
    }
    const data: any = {};
    const fields = ['currency','maxRedemptions','status','reason'];
    for (const f of fields) if (f in req.body) data[f] = req.body[f];
    if ('activeFrom' in req.body) data.activeFrom = req.body.activeFrom ? new Date(req.body.activeFrom) : null;
    if ('activeTo' in req.body) data.activeTo = req.body.activeTo ? new Date(req.body.activeTo) : null;
    // Enforce percent-only
    data.amountOff = null;
    if ('percentOff' in req.body) data.percentOff = req.body.percentOff;

    // Enforce strict rule on transition to ACTIVE/RESERVED
    const targetStatus = 'status' in data ? String(data.status) : d.status;
    const targetMobile = d.mobileNumber; // mobileNumber is immutable in current API; adjust if later made editable
    if (targetStatus === 'ACTIVE' || targetStatus === 'RESERVED') {
      const existing = await (prisma as any).discount.findFirst({ where: { mobileNumber: String(targetMobile), status: { in: ['ACTIVE','RESERVED'] }, NOT: { id: d.id } } });
      if (existing) return res.status(409).json({ success: false, error: 'MOBILE_ALREADY_HAS_ACTIVE_DISCOUNT', message: 'Only one ACTIVE/RESERVED discount allowed per mobileNumber.' });
    }
    const updated = await (prisma as any).discount.update({ where: { id: d.id }, data });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/discounts/{id}/cancel:
 *   post:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Cancel a discount (admin)
 *     description: Moves discount to CANCELLED if it is not redeemed. Reserved discounts not tied to a payment will be released.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Cancelled }
 */
router.post('/discounts/:id/cancel', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const d = await (prisma as any).discount.findUnique({ where: { id: String(req.params.id) } });
    if (!d) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (d.status === 'REDEEMED') return res.status(400).json({ success: false, error: 'ALREADY_REDEEMED' });
    const updated = await (prisma as any).discount.update({ where: { id: d.id }, data: { status: 'CANCELLED', appliedToIntentId: null } });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CANCEL_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/admin/discounts/preview:
 *   post:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Preview discount application for a seat (admin)
 *     description: Computes baseAmount from designation fee and applies the latest active mobile-bound percentage discount if applicable.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cell, designationCode, level, mobileNumber]
 *             properties:
 *               cell: { type: string }
 *               designationCode: { type: string }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               mobileNumber: { type: string }
 *               zone: { type: string, nullable: true }
 *               hrcCountryId: { type: string, nullable: true }
 *               hrcStateId: { type: string, nullable: true }
 *               hrcDistrictId: { type: string, nullable: true }
 *               hrcMandalId: { type: string, nullable: true }
 *     responses:
 *       200: { description: Breakdown }
 */
router.post('/discounts/preview', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { cell, designationCode, level, mobileNumber, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!cell || !designationCode || !level || !mobileNumber) return res.status(400).json({ success: false, error: 'cell, designationCode, level, mobileNumber required' });
    const avail = await (membershipService as any).getAvailability({ cellCodeOrName: String(cell), designationCode: String(designationCode), level: String(level), zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId });
    const baseAmount = (avail as any)?.designation?.fee ?? 0;
    // Mobile-number-only, percent-only
    let appliedDiscount: any | null = null;
    const candidates = await (prisma as any).discount.findMany({ where: { mobileNumber: String(mobileNumber), status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 3 });
    for (const d of candidates) if (withinWindow(d)) { appliedDiscount = d; break; }
    const picked = pickPercentOnly(appliedDiscount, baseAmount);
    const discountAmount = picked.amount;
    const discountPercent = picked.type === 'PERCENT' ? (picked.percent || null) : null;
    const appliedType = picked.type;
    const finalAmount = Math.max(0, baseAmount - discountAmount);
    return res.json({ success: true, data: { baseAmount, discountAmount, discountPercent, appliedType, finalAmount, note: appliedDiscount ? 'Mobile-based percentage discount applied' : null } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'PREVIEW_FAILED', message: e?.message });
  }
});

export default router;
