import { Router } from 'express';
import prisma from '../../lib/prisma';
import { createRazorpayOrder, razorpayEnabled, getRazorpayKeyId, verifyRazorpaySignature } from '../../lib/razorpay';
import * as bcrypt from 'bcrypt';
import { membershipService } from '../../lib/membershipService';

// Helper to get seat details from PaymentIntent
async function getSeatDetails(intent: any) {
  const cell = await (prisma as any).cell.findFirst({ where: { OR: [{ id: intent.cellCodeOrName }, { code: intent.cellCodeOrName }, { name: intent.cellCodeOrName }] } });
  const designation = await (prisma as any).designation.findFirst({ where: { OR: [{ code: intent.designationCode }, { id: intent.designationCode }] } });
  
  let location: any = null;
  if (intent.level === 'ZONE' && intent.zone) {
    location = { type: 'zone', zone: intent.zone };
  } else if (intent.level === 'STATE' && intent.hrcStateId) {
    const state = await (prisma as any).hrcState.findUnique({ where: { id: intent.hrcStateId } });
    location = { type: 'state', id: intent.hrcStateId, name: state?.name };
  } else if (intent.level === 'DISTRICT' && intent.hrcDistrictId) {
    const district = await (prisma as any).hrcDistrict.findUnique({ where: { id: intent.hrcDistrictId } });
    location = { type: 'district', id: intent.hrcDistrictId, name: district?.name };
  } else if (intent.level === 'MANDAL' && intent.hrcMandalId) {
    const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: intent.hrcMandalId } });
    location = { type: 'mandal', id: intent.hrcMandalId, name: mandal?.name };
  }

  return {
    cell: { id: cell?.id, name: cell?.name, code: cell?.code },
    designation: { id: designation?.id, name: designation?.name, code: designation?.code },
    level: intent.level,
    location
  };
}

