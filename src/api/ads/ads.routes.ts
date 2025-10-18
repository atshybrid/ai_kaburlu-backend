import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { createRazorpayOrder, getRazorpayKeyId, razorpayEnabled, createRazorpayPaymentLink, getRazorpayPaymentLink, getRazorpayOrderPayments, listRazorpayPaymentLinks } from '../../lib/razorpay';

const router = Router();

function roleOk(user: any): boolean {
  const r = (user?.role?.name || '').toUpperCase();
  return ['SUPERADMIN','SUPER_ADMIN','ADMIN','NEWS_DESK','HRCI_ADMIN'].includes(r);
}
function requireAdsAdmin(req: any, res: any, next: any) {
  if (roleOk(req.user)) return next();
  return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Ads admin role required' });
}

// Create or update ad (without payment)
/**
 * @swagger
 * tags:
 *   - name: Ads (Admin)
 *     description: Manage sponsor ads and payments
 */
/**
 * @swagger
 * /ads/admin:
 *   post:
 *     tags: [Ads (Admin)]
 *     summary: Create a sponsor ad (DRAFT)
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, mediaType, mediaUrl]
 *             properties:
 *               title: { type: string }
 *               mediaType: { type: string, enum: [IMAGE, GIF, VIDEO] }
 *               mediaUrl: { type: string }
 *               posterUrl: { type: string, nullable: true }
 *               clickUrl: { type: string, nullable: true }
 *               weight: { type: number, default: 1 }
 *               languageId: { type: string, nullable: true, description: "Language ID (not code)" }
 *               latitude: { type: number, nullable: true }
 *               longitude: { type: number, nullable: true }
 *               radiusKm: { type: number, nullable: true }
 *               state: { type: string, nullable: true }
 *               district: { type: string, nullable: true }
 *               mandal: { type: string, nullable: true }
 *               pincode: { type: string, nullable: true }
 *               startAt: { type: string, format: date-time, nullable: true }
 *               endAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200: { description: Created }
 */
router.post('/admin', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    // Validate languageId if provided
    if (b.languageId) {
      const lang = await prisma.language.findUnique({ where: { id: String(b.languageId) } });
      if (!lang) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE_ID' });
    }
    const data: any = {
      title: String(b.title || '').trim(),
      status: String(b.status || 'DRAFT').toUpperCase(),
      mediaType: String(b.mediaType || '').toUpperCase(),
      mediaUrl: String(b.mediaUrl || '').trim(),
      posterUrl: b.posterUrl ? String(b.posterUrl) : null,
      clickUrl: b.clickUrl ? String(b.clickUrl) : null,
      weight: Number(b.weight || 1),
      // store languageId
      languageId: b.languageId || b.language || null,
      latitude: b.latitude !== undefined ? Number(b.latitude) : null,
      longitude: b.longitude !== undefined ? Number(b.longitude) : null,
      radiusKm: b.radiusKm !== undefined ? Number(b.radiusKm) : null,
      state: b.state ? String(b.state) : null,
      district: b.district ? String(b.district) : null,
      mandal: b.mandal ? String(b.mandal) : null,
      pincode: b.pincode ? String(b.pincode) : null,
      startAt: b.startAt ? new Date(b.startAt) : null,
      endAt: b.endAt ? new Date(b.endAt) : null,
      createdByUserId: req.user?.id || null,
    };
    if (!data.title || !data.mediaType || !data.mediaUrl) return res.status(400).json({ success: false, error: 'TITLE_MEDIA_REQUIRED' });
    if (!['IMAGE','GIF','VIDEO'].includes(data.mediaType)) return res.status(400).json({ success: false, error: 'INVALID_MEDIA_TYPE' });
    const ad = await (prisma as any).ad.create({ data });
    return res.json({ success: true, data: ad });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'AD_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /ads/admin:
 *   get:
 *     tags: [Ads (Admin)]
 *     summary: List sponsor ads (admin)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: List of ads ordered by last update
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       title: { type: string }
 *                       status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, EXPIRED] }
 *                       mediaType: { type: string, enum: [IMAGE, GIF, VIDEO] }
 *                       mediaUrl: { type: string }
 *                       posterUrl: { type: string, nullable: true }
 *                       clickUrl: { type: string, nullable: true }
 *                       weight: { type: number }
 *                       languageId: { type: string, nullable: true, description: "Language ID (stored as Ad.language)" }
 *                       startAt: { type: string, format: date-time, nullable: true }
 *                       endAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *                       createdByUserId: { type: string, nullable: true }
 */
