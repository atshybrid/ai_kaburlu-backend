import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import { membershipService } from '../../lib/membershipService';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: HRCI Member Upgrade
 *     description: APIs to preview and apply member seat upgrades/reassignments
 */

/**
 * @swagger
 * /hrci/member/upgrade/preview:
 *   post:
 *     tags: [HRCI Member Upgrade]
 *     summary: Preview a membership upgrade (no changes saved)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [membershipId, cell, level]
 *             properties:
 *               membershipId: { type: string }
 *               cell: { type: string, description: "Cell id or code or name" }
 *               designationCode: { type: string, nullable: true }
 *               designationId: { type: string, nullable: true }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               zone: { type: string, nullable: true }
 *               hrcCountryId: { type: string, nullable: true }
 *               hrcStateId: { type: string, nullable: true }
 *               hrcDistrictId: { type: string, nullable: true }
 *               hrcMandalId: { type: string, nullable: true }
 *     responses:
 *       200: { description: Preview result }
 */
router.post('/preview', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { membershipId, cell, designationCode, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!membershipId) return res.status(400).json({ success: false, error: 'MEMBERSHIP_ID_REQUIRED' });
    if (!cell) return res.status(400).json({ success: false, error: 'CELL_REQUIRED' });
    if (!level) return res.status(400).json({ success: false, error: 'LEVEL_REQUIRED' });
    if (!designationCode && !designationId) return res.status(400).json({ success: false, error: 'DESIGNATION_REQUIRED' });

    const lvl = String(level);
    if (lvl === 'ZONE' && !zone) return res.status(400).json({ success: false, error: 'ZONE_REQUIRED' });
    if (lvl === 'STATE' && !hrcStateId) return res.status(400).json({ success: false, error: 'HRC_STATE_ID_REQUIRED' });
    if (lvl === 'DISTRICT' && !hrcDistrictId) return res.status(400).json({ success: false, error: 'HRC_DISTRICT_ID_REQUIRED' });
    if (lvl === 'MANDAL' && !hrcMandalId) return res.status(400).json({ success: false, error: 'HRC_MANDAL_ID_REQUIRED' });

  const outcome = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: String(membershipId) }, include: { payments: true } });
      if (!m) throw new Error('MEMBERSHIP_NOT_FOUND');

      const cellRow = await tx.cell.findFirst({ where: { OR: [ { id: String(cell) }, { code: String(cell) }, { name: String(cell) } ] } });
      if (!cellRow) throw new Error('CELL_NOT_FOUND');
      const desigRow = designationId
        ? await tx.designation.findUnique({ where: { id: String(designationId) } })
        : await tx.designation.findFirst({ where: { OR: [ { code: String(designationCode) }, { id: String(designationCode) } ] } });
      if (!desigRow) throw new Error('DESIGNATION_NOT_FOUND');

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

      // Pick the smallest available seatSequence within capacity (reuses freed seats and avoids unique collisions).
      const seatBucketWhere: any = {
        cellId: cellRow.id,
        designationId: desigRow.id,
        level: lvl,
        NOT: { id: m.id },
      };
      if (lvl === 'ZONE') seatBucketWhere.zone = zone || null;
      if (lvl === 'NATIONAL') seatBucketWhere.hrcCountryId = hrcCountryId || null;
      if (lvl === 'STATE') seatBucketWhere.hrcStateId = hrcStateId || null;
      if (lvl === 'DISTRICT') seatBucketWhere.hrcDistrictId = hrcDistrictId || null;
      if (lvl === 'MANDAL') seatBucketWhere.hrcMandalId = hrcMandalId || null;

      const seatsInUse = await tx.membership.findMany({ where: seatBucketWhere, select: { seatSequence: true } });
      const usedSeats = new Set<number>();
      for (const r of seatsInUse) if (typeof (r as any).seatSequence === 'number') usedSeats.add((r as any).seatSequence);
      let nextSeat: number | null = null;
      for (let i = 1; i <= desigRow.defaultCapacity; i++) {
        if (!usedSeats.has(i)) { nextSeat = i; break; }
      }
      if (!nextSeat) {
        return { accepted: false, reason: 'NO_SEATS_DESIGNATION', remaining: 0 };
      }

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
      const paidSum = (m.payments || []).filter((p: any) => p.status === 'SUCCESS').reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deltaDue = Math.max(0, newFee - paidSum);
      const willRequirePayment = deltaDue > 0;
      const toStatus = willRequirePayment ? 'PENDING_PAYMENT' : (m.status !== 'ACTIVE' ? 'PENDING_APPROVAL' : 'ACTIVE');
      const toPaymentStatus = willRequirePayment ? 'PENDING' : (paidSum > 0 ? 'SUCCESS' : 'NOT_REQUIRED');

      return {
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
        status: { from: { status: m.status, paymentStatus: m.paymentStatus }, to: { status: toStatus, paymentStatus: toPaymentStatus } },
      };
  }, { timeout: 15000 });

    if (!outcome.accepted) return res.status(409).json({ success: false, ...outcome });
    return res.json({ success: true, data: outcome });
  } catch (e: any) {
    const message = e?.message || String(e);
    if (message === 'MEMBERSHIP_NOT_FOUND' || message === 'CELL_NOT_FOUND' || message === 'DESIGNATION_NOT_FOUND') {
      return res.status(404).json({ success: false, error: message });
    }
    return res.status(500).json({ success: false, error: 'UPGRADE_PREVIEW_FAILED', message });
  }
});

