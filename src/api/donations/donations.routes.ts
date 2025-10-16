import { Router } from 'express';
import prisma from '../../lib/prisma';
import { createRazorpayOrder, getRazorpayKeyId, razorpayEnabled, verifyRazorpaySignature } from '../../lib/razorpay';
import { generateDonationReceiptPdf } from '../../lib/pdf/generateDonationReceipt';
import { requireAuth } from '../middlewares/authz';

const router = Router();

function withinWindow(ev: any): boolean {
  const now = new Date();
  if (ev.startAt && new Date(ev.startAt) > now) return false;
  if (ev.endAt && new Date(ev.endAt) < now) return false;
  return true;
}

/**
 * @swagger
 * tags:
 *   - name: Donations
 *     description: Public donations APIs (events, orders, confirm, receipt)
 */

/**
 * @swagger
 * /donations/events:
 *   get:
 *     tags: [Donations]
 *     summary: List active donation events
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200: { description: Events list }
 */
router.get('/events', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const events = await (prisma as any).donationEvent.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const filtered = events.filter(withinWindow);
    return res.json({ success: true, count: filtered.length, data: filtered });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'EVENTS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/events/{id}:
 *   get:
 *     tags: [Donations]
 *     summary: Get donation event by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Event details }
 *       404: { description: Not found }
 */
router.get('/events/:id', async (req, res) => {
  try {
  const ev = await (prisma as any).donationEvent.findUnique({ where: { id: String(req.params.id) } });
    if (!ev) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: ev });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'EVENT_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/share-links:
 *   post:
 *     tags: [Donations]
 *     summary: Create a share link for an event (member-auth)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventId]
 *             properties:
 *               eventId: { type: string }
 *     responses:
 *       200: { description: Created share link }
 */
