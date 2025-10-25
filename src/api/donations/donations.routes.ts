import { Router } from 'express';
import prisma from '../../lib/prisma';
import { createRazorpayOrder, getRazorpayKeyId, razorpayEnabled, verifyRazorpaySignature, createRazorpayPaymentLink, getRazorpayPaymentLink, getRazorpayOrderPayments, listRazorpayPaymentLinks, updateRazorpayPaymentLink, notifyRazorpayPaymentLink } from '../../lib/razorpay';
import { generateDonationReceiptPdf, buildDonationReceiptHtml } from '../../lib/pdf/generateDonationReceipt';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import { randomUUID } from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import QRCode from 'qrcode';
import { logAdminAction } from '../../lib/audit';

const router = Router();

// Small in-memory helpers for caching and rate limiting (stateless fallback; fine for a single instance)
const linkStatusCache = new Map<string, { ts: number; data: any }>();
const orderStatusCache = new Map<string, { ts: number; data: any }>();
const rateBucket = new Map<string, { windowStart: number; count: number }>();
const STATUS_TTL_MS = 3_000; // micro-cache 3s
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_PER_KEY = 30; // 30 req/min per (ip+linkId)

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

function maskPan(pan?: string | null): string | null {
  if (!pan) return null;
  const s = String(pan);
  // Mask all but last 4 characters
  return s.replace(/.(?=.{4}$)/g, 'X');
}

// Resolve the public base URL for constructing absolute links
function resolvePublicBase(req: any): string {
  const envBase = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').toString().trim();
  if (envBase) return envBase.replace(/\/$/, '');
  const xfProto = (req.headers['x-forwarded-proto'] as string) || undefined;
  const proto = (xfProto && xfProto.split(',')[0]) || req.protocol || 'http';
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0];
  return host ? `${proto}://${host}` : '';
}

// Build a structured 80G receipt JSON for front-end rendering
async function buildReceiptJson(donation: any, req: any, override?: { pdfUrl?: string | null; htmlUrl?: string | null }) {
  const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!org) throw new Error('ORG_SETTINGS_REQUIRED');
  const origin = resolvePublicBase(req);
  const amountFmt = (donation.amount || 0).toLocaleString('en-IN');
  const receiptNo = `DN-${String(donation.id).slice(-8).toUpperCase()}`;
  const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
  const donorName = donation.isAnonymous ? 'Anonymous Donor' : (donation.donorName || 'Donor');
  const htmlUrl = override?.htmlUrl || donation.receiptHtmlUrl || (origin ? `${origin}/donations/receipt/${donation.id}/html` : null);
  const pdfUrl = override?.pdfUrl || donation.receiptPdfUrl || null;
  return {
    id: donation.id,
    receiptNo,
    receiptDate,
    amount: donation.amount,
    amountFormatted: amountFmt,
    currency: donation.currency || 'INR',
    mode: donation.providerPaymentId ? 'UPI/Card/NetBanking' : 'Cash/Manual',
    purpose: 'Donation',
    donor: {
      name: donorName,
      address: donation.donorAddress || '',
      pan: donation.donorPan || null,
      mobile: donation.donorMobile || null,
      email: donation.donorEmail || null,
      isAnonymous: !!donation.isAnonymous,
    },
    org: {
      name: org.orgName,
      addressLine1: org.addressLine1 || null,
      addressLine2: org.addressLine2 || null,
      city: org.city || null,
      state: org.state || null,
      pincode: org.pincode || null,
      country: org.country || null,
      pan: org.pan || null,
      eightyG: {
        number: org.eightyGNumber || null,
        validFrom: org.eightyGValidFrom || null,
        validTo: org.eightyGValidTo || null,
      },
      authorizedSignatoryName: org.authorizedSignatoryName || null,
      authorizedSignatoryTitle: org.authorizedSignatoryTitle || null,
      logoUrl: `${origin}/org/settings/logo`,
      stampUrl: `${origin}/org/settings/stamp`,
    },
    verify: {
      htmlUrl,
      pdfUrl,
    },
  };
}

// Generate and persist receipt links (PDF uploaded + HTML absolute URL). Idempotent: returns existing if already set.
async function ensureReceiptLinks(donation: any, req: any): Promise<{ pdfUrl: string; htmlUrl: string }> {
  if (donation.receiptPdfUrl && donation.receiptHtmlUrl) {
    return { pdfUrl: donation.receiptPdfUrl, htmlUrl: donation.receiptHtmlUrl };
  }
  const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!org) throw new Error('ORG_SETTINGS_REQUIRED');
  const origin = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').toString().replace(/\/$/, '');
  const htmlUrl = origin ? `${origin}/donations/receipt/${donation.id}/html` : `${req?.protocol || 'http'}://${req?.get?.('host') || ''}/donations/receipt/${donation.id}/html`;

  // Build PDF once and upload
  const amountFmt = (donation.amount || 0).toLocaleString('en-IN');
  const receiptNo = `DN-${String(donation.id).slice(-8).toUpperCase()}`;
  const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
  const donorName = donation.isAnonymous ? 'Anonymous Donor' : (donation.donorName || 'Donor');
  const qrDataUrl = await QRCode.toDataURL(htmlUrl).catch(() => undefined);
  const appOrigin = origin || `${req?.protocol || 'http'}://${req?.get?.('host') || ''}`.replace(/\/$/, '');
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
  if (!R2_BUCKET) throw new Error('STORAGE_NOT_CONFIGURED');
  const d = new Date(donation.createdAt);
  const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  const key = `donations/receipts/${datePath}/${receiptNo}.pdf`;
  await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: Buffer.from(pdf), ContentType: 'application/pdf', CacheControl: 'public, max-age=31536000' }));
  const pdfUrl = getPublicUrl(key);
  const updated = await (prisma as any).donation.update({ where: { id: donation.id }, data: { receiptPdfUrl: pdfUrl, receiptHtmlUrl: htmlUrl, receiptGeneratedAt: new Date() } });
  return { pdfUrl: updated.receiptPdfUrl, htmlUrl: updated.receiptHtmlUrl };
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
 *     description: Creates a Donation and a PaymentIntent, then generates a Razorpay Payment Link for external payment. Callback URL is not used; status is handled internally via webhooks and reconciliation.
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
 *                     status: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *                     statusUrl: { type: string, description: 'Public endpoint to fetch current payment link status' }
 */