/**
 * @swagger
 * /hrci/member/upgrade/apply:
 *   post:
 *     tags: [HRCI Member Upgrade]
 *     summary: Apply a membership upgrade (persist changes)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [membershipId, cell, level]
 *             properties:
 *               membershipId: { type: string }
 *               cell: { type: string }
 *               designationCode: { type: string, nullable: true }
 *               designationId: { type: string, nullable: true }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               zone: { type: string, nullable: true }
 *               hrcCountryId: { type: string, nullable: true }
 *               hrcStateId: { type: string, nullable: true }
 *               hrcDistrictId: { type: string, nullable: true }
 *               hrcMandalId: { type: string, nullable: true }
 *     responses:
 *       200: { description: Upgrade applied }
 */
router.post('/apply', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { membershipId, cell, designationCode, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!membershipId) return res.status(400).json({ success: false, error: 'MEMBERSHIP_ID_REQUIRED' });
    if (!cell) return res.status(400).json({ success: false, error: 'CELL_REQUIRED' });
    if (!level) return res.status(400).json({ success: false, error: 'LEVEL_REQUIRED' });
    if (!designationCode && !designationId) return res.status(400).json({ success: false, error: 'DESIGNATION_REQUIRED' });

    const lvl = String(level);
    if (lvl === 'ZONE' && !zone) return res.status(400).json({ success: false, error: 'ZONE_REQUIRED' });
    if (lvl === 'STATE' && !hrcStateId) return res.status(400).json({ success: false, error: 'HRC_STATE_ID_REQUIRED' });
    if (lvl === 'DISTRICT' && !hrcDistrictId) return res.status(400).json({ success: false, error: 'HRC_DISTRICT_ID_REQUIRED' });
    if (lvl === 'MANDAL' && !hrcMandalId) return res.status(400).json({ success: false, error: 'HRC_MANDAL_ID_REQUIRED' });

  const result = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: String(membershipId) }, include: { payments: true } });
      if (!m) throw new Error('MEMBERSHIP_NOT_FOUND');

      const cellRow = await tx.cell.findFirst({ where: { OR: [ { id: String(cell) }, { code: String(cell) }, { name: String(cell) } ] } });
      if (!cellRow) throw new Error('CELL_NOT_FOUND');
      const desigRow = designationId
        ? await tx.designation.findUnique({ where: { id: String(designationId) } })
        : await tx.designation.findFirst({ where: { OR: [ { code: String(designationCode) }, { id: String(designationCode) } ] } });
      if (!desigRow) throw new Error('DESIGNATION_NOT_FOUND');

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

      // Pick the smallest available seatSequence within capacity (reuses freed seats and avoids unique collisions).
      const seatBucketWhere: any = {
        cellId: cellRow.id,
        designationId: desigRow.id,
        level: lvl,
        NOT: { id: m.id },
      };
      if (lvl === 'ZONE') seatBucketWhere.zone = zone || null;
      if (lvl === 'NATIONAL') seatBucketWhere.hrcCountryId = hrcCountryId || null;
      if (lvl === 'STATE') seatBucketWhere.hrcStateId = hrcStateId || null;
      if (lvl === 'DISTRICT') seatBucketWhere.hrcDistrictId = hrcDistrictId || null;
      if (lvl === 'MANDAL') seatBucketWhere.hrcMandalId = hrcMandalId || null;

      const seatsInUse = await tx.membership.findMany({ where: seatBucketWhere, select: { seatSequence: true } });
      const usedSeats = new Set<number>();
      for (const r of seatsInUse) if (typeof (r as any).seatSequence === 'number') usedSeats.add((r as any).seatSequence);
      let nextSeat: number | null = null;
      for (let i = 1; i <= desigRow.defaultCapacity; i++) {
        if (!usedSeats.has(i)) { nextSeat = i; break; }
      }
      if (!nextSeat) {
        return { accepted: false, reason: 'NO_SEATS_DESIGNATION', remaining: 0 };
      }

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
      const paidSum = (m.payments || []).filter((p: any) => p.status === 'SUCCESS').reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deltaDue = Math.max(0, newFee - paidSum);
      const willRequirePayment = deltaDue > 0;
      const targetStatus = willRequirePayment ? 'PENDING_PAYMENT' : (m.status !== 'ACTIVE' ? 'PENDING_APPROVAL' : 'ACTIVE');
      const targetPaymentStatus = willRequirePayment ? 'PENDING' : (paidSum > 0 ? 'SUCCESS' : 'NOT_REQUIRED');

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
          status: targetStatus as any,
          paymentStatus: targetPaymentStatus as any,
          lockedAt: new Date(),
        }
      });

      if (willRequirePayment) {
        await tx.membershipPayment.create({ data: { membershipId: m.id, amount: deltaDue, status: 'PENDING' } });
      }

      return {
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
        data: updated,
      };
  }, { timeout: 15000 });

    if (!result.accepted) return res.status(409).json({ success: false, ...result });
    return res.json({ success: true, data: result });
  } catch (e: any) {
    const message = e?.message || String(e);
    if (message === 'MEMBERSHIP_NOT_FOUND' || message === 'CELL_NOT_FOUND' || message === 'DESIGNATION_NOT_FOUND') {
      return res.status(404).json({ success: false, error: message });
    }
    return res.status(500).json({ success: false, error: 'UPGRADE_APPLY_FAILED', message });
  }
});