/**
 * @swagger
 * tags:
 *   - name: HRCI Membership - Member APIs
 *     description: Member registration, payment, and KYC submission APIs
 *   - name: HRCI Membership - Admin APIs  
 *     description: Admin management for memberships and KYC approvals
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
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Create payment intent (order) for a seat spec without creating membership
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
 *               mobileNumber:
 *                 type: string
 *                 description: 'Mobile number for registration linking'
 *                 example: '9876543210'
 *               zone: { type: string, nullable: true, description: 'REQUIRED when level=ZONE' }
 *               hrcCountryId: { type: string, nullable: true, description: 'Optional unless you manage multiple countries' }
 *               hrcStateId: { type: string, nullable: true, description: 'REQUIRED when level=STATE' }
 *               hrcDistrictId: { type: string, nullable: true, description: 'REQUIRED when level=DISTRICT' }
 *               hrcMandalId: { type: string, nullable: true, description: 'REQUIRED when level=MANDAL' }
 *           examples:
 *             NATIONAL:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'NATIONAL', mobileNumber: '9876543210' }
 *             ZONE:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'ZONE', zone: 'SOUTH', mobileNumber: '9876543210' }
 *             STATE:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'STATE', hrcStateId: 'ap', mobileNumber: '9876543210' }
 *             DISTRICT:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'DISTRICT', hrcDistrictId: 'krishna', mobileNumber: '9876543210' }
 *             MANDAL:
 *               value: { cell: 'GENERAL_BODY', designationCode: 'EXECUTIVE_MEMBER', level: 'MANDAL', hrcMandalId: 'mylavaram', mobileNumber: '9876543210' }
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
    const { cell, designationCode, level, mobileNumber, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!cell || !designationCode || !level || !mobileNumber) return res.status(400).json({ success: false, error: 'cell, designationCode, level, mobileNumber required' });
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
        amount, currency: 'INR', status: 'PENDING',
        meta: { registrationMobile: String(mobileNumber) }
      }
    });
    // If Razorpay is configured, create a provider order, else return internal order only
    let providerOrderId: string | undefined;
    if (razorpayEnabled()) {
      const rp = await createRazorpayOrder({ amountPaise: amount * 100, currency: 'INR', receipt: intent.id, notes: { cell, designationCode, level } });
      providerOrderId = rp.id;
      // Persist provider details for traceability
      await (prisma as any).paymentIntent.update({
        where: { id: intent.id },
        data: { meta: { registrationMobile: String(mobileNumber), provider: 'razorpay', providerOrderId } }
      });
    }
    return res.json({ success: true, data: { order: { orderId: intent.id, amount, currency: 'INR', provider: razorpayEnabled() ? 'razorpay' : null, providerOrderId: providerOrderId || null, providerKeyId: razorpayEnabled() ? getRazorpayKeyId() : null } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ORDER_FAILED', message: e?.message });
  }
});

// Confirm payment intent: mark payment successful and reserve seat (membership is created in /register)
/**
 * @swagger
 * /memberships/payfirst/confirm:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Confirm payment success and reserve seat (membership is NOT created here)
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
 *               mobileNumber: { type: string, description: 'Optional - for future registration linking' }
 *               provider: { type: string, nullable: true, description: 'e.g., razorpay' }
 *               razorpay_order_id: { type: string, nullable: true }
 *               razorpay_payment_id: { type: string, nullable: true }
 *               razorpay_signature: { type: string, nullable: true }
 *           examples:
 *             SuccessInternal:
 *               value: { orderId: 'cmgxxx', status: 'SUCCESS' }
 *             SuccessRazorpay:
 *               value: { orderId: 'cmgxxx', status: 'SUCCESS', provider: 'razorpay', razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_xyz', razorpay_signature: 'sig123', mobileNumber: '9876543210' }
 *             Failed:
 *               value: { orderId: 'cmgxxx', status: 'FAILED', providerRef: 'pay_xyz' }
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
 *                     seatReserved: { type: boolean }
 *                     seatDetails: 
 *                       type: object
 *                       properties:
 *                         cell: { type: object }
 *                         designation: { type: object }
 *                         level: { type: string }
 *                         location: { type: object, nullable: true }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, providerRef, status, mobileNumber } = req.body || {};
    if (!orderId || !status) return res.status(400).json({ success: false, error: 'orderId and status required' });
    const intent = await (prisma as any).paymentIntent.findUnique({ where: { id: String(orderId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });
    // Idempotency: if already successful, return seat details
    if (intent.status === 'SUCCESS') {
      const seatDetails = await getSeatDetails(intent);
      return res.json({ success: true, data: { status: 'PAID', seatReserved: true, seatDetails } });
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
    // SUCCESS path - just mark payment as successful and reserve seat
    await (prisma as any).paymentIntent.update({ 
      where: { id: intent.id }, 
      data: { 
        status: 'SUCCESS', 
        providerRef: providerRef || null,
        // Optionally link mobile for future registration
        ...(mobileNumber && { meta: { registrationMobile: mobileNumber } })
      } 
    });
    
    const seatDetails = await getSeatDetails(intent);
    return res.json({ 
      success: true, 
      data: { 
        status: 'PAID', 
        seatReserved: true, 
        seatDetails,
        registrationRequired: true,
        message: 'Payment successful. Please complete registration to activate membership.'
      } 
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CONFIRM_FAILED', message: e?.message });
  }
});

// Check payment status by order ID
/**
 * @swagger
 * /memberships/payfirst/status/{orderId}:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Check payment status for an order
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status
 */
