import { Router } from 'express';
import passport from 'passport';
// Inline role guard (avoids module resolution issue); keep original file but not required here
function ensureSuperAdminOrManager(req: any, res: any, next: any) {
  const roleName = (req.user?.role?.name || '').toUpperCase();
  if (['SUPER_ADMIN', 'SUPERADMIN', 'NEWS_DESK_ADMIN', 'LANGUAGE_ADMIN'].includes(roleName)) return next();
  return res.status(403).json({ error: 'Forbidden: insufficient role' });
}
import { validationMiddleware } from '../middlewares/validation.middleware';
import { PaymentOrderRequestDto, VolunteerOnboardDto, IdCardIssueDto } from './hrc.dto';
import { verifyRazorpaySignature } from './hrc.razorpay';
import prisma from '../../lib/prisma';
import { resolveFee } from './hrc.fees.service';
import { createRazorpayOrder } from './hrc.razorpay';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: Human Rights & Citizen Initiative module (volunteers, teams, ID cards, cases, donations)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PaymentOrderRequestDto:
 *       type: object
 *       required: [purpose]
 *       properties:
 *         purpose:
 *           type: string
 *           enum: [ID_CARD_ISSUE, ID_CARD_RENEW, DONATION, OTHER]
 *         teamId:
 *           type: string
 *         mandalId:
 *           type: string
 *         districtId:
 *           type: string
 *         stateId:
 *           type: string
 *         amountMinorOverride:
 *           type: integer
 *           description: Required for DONATION if no fee config
 *         currency:
 *           type: string
 *           example: INR
 *     PaymentOrderResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         paymentTransactionId:
 *           type: string
 *         order:
 *           type: object
 *           description: Razorpay order payload
 *     VolunteerOnboardDto:
 *       type: object
 *       properties:
 *         userId:
 *           type: string
 *         teamIds:
 *           type: array
 *           items:
 *             type: string
 *         bio:
 *           type: string
 *         aadhaarNumber:
 *           type: string
 *     IdCardIssueDto:
 *       type: object
 *       required: [paymentTransactionId]
 *       properties:
 *         paymentTransactionId:
 *           type: string
 *         providerPaymentId:
 *           type: string
 *         providerSignature:
 *           type: string
 *         renewalIntervalMonths:
 *           type: integer
 */

// HEALTH / VERSION
router.get('/health', (_req, res) => {
  res.json({ success: true, module: 'HRCI', status: 'scaffold', version: 1 });
});