router.post('/members/payment-links', requireAuth, async (req: any, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const user = req.user;
  const { eventId, amount, donorName, donorAddress, donorMobile, donorEmail, donorPan, isAnonymous, shareCode } = req.body || {};
    const idempotencyKey = (req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || (req.body && req.body.idempotencyKey) || '').toString().trim();
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

    // Attribution policy: always attribute to the logged-in member creating the link
    const referrerUserId: string | undefined = user?.id;
    // Optional: if a shareCode is provided, only update its counters (do not override attribution)
    if (shareCode) {
      const link = await (prisma as any).donationShareLink.findUnique({ where: { code: String(shareCode) } }).catch(() => null);
      if (link && link.active) {
        await (prisma as any).donationShareLink.update({ where: { id: link.id }, data: { ordersCount: { increment: 1 } } }).catch(() => null);
      }
    }

    // If idempotency key provided, try to find a recent pending intent+donation by this user and parameters
    if (idempotencyKey) {
      const existing = await prisma.paymentIntent.findFirst({
        where: {
          intentType: 'DONATION' as any,
          status: 'PENDING',
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }, // last 10 minutes
        },
        orderBy: { createdAt: 'desc' }
      }).catch(() => null);
      if (existing) {
        const existingDonation = await (prisma as any).donation.findFirst({ where: { paymentIntentId: existing.id, referrerUserId: user?.id } }).catch(() => null);
        if (existingDonation && existingDonation.providerOrderId) {
          const base = resolvePublicBase(req);
          const statusPath = `${req.baseUrl}/payment-links/${existingDonation.providerOrderId}/status`;
          const statusUrl = base ? `${base}${statusPath}` : statusPath;
          return res.json({ success: true, data: { donationId: existingDonation.id, intentId: existing.id, linkId: existingDonation.providerOrderId, shortUrl: null, status: existingDonation.status, statusUrl }, idempotent: true });
        }
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
        meta: { donorName, donorAddress, donorMobile, donorEmail, donorPan: panUpper || null, isAnonymous: !!isAnonymous, eventId: ev?.id || null, shareCode: shareCode || null, createdByUserId: user?.id || null, idempotencyKey: idempotencyKey || null },
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
      notes: { type: 'DONATION', donationId: donation.id, eventId: donation.eventId },
    });

    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', payment_link_id: pl.id } } });
    await (prisma as any).donation.update({ where: { id: donation.id }, data: { providerOrderId: pl.id } });

  const base = resolvePublicBase(req);
  // req.baseUrl will be '/donations' or '/api/v1/donations' depending on mount
  const statusPath = `${req.baseUrl}/payment-links/${pl.id}/status`;
  const statusUrl = base ? `${base}${statusPath}` : statusPath;
  return res.json({ success: true, data: { donationId: donation.id, intentId: intent.id, linkId: pl.id, shortUrl: (pl as any).short_url || null, status: donation.status, statusUrl } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_PAYMENT_LINK_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/members/payment-links:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: List donation payment links created by the logged-in member
 *     description: Returns payment-link based donations attributed to the member (via JWT), with optional filters and totals by status.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Filter from createdAt (inclusive)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Filter to createdAt (inclusive)
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Comma-separated statuses to include (PENDING,SUCCESS,FAILED,REFUND)
 *       - in: query
 *         name: eventId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *       - in: query
 *         name: includeShortUrl
 *         schema: { type: boolean, default: false }
 *         description: When true, fetch Razorpay payment link short URL for each item (may be slower)
 *     responses:
 *       200:
 *         description: List of member payment links and totals
 */
router.get('/members/payment-links', requireAuth, async (req: any, res) => {
  try {
    const userId = req.user?.id as string;
    if (!userId) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });

    const { from, to, status, eventId } = req.query as any;
    const verify = String(req.query.verify || '').toLowerCase() === 'true';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
  const includeShortUrl = String(req.query.includeShortUrl || '').toLowerCase() === 'true';

    const where: any = {
      referrerUserId: userId,
      // only those created via payment-link flow
      providerOrderId: { not: null },
    };

    if (from) {
      const d = new Date(String(from));
      if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d };
    }
    if (to) {
      const d = new Date(String(to));
      if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d };
    }
    if (status) {
      const arr = String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (arr.length) (where as any).status = { in: arr };
    }
    if (eventId) (where as any).eventId = String(eventId);

    let [rows, totalCount] = await Promise.all([
      (prisma as any).donation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
          donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
      }),
      (prisma as any).donation.count({ where })
    ]);

    // Optional reconciliation against Razorpay for pending rows in the page
    let reconciled = 0;
    if (verify && razorpayEnabled()) {
      for (const d of rows) {
        if (d.status === 'PENDING' && d.providerOrderId) {
          try {
            const pl = await getRazorpayPaymentLink(String(d.providerOrderId));
            if (String(pl.status).toLowerCase() === 'paid') {
              const intent = await prisma.paymentIntent.findFirst({ where: { id: String((await (prisma as any).donation.findUnique({ where: { id: d.id } })).paymentIntentId) } }).catch(() => null);
              await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
              await prisma.$transaction(async (tx) => {
                const anyTx = tx as any;
                const updated = await anyTx.donation.update({ where: { id: d.id }, data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || d.providerPaymentId } });
                await anyTx.donationEvent.update({ where: { id: updated.eventId }, data: { collectedAmount: { increment: updated.amount } } }).catch(() => null);
              });
              reconciled++;
            }
          } catch { /* ignore reconciliation errors per row */ }
        }
      }
      // Refresh the page rows if any reconciled
      if (reconciled > 0) {
        rows = await (prisma as any).donation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
            donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
        });
      }
    }

    // Totals by status using groupBy over the same filter (ignores pagination)
    const gb = await (prisma as any).donation.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amount: true }
    });
    const totals: any = { overall: { count: totalCount, amount: 0 }, byStatus: {} };
    for (const r of gb) {
      const amt = Number(r._sum?.amount || 0);
      totals.byStatus[r.status] = { count: Number(r._count?._all || 0), amount: amt };
      totals.overall.amount += amt;
    }

    // Optionally fetch short URLs
    const shortUrlMap = new Map<string, string | null>();
    if (includeShortUrl && razorpayEnabled()) {
      for (const r of rows) {
        if (r.providerOrderId && !shortUrlMap.has(r.providerOrderId)) {
          try {
            const pl = await getRazorpayPaymentLink(String(r.providerOrderId));
            shortUrlMap.set(r.providerOrderId, (pl as any).short_url || null);
          } catch { shortUrlMap.set(r.providerOrderId, null); }
        }
      }
    }
    // Backfill missing receipts for SUCCESS rows (cap to first 3 to avoid heavy work per call)
    let backfilled = 0;
    for (const r of rows) {
      if (backfilled >= 3) break;
      if (r.status === 'SUCCESS' && (!r.receiptPdfUrl || !r.receiptHtmlUrl)) {
        try {
          const full = await (prisma as any).donation.findUnique({ where: { id: r.id } });
          await ensureReceiptLinks(full, req);
          backfilled++;
        } catch {}
      }
    }
    // Attach masked PAN, shortUrl, and receipt links
    const data = rows.map((r: any) => ({
      ...r,
      donorPanMasked: maskPan(r.donorPan),
      shortUrl: r.providerOrderId ? (shortUrlMap.get(r.providerOrderId) ?? null) : null,
      receiptPdfUrl: r.receiptPdfUrl || null,
      receiptHtmlUrl: r.receiptHtmlUrl || null,
    }));
    return res.json({ success: true, count: data.length, total: totalCount, totals, data, reconciled });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MEMBER_PAYMENT_LINKS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/members/{userId}/payment-links:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List donation payment links created by a member (admin)
 *     description: HRCI Admin can view a member's payment link donations with filters and totals.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: eventId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200:
 *         description: Admin view of member payment links
 */