router.get('/admin', requireAuth, requireAdsAdmin, async (_req, res) => {
  try {
    const ads = await (prisma as any).ad.findMany({ orderBy: { updatedAt: 'desc' } });
    return res.json({ success: true, count: ads.length, data: ads });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'AD_LIST_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /ads/admin/{id}:
 *   put:
 *     tags: [Ads (Admin)]
 *     summary: Update a sponsor ad
 *     security: [ { bearerAuth: [] } ]
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
 *               title: { type: string }
 *               status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, EXPIRED] }
 *               mediaType: { type: string, enum: [IMAGE, GIF, VIDEO] }
 *               mediaUrl: { type: string }
 *               posterUrl: { type: string }
 *               clickUrl: { type: string }
 *               weight: { type: number }
 *               languageId: { type: string, description: "Language ID (stored as Ad.language)" }
 *               startAt: { type: string, format: date-time, nullable: true }
 *               endAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200:
 *         description: Updated ad
 */
router.put('/admin/:id', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const b = req.body || {};
    const data: any = {};
  const fields = ['title','status','mediaType','mediaUrl','posterUrl','clickUrl','weight','languageId','latitude','longitude','radiusKm','state','district','mandal','pincode','startAt','endAt'];
    for (const k of fields) if (k in b) (data as any)[k] = b[k];
    if ('startAt' in data) data.startAt = data.startAt ? new Date(data.startAt) : null;
    if ('endAt' in data) data.endAt = data.endAt ? new Date(data.endAt) : null;
  if ('languageId' in data) data.languageId = b.languageId || null;
    if (data.languageId) {
      const lang = await prisma.language.findUnique({ where: { id: String(data.languageId) } });
      if (!lang) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE_ID' });
    }
    if ('latitude' in data) data.latitude = data.latitude !== null && data.latitude !== undefined ? Number(data.latitude) : null;
    if ('longitude' in data) data.longitude = data.longitude !== null && data.longitude !== undefined ? Number(data.longitude) : null;
    if ('radiusKm' in data) data.radiusKm = data.radiusKm !== null && data.radiusKm !== undefined ? Number(data.radiusKm) : null;
    const updated = await (prisma as any).ad.update({ where: { id }, data });
    return res.json({ success: true, data: updated });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'AD_UPDATE_FAILED', message: e?.message }); }
});

// Create payment intent for ad and return payment order (Razorpay)
/**
 * @swagger
 * /ads/admin/{id}/pay:
 *   post:
 *     tags: [Ads (Admin)]
 *     summary: Initiate payment for an ad
 *     description: Creates a PaymentIntent and optionally a Razorpay order. Returns IDs required for client-side payment completion.
 *     security: [ { bearerAuth: [] } ]
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
 *             required: [amount]
 *             properties:
 *               amount: { type: number, description: "Amount in INR" }
 *     responses:
 *       200:
 *         description: Payment initiation info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string, description: "Internal PaymentIntent ID" }
 *                     amount: { type: number }
 *                     currency: { type: string }
 *                     providerOrderId: { type: string, nullable: true, description: "Razorpay Order ID if enabled" }
 *                     providerKeyId: { type: string, nullable: true, description: "Razorpay key_id for client" }
 */
router.post('/admin/:id/pay', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const ad = await (prisma as any).ad.findUnique({ where: { id } });
    if (!ad) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    const intent = await prisma.paymentIntent.create({ data: { amount, currency: 'INR', status: 'PENDING' as any, intentType: 'AD' as any, meta: { adId: id } } });
    let providerOrderId: string | undefined;
    if (razorpayEnabled()) {
      const rp = await createRazorpayOrder({ amountPaise: amount * 100, currency: 'INR', receipt: intent.id, notes: { type: 'AD', adId: id } });
      providerOrderId = rp.id;
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', providerOrderId } } });
    }
    return res.json({ success: true, data: { orderId: intent.id, amount, currency: 'INR', providerOrderId: providerOrderId || null, providerKeyId: razorpayEnabled() ? getRazorpayKeyId() : null } });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'AD_PAY_INIT_FAILED', message: e?.message }); }
});

