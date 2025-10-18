import { Router } from 'express';
import prisma from '../../lib/prisma';
import { createRazorpayOrder, getRazorpayKeyId, razorpayEnabled, verifyRazorpaySignature, createRazorpayPaymentLink, getRazorpayPaymentLink, getRazorpayOrderPayments } from '../../lib/razorpay';
import { generateDonationReceiptPdf, buildDonationReceiptHtml } from '../../lib/pdf/generateDonationReceipt';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import { randomUUID } from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import QRCode from 'qrcode';

const router = Router();

// Ensure asset URLs are absolute so images load in browsers and Puppeteer
function toAbsoluteAssetUrl(url: any, fallbackOrigin?: string): string {
  const raw = (url ?? '').toString().trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw)) return raw; // absolute or data URL
  const r2Base = process.env.R2_PUBLIC_BASE_URL && String(process.env.R2_PUBLIC_BASE_URL).trim();
  const base = r2Base && r2Base.replace(/\/$/, '');
  const origin = base || (fallbackOrigin ? fallbackOrigin.replace(/\/$/, '') : '');
  if (!origin) return raw; // last resort: return as-is
  const path = raw.replace(/^\//, '');
  return `${origin}/${path}`;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MEDIA_MAX_IMAGE_MB || 15) * 1024 * 1024 } });

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
 *       200:
 *         description: Events list
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
 *                       status: { type: string }
 *                       startAt: { type: string, format: date-time, nullable: true }
 *                       endAt: { type: string, format: date-time, nullable: true }
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
 *       200:
 *         description: Event details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
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
 * /donations/events/{id}/gallery:
 *   get:
 *     tags: [Donations]
 *     summary: List gallery images for an event (public)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Images }
 */
