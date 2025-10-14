import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin, requireHrcAdmin } from '../middlewares/authz';
import QRCode from 'qrcode';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI ID Cards
 *   description: ID Card settings and public card views
 * components:
 *   schemas:
 *     IdCardSetting:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         isActive: { type: boolean }
 *         primaryColor: { type: string, nullable: true }
 *         secondaryColor: { type: string, nullable: true }
 *         frontH1: { type: string, nullable: true }
 *         frontH2: { type: string, nullable: true }
 *         frontH3: { type: string, nullable: true }
 *         frontH4: { type: string, nullable: true }
 *         frontLogoUrl: { type: string, nullable: true }
 *         secondLogoUrl: { type: string, nullable: true }
 *         hrciStampUrl: { type: string, nullable: true }
 *         authorSignUrl: { type: string, nullable: true }
 *         registerDetails: { type: string, nullable: true }
 *         frontFooterText: { type: string, nullable: true }
 *         headOfficeAddress: { type: string, nullable: true }
 *         terms:
 *           oneOf:
 *             - type: array
 *               items: { type: string }
 *             - type: object
 *               description: JSON field may be stored as generic JSON in DB
 *         qrLandingBaseUrl: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */

// Admin CRUD for settings
/**
 * @swagger
 * /hrci/idcard/settings:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: List ID card settings (admin)
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: List of settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/IdCardSetting'
 *             examples:
 *               ok:
 *                 value: { success: true, data: [ { id: 'cuid', name: 'ID Card', isActive: true } ] }
 */
router.get('/settings', requireAuth, requireHrcAdmin, async (_req, res) => {
  const rows = await (prisma as any).idCardSetting.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ success: true, data: rows });
});

/**
 * @swagger
 * /hrci/idcard/settings:
 *   post:
 *     deprecated: true
 *     tags: [HRCI ID Cards]
 *     summary: Deprecated – use PUT /hrci/idcard/settings/{id}
 *     description: Creation via POST is removed. A default record is seeded; update it with PUT.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       410:
 *         description: Gone – use PUT instead
 */
router.post('/settings', requireAuth, requireHrcAdmin, (_req, res) => {
  res.status(410).json({ success: false, error: 'GONE', message: 'Use PUT /hrci/idcard/settings/{id}. A default setting is seeded.' });
});

/**
 * @swagger
 * /hrci/idcard/settings/{id}:
 *   put:
 *     tags: [HRCI ID Cards]
 *     summary: Update an ID card setting (admin)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated setting
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/IdCardSetting'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (requires HRCI admin)
 */
router.put('/settings/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  const updated = await (prisma as any).idCardSetting.update({ where: { id: req.params.id }, data: req.body || {} });
  if (updated.isActive) {
    await (prisma as any).idCardSetting.updateMany({ where: { id: { not: updated.id } }, data: { isActive: false } });
  }
  res.json({ success: true, data: updated });
});

/**
 * @swagger
 * /hrci/idcard/{cardNumber}:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: Public JSON for an ID card by cardNumber
 *     parameters:
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *           example: hrci-2510-00001
 */