router.get('/status/:orderId', async (req, res) => {
  try {
    const intent = await (prisma as any).paymentIntent.findUnique({ where: { id: req.params.orderId } });
    if (!intent) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });
    
    const seatDetails = await getSeatDetails(intent);
    return res.json({
      success: true,
      data: {
        orderId: intent.id,
        status: intent.status, // PENDING, SUCCESS, FAILED, REFUND_REQUIRED
        amount: intent.amount,
        currency: intent.currency,
        providerOrderId: intent?.meta?.providerOrderId || null,
        seatDetails,
        canRegister: intent.status === 'SUCCESS'
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STATUS_CHECK_FAILED', message: e?.message });
  }
});

// Lookup internal orderId by Razorpay provider order id
/**
 * @swagger
 * /memberships/payfirst/lookup/razorpay/{providerOrderId}:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Resolve internal orderId from Razorpay order id
 *     parameters:
 *       - name: providerOrderId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mapped order id
 */
router.get('/lookup/razorpay/:providerOrderId', async (req, res) => {
  try {
    const providerOrderId = String(req.params.providerOrderId);
    const intent = await (prisma as any).paymentIntent.findFirst({
      where: { meta: { path: ['providerOrderId'], equals: providerOrderId } }
    });
    if (!intent) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: { orderId: intent.id, provider: 'razorpay', providerOrderId } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LOOKUP_FAILED', message: e?.message });
  }
});

// Complete registration for paid seat
/**
 * @swagger
 * /memberships/payfirst/register:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Complete registration for a paid seat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, mobileNumber, mpin, fullName]
 *             properties:
 *               orderId: { type: string }
 *               mobileNumber:
 *                 type: string
 *                 example: '9876543210'
 *               mpin: { type: string }
 *               fullName: { type: string }
 *     responses:
 *       200:
 *         description: Registration completed
 */
router.post('/register', async (req, res) => {
  try {
    const { orderId, mobileNumber, mpin, fullName } = req.body || {};
    if (!orderId || !mobileNumber || !mpin || !fullName) {
      return res.status(400).json({ success: false, error: 'orderId, mobileNumber, mpin, fullName required' });
    }

    const intent = await (prisma as any).paymentIntent.findUnique({ where: { id: String(orderId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });
    if (intent.status !== 'SUCCESS') return res.status(400).json({ success: false, error: 'PAYMENT_NOT_COMPLETED' });
    if (intent.membershipId) return res.status(409).json({ success: false, error: 'ALREADY_REGISTERED', membershipId: intent.membershipId });

    // Enforce that the registering mobile matches the one used during order (if present)
    const linkedMobile = intent?.meta?.registrationMobile ? String(intent.meta.registrationMobile) : null;
    if (linkedMobile && linkedMobile !== String(mobileNumber)) {
      return res.status(400).json({ success: false, error: 'MOBILE_MISMATCH', message: 'Use the same mobile number used when creating the order' });
    }

    const result = await (prisma as any).$transaction(async (tx: any) => {
      // 1) Upsert user with mpinHash and ensure proper MEMBER role
      let user = await tx.user.findFirst({ where: { mobileNumber: String(mobileNumber) } });
      const bcrypt = await import('bcrypt');
      const mpinHash = await bcrypt.hash(String(mpin), 10);
      // Require a member role (HRCI_MEMBER or MEMBER); do not fallback to USER/CITIZEN_REPORTER
      const preferredRoles = ['HRCI_MEMBER','MEMBER'];
      const targetRole = await tx.role.findFirst({ where: { name: { in: preferredRoles as any } } });
      const lang = await tx.language.findFirst();
      if (!lang) throw new Error('CONFIG_MISSING');
      if (!targetRole) throw new Error('CONFIG_MISSING: MEMBER role not configured');
      if (!user) {
        user = await tx.user.create({ data: { mobileNumber: String(mobileNumber), mpin: null as any, mpinHash, roleId: targetRole.id, languageId: lang.id, status: 'PENDING' } });
      } else {
        // Always set MPIN; upgrade role if low-privilege
        const currentRole = await tx.role.findUnique({ where: { id: user.roleId } });
        const currentName = String(currentRole?.name || '').toUpperCase();
        const isMember = ['HRCI_MEMBER','MEMBER'].includes(currentName);
        // Upgrade any non-member role (including USER, CITIZEN_REPORTER, GUEST) to MEMBER
        await tx.user.update({ where: { id: user.id }, data: { mpin: null as any, mpinHash, ...(!isMember ? { roleId: targetRole.id } : {}) } });
      }
      await tx.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, fullName }, update: { fullName } });
      
      // 2) Create membership ACTIVE immediately (payment already succeeded)
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
        throw new Error('Seat no longer available');
      }
      
      // Activate membership and link intent
      await tx.membership.update({ where: { id: join.membershipId }, data: { status: 'ACTIVE', paymentStatus: 'SUCCESS', activatedAt: new Date() } });
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { membershipId: join.membershipId } });
      
      return { membershipId: join.membershipId };
    });

    return res.json({ 
      success: true, 
      data: { 
        status: 'ACTIVE', 
        membershipId: result.membershipId,
        message: 'Registration completed successfully'
      } 
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'REGISTRATION_FAILED', message: e?.message });
  }
});

// Check if mobile number has any paid but unregistered seats
/**
 * @swagger
 * /memberships/payfirst/check-mobile:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Check if mobile number has paid but unregistered seats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobileNumber]
 *             properties:
 *               mobileNumber:
 *                 type: string
 *                 example: '9876543210'
 *     responses:
 *       200:
 *         description: Mobile number payment status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     mobileNumber: { type: string }
 *                     isRegistered: { type: boolean }
 *                     roleName: { type: string, nullable: true, description: 'Role name when user exists (e.g., MEMBER, HRCI_ADMIN). Null if not registered.' }
 *                     hasPendingSeats: { type: boolean }
 *                     pendingRegistrations:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           orderId: { type: string }
 *                           amount: { type: number }
 *                           paidAt: { type: string, format: date-time }
 *                           seatDetails:
 *                             type: object
 *                     message: { type: string }
 */