router.get('/admin/members/:userId/payment-links', requireAuth, requireHrcAdmin, async (req: any, res) => {
  try {
    const memberUserId = String(req.params.userId);
    const { from, to, status, eventId } = req.query as any;
    const verify = String(req.query.verify || '').toLowerCase() === 'true';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const includeShortUrl = String(req.query.includeShortUrl || '').toLowerCase() === 'true';

    const where: any = {
      referrerUserId: memberUserId,
      providerOrderId: { not: null },
    };
    if (from) { const d = new Date(String(from)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d }; }
    if (to) { const d = new Date(String(to)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d }; }
    if (status) {
      const arr = String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (arr.length) (where as any).status = { in: arr };
    }
    if (eventId) (where as any).eventId = String(eventId);

    let [rows, totalCount] = await Promise.all([
      (prisma as any).donation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
          donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
      }),
      (prisma as any).donation.count({ where })
    ]);

    let reconciled = 0;
    if (verify && razorpayEnabled()) {
      for (const d of rows) {
        if (d.status === 'PENDING' && d.providerOrderId) {
          try {
            const pl = await getRazorpayPaymentLink(String(d.providerOrderId));
            if (String(pl.status).toLowerCase() === 'paid') {
              const intent = await prisma.paymentIntent.findFirst({ where: { id: String((await (prisma as any).donation.findUnique({ where: { id: d.id } })).paymentIntentId) } }).catch(() => null);
              await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
              await prisma.$transaction(async (tx) => {
                const anyTx = tx as any;
                const updated = await anyTx.donation.update({ where: { id: d.id }, data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || d.providerPaymentId } });
                await anyTx.donationEvent.update({ where: { id: updated.eventId }, data: { collectedAmount: { increment: updated.amount } } }).catch(() => null);
              });
              // Generate and persist receipt links for newly paid donations
              try { await ensureReceiptLinks({ ...d }, req); } catch {}
              reconciled++;
            }
          } catch { }
        }
      }
      if (reconciled > 0) {
        rows = await (prisma as any).donation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
            donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
        });
      }
    }

    const gb = await (prisma as any).donation.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amount: true }
    });
    const totals: any = { overall: { count: totalCount, amount: 0 }, byStatus: {} };
    for (const r of gb) {
      const amt = Number(r._sum?.amount || 0);
      totals.byStatus[r.status] = { count: Number(r._count?._all || 0), amount: amt };
      totals.overall.amount += amt;
    }

    const shortUrlMap = new Map<string, string | null>();
    if (includeShortUrl && razorpayEnabled()) {
      for (const r of rows) {
        if (r.providerOrderId && !shortUrlMap.has(r.providerOrderId)) {
          try {
            const pl = await getRazorpayPaymentLink(String(r.providerOrderId));
            shortUrlMap.set(r.providerOrderId, (pl as any).short_url || null);
          } catch { shortUrlMap.set(r.providerOrderId, null); }
        }
      }
    }
    let backfilled = 0;
    for (const r of rows) {
      if (backfilled >= 3) break;
      if (r.status === 'SUCCESS' && (!r.receiptPdfUrl || !r.receiptHtmlUrl)) {
        try {
          const full = await (prisma as any).donation.findUnique({ where: { id: r.id } });
          await ensureReceiptLinks(full, req);
          backfilled++;
        } catch {}
      }
    }
    const data = rows.map((r: any) => ({
      ...r,
      donorPanMasked: maskPan(r.donorPan),
      shortUrl: r.providerOrderId ? (shortUrlMap.get(r.providerOrderId) ?? null) : null,
      receiptPdfUrl: r.receiptPdfUrl || null,
      receiptHtmlUrl: r.receiptHtmlUrl || null,
    }));
    return res.json({ success: true, count: data.length, total: totalCount, totals, data, reconciled });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ADMIN_MEMBER_PAYMENT_LINKS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/members/{userId}/payment-links:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: List donation payment links for a specific member
 *     description: The member themself can query their own userId; HRCI Admins can query any member.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: eventId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200:
 *         description: Member view of payment links
 *       403:
 *         description: Forbidden when querying other users without admin role
 */