// Confirm payment webhook-like endpoint (reuse donations confirm style)
/**
 * @swagger
 * /ads/admin/pay/confirm:
 *   post:
 *     tags: [Ads (Admin)]
 *     summary: Confirm ad payment (webhook-like)
 *     description: Marks payment intent as SUCCESS and activates the ad. If Razorpay is enabled, signature verification is performed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: []
 *             properties:
 *               orderId: { type: string, nullable: true, description: "Internal PaymentIntent ID (preferred)" }
 *               razorpay_payment_id: { type: string, nullable: true }
 *               razorpay_order_id: { type: string, nullable: true, description: "Razorpay Order ID (fallback when orderId is not available)" }
 *               razorpay_signature: { type: string, nullable: true }
 *     responses:
 *       200: { description: Payment confirmed }
 */
router.post('/admin/pay/confirm', async (req, res) => {
  try {
    const { orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
    let intent = null as any;
    if (orderId) {
      intent = await prisma.paymentIntent.findUnique({ where: { id: String(orderId) } });
    }
    if (!intent && razorpay_order_id) {
      // Fallback: locate by Razorpay order id stored in meta.providerOrderId
      intent = await prisma.paymentIntent.findFirst({ where: { intentType: 'AD' as any, meta: { path: ['providerOrderId'], equals: String(razorpay_order_id) } }, orderBy: { createdAt: 'desc' } });
    }
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });
  if (String(intent.intentType) !== 'AD') return res.status(400).json({ success: false, error: 'INVALID_INTENT_TYPE' });
    // If Razorpay used, verify signature similar to donations
    if (razorpayEnabled() && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const { verifyRazorpaySignature } = await import('../../lib/razorpay');
      const ok = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!ok) return res.status(400).json({ success: false, error: 'BAD_SIGNATURE' });
    }
    // Mark SUCCESS and activate ad
  await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS' as any } });
    const adId = (intent.meta as any)?.adId;
    if (adId) {
      await (prisma as any).ad.update({ where: { id: adId }, data: { status: 'ACTIVE' } });
    }
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'AD_PAY_CONFIRM_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /ads/admin/{id}/pay/link:
 *   post:
 *     tags: [Ads (Admin)]
 *     summary: Create Razorpay Payment Link for ad
 *     description: Generates a Razorpay Payment Link so the advertiser can pay externally. Use confirm endpoint or webhook to activate on success.
 *     security: [ { bearerAuth: [] } ]
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
 *             required: [amount]
 *             properties:
 *               amount: { type: number, description: "Amount in INR" }
 *               description: { type: string }
 *               customer: { type: object, properties: { name: { type: string }, contact: { type: string }, email: { type: string } } }
 *               callbackUrl: { type: string }
 *     responses:
 *       200:
 *         description: Payment link created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     linkId: { type: string }
 *                     shortUrl: { type: string }
 */
router.post('/admin/:id/pay/link', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const id = String(req.params.id);
    const ad = await (prisma as any).ad.findUnique({ where: { id } });
    if (!ad) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
  const description = req.body.description || `Payment for Ad: ${ad.title}`;
  const customer = req.body.customer || undefined;
  const rawCallback = req.body.callbackUrl || undefined;
  const callbackUrl = (typeof rawCallback === 'string' && /^https?:\/\//i.test(rawCallback)) ? rawCallback : undefined;
  if (rawCallback && !callbackUrl) return res.status(400).json({ success: false, error: 'INVALID_CALLBACK_URL', message: 'callbackUrl must be an absolute http(s) URL' });
  // Create a PaymentIntent for traceability
  const intent = await prisma.paymentIntent.create({ data: { amount, currency: 'INR', status: 'PENDING' as any, intentType: 'AD' as any, meta: { adId: id } } });
    // Use a unique reference_id per attempt to satisfy Razorpay's uniqueness constraint
    const reference_id = intent.id;
    const pl = await createRazorpayPaymentLink({
      amountPaise: amount * 100,
      currency: 'INR',
      description,
      reference_id,
      customer,
      callback_url: callbackUrl,
      notes: { type: 'AD', adId: id, intentId: intent.id },
    });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', payment_link_id: (pl as any).id, reference_id } } });
    return res.json({ success: true, data: { linkId: pl.id, shortUrl: (pl as any).short_url || null, intentId: intent.id } });
  } catch (e: any) {
    // If duplicate reference_id error from older deployments (where reference_id was adId), return existing link if any
    const detail = e?.response?.data || undefined;
    const desc: string | undefined = detail?.error?.description;
    const id = String(req.params.id);
    if (desc && desc.includes('payment link with given reference_id') && desc.includes(id)) {
      try {
        const list = await listRazorpayPaymentLinks({ reference_id: id });
        const existing = list.items && list.items[0];
        if (existing) {
          return res.json({ success: true, data: { linkId: existing.id, shortUrl: existing.short_url || null, reused: true } });
        }
      } catch {}
    }
    return res.status(500).json({ success: false, error: 'AD_PAY_LINK_FAILED', message: e?.message, detail });
  }
});