router.get('/events/:id/gallery', async (req, res) => {
  try {
    const id = String(req.params.id);
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, "eventId", url, caption, "order", "isActive", "createdAt", "updatedAt"
      FROM "DonationEventImage"
      WHERE "eventId" = ${id} AND "isActive" = true
      ORDER BY "order" ASC
    `;
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/events:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List donation events (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Events list (admin)
 */
router.get('/admin/events', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { status } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;
    const where: any = {};
    if (status) where.status = String(status);
    const rows = await (prisma as any).donationEvent.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    return res.json({ success: true, count: rows.length, nextCursor, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ADMIN_EVENTS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/events:
 *   post:
 *     tags: [Donations - Admin]
 *     summary: Create donation event (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               coverImageUrl: { type: string }
 *               goalAmount: { type: integer }
 *               currency: { type: string, default: 'INR' }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *               status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, ENDED], default: DRAFT }
 *               presets: { type: array, items: { type: integer } }
 *               allowCustom: { type: boolean, default: true }
 *     responses:
 *       200: { description: Created }
 */
router.post('/events', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ success: false, error: 'TITLE_REQUIRED' });
    const data: any = {
      title: String(b.title),
      description: b.description || null,
      coverImageUrl: b.coverImageUrl || null,
      goalAmount: typeof b.goalAmount === 'number' ? b.goalAmount : null,
      currency: b.currency || 'INR',
      status: b.status || 'DRAFT',
      presets: Array.isArray(b.presets) ? b.presets : [],
      allowCustom: typeof b.allowCustom === 'boolean' ? b.allowCustom : true,
    };
    if (b.startAt) data.startAt = new Date(b.startAt);
    if (b.endAt) data.endAt = new Date(b.endAt);
    const created = await (prisma as any).donationEvent.create({ data });
    return res.json({ success: true, data: created });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'EVENT_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/events/{id}:
 *   put:
 *     tags: [Donations - Admin]
 *     summary: Update donation event (admin)
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
 *               title: { type: string }
 *               description: { type: string }
 *               coverImageUrl: { type: string }
 *               goalAmount: { type: integer }
 *               currency: { type: string }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *               status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, ENDED] }
 *               presets: { type: array, items: { type: integer } }
 *               allowCustom: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/events/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const data: any = { ...b };
    if ('startAt' in b) data.startAt = b.startAt ? new Date(b.startAt) : null;
    if ('endAt' in b) data.endAt = b.endAt ? new Date(b.endAt) : null;
    if ('presets' in b && !Array.isArray(b.presets)) data.presets = [];
    const updated = await (prisma as any).donationEvent.update({ where: { id: String(req.params.id) }, data });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'EVENT_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/events/{id}/status:
 *   patch:
 *     tags: [Donations - Admin]
 *     summary: Update event status (admin)
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, ENDED] }
 *     responses:
 *       200: { description: Status updated }
 */
router.patch('/events/:id/status', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ success: false, error: 'STATUS_REQUIRED' });
    const updated = await (prisma as any).donationEvent.update({ where: { id: String(req.params.id) }, data: { status: String(status) } });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'EVENT_STATUS_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/events/{id}/gallery:
 *   post:
 *     tags: [Donations - Admin]
 *     summary: Add image to event gallery (admin)
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
 *             required: [url]
 *             properties:
 *               url: { type: string }
 *               caption: { type: string }
 *               order: { type: integer, default: 0 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       200: { description: Created }
 */
router.post('/admin/events/:id/gallery', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const b = req.body || {};
    if (!b.url) return res.status(400).json({ success: false, error: 'URL_REQUIRED' });
    const itemId = randomUUID();
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO "DonationEventImage" (id, "eventId", url, caption, "order", "isActive")
      VALUES (${itemId}, ${id}, ${String(b.url)}, ${b.caption || null}, ${Number(b.order) || 0}, ${typeof b.isActive === 'boolean' ? b.isActive : true})
      RETURNING id, "eventId", url, caption, "order", "isActive", "createdAt", "updatedAt"
    `;
    const created = rows[0];
    return res.json({ success: true, data: created });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/events/{id}/gallery:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List gallery images for an event (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Gallery list }
 */
router.get('/admin/events/:id/gallery', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, "eventId", url, caption, "order", "isActive", "createdAt", "updatedAt"
      FROM "DonationEventImage" WHERE "eventId" = ${id} ORDER BY "order" ASC, "createdAt" DESC
    `;
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_LIST_FAILED', message: e?.message });
  }
});

// =========================
// Member Donation Payment Links (Razorpay) – external payment flow
// =========================
/**
 * @swagger
 * /donations/members/payment-links:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Create a Razorpay Payment Link for a donation (member flow)
 *     description: Creates a Donation and a PaymentIntent, then generates a Razorpay Payment Link for external payment.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: integer, description: 'Amount in INR rupees', example: 500 }
 *               eventId: { type: string, nullable: true }
 *               donorName: { type: string, nullable: true }
 *               donorAddress: { type: string, nullable: true }
 *               donorMobile: { type: string, nullable: true }
 *               donorEmail: { type: string, nullable: true }
 *               donorPan: { type: string, nullable: true }
 *               isAnonymous: { type: boolean, default: false }
 *               shareCode: { type: string, nullable: true }
 *               callbackUrl: { type: string, nullable: true }
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
 *                     donationId: { type: string }
 *                     intentId: { type: string }
 *                     linkId: { type: string }
 *                     shortUrl: { type: string }
 */
router.post('/members/payment-links', requireAuth, async (req: any, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const user = req.user;
    const { eventId, amount, donorName, donorAddress, donorMobile, donorEmail, donorPan, isAnonymous, shareCode, callbackUrl } = req.body || {};
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    const panUpper = (donorPan ? String(donorPan) : '').trim().toUpperCase();
    if (amt > 10000 && !panUpper) return res.status(400).json({ success: false, error: 'PAN_REQUIRED_FOR_HIGH_VALUE_DONATION' });
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

    const intent = await prisma.paymentIntent.create({
      data: ({
        amount: amt,
        currency: 'INR',
        status: 'PENDING',
        intentType: 'DONATION' as any,
        cellCodeOrName: ev?.title || 'DONATION',
        designationCode: 'DONATION',
        level: 'NATIONAL' as any,
        meta: { donorName, donorAddress, donorMobile, donorEmail, donorPan: panUpper || null, isAnonymous: !!isAnonymous, eventId: ev?.id || null, shareCode: shareCode || null, createdByUserId: user?.id || null },
      } as any)
    });

    const donation = await (prisma as any).donation.create({
      data: {
        eventId: ev?.id || (await ensureDefaultEvent()),
        amount: amt,
        donorName: donorName || null,
        donorAddress: donorAddress || null,
        donorMobile: donorMobile || null,
        donorEmail: donorEmail || null,
        donorPan: panUpper || null,
        isAnonymous: !!isAnonymous,
        referrerUserId: referrerUserId || null,
        status: 'PENDING',
        paymentIntentId: intent.id,
      }
    });

    const pl = await createRazorpayPaymentLink({
      amountPaise: amt * 100,
      currency: 'INR',
      description: `Donation for ${ev?.title || 'General Donation'}`,
      reference_id: donation.id,
      customer: donorMobile || donorEmail ? { name: donorName, contact: donorMobile, email: donorEmail } : undefined,
      callback_url: callbackUrl,
      notes: { type: 'DONATION', donationId: donation.id, eventId: donation.eventId },
    });

    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', payment_link_id: pl.id } } });
    await (prisma as any).donation.update({ where: { id: donation.id }, data: { providerOrderId: pl.id } });

    return res.json({ success: true, data: { donationId: donation.id, intentId: intent.id, linkId: pl.id, shortUrl: (pl as any).short_url || null } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_PAYMENT_LINK_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/members/payment-links/{id}:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get Razorpay Payment Link status (member flow)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Payment link status }
 */
router.get('/members/payment-links/:id', requireAuth, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const linkId = String(req.params.id);
    const pl = await getRazorpayPaymentLink(linkId);
    return res.json({ success: true, data: pl });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_PAYMENT_LINK_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/members/payment-links/{id}:
 *   delete:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Cancel Razorpay Payment Link (member flow)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Payment link cancelled }
 */

/**
 * @swagger
 * /donations/admin/events/{id}/gallery/upload:
 *   post:
 *     tags: [Donations - Admin]
 *     summary: Upload multiple images to event gallery (admin)
 *     description: Accepts multipart/form-data with field name `images` (one or more files). Images are converted to WebP and stored in object storage.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               caption:
 *                 type: string
 *                 description: Optional caption to apply to all images (or send per-image in a future enhancement)
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200: { description: Images uploaded }
 */
router.post('/admin/events/:id/gallery/upload', requireAuth, requireHrcAdmin, upload.array('images'), async (req: any, res) => {
  try {
    const id = String(req.params.id);
    const files: Express.Multer.File[] = req.files || [];
    const { caption } = req.body || {};
    // Parse boolean from multipart body
    const isActiveRaw = (req.body?.isActive ?? 'true');
    const isActive = String(isActiveRaw).toLowerCase() === 'true' || String(isActiveRaw) === '1';
    if (!files.length) return res.status(400).json({ success: false, error: 'IMAGES_REQUIRED' });
    if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });
    const createdItems: any[] = [];
    let skipped = 0;
    let orderBase = 0;
    const existingMaxOrder = await prisma.$queryRaw<any[]>`
      SELECT COALESCE(MAX("order"), 0) as max_order FROM "DonationEventImage" WHERE "eventId" = ${id}
    `;
    orderBase = Number(existingMaxOrder?.[0]?.max_order || 0) + 1;
    const d = new Date();
    const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rand = Math.random().toString(36).slice(2, 8);
      const originalName = (file.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!((file.mimetype || '').startsWith('image/'))) { skipped++; continue; }
      // Convert to webp
      let buf = file.buffer;
      let mime = 'image/webp';
      try { buf = await sharp(file.buffer).webp({ quality: 80 }).toBuffer(); } catch { /* keep original buffer if sharp fails */ }
      const safeName = originalName.replace(/\.[^.]+$/, '') + '.webp';
      const key = `donations/${id}/${datePath}/${Date.now()}-${rand}-${safeName}`;
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000' }));
      const url = getPublicUrl(key);
      const itemId = randomUUID();
      const rows = await prisma.$queryRaw<any[]>`
        INSERT INTO "DonationEventImage" (id, "eventId", url, caption, "order", "isActive")
        VALUES (${itemId}, ${id}, ${url}, ${caption || null}, ${orderBase + i}, ${isActive})
        RETURNING id, "eventId", url, caption, "order", "isActive", "createdAt", "updatedAt"
      `;
      createdItems.push(rows[0]);
    }
    if (!createdItems.length) return res.status(400).json({ success: false, error: 'NO_VALID_IMAGES' });
    return res.json({ success: true, count: createdItems.length, skipped, data: createdItems });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_MULTI_UPLOAD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/events/{id}/gallery/{imageId}:
 *   put:
 *     tags: [Donations - Admin]
 *     summary: Update an event gallery image (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string }
 *               caption: { type: string }
 *               order: { type: integer }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/admin/events/:id/gallery/:imageId', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const imageId = String(req.params.imageId);
    const existingRows = await prisma.$queryRaw<any[]>`
      SELECT id, "eventId", url, caption, "order", "isActive" FROM "DonationEventImage" WHERE id = ${imageId}
    `;
    const curr = existingRows[0];
    if (!curr) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const b = req.body || {};
    const url = 'url' in b ? (b.url ?? null) : curr.url;
    const caption = 'caption' in b ? (b.caption ?? null) : curr.caption;
    const order = 'order' in b ? (b.order ?? curr.order) : curr.order;
    const isActive = 'isActive' in b ? (b.isActive ?? curr.isActive) : curr.isActive;
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE "DonationEventImage"
      SET url = ${url}, caption = ${caption}, "order" = ${order}, "isActive" = ${isActive}, "updatedAt" = NOW()
      WHERE id = ${imageId}
      RETURNING id, "eventId", url, caption, "order", "isActive", "createdAt", "updatedAt"
    `;
    return res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/events/{id}/gallery/{imageId}:
 *   delete:
 *     tags: [Donations - Admin]
 *     summary: Delete an event gallery image (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/admin/events/:id/gallery/:imageId', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const imageId = String(req.params.imageId);
    const result: any = await prisma.$executeRaw`
      DELETE FROM "DonationEventImage" WHERE id = ${imageId}
    `;
    // result is number of rows affected in recent Prisma versions
    return res.json({ success: true, deleted: Number(result) || 0 });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_DELETE_FAILED', message: e?.message });
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
 *       200:
 *         description: Created share link
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     code: { type: string }
 *                     eventId: { type: string }
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
 *       200:
 *         description: Share link info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     link: { type: object }
 *                     event: { type: object }
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
 *               donorAddress: { type: string, nullable: true }
 *               donorMobile: { type: string, nullable: true }
 *               donorEmail: { type: string, nullable: true }
 *               donorPan: { type: string, nullable: true }
 *               isAnonymous: { type: boolean, default: false }
 *               shareCode: { type: string, nullable: true, description: 'Optional member share link code' }
 *     responses:
 *       200:
 *         description: Order created
 *       400:
 *         description: Validation error (e.g., invalid amount or PAN missing for high value donation > 10,000 INR)
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
 *                         amount: { type: integer }
 *                         currency: { type: string }
 *                         provider: { type: string, nullable: true }
 *                         providerOrderId: { type: string, nullable: true }
 *                         providerKeyId: { type: string, nullable: true }
 */
router.post('/orders', async (req, res) => {
  try {
  const { eventId, amount, donorName, donorAddress, donorMobile, donorEmail, donorPan, isAnonymous, shareCode } = req.body || {};
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    // PAN normalization and presence check only for high-value
    const panUpper = (donorPan ? String(donorPan) : '').trim().toUpperCase();
    if (amt > 10000 && !panUpper) {
      return res.status(400).json({ success: false, error: 'PAN_REQUIRED_FOR_HIGH_VALUE_DONATION', message: 'PAN is required for donations above 10,000 INR' });
    }
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
      data: ({
        amount: amt,
        currency: 'INR',
        status: amt === 0 ? 'SUCCESS' : 'PENDING',
  intentType: 'DONATION' as any,
        // Satisfy not-null PaymentIntent fields used by membership flows
        cellCodeOrName: ev?.title || 'DONATION',
        designationCode: 'DONATION',
  level: 'NATIONAL' as any,
  meta: { donorName, donorAddress, donorMobile, donorEmail, donorPan: panUpper || null, isAnonymous: !!isAnonymous, eventId: ev?.id || null, shareCode: shareCode || null },
      } as any)
    });

    // Create donation record linked to intent
    const donation = await (prisma as any).donation.create({
      data: {
        eventId: ev?.id || (await ensureDefaultEvent()),
        amount: amt,
        donorName: donorName || null,
  donorAddress: donorAddress || null,
  donorMobile: donorMobile || null,
        donorEmail: donorEmail || null,
        donorPan: panUpper || null,
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
 *       200:
 *         description: Confirmation result
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
 *                     donationId: { type: string }
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
 * /donations/manual-verify:
 *   post:
 *     tags: [Donations]
 *     summary: Manually verify a donation payment when webhook/confirm is missed
 *     description: |
 *       - Use either providerOrderId (Razorpay Order ID) or payment_link_id (Razorpay Payment Link ID) to verify status.
 *       - On success, marks PaymentIntent and Donation as SUCCESS and updates event collectedAmount and share successCount.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               donationId: { type: string }
 *               providerOrderId: { type: string, nullable: true, description: 'Razorpay Order ID' }
 *               payment_link_id: { type: string, nullable: true, description: 'Razorpay Payment Link ID' }
 *     responses:
 *       200: { description: Verification result }
 */
router.post('/manual-verify', requireAuth, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const { donationId, providerOrderId, payment_link_id } = req.body || {};
    if (!donationId) return res.status(400).json({ success: false, error: 'DONATION_ID_REQUIRED' });
    const donation = await (prisma as any).donation.findUnique({ where: { id: String(donationId) } });
    if (!donation) return res.status(404).json({ success: false, error: 'DONATION_NOT_FOUND' });
    if (donation.status === 'SUCCESS') return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id } });
    const intent = await prisma.paymentIntent.findUnique({ where: { id: String(donation.paymentIntentId) } });
    if (!intent) return res.status(404).json({ success: false, error: 'INTENT_NOT_FOUND' });

    let paid = false;
    let providerPaymentId: string | undefined;

    // Prefer explicit params; else use stored meta
    const linkId = payment_link_id || (intent.meta as any)?.payment_link_id || null;
    const orderId = providerOrderId || donation.providerOrderId || (intent.meta as any)?.providerOrderId || null;

    if (linkId) {
      const pl = await getRazorpayPaymentLink(String(linkId));
      if (String(pl.status).toLowerCase() === 'paid') {
        paid = true;
      }
    } else if (orderId) {
      const resPay = await getRazorpayOrderPayments(String(orderId));
      const successPayment = resPay.items.find(p => String(p.status).toLowerCase() === 'captured' || String(p.status).toLowerCase() === 'authorized');
      if (successPayment) {
        paid = true;
        providerPaymentId = successPayment.id;
      }
    } else {
      return res.status(400).json({ success: false, error: 'MISSING_VERIFICATION_REFERENCE' });
    }

    if (!paid) {
      return res.json({ success: true, data: { status: 'PENDING', donationId: donation.id } });
    }

    // Mark success and apply side-effects
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS' } });
    await prisma.$transaction(async (tx) => {
      const anyTx = tx as any;
      const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS', providerPaymentId: providerPaymentId || donation.providerPaymentId } });
      await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
      // Share link success count
      const meta: any = intent.meta || {};
      const code = (meta && meta.shareCode) || null;
      if (code) {
        const link = await anyTx.donationShareLink.findUnique({ where: { code } }).catch(() => null);
        if (link) await anyTx.donationShareLink.update({ where: { id: link.id }, data: { successCount: { increment: 1 } } });
      }
    });
    return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_MANUAL_VERIFY_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/receipt/{id}:
 *   get:
 *     tags: [Donations]
 *     summary: Get donation receipt PDF
 *     description: Includes donor address (if provided). QR is embedded to verify this receipt URL.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PDF
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
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

    // Force absolute origin for QR to production domain
    const origin = 'https://app.hrcitodaynews.in'.replace(/\/$/, '');
    const qrUrl = `${origin}/donations/receipt/${donation.id}/html`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl).catch(() => undefined);
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
      // Always fetch branding via public endpoints under the app domain
      hrciLogoUrl: `${origin}/org/settings/logo`,
      stampRoundUrl: `${origin}/org/settings/stamp`,
    }, {
      receiptNo,
      receiptDate,
      donorName,
      donorAddress: donation.donorAddress || '',
      donorPan: donation.donorPan || undefined,
      amount: amountFmt,
      mode: donation.providerPaymentId ? 'UPI/Card/NetBanking' : 'Cash/Manual',
      purpose: 'Donation',
      qrDataUrl,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${donation.id}.pdf"`);
    return res.send(Buffer.from(pdf));
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'RECEIPT_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/receipt/{id}/html:
 *   get:
 *     tags: [Donations]
 *     summary: View donation receipt as HTML (for QR verification)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       400: { description: Receipt available only after payment success }
 *       404: { description: Not found }
 */
router.get('/receipt/:id/html', async (req, res) => {
  try {
    const donation = await (prisma as any).donation.findUnique({ where: { id: String(req.params.id) } });
    if (!donation) return res.status(404).send('Not Found');
    if (donation.status !== 'SUCCESS') return res.status(400).send('Receipt available after success');
    const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!org) return res.status(400).send('Organization settings required');

    const amountFmt = (donation.amount || 0).toLocaleString('en-IN');
    const receiptNo = `DN-${donation.id.slice(-8).toUpperCase()}`;
    const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
    const donorName = donation.isAnonymous ? 'Anonymous Donor' : (donation.donorName || 'Donor');
    // Force absolute origin for QR to production domain
    const origin = 'https://app.hrcitodaynews.in'.replace(/\/$/, '');
    const qrUrl = `${origin}/donations/receipt/${donation.id}/html`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl).catch(() => undefined);
    const html = buildDonationReceiptHtml({
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
      // Use base-relative endpoints so it works on any host
      hrciLogoUrl: `/org/settings/logo`,
      stampRoundUrl: `/org/settings/stamp`,
    }, {
      receiptNo,
      receiptDate,
      donorName,
      donorAddress: donation.donorAddress || '',
      donorPan: donation.donorPan || undefined,
      amount: amountFmt,
      mode: donation.providerPaymentId ? 'UPI/Card/NetBanking' : 'Cash/Manual',
      purpose: 'Donation',
      qrDataUrl,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e: any) {
    return res.status(500).send('Failed to render receipt');
  }
});

/**
 * @swagger
 * /donations/receipt/{id}/url:
 *   get:
 *     tags: [Donations]
 *     summary: Generate donation receipt and return a public download URL
 *     description: Generates the PDF, uploads to storage, and returns a public URL. PDF includes donor address (if provided) and a QR to verify this receipt URL.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Receipt URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *       400: { description: Receipt available only after payment success }
 *       404: { description: Donation not found }
 */
router.get('/receipt/:id/url', async (req, res) => {
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

  // Force absolute origin for QR to production domain
  const origin = 'https://app.hrcitodaynews.in'.replace(/\/$/, '');
  const qrUrl = `${origin}/donations/receipt/${donation.id}/html`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl).catch(() => undefined);
  // Use the same app domain for branding endpoints
  const appOrigin = 'https://app.hrcitodaynews.in'.replace(/\/$/, '');
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
  hrciLogoUrl: `${appOrigin}/org/settings/logo`,
  stampRoundUrl: `${appOrigin}/org/settings/stamp`,
    }, {
      receiptNo,
      receiptDate,
      donorName,
      donorAddress: donation.donorAddress || '',
      donorPan: donation.donorPan || undefined,
      amount: amountFmt,
      mode: donation.providerPaymentId ? 'UPI/Card/NetBanking' : 'Cash/Manual',
      purpose: 'Donation',
      qrDataUrl,
    });

    if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });
    const d = new Date(donation.createdAt);
    const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    const key = `donations/receipts/${datePath}/${receiptNo}.pdf`;
    await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: Buffer.from(pdf), ContentType: 'application/pdf', CacheControl: 'public, max-age=31536000' }));
    const url = getPublicUrl(key);
    return res.json({ success: true, data: { url } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'RECEIPT_URL_FAILED', message: e?.message });
  }
});

async function ensureDefaultEvent(): Promise<string> {
  const existing = await (prisma as any).donationEvent.findFirst({ where: { status: 'ACTIVE', title: 'General Donation' } });
  if (existing) return existing.id;
  const created = await (prisma as any).donationEvent.create({ data: { title: 'General Donation', status: 'ACTIVE', allowCustom: true, presets: [100, 500, 1000] } });
  return created.id;
}

export default router;
