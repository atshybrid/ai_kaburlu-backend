import { Router } from 'express';
import axios from 'axios';
import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

const router = Router();

// Normalize asset URLs (logo/stamp) to absolute so they can be used on HTML pages and PDFs
function toAbsoluteAssetUrl(url: any, origin?: string): string {
  const raw = (url ?? '').toString().trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw)) return raw; // already absolute or data URL
  const r2Base = process.env.R2_PUBLIC_BASE_URL && String(process.env.R2_PUBLIC_BASE_URL).trim();
  const base = (r2Base || origin || '').replace(/\/$/, '');
  if (!base) return raw;
  const path = raw.replace(/^\//, '');
  return `${base}/${path}`;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const mime = m[1];
    const buffer = Buffer.from(m[2], 'base64');
    return { mime, buffer };
  } catch {
    return null;
  }
}

/**
 * @swagger
 * /org/settings/public:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Public org settings (receipt fields)
 *     responses:
 *       200: { description: Org settings (public) }
 */
router.get('/public', async (_req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) return res.json({ success: true, data: null });
    const pub = {
      orgName: s.orgName,
      addressLine1: s.addressLine1,
      addressLine2: s.addressLine2,
      city: s.city,
      state: s.state,
      pincode: s.pincode,
      country: s.country,
      pan: s.pan,
      eightyGNumber: s.eightyGNumber,
      eightyGValidFrom: s.eightyGValidFrom,
      eightyGValidTo: s.eightyGValidTo,
      email: s.email,
      phone: s.phone,
      website: s.website,
      authorizedSignatoryName: s.authorizedSignatoryName,
      authorizedSignatoryTitle: s.authorizedSignatoryTitle,
      hrciLogoUrl: s.hrciLogoUrl,
      stampRoundUrl: s.stampRoundUrl,
      documents: s.documents || null,
    };
    return res.json({ success: true, data: pub });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/branding:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get branding assets (logo and stamp) with absolute URLs
 *     responses:
 *       200: { description: Branding URLs }
 */
router.get('/branding', async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) return res.json({ success: true, data: { hrciLogoUrl: '', stampRoundUrl: '', logoApi: '/org/settings/logo', stampApi: '/org/settings/stamp' } });
    const origin = `${req.protocol}://${req.get('host')}`;
    const logoAbs = toAbsoluteAssetUrl(s.hrciLogoUrl, origin);
    const stampAbs = toAbsoluteAssetUrl(s.stampRoundUrl, origin);
    return res.json({
      success: true,
      data: {
        hrciLogoUrl: logoAbs,
        stampRoundUrl: stampAbs,
        // API endpoints (no redirect issues when consumed as <img src>)
        logoApi: `${origin}/org/settings/logo`,
        stampApi: `${origin}/org/settings/stamp`,
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'BRANDING_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/logo:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Redirect to organization logo image (absolute URL)
 *     responses:
 *       302: { description: Redirects to logo }
 *       404: { description: Not configured }
 */
router.get('/logo', async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s?.hrciLogoUrl) return res.status(404).send('LOGO_NOT_CONFIGURED');
    const origin = `${req.protocol}://${req.get('host')}`;
    const url = toAbsoluteAssetUrl(s.hrciLogoUrl, origin);
    if (/^data:/i.test(url)) {
      const parsed = parseDataUrl(url);
      if (!parsed) return res.status(400).send('INVALID_DATA_URL');
      res.setHeader('Content-Type', parsed.mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(parsed.buffer);
    }
    // Proxy the image to avoid redirects/CORS issues in Swagger/fetch
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', maxRedirects: 5, validateStatus: () => true });
      const status = resp.status;
      if (status >= 200 && status < 400) {
        const ctype = resp.headers['content-type'] || 'image/png';
        res.setHeader('Content-Type', ctype);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(Buffer.from(resp.data));
      }
      return res.status(502).send('IMAGE_FETCH_FAILED');
    } catch (e) {
      return res.status(502).send('IMAGE_FETCH_FAILED');
    }
  } catch (e: any) {
    return res.status(500).send('LOGO_RESOLVE_FAILED');
  }
});

/**
 * @swagger
 * /org/settings/stamp:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Redirect to organization round stamp image (absolute URL)
 *     responses:
 *       302: { description: Redirects to stamp }
 *       404: { description: Not configured }
 */
router.get('/stamp', async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s?.stampRoundUrl) return res.status(404).send('STAMP_NOT_CONFIGURED');
    const origin = `${req.protocol}://${req.get('host')}`;
    const url = toAbsoluteAssetUrl(s.stampRoundUrl, origin);
    if (/^data:/i.test(url)) {
      const parsed = parseDataUrl(url);
      if (!parsed) return res.status(400).send('INVALID_DATA_URL');
      res.setHeader('Content-Type', parsed.mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(parsed.buffer);
    }
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', maxRedirects: 5, validateStatus: () => true });
      const status = resp.status;
      if (status >= 200 && status < 400) {
        const ctype = resp.headers['content-type'] || 'image/png';
        res.setHeader('Content-Type', ctype);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(Buffer.from(resp.data));
      }
      return res.status(502).send('IMAGE_FETCH_FAILED');
    } catch (e) {
      return res.status(502).send('IMAGE_FETCH_FAILED');
    }
  } catch (e: any) {
    return res.status(500).send('STAMP_RESOLVE_FAILED');
  }
});

/**
 * @swagger
 * /org/settings:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Get org settings (admin)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Settings }
 */