router.get('/members/:userId/payment-links', requireAuth, async (req: any, res) => {
  try {
    const requester = req.user;
    const paramUserId = String(req.params.userId);
    const roleName = requester?.role?.name?.toString()?.toUpperCase();
    const isAdmin = roleName === 'HRCI_ADMIN' || roleName === 'SUPERADMIN';
    if (!isAdmin && requester?.id !== paramUserId) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Can only query your own records' });
    }

    const { from, to, status, eventId } = req.query as any;
    const verify = String(req.query.verify || '').toLowerCase() === 'true';
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const includeShortUrl = String(req.query.includeShortUrl || '').toLowerCase() === 'true';

    const where: any = {
      referrerUserId: paramUserId,
      providerOrderId: { not: null },
    };
    if (from) { const d = new Date(String(from)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d }; }
    if (to) { const d = new Date(String(to)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d }; }
    if (status) { const arr = String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); if (arr.length) (where as any).status = { in: arr }; }
    if (eventId) (where as any).eventId = String(eventId);

    let [rows, totalCount] = await Promise.all([
      (prisma as any).donation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
          donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
      }),
      (prisma as any).donation.count({ where })
    ]);

    let reconciled = 0;
    if (verify && razorpayEnabled()) {
      for (const d of rows) {
        if (d.status === 'PENDING' && d.providerOrderId) {
          try {
            const pl = await getRazorpayPaymentLink(String(d.providerOrderId));
            if (String(pl.status).toLowerCase() === 'paid') {
              const intent = await prisma.paymentIntent.findFirst({ where: { id: String((await (prisma as any).donation.findUnique({ where: { id: d.id } })).paymentIntentId) } }).catch(() => null);
              await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
              await prisma.$transaction(async (tx) => {
                const anyTx = tx as any;
                const updated = await anyTx.donation.update({ where: { id: d.id }, data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || d.providerPaymentId } });
                await anyTx.donationEvent.update({ where: { id: updated.eventId }, data: { collectedAmount: { increment: updated.amount } } }).catch(() => null);
              });
              reconciled++;
            }
          } catch { }
        }
      }
      if (reconciled > 0) {
        rows = await (prisma as any).donation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, receiptPdfUrl: true, receiptHtmlUrl: true,
            donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true }
        });
      }
    }

    const gb = await (prisma as any).donation.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amount: true }
    });
    const totals: any = { overall: { count: totalCount, amount: 0 }, byStatus: {} };
    for (const r of gb) {
      const amt = Number(r._sum?.amount || 0);
      totals.byStatus[r.status] = { count: Number(r._count?._all || 0), amount: amt };
      totals.overall.amount += amt;
    }

    const shortUrlMap = new Map<string, string | null>();
    if (includeShortUrl && razorpayEnabled()) {
      for (const r of rows) {
        if (r.providerOrderId && !shortUrlMap.has(r.providerOrderId)) {
          try {
            const pl = await getRazorpayPaymentLink(String(r.providerOrderId));
            shortUrlMap.set(r.providerOrderId, (pl as any).short_url || null);
          } catch { shortUrlMap.set(r.providerOrderId, null); }
        }
      }
    }
    let backfilled = 0;
    for (const r of rows) {
      if (backfilled >= 3) break;
      if (r.status === 'SUCCESS' && (!r.receiptPdfUrl || !r.receiptHtmlUrl)) {
        try {
          const full = await (prisma as any).donation.findUnique({ where: { id: r.id } });
          await ensureReceiptLinks(full, req);
          backfilled++;
        } catch {}
      }
    }
    const data = rows.map((r: any) => ({
      ...r,
      donorPanMasked: maskPan(r.donorPan),
      shortUrl: r.providerOrderId ? (shortUrlMap.get(r.providerOrderId) ?? null) : null,
      receiptPdfUrl: r.receiptPdfUrl || null,
      receiptHtmlUrl: r.receiptHtmlUrl || null,
    }));
    return res.json({ success: true, count: data.length, total: totalCount, totals, data, reconciled });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MEMBER_PAYMENT_LINKS_USER_LIST_FAILED', message: e?.message });
  }
});