router.post('/check-mobile', async (req, res) => {
  try {
    const { mobileNumber } = req.body || {};
    if (!mobileNumber) return res.status(400).json({ success: false, error: 'mobileNumber required' });

    // Check if user already registered
  const existingUser = await (prisma as any).user.findFirst({ where: { mobileNumber: String(mobileNumber) }, include: { role: true } });
    const isRegistered = !!existingUser;

    // Find paid intents linked to this mobile (stored in meta)
    const paidIntents = await (prisma as any).paymentIntent.findMany({
      where: {
        status: 'SUCCESS',
        membershipId: null, // Not yet registered
        OR: [
          { meta: { path: ['registrationMobile'], equals: mobileNumber } },
          // Also check if mobile matches any existing user with active membership
          ...(existingUser ? [{ 
            membershipId: { 
              in: await (prisma as any).membership.findMany({
                where: { userId: existingUser.id },
                select: { id: true }
              }).then((ms: any[]) => ms.map(m => m.id))
            }
          }] : [])
        ]
      }
    });

    const pendingRegistrations = [];
    for (const intent of paidIntents) {
      const seatDetails = await getSeatDetails(intent);
      pendingRegistrations.push({
        orderId: intent.id,
        amount: intent.amount,
        paidAt: intent.updatedAt,
        seatDetails
      });
    }

    return res.json({
      success: true,
      data: {
        mobileNumber,
        isRegistered,
        roleName: existingUser?.role?.name || null,
        hasPendingSeats: pendingRegistrations.length > 0,
        pendingRegistrations,
        message: pendingRegistrations.length > 0 
          ? `Found ${pendingRegistrations.length} paid seat(s) waiting for registration`
          : isRegistered 
            ? 'User already registered' 
            : 'No pending payments found'
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CHECK_FAILED', message: e?.message });
  }
});

// Admin: List all paid but unregistered seats
/**
 * @swagger
 * /memberships/payfirst/admin/pending:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: List all paid but unregistered seats (Admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending registrations
 */
router.get('/admin/pending', async (req, res) => {
  try {
    // Note: Add proper admin auth middleware in production
    const pendingIntents = await (prisma as any).paymentIntent.findMany({
      where: {
        status: 'SUCCESS',
        membershipId: null // Not yet registered
      },
      orderBy: { updatedAt: 'desc' }
    });

    const pendingList = [];
    for (const intent of pendingIntents) {
      const seatDetails = await getSeatDetails(intent);
      const linkedMobile = intent.meta?.registrationMobile || null;
      
      pendingList.push({
        orderId: intent.id,
        amount: intent.amount,
        paidAt: intent.updatedAt,
        linkedMobile,
        seatDetails,
        daysSincePaid: Math.floor((Date.now() - new Date(intent.updatedAt).getTime()) / (24 * 60 * 60 * 1000))
      });
    }

    return res.json({
      success: true,
      data: {
        count: pendingList.length,
        pendingRegistrations: pendingList,
        message: `Found ${pendingList.length} paid seats awaiting registration`
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ADMIN_CHECK_FAILED', message: e?.message });
  }
});

// Admin: Manually complete registration for a payment intent
/**
 * @swagger
 * /memberships/payfirst/admin/complete/{orderId}:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Manually complete registration for paid order (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mobile:
 *                 type: string
 *                 example: "9876543210"
 *               firstName:
 *                 type: string
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               mpin:
 *                 type: string
 *                 example: "123456"
 *             required: [mobile, firstName, lastName, mpin]
 *     responses:
 *       200:
 *         description: Registration completed successfully
 */
router.post('/admin/complete/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { mobile, firstName, lastName, mpin } = req.body;

    // Note: Add proper admin auth middleware in production

    // Find the payment intent
    const paymentIntent = await (prisma as any).paymentIntent.findUnique({
      where: { id: orderId }
    });

    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND',
        message: 'Payment order not found'
      });
    }

    if (paymentIntent.status !== 'SUCCESS') {
      return res.status(400).json({
        success: false,
        error: 'PAYMENT_NOT_SUCCESS',
        message: 'Payment is not in SUCCESS status'
      });
    }

    if (paymentIntent.membershipId) {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_REGISTERED',
        message: 'This payment has already been used for registration'
      });
    }

    // Check if user exists
    let user = await (prisma as any).user.findUnique({
      where: { mobileNumber: mobile }
    });

    let createdNewUser = false;
    if (!user) {
      // Create new user (require member role)
      const mpinHash = await bcrypt.hash(String(mpin), 10);
      const preferredRoles = ['HRCI_MEMBER','MEMBER'];
      const targetRole = await (prisma as any).role.findFirst({ where: { name: { in: preferredRoles as any } } });
      const lang = await (prisma as any).language.findFirst();
      if (!lang || !targetRole) {
        return res.status(500).json({ success: false, error: 'CONFIG_MISSING', message: 'MEMBER role or language not configured' });
      }
      user = await (prisma as any).user.create({
        data: {
          mobileNumber: String(mobile),
          mpin: null as any,
          mpinHash,
          roleId: targetRole.id,
          languageId: lang.id,
          status: 'PENDING'
        }
      });
      createdNewUser = true;

      // Create user profile
      await (prisma as any).userProfile.create({
        data: {
          userId: user.id,
          fullName: `${firstName} ${lastName}`
        }
      });
    } else {
      // Update existing user's MPIN and upgrade role to member if not already
      const mpinHash = await bcrypt.hash(String(mpin), 10);
      const currentRole = await (prisma as any).role.findUnique({ where: { id: user.roleId } });
      const currentName = String(currentRole?.name || '').toUpperCase();
      const isMember = ['HRCI_MEMBER','MEMBER'].includes(currentName);
      const preferredRoles = ['HRCI_MEMBER','MEMBER'];
      const targetRole = await (prisma as any).role.findFirst({ where: { name: { in: preferredRoles as any } } });
      await (prisma as any).user.update({
        where: { id: user.id },
        data: { mpin: null as any, mpinHash, ...(!isMember && targetRole ? { roleId: targetRole.id } : {}) }
      });

      // Update user profile
      await (prisma as any).userProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, fullName: `${firstName} ${lastName}` },
        update: { fullName: `${firstName} ${lastName}` }
      });
    }

    // Create membership using the same approach as the register endpoint
    const join = await membershipService.joinSeat({
      userId: user.id,
      cellCodeOrName: paymentIntent.cellCodeOrName,
      designationCode: paymentIntent.designationCode,
      level: paymentIntent.level as any,
      zone: paymentIntent.zone || undefined,
      hrcCountryId: paymentIntent.hrcCountryId || undefined,
      hrcStateId: paymentIntent.hrcStateId || undefined,
      hrcDistrictId: paymentIntent.hrcDistrictId || undefined,
      hrcMandalId: paymentIntent.hrcMandalId || undefined
    } as any);

    if (!join.accepted) {
      return res.status(400).json({
        success: false,
        error: 'SEAT_UNAVAILABLE',
        message: 'Seat is no longer available'
      });
    }

    // Activate membership and link intent
    const membership = await (prisma as any).membership.update({
      where: { id: join.membershipId },
      data: {
        status: 'ACTIVE',
        paymentStatus: 'SUCCESS',
        activatedAt: new Date()
      }
    });

    // Link the membership to payment intent
    await (prisma as any).paymentIntent.update({
      where: { id: orderId },
      data: { membershipId: join.membershipId }
    });

    // Get seat details for response
    const seatDetails = await getSeatDetails(paymentIntent);

    // Issue ID Card
    let idCard;
    try {
      idCard = await (prisma as any).iDCard.create({
        data: {
          userId: user.id,
          membershipId: membership.id,
          cardNumber: `HRCI-${Date.now()}-${user.id}`,
          status: 'ACTIVE'
        }
      });
    } catch (idError) {
      console.warn('ID Card creation failed:', idError);
    }

    return res.json({
      success: true,
      data: {
        message: 'Registration completed successfully by admin',
        user: {
          id: user.id,
          mobile: user.mobileNumber,
          createdNewUser
        },
        membership: {
          id: membership.id,
          cell: seatDetails.cell,
          designation: seatDetails.designation,
          level: seatDetails.level,
          location: seatDetails.location,
          status: 'ACTIVE'
        },
        idCard: idCard ? {
          id: idCard.id,
          cardNumber: idCard.cardNumber,
          status: idCard.status
        } : null,
        paymentIntent: {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          status: 'REGISTRATION_COMPLETED'
        }
      }
    });

  } catch (e: any) {
    console.error('Admin complete registration error:', e);
    return res.status(500).json({ 
      success: false, 
      error: 'ADMIN_COMPLETE_FAILED', 
      message: e?.message 
    });
  }
});

export default router;
