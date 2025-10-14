import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin, requireHrcAdmin } from '../middlewares/authz';

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
 *     summary: Render a simple HTML preview of the ID card (public)
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
  const primary = s?.primaryColor || '#0d6efd';
  const secondary = s?.secondaryColor || '#6c757d';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>ID Card</title>
  <style>body{font-family:Arial;margin:0;padding:0;background:#f5f5f5} .card{width:360px;margin:16px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.12)} .hdr{background:${primary};color:#fff;padding:12px;text-align:center}
  .logo{height:48px;border-radius:50%;object-fit:cover}
  .blk{padding:12px;color:#212529}
  .photo{display:flex;justify-content:center;margin-top:8px}
  .photo img{width:90px;height:90px;border-radius:8px;object-fit:cover;border:3px solid ${secondary}33}
  .h1{font-size:18px;font-weight:700}
  .h2{font-size:14px;color:${secondary}}
  .row{display:flex;justify-content:space-between;margin-top:8px}
  .qr{margin:12px auto;text-align:center}
  .footer{font-size:11px;color:#666;text-align:center;padding:8px 12px}
  </style></head><body>
  <div class="card">
   <div class="hdr">
     ${s?.frontLogoUrl ? `<img class="logo" src="${s.frontLogoUrl}"/>` : ''}
     <div class="h1">${s?.frontH1 || 'HRCI'}</div>
     <div class="h2">${s?.frontH2 || ''}</div>
   </div>
   <div class="blk">
     ${photoUrl ? `<div class="photo"><img src="${photoUrl}" alt="Photo"/></div>` : ''}
     <div><b>Name:</b> ${fullName}</div>
     <div><b>Designation:</b> ${designationName}</div>
     <div><b>Cell:</b> ${cellName}</div>
     <div><b>Mobile:</b> ${mobileNumber}</div>
     ${s?.registerDetails ? `<div style="margin-top:8px;white-space:pre-wrap">${s.registerDetails}</div>` : ''}
     ${s?.authorSignUrl ? `<div style="margin-top:8px"><img src="${s.authorSignUrl}" style="height:36px"/></div>` : ''}
   </div>
   <div class="qr">
     <img src="/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr" alt="QR"/>
   </div>
   <div class="footer">${s?.frontFooterText || ''}</div>
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
  const baseUrl = setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`;
  // Prefer HTML landing page when scanning the QR for human-friendly view
  const url = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/html`;
  // Lightweight inline SVG QR (placeholder pattern). For production, integrate 'qrcode' package.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='#fff'/>`+
              `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='10'>QR</text>`+
              `</svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

export default router;