// Implement cancellation for member's payment link
router.delete('/members/payment-links/:id', requireAuth, async (req: any, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const userId = req.user?.id as string;
    const linkId = String(req.params.id);

    // Find the donation created by this member with this link id
    const donation = await (prisma as any).donation.findFirst({ where: { providerOrderId: linkId, referrerUserId: userId } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Payment link not found for this member' });
    if (donation.status === 'SUCCESS') return res.status(400).json({ success: false, error: 'CANNOT_CANCEL_PAID_LINK' });

    const { cancelRazorpayPaymentLink } = await import('../../lib/razorpay');
    const pl = await cancelRazorpayPaymentLink(linkId).catch((e: any) => {
      // Razorpay may return error if already cancelled; treat as ok
      return { id: linkId, status: 'cancelled' } as any;
    });

    // Mark donation as FAILED to indicate cancelled
    await (prisma as any).donation.update({ where: { id: donation.id }, data: { status: 'FAILED' } }).catch(() => null);

    return res.json({ success: true, data: { linkId, status: (pl as any)?.status || 'cancelled' } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_PAYMENT_LINK_CANCEL_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/members/payment-links/{id}/notify:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Send payment link notification (sms/email)
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
 *             required: [via]
 *             properties:
 *               via: { type: string, enum: [sms, email] }
 *     responses:
 *       200: { description: Notification triggered }
 */
router.post('/members/payment-links/:id/notify', requireAuth, async (req: any, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const userId = req.user?.id as string;
    const id = String(req.params.id);
    const via = String(req.body?.via || '').toLowerCase();
    if (!['sms', 'email'].includes(via)) return res.status(400).json({ success: false, error: 'INVALID_VIA' });

    // Ensure this link belongs to the member
    const donation = await (prisma as any).donation.findFirst({ where: { providerOrderId: id, referrerUserId: userId } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (donation.status === 'SUCCESS') return res.status(400).json({ success: false, error: 'ALREADY_PAID' });

    const out = await notifyRazorpayPaymentLink(id, via as any);
    // Best-effort audit for member self-notify
    logAdminAction({ req, action: 'donation.member.payment_link.notify', target: { type: 'RZP_PAYMENT_LINK', id }, payload: { via }, response: out, success: true }).catch(() => {});
    return res.json({ success: true, data: out });
  } catch (e: any) {
    logAdminAction({ req, action: 'donation.member.payment_link.notify', target: { type: 'RZP_PAYMENT_LINK', id: String(req.params.id) }, payload: { via: req.body?.via }, success: false, errorMessage: e?.message }).catch(() => {});
    return res.status(500).json({ success: false, error: 'RP_LINK_NOTIFY_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/payment-links/{id}/notify:
 *   post:
 *     tags: [Donations - Admin]
 *     summary: Send payment link notification (sms/email) as admin
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
 *             required: [via]
 *             properties:
 *               via: { type: string, enum: [sms, email] }
 *     responses:
 *       200: { description: Notification triggered }
 */
router.post('/admin/payment-links/:id/notify', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const id = String(req.params.id);
    const via = String(req.body?.via || '').toLowerCase();
    if (!['sms', 'email'].includes(via)) return res.status(400).json({ success: false, error: 'INVALID_VIA' });
    const out = await notifyRazorpayPaymentLink(id, via as any);
    await logAdminAction({ req, action: 'donation.admin.payment_link.notify', target: { type: 'RZP_PAYMENT_LINK', id }, payload: { via }, response: out, success: true });
    return res.json({ success: true, data: out });
  } catch (e: any) {
    await logAdminAction({ req, action: 'donation.admin.payment_link.notify', target: { type: 'RZP_PAYMENT_LINK', id: String(req.params.id) }, payload: { via: req.body?.via }, success: false, errorMessage: e?.message });
    return res.status(500).json({ success: false, error: 'RP_LINK_NOTIFY_FAILED', message: e?.message });
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
    // Ownership guard: only the member that created this link (or admin) can query
    const requester: any = (req as any).user;
    const roleName = requester?.role?.name?.toString()?.toUpperCase();
    const isAdmin = roleName === 'HRCI_ADMIN' || roleName === 'SUPERADMIN' || roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';
    const donation = await (prisma as any).donation.findFirst({ where: { providerOrderId: linkId } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (!isAdmin && donation.referrerUserId !== requester?.id) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Can only query your own records' });
    }
    const pl = await getRazorpayPaymentLink(linkId);

    // Auto-reconcile: if Razorpay shows paid and our donation is not SUCCESS, update immediately
    if (String(pl.status).toLowerCase() === 'paid' && donation.status !== 'SUCCESS') {
      try {
        const intent = donation.paymentIntentId ? await prisma.paymentIntent.findUnique({ where: { id: donation.paymentIntentId } }) : null;
        await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
        await prisma.$transaction(async (tx) => {
          const anyTx = tx as any;
          const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || donation.providerPaymentId } });
          await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
        });
      } catch { /* ignore reconcile errors */ }
    }

    return res.json({ success: true, data: pl });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_PAYMENT_LINK_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/payment-links/{id}/status:
 *   get:
 *     tags: [Donations]
 *     summary: Public - Get Razorpay Payment Link status
 *     description: Public endpoint to check payment link status. If provider reports paid, the donation is reconciled to SUCCESS.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Payment link status }
 *       404: { description: Not found }
 */
router.get('/payment-links/:id/status', async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const linkId = String(req.params.id);
    // Rate limit per (ip+linkId)
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${ip}:${linkId}`;
    const now = Date.now();
    const bucket = rateBucket.get(key);
    if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
      rateBucket.set(key, { windowStart: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > RATE_LIMIT_PER_KEY) {
        return res.status(429).json({ success: false, error: 'RATE_LIMITED' });
      }
    }

    // Require that the linkId corresponds to a known donation (avoid open proxy to Razorpay)
    const donation = await (prisma as any).donation.findFirst({ where: { providerOrderId: linkId } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    // Micro-cache for a few seconds to reduce provider calls during rapid polling
    const cached = linkStatusCache.get(linkId);
    if (cached && now - cached.ts < STATUS_TTL_MS) {
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(STATUS_TTL_MS / 1000)}`);
      return res.json({ success: true, data: cached.data, cached: true });
    }
    const pl = await getRazorpayPaymentLink(linkId);

    // Auto-reconcile if paid
    if (String(pl.status).toLowerCase() === 'paid' && donation.status !== 'SUCCESS') {
      try {
        const intent = donation.paymentIntentId ? await prisma.paymentIntent.findUnique({ where: { id: donation.paymentIntentId } }) : null;
        await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
        await prisma.$transaction(async (tx) => {
          const anyTx = tx as any;
          const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || donation.providerPaymentId } });
          await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
        });
      } catch { /* ignore reconcile errors */ }
    }

    // Return sanitized status info
    const payload = { id: pl.id, status: pl.status, amount: (pl as any).amount, currency: (pl as any).currency, short_url: (pl as any).short_url || undefined };
    linkStatusCache.set(linkId, { ts: now, data: payload });
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(STATUS_TTL_MS / 1000)}`);
    return res.json({ success: true, data: payload });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'PAYMENT_LINK_STATUS_FAILED', message: e?.message });
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
 * /donations/admin/payment-links:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List Razorpay Payment Links (direct from Razorpay)
 *     description: Proxy to Razorpay Payment Links list API. Useful for audits.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: integer, description: 'epoch seconds' }
 *       - in: query
 *         name: to
 *         schema: { type: integer, description: 'epoch seconds' }
 *       - in: query
 *         name: count
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: skip
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200: { description: Razorpay Payment Links list }
 */
router.get('/admin/payment-links', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const params: any = {};
    if (req.query.from) params.from = Number(req.query.from);
    if (req.query.to) params.to = Number(req.query.to);
    if (req.query.count) params.count = Math.min(100, Math.max(1, Number(req.query.count)));
    if (req.query.skip) params.skip = Math.max(0, Number(req.query.skip));
    const rp = await listRazorpayPaymentLinks(params);
    await logAdminAction({ req, action: 'donation.admin.payment_link.list', target: { type: 'RZP_PAYMENT_LINK' }, payload: params, response: { count: rp?.count }, success: true });
    return res.json({ success: true, data: rp });
  } catch (e: any) {
    await logAdminAction({ req, action: 'donation.admin.payment_link.list', payload: req.query, success: false, errorMessage: e?.message });
    return res.status(500).json({ success: false, error: 'RP_LINKS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/donations:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List all donations (admin)
 *     description: Admin listing of donations with filters, pagination and totals by status. Includes donorPhotoUrl and receipt links if present.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Comma-separated list of statuses (PENDING,SUCCESS,FAILED,REFUND)
 *       - in: query
 *         name: eventId
 *         schema: { type: string }
 *       - in: query
 *         name: referrerUserId
 *         schema: { type: string }
 *         description: Filter by member attribution (creator of link/share)
 *       - in: query
 *         name: mobile
 *         schema: { type: string }
 *       - in: query
 *         name: email
 *         schema: { type: string }
 *       - in: query
 *         name: pan
 *         schema: { type: string }
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *       - in: query
 *         name: verify
 *         schema: { type: boolean, default: false }
 *         description: If true, best-effort reconcile pending rows with provider
 *     responses:
 *       200:
 *         description: Donations list
 */
router.get('/admin/donations', requireAuth, requireHrcAdmin, async (req: any, res) => {
  try {
    const { from, to, status, eventId, referrerUserId, mobile, email, pan, name } = req.query as any;
    const verify = String(req.query.verify || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: any = {};
    if (from) { const d = new Date(String(from)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d }; }
    if (to) { const d = new Date(String(to)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d }; }
    if (status) {
      const arr = String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (arr.length) (where as any).status = { in: arr };
    }
    if (eventId) (where as any).eventId = String(eventId);
    if (referrerUserId) (where as any).referrerUserId = String(referrerUserId);
    if (mobile) (where as any).donorMobile = { contains: String(mobile), mode: 'insensitive' };
    if (email) (where as any).donorEmail = { contains: String(email), mode: 'insensitive' };
    if (pan) (where as any).donorPan = { equals: String(pan).toUpperCase() };
    if (name) (where as any).donorName = { contains: String(name), mode: 'insensitive' };

    let [rows, totalCount] = await Promise.all([
      (prisma as any).donation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, eventId: true, amount: true, currency: true, status: true,
          providerOrderId: true, providerPaymentId: true, createdAt: true, updatedAt: true,
          donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true,
          receiptPdfUrl: true, receiptHtmlUrl: true, donorPhotoUrl: true,
          referrerUserId: true,
        }
      }),
      (prisma as any).donation.count({ where })
    ]);

    // Optional best-effort reconciliation for pending rows in page
    let reconciled = 0;
    if (verify && razorpayEnabled()) {
      for (const d of rows) {
        if (d.status === 'PENDING') {
          try {
            if (d.providerOrderId) {
              const payments = await getRazorpayOrderPayments(String(d.providerOrderId));
              const successPayment = payments?.items?.find((p: any) => ['captured','authorized'].includes(String(p.status||'').toLowerCase()));
              if (successPayment) {
                const intent = d.paymentIntentId ? await prisma.paymentIntent.findUnique({ where: { id: String((await (prisma as any).donation.findUnique({ where: { id: d.id } })).paymentIntentId) } }).catch(() => null) : null;
                await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
                await prisma.$transaction(async (tx) => {
                  const anyTx = tx as any;
                  const updated = await anyTx.donation.update({ where: { id: d.id }, data: { status: 'SUCCESS', providerPaymentId: successPayment.id } });
                  await anyTx.donationEvent.update({ where: { id: updated.eventId }, data: { collectedAmount: { increment: updated.amount } } }).catch(() => null);
                });
                reconciled++;
              }
            }
          } catch { }
        }
      }
      if (reconciled > 0) {
        rows = await (prisma as any).donation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true, eventId: true, amount: true, currency: true, status: true,
            providerOrderId: true, providerPaymentId: true, createdAt: true, updatedAt: true,
            donorName: true, donorAddress: true, donorMobile: true, donorEmail: true, donorPan: true, isAnonymous: true,
            receiptPdfUrl: true, receiptHtmlUrl: true, donorPhotoUrl: true,
            referrerUserId: true,
          }
        });
      }
    }

    // Totals by status for the current filter
    const gb = await (prisma as any).donation.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amount: true }
    });
    const totals: any = { overall: { count: totalCount, amount: 0 }, byStatus: {} };
    for (const r of gb) {
      const amt = Number(r._sum?.amount || 0);
      totals.byStatus[r.status] = { count: Number(r._count?._all || 0), amount: amt };
      totals.overall.amount += amt;
    }

    // Mask PAN in response for safety
    const data = rows.map((r: any) => ({
      ...r,
      donorPanMasked: r.donorPan ? String(r.donorPan).replace(/.(?=.{4}$)/g, 'X') : null,
    }));

    return res.json({ success: true, count: data.length, total: totalCount, totals, data, reconciled });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ADMIN_DONATIONS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/payment-links/{id}:
 *   patch:
 *     tags: [Donations - Admin]
 *     summary: Update a Razorpay Payment Link (notes, etc.)
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
 *               notes: { type: object }
 *     responses:
 *       200: { description: Updated Razorpay link }
 */
router.patch('/admin/payment-links/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const id = String(req.params.id);
    const payload: any = {};
    if (req.body && typeof req.body === 'object') Object.assign(payload, req.body);
    const rp = await updateRazorpayPaymentLink(id, payload);
    await logAdminAction({ req, action: 'donation.admin.payment_link.patch', target: { type: 'RZP_PAYMENT_LINK', id }, payload, response: rp, success: true });
    return res.json({ success: true, data: rp });
  } catch (e: any) {
    await logAdminAction({ req, action: 'donation.admin.payment_link.patch', target: { type: 'RZP_PAYMENT_LINK', id: String(req.params.id) }, payload: req.body, success: false, errorMessage: e?.message });
    return res.status(500).json({ success: false, error: 'RP_LINK_UPDATE_FAILED', message: e?.message });
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
 * /donations/admin/audit-logs:
 *   get:
 *     tags: [Donations - Admin]
 *     summary: List admin audit logs
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: actorUserId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200: { description: Audit logs }
 */
router.get('/admin/audit-logs', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { action, actorUserId, from, to } = req.query as any;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: any = {};
    if (action) where.action = String(action);
    if (actorUserId) where.actorUserId = String(actorUserId);
    if (from) { const d = new Date(String(from)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d }; }
    if (to) { const d = new Date(String(to)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d }; }
    const [rows, total] = await Promise.all([
      (prisma as any).adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      (prisma as any).adminAuditLog.count({ where })
    ]);
    return res.json({ success: true, count: rows.length, total, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'AUDIT_LOGS_LIST_FAILED', message: e?.message });
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
 *                         orderId: { type: string, description: 'Internal PaymentIntent ID' }
 *                         amount: { type: integer }
 *                         currency: { type: string, example: 'INR' }
 *                         provider: { type: string, example: 'razorpay' }
 *                         providerOrderId: { type: string, description: 'Razorpay Order ID' }
 *                         providerKeyId: { type: string, description: 'Use with Razorpay SDK' }
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
 *         description: Confirmation result with 80G receipt JSON on success
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
 *                     receiptPdfUrl: { type: string, nullable: true }
 *                     receiptHtmlUrl: { type: string, nullable: true }
 *                     receipt:
 *                       type: object
 *                       description: Structured 80G receipt data for front-end rendering
 *                       properties:
 *                         receiptNo: { type: string }
 *                         receiptDate: { type: string }
 *                         amount: { type: integer }
 *                         amountFormatted: { type: string }
 *                         currency: { type: string }
 *                         mode: { type: string }
 *                         purpose: { type: string }
 *                         donor:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             address: { type: string }
 *                             pan: { type: string, nullable: true }
 *                             mobile: { type: string, nullable: true }
 *                             email: { type: string, nullable: true }
 *                             isAnonymous: { type: boolean }
 *                         org:
 *                           type: object
 *                           properties:
 *                             name: { type: string }
 *                             pan: { type: string, nullable: true }
 *                             eightyG:
 *                               type: object
 *                               properties:
 *                                 number: { type: string, nullable: true }
 *                                 validFrom: { type: string, nullable: true }
 *                                 validTo: { type: string, nullable: true }
 *                         verify:
 *                           type: object
 *                           properties:
 *                             htmlUrl: { type: string, nullable: true }
 *                             pdfUrl: { type: string, nullable: true }
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
      let urls: any = {};
      try { const u = await ensureReceiptLinks(donation, req); urls = { receiptPdfUrl: u.pdfUrl, receiptHtmlUrl: u.htmlUrl }; } catch {}
      let receipt: any = null;
      try { receipt = await buildReceiptJson(donation, req, { pdfUrl: urls.receiptPdfUrl, htmlUrl: urls.receiptHtmlUrl }); } catch {}
      return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id, ...urls, receipt } });
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
    let urls: any = {};
    try { const u = await ensureReceiptLinks(donation, req); urls = { receiptPdfUrl: u.pdfUrl, receiptHtmlUrl: u.htmlUrl }; } catch {}
    let receipt: any = null;
    try { receipt = await buildReceiptJson(donation, req, { pdfUrl: urls.receiptPdfUrl, htmlUrl: urls.receiptHtmlUrl }); } catch {}
    return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id, ...urls, receipt } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONATION_CONFIRM_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/orders/{id}/status:
 *   get:
 *     tags: [Donations]
 *     summary: Public - Get Razorpay Order payment status
 *     description: Checks Razorpay Order payments; if captured/authorized, marks donation SUCCESS, updates totals, and returns receipt URLs.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order status and receipt links when paid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     providerOrderId: { type: string }
 *                     paid: { type: boolean }
 *                     paymentId: { type: string, nullable: true }
 *                     status: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *                     receiptPdfUrl: { type: string, nullable: true }
 *                     receiptHtmlUrl: { type: string, nullable: true }
 *       404: { description: Donation not found for this order }
 */
router.get('/orders/:id/status', async (req, res) => {
  try {
    if (!razorpayEnabled()) return res.status(400).json({ success: false, error: 'RAZORPAY_DISABLED' });
    const providerOrderId = String(req.params.id);
    // Rate limit per (ip+orderId)
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || 'unknown';
    const key = `${ip}:ord:${providerOrderId}`;
    const now = Date.now();
    const bucket = rateBucket.get(key);
    if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
      rateBucket.set(key, { windowStart: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > RATE_LIMIT_PER_KEY) {
        return res.status(429).json({ success: false, error: 'RATE_LIMITED' });
      }
    }

    const donation = await (prisma as any).donation.findFirst({ where: { providerOrderId: providerOrderId } });
    if (!donation) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    // Micro-cache
    const cached = orderStatusCache.get(providerOrderId);
    if (cached && now - cached.ts < STATUS_TTL_MS) {
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(STATUS_TTL_MS / 1000)}`);
      return res.json({ success: true, data: cached.data, cached: true });
    }

    const payments = await getRazorpayOrderPayments(providerOrderId);
    const successPayment = payments?.items?.find((p: any) => {
      const st = String(p.status || '').toLowerCase();
      return st === 'captured' || st === 'authorized';
    });

    let updatedDonation = donation;
    if (successPayment && donation.status !== 'SUCCESS') {
      try {
        const intent = donation.paymentIntentId ? await prisma.paymentIntent.findUnique({ where: { id: donation.paymentIntentId } }) : null;
        await prisma.paymentIntent.update({ where: { id: intent?.id || '' }, data: { status: 'SUCCESS' } }).catch(() => null);
        await prisma.$transaction(async (tx) => {
          const anyTx = tx as any;
          const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS', providerPaymentId: successPayment.id } });
          await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
          updatedDonation = d;
        });
      } catch {}
    }

    // Ensure receipt links (best-effort)
    let urls: any = { receiptPdfUrl: updatedDonation.receiptPdfUrl || null, receiptHtmlUrl: updatedDonation.receiptHtmlUrl || null };
    if (updatedDonation.status === 'SUCCESS' && (!updatedDonation.receiptPdfUrl || !updatedDonation.receiptHtmlUrl)) {
      try { const u = await ensureReceiptLinks(updatedDonation, req); urls = { receiptPdfUrl: u.pdfUrl, receiptHtmlUrl: u.htmlUrl }; } catch {}
    }

    const payload = {
      providerOrderId,
      paid: !!successPayment || updatedDonation.status === 'SUCCESS',
      paymentId: successPayment?.id || updatedDonation.providerPaymentId || null,
      status: updatedDonation.status,
      ...urls,
    };
    orderStatusCache.set(providerOrderId, { ts: now, data: payload });
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(STATUS_TTL_MS / 1000)}`);
    return res.json({ success: true, data: payload });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ORDER_STATUS_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/receipts/search:
 *   get:
 *     tags: [Donations]
 *     summary: Public - Search paid donations to fetch 80G receipts
 *     parameters:
 *       - in: query
 *         name: donationId
 *         schema: { type: string }
 *       - in: query
 *         name: mobile
 *         schema: { type: string }
 *       - in: query
 *         name: pan
 *         schema: { type: string }
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200:
 *         description: Matching paid donations with receipt links
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 total: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       amount: { type: integer }
 *                       currency: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       donorName: { type: string }
 *                       donorMobile: { type: string }
 *                       donorEmail: { type: string }
 *                       donorPanMasked: { type: string, nullable: true }
 *                       receiptPdfUrl: { type: string, nullable: true }
 *                       receiptHtmlUrl: { type: string, nullable: true }
 */
router.get('/receipts/search', async (req, res) => {
  try {
    const { donationId, mobile, pan, name, from, to } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: any = { status: 'SUCCESS' };
    if (donationId) where.id = String(donationId);
    if (mobile) where.donorMobile = { contains: String(mobile), mode: 'insensitive' };
    if (pan) where.donorPan = { equals: String(pan).toUpperCase() };
    if (name) where.donorName = { contains: String(name), mode: 'insensitive' };
    if (from) { const d = new Date(String(from)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), gte: d }; }
    if (to) { const d = new Date(String(to)); if (!isNaN(d.getTime())) (where as any).createdAt = { ...(where.createdAt || {}), lte: d }; }

    const [rows, total] = await Promise.all([
      (prisma as any).donation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, amount: true, currency: true, createdAt: true,
          donorName: true, donorMobile: true, donorEmail: true, donorPan: true,
          receiptPdfUrl: true, receiptHtmlUrl: true, providerPaymentId: true,
        }
      }),
      (prisma as any).donation.count({ where })
    ]);

    // Ensure receipt links exist for returned rows (best-effort, cap a few)
    let backfilled = 0;
    for (const r of rows) {
      if (backfilled >= 3) break;
      if (!r.receiptPdfUrl || !r.receiptHtmlUrl) {
        try {
          const full = await (prisma as any).donation.findUnique({ where: { id: r.id } });
          await ensureReceiptLinks(full, req);
          backfilled++;
        } catch {}
      }
    }

    const data = rows.map((r: any) => ({
      ...r,
      donorPanMasked: maskPan(r.donorPan),
      receiptPdfUrl: r.receiptPdfUrl || null,
      receiptHtmlUrl: r.receiptHtmlUrl || null,
    }));

    return res.json({ success: true, count: data.length, total, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'RECEIPT_SEARCH_FAILED', message: e?.message });
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
    if (donation.status === 'SUCCESS') {
      try { await ensureReceiptLinks(donation, req); } catch {}
      return res.json({ success: true, data: { status: 'SUCCESS', donationId: donation.id } });
    }
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
  try { await ensureReceiptLinks(donation, req); } catch {}
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

  // Use configured public base URL for QR and branding
  const origin = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://app.hrcitodaynews.in').toString().replace(/\/$/, '');
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
  // Use app endpoints so relative paths + base URL work reliably
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
  // Use configured public base URL for QR
  const origin = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://app.hrcitodaynews.in').toString().replace(/\/$/, '');
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
    if (donation.receiptPdfUrl) {
      return res.json({ success: true, data: { url: donation.receiptPdfUrl } });
    }
    const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!org) return res.status(400).json({ success: false, error: 'ORG_SETTINGS_REQUIRED', message: 'Set organization settings first from admin' });

    const amountFmt = (donation.amount || 0).toLocaleString('en-IN');
    const receiptNo = `DN-${donation.id.slice(-8).toUpperCase()}`;
    const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
    const donorName = donation.isAnonymous ? 'Anonymous Donor' : (donation.donorName || 'Donor');

  // Use configured public base URL for QR
  const origin = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://app.hrcitodaynews.in').toString().replace(/\/$/, '');
  const qrUrl = `${origin}/donations/receipt/${donation.id}/html`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl).catch(() => undefined);
  // Use the same app domain for branding endpoints
  const appOrigin = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://app.hrcitodaynews.in').toString().replace(/\/$/, '');
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
