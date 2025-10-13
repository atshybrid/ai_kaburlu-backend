import { Router } from 'express';
import prisma from '../../lib/prisma';
import { membershipService } from '../../lib/membershipService';

/**
 * @swagger
 * tags:
 *   name: Memberships PayFirst
 *   description: Pay-first onboarding flow (create order first, create membership on success)
 */
const router = Router();

// helper: validate location fields required by level
function validateGeoByLevel(level: string, body: any): { ok: boolean; error?: string } {
  switch (String(level)) {
    case 'ZONE':
      if (!body.zone) return { ok: false, error: 'zone is required for level ZONE' };
      return { ok: true };
    case 'STATE':
      if (!body.hrcStateId) return { ok: false, error: 'hrcStateId is required for level STATE' };
      return { ok: true };
    case 'DISTRICT':
      if (!body.hrcDistrictId) return { ok: false, error: 'hrcDistrictId is required for level DISTRICT' };
      return { ok: true };
    case 'MANDAL':
      if (!body.hrcMandalId) return { ok: false, error: 'hrcMandalId is required for level MANDAL' };
      return { ok: true };
    case 'NATIONAL':
      // If you manage multiple countries, uncomment to require hrcCountryId
      // if (!body.hrcCountryId) return { ok: false, error: 'hrcCountryId is required for level NATIONAL' };
      return { ok: true };
    default:
      return { ok: false, error: 'Unsupported level' };
  }
}

// Create a payment intent (order) with seatSpec, no membership row yet
/**
 * @swagger
 * /memberships/payfirst/orders:
 *   post:
 *     tags: [Memberships PayFirst]
 *     summary: Create payment intent (order) for a seat spec without creating membership
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cell, designationCode, level]
 *             properties:
 *               cell: { type: string }
 *               designationCode: { type: string }
 *               level: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *               zone: { type: string, nullable: true, description: 'REQUIRED when level=ZONE' }
 *               hrcCountryId: { type: string, nullable: true, description: 'Optional unless you manage multiple countries' }
 *               hrcStateId: { type: string, nullable: true, description: 'REQUIRED when level=STATE' }
 *               hrcDistrictId: { type: string, nullable: true, description: 'REQUIRED when level=DISTRICT' }
 *               hrcMandalId: { type: string, nullable: true, description: 'REQUIRED when level=MANDAL' }
 *               mobileNumber: { type: string }
 *               fullName: { type: string }
 *               mpin: { type: string }
 *     responses:
 *       200:
 *         description: Order created
 */