router.post('/share-links', requireAuth, async (req, res) => {
  try {
    const { eventId } = req.body || {};
    if (!eventId) return res.status(400).json({ success: false, error: 'eventId required' });
  const ev = await (prisma as any).donationEvent.findUnique({ where: { id: String(eventId) } });
    if (!ev) return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND' });
    const user: any = (req as any).user;
    const code = `D${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`.toUpperCase();
  const link = await (prisma as any).donationShareLink.create({ data: { eventId: ev.id, createdByUserId: user.id, code } });
    return res.json({ success: true, data: link });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'SHARE_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/share-links/{code}:
 *   get:
 *     tags: [Donations]
 *     summary: Resolve a share link code and increment clicks
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Share link info }
 *       404: { description: Not found }
 */
router.get('/share-links/:code', async (req, res) => {
  try {
    const code = String(req.params.code);
  const link = await (prisma as any).donationShareLink.findUnique({ where: { code } });
    if (!link || !link.active) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  await (prisma as any).donationShareLink.update({ where: { id: link.id }, data: { clicksCount: { increment: 1 } } }).catch(() => null);
  const ev = await (prisma as any).donationEvent.findUnique({ where: { id: link.eventId } }).catch(() => null);
    return res.json({ success: true, data: { link, event: ev } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'SHARE_RESOLVE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/orders:
 *   post:
 *     tags: [Donations]
 *     summary: Create donation order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               eventId: { type: string, nullable: true }
 *               amount: { type: integer, description: 'Amount in INR rupees', example: 500 }
 *               donorName: { type: string, nullable: true }
 *               donorMobile: { type: string, nullable: true }
 *               donorEmail: { type: string, nullable: true }
 *               donorPan: { type: string, nullable: true }
 *               isAnonymous: { type: boolean, default: false }
 *               shareCode: { type: string, nullable: true, description: 'Optional member share link code' }
 *     responses:
 *       200:
 *         description: Order created
 */
router.post('/orders', async (req, res) => {
  try {
    const { eventId, amount, donorName, donorMobile, donorEmail, donorPan, isAnonymous, shareCode } = req.body || {};
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    let ev: any = null;
    if (eventId) {
  ev = await (prisma as any).donationEvent.findUnique({ where: { id: String(eventId) } });
      if (!ev) return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND' });
      if (ev.status !== 'ACTIVE' || !withinWindow(ev)) return res.status(400).json({ success: false, error: 'EVENT_NOT_ACTIVE' });
    }

    // Optional: resolve share code
    let referrerUserId: string | undefined;
    if (shareCode) {
  const link = await (prisma as any).donationShareLink.findUnique({ where: { code: String(shareCode) } }).catch(() => null);
      if (link && link.active) {
        referrerUserId = link.createdByUserId;
  await (prisma as any).donationShareLink.update({ where: { id: link.id }, data: { ordersCount: { increment: 1 } } }).catch(() => null);
      }
    }

    // Create a PaymentIntent of type DONATION
    const intent = await prisma.paymentIntent.create({
      data: {
        amount: amt,
        currency: 'INR',
        status: amt === 0 ? 'SUCCESS' : 'PENDING',
        // @ts-expect-error: intentType is available in schema; cast to any to avoid stale client type errors
        intentType: 'DONATION' as any,
        meta: { donorName, donorMobile, donorEmail, donorPan, isAnonymous: !!isAnonymous, eventId: ev?.id || null },
      }
    });

    // Create donation record linked to intent
    const donation = await (prisma as any).donation.create({
      data: {
        eventId: ev?.id || (await ensureDefaultEvent()),
        amount: amt,
        donorName: donorName || null,
        donorMobile: donorMobile || null,
        donorEmail: donorEmail || null,
        donorPan: donorPan || null,
        isAnonymous: !!isAnonymous,
        referrerUserId: referrerUserId || null,
        status: amt === 0 ? 'SUCCESS' : 'PENDING',
        paymentIntentId: intent.id,
      }
    });

    let providerOrderId: string | undefined;
    if (razorpayEnabled() && amt > 0) {
      const rp = await createRazorpayOrder({ amountPaise: amt * 100, currency: 'INR', receipt: intent.id, notes: { type: 'DONATION', donationId: donation.id, eventId: donation.eventId } });
      providerOrderId = rp.id;
  await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', providerOrderId } } });
  await (prisma as any).donation.update({ where: { id: donation.id }, data: { providerOrderId } });
    }

    return res.json({ success: true, data: { order: { orderId: intent.id, amount: amt, currency: 'INR', provider: razorpayEnabled() && amt > 0 ? 'razorpay' : null, providerOrderId: providerOrderId || null, providerKeyId: razorpayEnabled() && amt > 0 ? getRazorpayKeyId() : null } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_ORDER_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/confirm:
 *   post:
 *     tags: [Donations]
 *     summary: Confirm donation payment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, status]
 *             properties:
 *               orderId: { type: string }
 *               status: { type: string, enum: [SUCCESS, FAILED] }
 *               provider: { type: string, nullable: true }
 *               providerRef: { type: string, nullable: true }
 *               razorpay_order_id: { type: string, nullable: true }
 *               razorpay_payment_id: { type: string, nullable: true }
 *               razorpay_signature: { type: string, nullable: true }
 *     responses:
 *       200: { description: Confirmation result }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, status, providerRef } = req.body || {};
    if (!orderId || !status) return res.status(400).json({ success: false, error: 'orderId and status required' });
    const intent = await prisma.paymentIntent.findUnique({ where: { id: String(orderId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });
  const donation = await (prisma as any).donation.findFirst({ where: { paymentIntentId: intent.id } });
    if (!donation) return res.status(404).json({ success: false, error: 'DONATION_NOT_FOUND' });

    if (intent.status === 'SUCCESS' || donation.status === 'SUCCESS') {
      return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id } });
    }

    if (status === 'FAILED') {
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'FAILED', providerRef: providerRef || null } });
  await (prisma as any).donation.update({ where: { id: donation.id }, data: { status: 'FAILED' } });
      return res.json({ success: true, data: { status: 'FAILED' } });
    }

    if (req.body.provider === 'razorpay') {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, error: 'MISSING_PG_SIGNATURE' });
      }
      const valid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!valid) return res.status(400).json({ success: false, error: 'INVALID_PG_SIGNATURE' });
  await (prisma as any).donation.update({ where: { id: donation.id }, data: { providerPaymentId: razorpay_payment_id } });
    }

    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS', providerRef: providerRef || null } });
    await prisma.$transaction(async (tx) => {
      const anyTx = tx as any;
      const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS' } });
      await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
      // Update share link success count if available on code
      const meta: any = intent.meta || {};
      const code = (meta && meta.shareCode) || null;
      if (code) {
        const link = await anyTx.donationShareLink.findUnique({ where: { code } }).catch(() => null);
        if (link) await anyTx.donationShareLink.update({ where: { id: link.id }, data: { successCount: { increment: 1 } } });
      }
    });
    return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_CONFIRM_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/receipt/{id}:
 *   get:
 *     tags: [Donations]
 *     summary: Get donation receipt PDF
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: PDF }
 *       404: { description: Not found }
 */
router.get('/receipt/:id', async (req, res) => {
  try {
  const donation = await (prisma as any).donation.findUnique({ where: { id: String(req.params.id) } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (donation.status !== 'SUCCESS') return res.status(400).json({ success: false, error: 'RECEIPT_AVAILABLE_AFTER_SUCCESS' });
  const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!org) return res.status(400).json({ success: false, error: 'ORG_SETTINGS_REQUIRED', message: 'Set organization settings first from admin' });

    const amountFmt = (donation.amount || 0).toLocaleString('en-IN');
    const receiptNo = `DN-${donation.id.slice(-8).toUpperCase()}`;
    const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
    const donorName = donation.isAnonymous ? 'Anonymous Donor' : (donation.donorName || 'Donor');

    const pdf = await generateDonationReceiptPdf({
      orgName: org.orgName,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      state: org.state,
      pincode: org.pincode,
      country: org.country,
      pan: org.pan,
      eightyGNumber: org.eightyGNumber,
      eightyGValidFrom: org.eightyGValidFrom,
      eightyGValidTo: org.eightyGValidTo,
      authorizedSignatoryName: org.authorizedSignatoryName,
      authorizedSignatoryTitle: org.authorizedSignatoryTitle,
    }, {
      receiptNo,
      receiptDate,
      donorName,
      donorAddress: '',
      donorPan: donation.donorPan || undefined,
      amount: amountFmt,
      mode: donation.providerPaymentId ? 'UPI/Card/NetBanking' : 'Cash/Manual',
      purpose: 'Donation',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${donation.id}.pdf"`);
    return res.send(Buffer.from(pdf));
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'RECEIPT_FAILED', message: e?.message });
  }
});

async function ensureDefaultEvent(): Promise<string> {
  const existing = await (prisma as any).donationEvent.findFirst({ where: { status: 'ACTIVE', title: 'General Donation' } });
  if (existing) return existing.id;
  const created = await (prisma as any).donationEvent.create({ data: { title: 'General Donation', status: 'ACTIVE', allowCustom: true, presets: [100, 500, 1000] } });
  return created.id;
}

export default router;