router.get('/', requireAuth, requireHrcAdmin, async (_req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: s });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Upsert org settings (admin)
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orgName: { type: string }
 *               addressLine1: { type: string }
 *               addressLine2: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               country: { type: string }
 *               pan: { type: string }
 *               eightyGNumber: { type: string }
 *               eightyGValidFrom: { type: string, format: date-time }
 *               eightyGValidTo: { type: string, format: date-time }
 *               email: { type: string }
 *               phone: { type: string }
 *               website: { type: string }
 *               authorizedSignatoryName: { type: string }
 *               authorizedSignatoryTitle: { type: string }
 *               hrciLogoUrl: { type: string, description: 'HRCI logo image URL' }
 *               stampRoundUrl: { type: string, description: 'Round stamp PNG URL' }
 *               documents:
 *                 type: array
 *                 description: 'Array of document metadata (title + file url + type)'
 *                 items:
 *                   type: object
 *                   properties:
 *                     title: { type: string }
 *                     url: { type: string }
 *                     type: { type: string, description: 'optional type/category' }
 *     responses:
 *       200: { description: Upserted }
 */
router.put('/', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const existing = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    const data: any = { ...body };
    if ('eightyGValidFrom' in body) data.eightyGValidFrom = body.eightyGValidFrom ? new Date(body.eightyGValidFrom) : null;
    if ('eightyGValidTo' in body) data.eightyGValidTo = body.eightyGValidTo ? new Date(body.eightyGValidTo) : null;
    // Coerce documents to JSON array if string provided
    if (typeof data.documents === 'string') {
      try { data.documents = JSON.parse(data.documents); } catch { /* keep as string */ }
    }
    let saved;
    if (existing) {
      saved = await (prisma as any).orgSetting.update({ where: { id: existing.id }, data });
    } else {
      if (!data.orgName) return res.status(400).json({ success: false, error: 'ORG_NAME_REQUIRED' });
      saved = await (prisma as any).orgSetting.create({ data });
    }
    return res.json({ success: true, data: saved });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'UPSERT_FAILED', message: e?.message });
  }
});

export default router;

/**
 * Org Settings Documents management (admin only)
 * Routes: POST/PUT/GET (one)/GET all/DELETE at /org/settings/docs
 */

/**
 * @swagger
 * /org/settings/docs:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: List organization documents (admin)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Documents array
 */
router.get('/docs', requireAuth, requireHrcAdmin, async (_req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    const docs = (s?.documents as any[]) || [];
    return res.json({ success: true, count: docs.length, data: docs });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DOCS_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/docs/{id}:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Get a single organization document (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Document }
 *       404: { description: Not found }
 */
router.get('/docs/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    const docs: any[] = (s?.documents as any[]) || [];
    const doc = docs.find(d => d && String(d.id) === String(req.params.id));
    if (!doc) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DOC_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/docs:
 *   post:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Add a new organization document (admin)
 *     description: Upload files via /media first to get a URL, then create a doc entry with title/url/type.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, url]
 *             properties:
 *               title: { type: string }
 *               url: { type: string }
 *               type: { type: string }
 *     responses:
 *       200: { description: Created }
 */
router.post('/docs', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.url) return res.status(400).json({ success: false, error: 'TITLE_AND_URL_REQUIRED' });
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) return res.status(400).json({ success: false, error: 'ORG_SETTINGS_REQUIRED' });
    const docs: any[] = Array.isArray(s.documents) ? (s.documents as any[]) : [];
    const nowIso = new Date().toISOString();
    const item = { id: randomUUID(), title: String(b.title), url: String(b.url), type: b.type || null, createdAt: nowIso, updatedAt: nowIso };
    const updated = await (prisma as any).orgSetting.update({ where: { id: s.id }, data: { documents: [...docs, item] } });
    return res.json({ success: true, data: item, count: (updated.documents as any[])?.length || 0 });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DOC_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/docs/{id}:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Update an organization document (admin)
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
 *               url: { type: string }
 *               type: { type: string }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 */
router.put('/docs/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) return res.status(400).json({ success: false, error: 'ORG_SETTINGS_REQUIRED' });
    const docs: any[] = Array.isArray(s.documents) ? (s.documents as any[]) : [];
    const idx = docs.findIndex(d => d && String(d.id) === String(req.params.id));
    if (idx < 0) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const curr = docs[idx] || {};
    const next = { ...curr, ...req.body, id: curr.id, updatedAt: new Date().toISOString() };
    const nextDocs = [...docs]; nextDocs[idx] = next;
    await (prisma as any).orgSetting.update({ where: { id: s.id }, data: { documents: nextDocs } });
    return res.json({ success: true, data: next });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DOC_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /org/settings/docs/{id}:
 *   delete:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Delete an organization document (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Not found }
 */
router.delete('/docs/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const s = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!s) return res.status(400).json({ success: false, error: 'ORG_SETTINGS_REQUIRED' });
    const docs: any[] = Array.isArray(s.documents) ? (s.documents as any[]) : [];
    const before = docs.length;
    const nextDocs = docs.filter(d => !(d && String(d.id) === String(req.params.id)));
    if (nextDocs.length === before) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    await (prisma as any).orgSetting.update({ where: { id: s.id }, data: { documents: nextDocs } });
    return res.json({ success: true, deleted: before - nextDocs.length, remaining: nextDocs.length });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DOC_DELETE_FAILED', message: e?.message });
  }
});
