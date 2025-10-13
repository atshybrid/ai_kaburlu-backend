import { Router } from 'express';
import prisma from '../../lib/prisma';
import { createRazorpayOrder, razorpayEnabled, getRazorpayKeyId, verifyRazorpaySignature } from '../../lib/razorpay';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
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
 *           examples:
 *             NATIONAL:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'NATIONAL' }
 *             ZONE:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'ZONE', zone: 'SOUTH' }
 *             STATE:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'STATE', hrcStateId: 'ap' }
 *             DISTRICT:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'DISTRICT', hrcDistrictId: 'krishna' }
 *             MANDAL:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'MANDAL', hrcMandalId: 'mylavaram' }
 *     description: |
 *       Creates a payment intent for the specified seat. No membership or user is created at this step.
 *       Supply the user details at /memberships/payfirst/confirm after payment success.
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     order:
 *                       type: object
 *                       properties:
 *                         orderId: { type: string }
 *                         amount: { type: number }
 *                         currency: { type: string }
 *                         provider: { type: string, nullable: true }
 *                         providerOrderId: { type: string, nullable: true }
 *                         providerKeyId: { type: string, nullable: true }
 *             examples:
 *               WithRazorpay:
 *                 value: { success: true, data: { order: { orderId: 'cmgxxx', amount: 100, currency: 'INR', provider: 'razorpay', providerOrderId: 'order_abc', providerKeyId: 'rzp_test_xxx' } } }
 *               InternalOnly:
 *                 value: { success: true, data: { order: { orderId: 'cmgxxx', amount: 100, currency: 'INR', provider: null, providerOrderId: null } } }
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
    // If Razorpay is configured, create a provider order, else return internal order only
    let providerOrderId: string | undefined;
    if (razorpayEnabled()) {
      const rp = await createRazorpayOrder({ amountPaise: amount * 100, currency: 'INR', receipt: intent.id, notes: { cell, designationCode, level } });
      providerOrderId = rp.id;
    }
    return res.json({ success: true, data: { order: { orderId: intent.id, amount, currency: 'INR', provider: razorpayEnabled() ? 'razorpay' : null, providerOrderId: providerOrderId || null, providerKeyId: razorpayEnabled() ? getRazorpayKeyId() : null } } });
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
 *               mobileNumber: { type: string, description: 'Required when status=SUCCESS' }
 *               mpin: { type: string, description: 'Required when status=SUCCESS (stored as hash)' }
 *               fullName: { type: string, description: 'Required when status=SUCCESS' }
 *               provider: { type: string, nullable: true, description: 'e.g., razorpay' }
 *               razorpay_order_id: { type: string, nullable: true }
 *               razorpay_payment_id: { type: string, nullable: true }
 *               razorpay_signature: { type: string, nullable: true }
 *           examples:
 *             SuccessInternal:
 *               value: { orderId: 'cmgxxx', status: 'SUCCESS', mobileNumber: '9000000001', mpin: '1234', fullName: 'John Doe' }
 *             SuccessRazorpay:
 *               value: { orderId: 'cmgxxx', status: 'SUCCESS', provider: 'razorpay', razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_xyz', razorpay_signature: 'sig123', mobileNumber: '9000000001', mpin: '1234', fullName: 'John Doe' }
 *             Failed:
 *               value: { orderId: 'cmgxxx', status: 'FAILED', providerRef: 'pay_xyz' }
 *     description: |
 *       Notes:
 *       - Capacity is re-checked on confirm to prevent overbooking.
 *       - For ZONE/STATE/DISTRICT/MANDAL, the PaymentIntent must carry zone/hrcStateId/hrcDistrictId/hrcMandalId respectively.
 *       - If not present, confirm will fail with MISSING_LOCATION.
 *     responses:
 *       200:
 *         description: Result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string }
 *                     membershipId: { type: string }
 *                     idCardCreated: { type: boolean }
 *                     idCardReason: { type: string, nullable: true }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, providerRef, status, mobileNumber, mpin, fullName } = req.body || {};
    if (!orderId || !status) return res.status(400).json({ success: false, error: 'orderId and status required' });
    const intent = await (prisma as any).paymentIntent.findUnique({ where: { id: String(orderId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });
    // Idempotency: if already successful and linked, return same
    if (intent.status === 'SUCCESS' && intent.membershipId) {
      // Check if card exists for completeness
      const existingCard = await (prisma as any).iDCard.findUnique({ where: { membershipId: intent.membershipId } }).catch(() => null);
      return res.json({ success: true, data: { status: 'ACTIVE', membershipId: intent.membershipId, idCardCreated: !!existingCard, idCardReason: existingCard ? null : 'CARD_NOT_ISSUED' } });
    }
    // Validate geo presence for the saved level
    const geoCheck = validateGeoByLevel(intent.level, intent);
    if (!geoCheck.ok) return res.status(400).json({ success: false, error: 'MISSING_LOCATION', message: geoCheck.error });
    // Optional Razorpay signature verification on SUCCESS
    if (status === 'SUCCESS' && req.body.provider === 'razorpay') {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, error: 'MISSING_PG_SIGNATURE' });
      }
      const valid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!valid) return res.status(400).json({ success: false, error: 'INVALID_PG_SIGNATURE' });
    }

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
      // Auto-issue ID card if profile has photo and no existing card
      let idCardCreated = false; let idCardReason: string | null = null;
      const existingCard = await tx.iDCard.findUnique({ where: { membershipId: join.membershipId } }).catch(() => null);
      if (!existingCard) {
        const m = await tx.membership.findUnique({ where: { id: join.membershipId }, include: { designation: true, cell: true, user: { include: { profile: true } } } });
        const hasPhoto = !!(m?.user?.profile?.profilePhotoUrl || m?.user?.profile?.profilePhotoMediaId);
        if (!hasPhoto) {
          idCardCreated = false; idCardReason = 'PROFILE_PHOTO_REQUIRED';
        } else {
          const cardNumber = await generateNextIdCardNumber(tx as any);
          const fullName = m?.user?.profile?.fullName || undefined;
          const mobileNumber = m?.user?.mobileNumber || undefined;
          const designationName = m?.designation?.name || undefined;
          const cellName = m?.cell?.name || undefined;
          await tx.iDCard.create({ data: { membershipId: join.membershipId, cardNumber, expiresAt: new Date(Date.now() + 365*24*60*60*1000), fullName, mobileNumber, designationName, cellName } as any });
          idCardCreated = true; idCardReason = null;
        }
      }
      return { soldOut: false, membershipId: join.membershipId, idCardCreated, idCardReason };
    });
    if (result.soldOut) return res.status(409).json({ success: false, error: 'SOLD_OUT', message: 'Seat sold out. Refund is required.' });
    return res.json({ success: true, data: { status: 'ACTIVE', membershipId: result.membershipId, idCardCreated: result.idCardCreated, idCardReason: result.idCardReason } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CONFIRM_FAILED', message: e?.message });
  }
});

export default router;