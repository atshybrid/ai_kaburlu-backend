import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { createRazorpayOrder, getRazorpayKeyId, razorpayEnabled, createRazorpayPaymentLink, getRazorpayPaymentLink, getRazorpayOrderPayments, listRazorpayPaymentLinks } from '../../lib/razorpay';
import { r2Client, R2_BUCKET, R2_PUBLIC_BASE_URL, R2_ENDPOINT, R2_ACCOUNT_ID } from '../../lib/r2';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

function roleOk(user: any): boolean {
  const r = (user?.role?.name || '').toUpperCase();
  return ['SUPERADMIN','SUPER_ADMIN','ADMIN','NEWS_DESK','HRCI_ADMIN'].includes(r);
}
function requireAdsAdmin(req: any, res: any, next: any) {
  if (roleOk(req.user)) return next();
  return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Ads admin role required' });
}

// --- Media helpers ---
const MAX_VIDEO_BYTES = Number(process.env.MEDIA_MAX_VIDEO_MB || 100) * 1024 * 1024; // 100MB default

function tryDeriveR2KeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+/, ''); // strip leading '/'
    // If custom base is defined
    if (R2_PUBLIC_BASE_URL) {
      const base = R2_PUBLIC_BASE_URL.replace(/\/$/, '').toLowerCase();
      const hostMatch = u.origin.toLowerCase() === base || (base.endsWith('.r2.cloudflarestorage.com') && u.origin.toLowerCase() === base);
      if (hostMatch) {
        // If base is account-level (*.r2.cloudflarestorage.com), expect bucket/key in path
        if (/\.r2\.cloudflarestorage\.com$/i.test(base)) {
          const parts = path.split('/');
          if (parts.length >= 2 && parts[0] === R2_BUCKET) return parts.slice(1).join('/');
          return null;
        }
        // Else CDN mapped directly to bucket; entire path is key
        return path || null;
      }
    }
    // If endpoint configured, expect /bucket/key
    if (R2_ENDPOINT && u.origin.toLowerCase() === R2_ENDPOINT.replace(/\/$/, '').toLowerCase()) {
      const parts = path.split('/');
      if (parts.length >= 2 && parts[0] === R2_BUCKET) return parts.slice(1).join('/');
      return null;
    }
    // Default account endpoint
    const expectedOrigin = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.toLowerCase();
    if (u.origin.toLowerCase() === expectedOrigin) {
      const parts = path.split('/');
      if (parts.length >= 2 && parts[0] === R2_BUCKET) return parts.slice(1).join('/');
    }
  } catch {}
  return null;
}

async function assertVideoNotTooLargeFromUrlOrKey(mediaUrl?: string | null, mediaKey?: string | null, providedSizeBytes?: number | null) {
  // If we have a provided size hint, enforce it immediately
  if (typeof providedSizeBytes === 'number' && providedSizeBytes > 0) {
    if (providedSizeBytes > MAX_VIDEO_BYTES) {
      const mb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));
      const err: any = new Error(`Video too large. Max ${mb}MB`);
      err.code = 'VIDEO_TOO_LARGE';
      throw err;
    }
  }
  // Prefer key if available; else try derive from URL
  const key = (mediaKey && mediaKey.trim()) || (mediaUrl ? tryDeriveR2KeyFromUrl(String(mediaUrl)) : null);
  if (!key) return; // cannot verify without key; allow
  if (!R2_BUCKET) return; // storage not configured; allow
  try {
    const head = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const len = Number((head as any).ContentLength || 0);
    if (len > MAX_VIDEO_BYTES) {
      const mb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));
      const err: any = new Error(`Video too large. Max ${mb}MB`);
      err.code = 'VIDEO_TOO_LARGE';
      throw err;
    }
  } catch (e: any) {
    // If object not found or head failed, do not block creation; rely on upload endpoint enforcing limits
    // Optionally, we could surface a warning via logs
    return;
  }
}