/**
 * @swagger
 * /ads/admin/pay/manual-verify:
 *   post:
 *     tags: [Ads (Admin)]
 *     summary: Manually verify ad payment when webhook/confirm is missed
 *     description: |
 *       - Provide adId and either providerOrderId (Razorpay Order ID) or payment_link_id (Razorpay Payment Link ID).
 *       - If paid, marks related PaymentIntent as SUCCESS and activates the Ad.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [adId]
 *             properties:
 *               adId: { type: string }
 *               providerOrderId: { type: string, nullable: true }
 *               payment_link_id: { type: string, nullable: true }
 *     responses:
 *       200: { description: Verification result }
 */
router.post('/admin/pay/manual-verify', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const { adId, providerOrderId, payment_link_id } = req.body || {};
    if (!adId) return res.status(400).json({ success: false, error: 'AD_ID_REQUIRED' });
    const ad = await (prisma as any).ad.findUnique({ where: { id: String(adId) } });
    if (!ad) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (String(ad.status) === 'ACTIVE') return res.json({ success: true, data: { status: 'ACTIVE' } });

    // Find latest intent for this ad
    const intent = await prisma.paymentIntent.findFirst({ where: { intentType: 'AD' as any, meta: { path: ['adId'], equals: String(adId) } }, orderBy: { createdAt: 'desc' } }).catch(() => null);

    let paid = false;
    // Validate Razorpay ID formats to avoid 404s when internal IDs are mistakenly passed
    const isRpLink = (s: any) => typeof s === 'string' && /^plink_/i.test(s);
    const isRpOrder = (s: any) => typeof s === 'string' && /^order_/i.test(s);
    const providedLinkId = isRpLink(payment_link_id) ? String(payment_link_id) : undefined;
    const providedOrderId = isRpOrder(providerOrderId) ? String(providerOrderId) : undefined;
    const linkId = providedLinkId || (intent && (intent.meta as any)?.payment_link_id) || null;
    const orderId = providedOrderId || (intent && (intent.meta as any)?.providerOrderId) || null;

    try {
      if (linkId) {
        const pl = await getRazorpayPaymentLink(String(linkId));
        if (String(pl.status).toLowerCase() === 'paid') paid = true;
      } else if (orderId) {
        const resPay = await getRazorpayOrderPayments(String(orderId));
        const successPayment = resPay.items.find(p => String(p.status).toLowerCase() === 'captured' || String(p.status).toLowerCase() === 'authorized');
        if (successPayment) paid = true;
      } else {
        return res.status(400).json({ success: false, error: 'MISSING_VERIFICATION_REFERENCE', message: 'Provide a valid payment_link_id (plink_*) or providerOrderId (order_*), or ensure a PaymentIntent exists for this ad.' });
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        return res.status(400).json({ success: false, error: 'INVALID_PROVIDER_REFERENCE', message: 'Payment reference not found at provider. Ensure payment_link_id starts with plink_* or providerOrderId starts with order_*.' });
      }
      throw err;
    }

    if (!paid) return res.json({ success: true, data: { status: 'PENDING' } });

    if (intent) await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS' as any } }).catch(() => null);
    await (prisma as any).ad.update({ where: { id: ad.id }, data: { status: 'ACTIVE' } });
    return res.json({ success: true, data: { status: 'ACTIVE' } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'AD_MANUAL_VERIFY_FAILED', message: e?.message });
  }
});

export default router;