export default router;

// ---------------------------
// Simple/unified Upgrade APIs
// ---------------------------

/**
 * @swagger
 * /hrci/member/upgrade/{membershipId}:
 *   get:
 *     tags: [HRCI Member Upgrade]
 *     summary: Get membership details for upgrade UI (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: membershipId
 *         required: true
 *         schema: { type: string }
 *     responses:
  *       200:
  *         description: Membership with related info
  *         content:
  *           application/json:
  *             examples:
  *               success:
  *                 summary: Successful load
  *                 value:
  *                   success: true
  *                   data:
  *                     id: cm123abc...
  *                     userId: usr123...
  *                     cellId: cell_abc123
  *                     designationId: desig_xyz456
  *                     level: ZONE
  *                     zone: SOUTH
  *                     status: PENDING_APPROVAL
  *                     paymentStatus: NOT_REQUIRED
  *                     seatSequence: 3
  *                     createdAt: 2025-10-31T10:00:00.000Z
  *                     updatedAt: 2025-10-31T10:00:00.000Z
  *                     payments:
  *                       - id: pay1
  *                         amount: 100
  *                         status: SUCCESS
  *                     paidSum: 100
 */
router.get('/:membershipId', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { membershipId } = req.params;
    const m = await prisma.membership.findUnique({
      where: { id: String(membershipId) },
      include: { designation: true, cell: true, idCard: true, payments: true }
    });
    if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });
    const paidSum = (m.payments || []).filter(p => p.status === 'SUCCESS').reduce((s, p) => s + (p.amount || 0), 0);
    return res.json({ success: true, data: { ...m, paidSum } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MEMBERSHIP_LOAD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /hrci/member/upgrade:
 *   post:
 *     tags: [HRCI Member Upgrade]
 *     summary: Unified upgrade API (preview by default; set dryRun=false to apply)
 *     description: Simpler payload using only IDs. Defaults to dryRun=true.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [membershipId, cellId, designationId, level]
 *             properties:
 *               membershipId: { type: string }
 *               cellId: { type: string }
 *               designationId: { type: string }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               zone: { type: string, nullable: true }
 *               hrcCountryId: { type: string, nullable: true }
 *               hrcStateId: { type: string, nullable: true }
 *               hrcDistrictId: { type: string, nullable: true }
 *               hrcMandalId: { type: string, nullable: true }
 *               dryRun: { type: boolean, default: true }
  *           examples:
  *             previewZone:
  *               summary: Preview move to ZONE (dryRun=true default)
  *               value:
  *                 membershipId: cm123abc...
  *                 cellId: cell_abc123
  *                 designationId: desig_xyz456
  *                 level: ZONE
  *                 zone: SOUTH
  *             applyState:
  *               summary: Apply move to STATE (dryRun=false)
  *               value:
  *                 membershipId: cm123abc...
  *                 cellId: cell_abc123
  *                 designationId: desig_xyz456
  *                 level: STATE
  *                 hrcStateId: state-id-here
  *                 dryRun: false
 *     responses:
  *       200:
  *         description: Preview/Apply result
  *         content:
  *           application/json:
  *             examples:
  *               previewAccepted:
  *                 summary: Preview accepted (no DB changes)
  *                 value:
  *                   success: true
  *                   data:
  *                     accepted: true
  *                     membershipId: cm123abc...
  *                     to:
  *                       cellId: cell_abc123
  *                       designationId: desig_xyz456
  *                       level: ZONE
  *                       zone: SOUTH
  *                       seatSequence: 7
  *                     pricing:
  *                       fee: 500
  *                       paid: 100
  *                       deltaDue: 400
  *                     status:
  *                       from: { status: PENDING_APPROVAL, paymentStatus: NOT_REQUIRED }
  *                       to:   { status: PENDING_PAYMENT,   paymentStatus: PENDING }
  *               applyAccepted:
  *                 summary: Apply accepted (changes persisted)
  *                 value:
  *                   success: true
  *                   data:
  *                     accepted: true
  *                     membershipId: cm123abc...
  *                     to:
  *                       cellId: cell_abc123
  *                       designationId: desig_xyz456
  *                       level: STATE
  *                       hrcStateId: state-id-here
  *                       seatSequence: 10
  *                     pricing:
  *                       fee: 0
  *                       paid: 100
  *                       deltaDue: 0
  *                     status:
  *                       from: { status: PENDING_PAYMENT, paymentStatus: PENDING }
  *                       to:   { status: PENDING_APPROVAL, paymentStatus: SUCCESS }
  *                     data:
  *                       id: cm123abc...
  *                       cellId: cell_abc123
  *                       designationId: desig_xyz456
  *                       level: STATE
  *                       hrcStateId: state-id-here
  *                       seatSequence: 10
 */
router.post('/', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { membershipId, cellId, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    const dryRun = ('dryRun' in (req.body || {})) ? Boolean(req.body.dryRun) : true;
    if (!membershipId) return res.status(400).json({ success: false, error: 'MEMBERSHIP_ID_REQUIRED' });
    if (!cellId) return res.status(400).json({ success: false, error: 'CELL_ID_REQUIRED' });
    if (!designationId) return res.status(400).json({ success: false, error: 'DESIGNATION_ID_REQUIRED' });
    if (!level) return res.status(400).json({ success: false, error: 'LEVEL_REQUIRED' });

    const lvl = String(level);
    if (lvl === 'ZONE' && !zone) return res.status(400).json({ success: false, error: 'ZONE_REQUIRED' });
    if (lvl === 'STATE' && !hrcStateId) return res.status(400).json({ success: false, error: 'HRC_STATE_ID_REQUIRED' });
    if (lvl === 'DISTRICT' && !hrcDistrictId) return res.status(400).json({ success: false, error: 'HRC_DISTRICT_ID_REQUIRED' });
    if (lvl === 'MANDAL' && !hrcMandalId) return res.status(400).json({ success: false, error: 'HRC_MANDAL_ID_REQUIRED' });

  const outcome = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: String(membershipId) }, include: { payments: true } });
      if (!m) throw new Error('MEMBERSHIP_NOT_FOUND');

      const cellRow = await tx.cell.findUnique({ where: { id: String(cellId) } });
      if (!cellRow) throw new Error('CELL_NOT_FOUND');
      const desigRow = await tx.designation.findUnique({ where: { id: String(designationId) } });
      if (!desigRow) throw new Error('DESIGNATION_NOT_FOUND');

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

      // Pick the smallest available seatSequence within capacity (reuses freed seats and avoids unique collisions).
      const seatBucketWhere: any = {
        cellId: cellRow.id,
        designationId: desigRow.id,
        level: lvl,
        NOT: { id: m.id },
      };
      if (lvl === 'ZONE') seatBucketWhere.zone = zone || null;
      if (lvl === 'NATIONAL') seatBucketWhere.hrcCountryId = hrcCountryId || null;
      if (lvl === 'STATE') seatBucketWhere.hrcStateId = hrcStateId || null;
      if (lvl === 'DISTRICT') seatBucketWhere.hrcDistrictId = hrcDistrictId || null;
      if (lvl === 'MANDAL') seatBucketWhere.hrcMandalId = hrcMandalId || null;

      const seatsInUse = await tx.membership.findMany({ where: seatBucketWhere, select: { seatSequence: true } });
      const usedSeats = new Set<number>();
      for (const r of seatsInUse) if (typeof (r as any).seatSequence === 'number') usedSeats.add((r as any).seatSequence);
      let nextSeat: number | null = null;
      for (let i = 1; i <= desigRow.defaultCapacity; i++) {
        if (!usedSeats.has(i)) { nextSeat = i; break; }
      }
      if (!nextSeat) {
        return { accepted: false, reason: 'NO_SEATS_DESIGNATION', remaining: 0 };
      }

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
      const paidSum = (m.payments || []).filter((p: any) => p.status === 'SUCCESS').reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const deltaDue = Math.max(0, newFee - paidSum);
      const willRequirePayment = deltaDue > 0;
      const targetStatus = willRequirePayment ? 'PENDING_PAYMENT' : (m.status !== 'ACTIVE' ? 'PENDING_APPROVAL' : 'ACTIVE');
      const targetPaymentStatus = willRequirePayment ? 'PENDING' : (paidSum > 0 ? 'SUCCESS' : 'NOT_REQUIRED');

      const preview = {
        accepted: true,
        membershipId: String(membershipId),
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
          status: targetStatus as any,
          paymentStatus: targetPaymentStatus as any,
          lockedAt: new Date(),
        }
      });

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
    return res.status(500).json({ success: false, error: 'UPGRADE_FAILED', message });
  }
});