// -- Helpers (best-practice: DRY the enrichment logic) --
const PROVIDER_ENRICH_MAX = Math.max(1, Number(process.env.ADS_ADMIN_PROVIDER_ENRICH_MAX || 50));

async function findLatestAdIntent(adId: string) {
  try {
    return await prisma.paymentIntent.findFirst({
      where: {
        intentType: 'AD' as any,
        OR: [
          { adId },
          { meta: { path: ['adId'], equals: String(adId) } as any },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch {
    return null as any;
  }
}

async function enrichAdBase(ad: any) {
  const { language, ...rest } = ad as any;
  // Compute date-based effective status (no provider info)
  let effectiveStatus = rest.status;
  try {
    const now = new Date();
    if (rest.endAt && new Date(rest.endAt) < now) effectiveStatus = 'EXPIRED';
  } catch {}
  return {
    ...rest,
    status: effectiveStatus,
    languageName: language?.name || null,
    languageCode: language?.code || null,
  } as any;
}

async function enrichAdWithPayment(ad: any, fetchProvider: boolean) {
  const baseRaw = await enrichAdBase(ad);
  let base = { ...baseRaw } as any;
  if (!razorpayEnabled()) return base; // No provider info if disabled
  try {
    const intent = await findLatestAdIntent(ad.id);
    let payment: any = null;
    let effectiveStatus = base.status;
    if (intent) {
      const meta = (intent.meta as any) || {};
      const linkId = meta.payment_link_id || null;
      let linkShortUrl: string | null = null;
      let linkStatus: string | null = null;
      if (linkId && fetchProvider) {
        try {
          const pl = await getRazorpayPaymentLink(String(linkId));
          linkShortUrl = (pl as any).short_url || null;
          linkStatus = (pl as any).status || null;
        } catch {}
      }
      // Determine effective status using payment intent/link
      const now = new Date();
      if (base.endAt && new Date(base.endAt) < now) {
        effectiveStatus = 'EXPIRED';
      } else if (String(intent.status).toUpperCase() === 'SUCCESS' || String(base.status).toUpperCase() === 'ACTIVE' || String(linkStatus).toLowerCase() === 'paid') {
        effectiveStatus = 'ACTIVE';
      } else if (linkId || String(intent.status).toUpperCase() === 'PENDING') {
        effectiveStatus = 'PENDING_PAYMENT';
      }
      payment = {
        intentId: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        provider: meta.provider || (linkId ? 'razorpay' : (meta.providerOrderId ? 'razorpay' : null)),
        providerKeyId: getRazorpayKeyId(),
        razorpay: {
          payment_link_id: linkId || null,
          payment_link_short_url: linkShortUrl,
          payment_link_status: linkStatus,
          providerOrderId: meta.providerOrderId || null,
        },
      };
      base.status = effectiveStatus;
    } else {
      payment = { provider: 'razorpay', providerKeyId: getRazorpayKeyId() };
    }
    return { ...base, payment };
  } catch {
    return { ...base, payment: { provider: 'razorpay', providerKeyId: getRazorpayKeyId() } };
  }
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
    // Enforce video size limit (100MB default) when mediaType=VIDEO
    if (String(b.mediaType || '').toUpperCase() === 'VIDEO') {
      try {
        await assertVideoNotTooLargeFromUrlOrKey(b.mediaUrl, b.mediaKey, Number(b.mediaSizeBytes || 0) || null);
      } catch (err: any) {
        if (err?.code === 'VIDEO_TOO_LARGE') return res.status(400).json({ success: false, error: 'VIDEO_TOO_LARGE', message: err.message });
        // Unexpected error
      }
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
 *                       status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, EXPIRED, PENDING_PAYMENT], description: "Effective status computed from DB status + payment + dates" }
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
 *                       payment:
 *                         type: object
 *                         description: Razorpay payment details for this ad (if available)
 *                         properties:
 *                           intentId: { type: string, nullable: true }
 *                           amount: { type: number, nullable: true }
 *                           currency: { type: string, nullable: true }
 *                           status: { type: string, nullable: true, description: "PaymentIntent status" }
 *                           provider: { type: string, nullable: true, description: "Payment provider, e.g., razorpay" }
 *                           providerKeyId: { type: string, nullable: true, description: "Public key for client-side Razorpay" }
 *                           razorpay:
 *                             type: object
 *                             properties:
 *                               payment_link_id: { type: string, nullable: true }
 *                               payment_link_short_url: { type: string, nullable: true }
 *                               payment_link_status: { type: string, nullable: true }
 *                               providerOrderId: { type: string, nullable: true }
 *                       languageName: { type: string, nullable: true }
 *                       languageCode: { type: string, nullable: true }
 */
/**
 * @swagger
 * /ads/admin:
 *   get:
 *     tags: [Ads (Admin)]
 *     summary: List sponsor ads (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, PENDING_PAYMENT, ACTIVE, PAUSED, EXPIRED, ARCHIVED] }
 *       - in: query
 *         name: languageId
 *         schema: { type: string }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Case-insensitive title contains filter
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Optional limit; if omitted returns all
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: Base64-encoded JSON { id, date } for stable pagination
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [updatedAt, createdAt] }
 *         description: Sort field (desc)
 *       - in: query
 *         name: includePayment
 *         schema: { type: boolean }
 *         description: If false, skip provider/payment enrichment for faster listing
 *     responses:
 *       200:
 *         description: Paginated list of ads ordered by sortBy desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 pageInfo:
 *                   type: object
 *                   properties:
 *                     limit: { type: integer }
 *                     nextCursor: { type: string, nullable: true }
 *                     hasMore: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AdAdminListItem'
 */
router.get('/admin', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    const where: any = {};
    const status = (req.query.status as string) || '';
    const languageId = (req.query.languageId as string) || '';
    const q = (req.query.q as string) || '';
    if (status) where.status = status as any;
    if (languageId) where.languageId = languageId;
    if (q) where.title = { contains: q, mode: 'insensitive' } as any;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 200);
    const cursorRaw = (req.query.cursor as string) || '';
    let cursor: { id: string; date: string } | null = null;
    if (cursorRaw) {
      try {
        const decoded = Buffer.from(cursorRaw, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.date === 'string') {
          cursor = { id: parsed.id, date: parsed.date };
        }
      } catch {}
    }
    const sortBy = ((req.query.sortBy as string) || 'updatedAt') === 'createdAt' ? 'createdAt' : 'updatedAt';
    const prefetch = Math.max(limit * 5, 200);
    const seed = await (prisma as any).ad.findMany({
      where,
      orderBy: [{ [sortBy]: 'desc' }, { id: 'desc' }],
      take: prefetch,
      include: { language: { select: { id: true, name: true, code: true, nativeName: true } } },
    });
    const afterCursor = cursor
      ? seed.filter((item: any) => {
          const itemDate = item[sortBy] instanceof Date ? item[sortBy] : new Date(item[sortBy] as any);
          const cursorDate = new Date(cursor!.date);
          return itemDate < cursorDate || (itemDate.getTime() === cursorDate.getTime() && item.id < cursor!.id);
        })
      : seed;
    const slice = afterCursor.slice(0, limit);

    // Enrich with Razorpay payment link and details if enabled
    const includePayment = String(req.query.includePayment ?? 'true').toLowerCase() !== 'false';
    const shouldFetchProvider = includePayment && razorpayEnabled() && slice.length <= PROVIDER_ENRICH_MAX;
    const data = includePayment && razorpayEnabled()
      ? await Promise.all(slice.map((ad: any) => enrichAdWithPayment(ad, shouldFetchProvider)))
      : await Promise.all(slice.map((ad: any) => enrichAdBase(ad)));

    const last = slice[slice.length - 1];
    const nextCursor = last ? Buffer.from(JSON.stringify({ id: last.id, date: (last as any)[sortBy].toISOString() })).toString('base64') : null;
    const hasMore = afterCursor.length > limit;

    return res.json({ success: true, pageInfo: { limit, nextCursor, hasMore }, data });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'AD_LIST_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /ads/admin/{id}:
 *   get:
 *     tags: [Ads (Admin)]
 *     summary: Get a sponsor ad by ID (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ad with Razorpay payment details
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
 *                     title: { type: string }
 *                     status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, EXPIRED, PENDING_PAYMENT], description: "Effective status computed from DB status + payment + dates" }
 *                     mediaType: { type: string, enum: [IMAGE, GIF, VIDEO] }
 *                     mediaUrl: { type: string }
 *                     posterUrl: { type: string, nullable: true }
 *                     clickUrl: { type: string, nullable: true }
 *                     weight: { type: number }
 *                     languageId: { type: string, nullable: true, description: "Language ID (stored as Ad.language)" }
 *                     startAt: { type: string, format: date-time, nullable: true }
 *                     endAt: { type: string, format: date-time, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *                     createdByUserId: { type: string, nullable: true }
 *                     languageName: { type: string, nullable: true }
 *                     languageCode: { type: string, nullable: true }
 *                     payment:
 *                       type: object
 *                       description: Razorpay payment details for this ad (if available)
 *                       properties:
 *                         intentId: { type: string, nullable: true }
 *                         amount: { type: number, nullable: true }
 *                         currency: { type: string, nullable: true }
 *                         status: { type: string, nullable: true, description: "PaymentIntent status" }
 *                         provider: { type: string, nullable: true, description: "Payment provider, e.g., razorpay" }
 *                         providerKeyId: { type: string, nullable: true, description: "Public key for client-side Razorpay" }
 *                         razorpay:
 *                           type: object
 *                           properties:
 *                             payment_link_id: { type: string, nullable: true }
 *                             payment_link_short_url: { type: string, nullable: true }
 *                             payment_link_status: { type: string, nullable: true }
 *                             providerOrderId: { type: string, nullable: true }
 */
router.get('/admin/:id', requireAuth, requireAdsAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const ad = await (prisma as any).ad.findUnique({ where: { id }, include: { language: { select: { id: true, name: true, code: true, nativeName: true } } } });
    if (!ad) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    // For single fetch we can safely include provider details
    const data = await enrichAdWithPayment(ad, true);
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'AD_GET_FAILED', message: e?.message });
  }
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
 *               status: { type: string, enum: [DRAFT, ACTIVE, PAUSED, EXPIRED, PENDING_PAYMENT] }
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
    // If switching/updating to VIDEO or replacing mediaUrl for VIDEO, enforce size
    const targetMediaType = String((data.mediaType ?? b.mediaType) || '').toUpperCase();
    const targetMediaUrl = (data.mediaUrl ?? b.mediaUrl) || undefined;
    if (targetMediaType === 'VIDEO' && (targetMediaUrl || b.mediaKey || b.mediaSizeBytes)) {
      try {
        await assertVideoNotTooLargeFromUrlOrKey(targetMediaUrl, b.mediaKey, Number(b.mediaSizeBytes || 0) || null);
      } catch (err: any) {
        if (err?.code === 'VIDEO_TOO_LARGE') return res.status(400).json({ success: false, error: 'VIDEO_TOO_LARGE', message: err.message });
      }
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
    // Mark ad as pending payment at initiation
    try { await (prisma as any).ad.update({ where: { id }, data: { status: 'PENDING_PAYMENT' } }); } catch {}
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
      notes: { type: 'AD', adId: id, intentId: intent.id },
    });
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { meta: { ...(intent.meta as any || {}), provider: 'razorpay', payment_link_id: (pl as any).id, reference_id } } });
    // Move ad to PENDING_PAYMENT state (db enum now includes it)
    try { await (prisma as any).ad.update({ where: { id }, data: { status: 'PENDING_PAYMENT' } }); } catch {}
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