router.post('/orders', async (req, res) => {
  try {
    const { cell, designationCode, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!cell || !designationCode || !level) return res.status(400).json({ success: false, error: 'cell, designationCode, level required' });
    const geoCheck = validateGeoByLevel(level, req.body || {});
    if (!geoCheck.ok) return res.status(400).json({ success: false, error: 'MISSING_LOCATION', message: geoCheck.error });
    // Price from designation
    const avail = await membershipService.getAvailability({
      cellCodeOrName: String(cell), designationCode: String(designationCode), level: String(level) as any,
      zone: zone || undefined, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId
    } as any);
    const amount = (avail as any).designation?.fee ?? 0;
    const intent = await (prisma as any).paymentIntent.create({
      data: {
        cellCodeOrName: String(cell), designationCode: String(designationCode), level: String(level),
        zone: zone || null, hrcCountryId: hrcCountryId || null, hrcStateId: hrcStateId || null, hrcDistrictId: hrcDistrictId || null, hrcMandalId: hrcMandalId || null,
        amount, currency: 'INR', status: 'PENDING'
      }
    });
    // Return an order stub (integrate real PG later)
    return res.json({ success: true, data: { order: { orderId: intent.id, amount, currency: 'INR' } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ORDER_FAILED', message: e?.message });
  }
});

// Confirm payment intent: atomically create membership on success
/**
 * @swagger
 * /memberships/payfirst/confirm:
 *   post:
 *     tags: [Memberships PayFirst]
 *     summary: Confirm payment success and create membership atomically
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, status]
 *             properties:
 *               orderId: { type: string }
 *               providerRef: { type: string }
 *               status: { type: string, enum: [SUCCESS, FAILED] }
 *               mobileNumber: { type: string }
 *               mpin: { type: string }
 *               fullName: { type: string }
 *     description: |
 *       Notes:
 *       - Capacity is re-checked on confirm to prevent overbooking.
 *       - For ZONE/STATE/DISTRICT/MANDAL, the PaymentIntent must carry zone/hrcStateId/hrcDistrictId/hrcMandalId respectively.
 *       - If not present, confirm will fail with MISSING_LOCATION.
 *     responses:
 *       200:
 *         description: Result
 */
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, providerRef, status, mobileNumber, mpin, fullName } = req.body || {};
    if (!orderId || !status) return res.status(400).json({ success: false, error: 'orderId and status required' });
    const intent = await (prisma as any).paymentIntent.findUnique({ where: { id: String(orderId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });
    // Validate geo presence for the saved level
    const geoCheck = validateGeoByLevel(intent.level, intent);
    if (!geoCheck.ok) return res.status(400).json({ success: false, error: 'MISSING_LOCATION', message: geoCheck.error });
    if (status === 'FAILED') {
      await (prisma as any).paymentIntent.update({ where: { id: intent.id }, data: { status: 'FAILED', providerRef: providerRef || null } });
      return res.json({ success: true, data: { status: 'FAILED' } });
    }
    // SUCCESS path
    const result = await (prisma as any).$transaction(async (tx: any) => {
      // 1) Re-check availability live
      const avail = await membershipService.getAvailability({
        cellCodeOrName: intent.cellCodeOrName, designationCode: intent.designationCode, level: intent.level,
        zone: intent.zone || undefined, hrcCountryId: intent.hrcCountryId || undefined, hrcStateId: intent.hrcStateId || undefined,
        hrcDistrictId: intent.hrcDistrictId || undefined, hrcMandalId: intent.hrcMandalId || undefined
      } as any);
      if ((avail as any).designation.remaining <= 0) {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REFUND_REQUIRED', providerRef: providerRef || null } });
        return { soldOut: true };
      }
      // 2) Upsert user with mpinHash
      if (!mobileNumber || !mpin || !fullName) throw new Error('mobileNumber, mpin, fullName required');
      let user = await tx.user.findFirst({ where: { mobileNumber: String(mobileNumber) } });
      const bcrypt = await import('bcrypt');
      const mpinHash = await bcrypt.hash(String(mpin), 10);
      if (!user) {
        const citizen = await tx.role.findFirst({ where: { name: { in: ['CITIZEN_REPORTER','USER','MEMBER','GUEST'] as any } } });
        const lang = await tx.language.findFirst();
        if (!citizen || !lang) throw new Error('CONFIG_MISSING');
        user = await tx.user.create({ data: { mobileNumber: String(mobileNumber), mpin: null as any, mpinHash, roleId: citizen.id, languageId: lang.id, status: 'PENDING' } });
      } else {
        await tx.user.update({ where: { id: user.id }, data: { mpin: null as any, mpinHash } });
      }
      await tx.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, fullName }, update: { fullName } });
      // 3) Create membership ACTIVE immediately (payment already succeeded)
      const join = await membershipService.joinSeat({
        userId: user.id,
        cellCodeOrName: intent.cellCodeOrName,
        designationCode: intent.designationCode,
        level: intent.level as any,
        zone: intent.zone || undefined,
        hrcCountryId: intent.hrcCountryId || undefined,
        hrcStateId: intent.hrcStateId || undefined,
        hrcDistrictId: intent.hrcDistrictId || undefined,
        hrcMandalId: intent.hrcMandalId || undefined
      } as any);
      if (!join.accepted) {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REFUND_REQUIRED', providerRef: providerRef || null } });
        return { soldOut: true };
      }
      // Activate membership and link intent
      await tx.membership.update({ where: { id: join.membershipId }, data: { status: 'ACTIVE', paymentStatus: 'SUCCESS', activatedAt: new Date() } });
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS', providerRef: providerRef || null, membershipId: join.membershipId } });
      return { soldOut: false, membershipId: join.membershipId };
    });
    if (result.soldOut) return res.status(409).json({ success: false, error: 'SOLD_OUT', message: 'Seat sold out. Refund is required.' });
    return res.json({ success: true, data: { status: 'ACTIVE', membershipId: result.membershipId } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CONFIRM_FAILED', message: e?.message });
  }
});

export default router;