router.get('/:cardNumber', async (req, res) => {
  const card = await prisma.iDCard.findUnique({ where: { cardNumber: req.params.cardNumber } });
  if (!card) return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND' });
  const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  const baseUrl = setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`;
  const apiUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}`;
  const htmlUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/html`;
  const qrUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
  // Keep verifyUrl for backward compatibility (points to API JSON), also return htmlUrl and qrUrl for UX
  const verifyUrl = apiUrl;
  return res.json({ success: true, data: { card, setting, verifyUrl, htmlUrl, qrUrl } });
});

/**
 * @swagger
 * /hrci/idcard/{cardNumber}/html:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: Render a full visual HTML ID card (front and back) using current settings (public)
 *     parameters:
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *           example: hrci-2510-00001
 */
router.get('/:cardNumber/html', async (req, res) => {
  const card = await prisma.iDCard.findUnique({ where: { cardNumber: req.params.cardNumber } });
  if (!card) return res.status(404).send('Card not found');
  const s = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  // Resolve display fields
  let fullName = (card as any).fullName || '';
  let designationName = (card as any).designationName || '';
  let cellName = (card as any).cellName || '';
  let mobileNumber = (card as any).mobileNumber || '';
  let photoUrl: string | undefined;
  if (!fullName || !designationName || !cellName || !mobileNumber) {
    const m = await prisma.membership.findUnique({ where: { id: card.membershipId }, include: { designation: true, cell: true } });
    if (m) {
      try {
        // fetch from user and profile
        const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any }) as any;
        fullName = fullName || (user?.profile?.fullName || '');
        mobileNumber = mobileNumber || (user?.mobileNumber || '');
        photoUrl = (user?.profile?.profilePhotoUrl || user?.profile?.profilePhotoMedia?.url || undefined) as any;
      } catch {}
      designationName = designationName || (m as any).designation?.name || '';
      cellName = cellName || (m as any).cell?.name || '';
    }
  }
  // Dates
  function fmt(d?: Date | string | null) {
    if (!d) return '';
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const primary = s?.primaryColor || '#0d6efd';
  const secondary = s?.secondaryColor || '#6c757d';
  // Compose terms as list
  const terms: string[] = Array.isArray((s as any)?.terms)
    ? ((s as any).terms as any[]).map(String)
    : (typeof (s as any)?.terms === 'object' && (s as any).terms
        ? Object.values((s as any).terms).map(String)
        : []);
  // Generate inline QR SVG for the human-friendly HTML landing URL
  const baseHost = (s?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const landingUrl = `${baseHost}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/html`;
  let qrSvg = '';
  try {
    qrSvg = await QRCode.toString(landingUrl, { type: 'svg', margin: 0, width: 160 });
  } catch {
    qrSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='10'>QR</text></svg>`;
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>ID Card ${card.cardNumber}</title>
  <style>
  :root{--primary:${primary};--secondary:${secondary}}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:16px;background:#f5f5f5;color:#212529}
  .wrap{display:flex;gap:24px;flex-wrap:wrap;justify-content:center}
  .card{width:360px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.12)}
  .hdr{background:var(--primary);color:#fff;padding:10px 12px;text-align:center}
  .hdr .logos{display:flex;gap:12px;justify-content:center;align-items:center;margin-bottom:6px}
  .logo{height:44px;object-fit:contain}
  .h1{font-size:18px;font-weight:700}
  .h2{font-size:13px;opacity:.9}
  .h34{font-size:12px;opacity:.9}
  .blk{padding:12px}
  .photo{display:flex;justify-content:center;margin:8px 0}
  .photo img{width:96px;height:96px;border-radius:10px;object-fit:cover;border:3px solid rgba(0,0,0,.08)}
  .row{display:flex;gap:8px;margin:6px 0}
  .kv{flex:1 1 50%}
  .kv .k{font-size:12px;color:#666}
  .kv .v{font-weight:600}
  .divider{height:1px;background:#eee;margin:10px 0}
  .meta{font-size:12px;color:#555}
  .qr{display:flex;justify-content:center;margin:10px 0}
  .signs{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0}
  .signs img{height:40px}
  .footer{font-size:11px;color:#666;text-align:center;padding:8px 12px;background:#fafafa}
  /* Back */
  .back .title{background:var(--secondary);color:#fff;text-align:center;padding:8px 12px;font-weight:700}
  .terms{padding:10px 16px;font-size:12px}
  .terms li{margin:6px 0}
  .addr{padding:0 16px 12px;color:#444;font-size:12px}
  @media print {.wrap{gap:0}.card{box-shadow:none;margin:0}}
  </style></head><body>
  <div class="wrap">
    <div class="card front">
      <div class="hdr">
        <div class="logos">
          ${s?.frontLogoUrl ? `<img class="logo" src="${s.frontLogoUrl}" alt="Logo"/>` : ''}
          ${s?.secondLogoUrl ? `<img class="logo" src="${s.secondLogoUrl}" alt="Second Logo"/>` : ''}
        </div>
        <div class="h1">${s?.frontH1 || 'HRCI'}</div>
        ${s?.frontH2 ? `<div class="h2">${s.frontH2}</div>` : ''}
        ${(s?.frontH3 || s?.frontH4) ? `<div class="h34">${[s?.frontH3, s?.frontH4].filter(Boolean).join(' • ')}</div>` : ''}
      </div>
      <div class="blk">
        ${photoUrl ? `<div class="photo"><img src="${photoUrl}" alt="Photo"/></div>` : ''}
        <div class="row">
          <div class="kv"><div class="k">Name</div><div class="v">${fullName || '-'}</div></div>
          <div class="kv"><div class="k">Mobile</div><div class="v">${mobileNumber || '-'}</div></div>
        </div>
        <div class="row">
          <div class="kv"><div class="k">Designation</div><div class="v">${designationName || '-'}</div></div>
          <div class="kv"><div class="k">Cell</div><div class="v">${cellName || '-'}</div></div>
        </div>
        <div class="divider"></div>
        <div class="meta">Card No: <b>${card.cardNumber}</b></div>
        <div class="meta">Issued: <b>${fmt(card.issuedAt)}</b> &nbsp; | &nbsp; Valid Upto: <b>${fmt(card.expiresAt)}</b></div>
        <div class="qr">${qrSvg}</div>
        ${s?.registerDetails ? `<div class="meta" style="white-space:pre-wrap">${s.registerDetails}</div>` : ''}
        ${s?.authorSignUrl || s?.hrciStampUrl ? `<div class="signs">${s?.authorSignUrl ? `<img src="${s.authorSignUrl}" alt="Signature"/>` : ''}${s?.hrciStampUrl ? `<img src="${s.hrciStampUrl}" alt="Stamp"/>` : ''}</div>` : ''}
      </div>
      <div class="footer">${s?.frontFooterText || ''}</div>
    </div>
    <div class="card back">
      <div class="title">Terms & Instructions</div>
      <ol class="terms">
        ${terms.length ? terms.map(t => `<li>${t}</li>`).join('') : '<li>Carry this card at all times during official duties.</li>'}
      </ol>
      ${s?.headOfficeAddress ? `<div class="addr"><b>Head Office:</b><br/>${s.headOfficeAddress}</div>` : ''}
    </div>
  </div>
  </body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Simple QR endpoint (PNG) using Google Chart API fallback or pure SVG
/**
 * @swagger
 * /hrci/idcard/{cardNumber}/qr:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: Render a QR image (SVG) for public verification
 *     parameters:
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *           example: hrci-2510-00001
 */
router.get('/:cardNumber/qr', async (req, res) => {
  const card = await prisma.iDCard.findUnique({ where: { cardNumber: req.params.cardNumber } });
  if (!card) return res.status(404).send('Not found');
  const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  const baseUrl = (setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  // Prefer HTML landing page when scanning the QR for human-friendly view
  const url = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/html`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 0, width: 160 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (e) {
    const fallback = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='10'>QR</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(fallback);
  }
});

export default router;