// --- TEAMS (phase 1 minimal placeholders) ---
router.post('/teams', passport.authenticate('jwt', { session: false }), ensureSuperAdminOrManager, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.get('/teams', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- VOLUNTEERS ---
router.post('/volunteers/onboard', passport.authenticate('jwt', { session: false }), validationMiddleware(VolunteerOnboardDto), async (req: any, res) => {
  try {
    const userId = req.body.userId || req.user?.id;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Ensure user exists
    const user = await (prisma as any).user.findUnique({ where: { id: userId }, include: { hrcVolunteerProfile: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let volunteer = user.hrcVolunteerProfile;
    if (!volunteer) {
      volunteer = await (prisma as any).hrcVolunteerProfile.create({
        data: {
          userId,
          bio: req.body.bio,
          aadhaarNumber: req.body.aadhaarNumber,
          addressLine1: req.body.addressLine1,
          addressLine2: req.body.addressLine2,
          pincode: req.body.pincode,
          active: true
        }
      });
    } else if (req.body.bio || req.body.aadhaarNumber) {
      volunteer = await (prisma as any).hrcVolunteerProfile.update({
        where: { id: volunteer.id },
        data: {
          bio: req.body.bio ?? volunteer.bio,
          aadhaarNumber: req.body.aadhaarNumber ?? volunteer.aadhaarNumber,
          addressLine1: req.body.addressLine1 ?? volunteer.addressLine1,
          addressLine2: req.body.addressLine2 ?? volunteer.addressLine2,
          pincode: req.body.pincode ?? volunteer.pincode,
          active: true
        }
      });
    }

    const teamIds: string[] = req.body.teamIds || [];
    const memberships: any[] = [];
    for (const tId of teamIds) {
      const team = await (prisma as any).hrcTeam.findUnique({ where: { id: tId } });
      if (!team) continue; // skip invalid
      const member = await (prisma as any).hrcTeamMember.upsert({
        where: { teamId_volunteerId: { teamId: tId, volunteerId: volunteer.id } },
        update: { active: true },
        create: { teamId: tId, volunteerId: volunteer.id, membershipRole: 'MEMBER' }
      });
      memberships.push(member);
    }

    res.json({ success: true, volunteer, membershipsCount: memberships.length });
  } catch (e: any) {
    console.error('Volunteer onboard error', e);
    res.status(500).json({ error: 'Failed to onboard volunteer', message: e?.message });
  }
});

/**
 * @swagger
 * /api/v1/hrc/payments/order:
 *   post:
 *     summary: Create payment order (Razorpay) for ID card or donation
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentOrderRequestDto'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentOrderResponse'
 */

// --- ID CARDS ---
router.post('/idcards/issue', passport.authenticate('jwt', { session: false }), validationMiddleware(IdCardIssueDto), async (req: any, res) => {
  try {
    const { paymentTransactionId, providerPaymentId, providerSignature, renewalIntervalMonths } = req.body as IdCardIssueDto;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    // Load transaction
    const txn = await (prisma as any).paymentTransaction.findUnique({ where: { id: paymentTransactionId } });
    if (!txn) return res.status(404).json({ error: 'Payment transaction not found' });
    if (txn.purpose !== 'ID_CARD_ISSUE' && txn.purpose !== 'ID_CARD_RENEW') return res.status(400).json({ error: 'Invalid purpose for ID card issuance' });

    // Optionally verify signature if provided
    if (providerPaymentId && providerSignature) {
      if (!txn.providerOrderId) return res.status(400).json({ error: 'Transaction missing providerOrderId for signature check' });
      const ok = verifyRazorpaySignature(txn.providerOrderId, providerPaymentId, providerSignature);
      if (!ok) return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Mark transaction paid if still pending
    if (txn.status === 'PENDING' || txn.status === 'CREATED') {
      await (prisma as any).paymentTransaction.update({ where: { id: txn.id }, data: { status: 'PAID', providerPaymentId, providerSignature, paidAt: new Date() } });
    }

    // Ensure volunteer exists (auto create profile if missing)
    let volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId } });
    if (!volunteer) {
      volunteer = await (prisma as any).hrcVolunteerProfile.create({ data: { userId, active: true } });
    }

    const interval = renewalIntervalMonths || txn.meta?.renewalIntervalMonths || 12;
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + interval);

    // Create ID card (one active at a time rule – optional future enhancement: revoke current active first)
    const idCard = await (prisma as any).hrcIdCard.create({
      data: {
        volunteerId: volunteer.id,
        expiryDate,
        renewalIntervalMonths: interval,
        feeAmountMinor: txn.amountMinor,
        currency: txn.currency,
        status: 'ACTIVE',
        paymentTxnId: txn.id
      }
    });

    res.json({ success: true, idCard });
  } catch (e: any) {
    console.error('ID card issue error', e);
    res.status(500).json({ error: 'Failed to issue ID card', message: e?.message });
  }
});

// --- CASES ---
router.post('/cases', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- DONATIONS ---
router.post('/donations', (_req, res) => {
  // public / anonymous allowed for initiating donation intent
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- PAYMENTS (Razorpay) ---
router.post('/payments/order', passport.authenticate('jwt', { session: false }), validationMiddleware(PaymentOrderRequestDto), async (req: any, res) => {
  try {
    const { purpose, teamId, mandalId, districtId, stateId, amountMinorOverride, currency } = req.body as PaymentOrderRequestDto;

    // Resolve fee unless override provided for donation
    let amountMinor: number | undefined;
    let renewalIntervalMonths: number | undefined;
    if (purpose === 'DONATION' && amountMinorOverride) {
      amountMinor = amountMinorOverride;
    } else {
      const fee = await resolveFee({ purpose: purpose as any, teamId, mandalId, districtId, stateId });
      if (!fee) return res.status(404).json({ error: 'Fee configuration not found' });
      amountMinor = fee.amountMinor;
      renewalIntervalMonths = fee.renewalIntervalMonths || undefined;
    }
    if (!amountMinor || amountMinor <= 0) return res.status(400).json({ error: 'Invalid amount resolved' });

    const cur = currency || process.env.HRCI_DEFAULT_CURRENCY || 'INR';
    const receipt = `HRC-${purpose}-${Date.now()}`;

    // Create PaymentTransaction (status CREATED)
  const paymentTxn = await (prisma as any).paymentTransaction.create({
      data: {
        purpose: purpose as any,
        amountMinor,
        currency: cur,
        status: 'CREATED',
        meta: { teamId, mandalId, districtId, stateId, renewalIntervalMonths }
      }
    });

    // Create Razorpay order
    const order = await createRazorpayOrder({ amountMinor, currency: cur, receipt, notes: { paymentTxnId: paymentTxn.id, purpose } });

    // Update transaction with provider order id
  await (prisma as any).paymentTransaction.update({ where: { id: paymentTxn.id }, data: { providerOrderId: order.id, status: 'PENDING' } });

    res.json({ success: true, paymentTransactionId: paymentTxn.id, order });
  } catch (e: any) {
    console.error('Payment order error', e);
    res.status(500).json({ error: 'Failed to create payment order', message: e?.message });
  }
});

/**
 * @swagger
 * /api/v1/hrc/volunteers/onboard:
 *   post:
 *     summary: Onboard user as volunteer and optionally attach to teams
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VolunteerOnboardDto'
 *     responses:
 *       200:
 *         description: Volunteer onboarded
 */

/**
 * @swagger
 * /api/v1/hrc/idcards/issue:
 *   post:
 *     summary: Issue (or finalize) ID card after successful payment
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IdCardIssueDto'
 *     responses:
 *       200:
 *         description: ID card issued
 */

router.post('/payments/webhook', (_req, res) => {
  // signature verification will be added; keep body raw (configure in app when implementing)
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
