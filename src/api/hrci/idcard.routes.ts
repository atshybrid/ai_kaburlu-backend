import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin, requireHrcAdmin } from '../middlewares/authz';
import { ensureAppointmentLetterForUser } from '../auth/auth.service';
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
 *         regionalOfficeAddress: { type: string, nullable: true }
 *         administrationOfficeAddress: { type: string, nullable: true }
 *         contactNumber1: { type: string, nullable: true }
 *         contactNumber2: { type: string, nullable: true }
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
  // Be forgiving with case by using a case-insensitive lookup
  const raw = String(req.params.cardNumber || '').trim();
  const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: raw, mode: 'insensitive' } as any } as any });
  if (!card) return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND' });
  // Enrich with membership level and computed display label (Level + Designation)
  let membershipLevel: string | null = null;
  let designationName: string | null = (card as any).designationName || null;
  let zoneValue: string | null = null;
  let hrcCountryId: string | null = null;
  let hrcStateId: string | null = null;
  let hrcDistrictId: string | null = null;
  let hrcMandalId: string | null = null;
  try {
    const membership = await prisma.membership.findUnique({ where: { id: card.membershipId }, include: { designation: true } });
    if (membership) {
      membershipLevel = membership.level as unknown as string;
      if (!designationName) designationName = (membership as any).designation?.name || null;
      zoneValue = membership.zone as any || null;
      hrcCountryId = (membership as any).hrcCountryId || null;
      hrcStateId = (membership as any).hrcStateId || null;
      hrcDistrictId = (membership as any).hrcDistrictId || null;
      hrcMandalId = (membership as any).hrcMandalId || null;
    }
  } catch {}
  // Human-friendly prefix mapping
  const zoneMap: Record<string, string> = { NORTH: 'North Zone', SOUTH: 'South Zone', EAST: 'East Zone', WEST: 'West Zone', CENTRAL: 'Central Zone' };
  const levelMap: Record<string, string> = { NATIONAL: 'National', STATE: 'State', DISTRICT: 'District', MANDAL: 'Mandal' };
  let prefix: string | null = null;
  if (membershipLevel === 'ZONE') {
    prefix = zoneValue ? zoneMap[String(zoneValue).toUpperCase()] || `${String(zoneValue).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())} Zone` : 'Zone';
  } else if (membershipLevel) {
    prefix = levelMap[membershipLevel] || membershipLevel.charAt(0) + membershipLevel.slice(1).toLowerCase();
  }
  const designationNameFormatted = designationName && prefix ? `${prefix} ${designationName}` : designationName;
  // Backward compatibility: designationDisplay retains previous UPPERCASE level style, but also expose new formatted name
  const designationDisplay = designationNameFormatted || null;

  // Level title + location details based on membership scope
  let levelTitle: string | null = null;
  let levelLocation: any = null;
  let locationTitle: string | null = null;
  // Resolve country name once if countryId exists (used for NATIONAL/ZONE display)
  let countryNameResolved: string | undefined;
  try {
    if (hrcCountryId) {
      const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
      countryNameResolved = c?.name;
    }
  } catch {}
  try {
    if (membershipLevel === 'NATIONAL') {
      levelTitle = 'National';
      levelLocation = countryNameResolved ? { countryId: hrcCountryId, countryName: countryNameResolved } : (hrcCountryId ? { countryId: hrcCountryId } : null);
      locationTitle = countryNameResolved || 'India';
    } else if (membershipLevel === 'ZONE') {
      const zoneTitle = zoneValue ? (zoneMap[String(zoneValue).toUpperCase()] || `${String(zoneValue).toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())} Zone`) : 'Zone';
      levelTitle = 'Zone';
      levelLocation = { countryId: hrcCountryId, countryName: countryNameResolved, zone: zoneValue, zoneTitle };
      locationTitle = [countryNameResolved, zoneTitle].filter(Boolean).join(', ') || zoneTitle;
    } else if (membershipLevel === 'STATE') {
      levelTitle = 'State';
      let stateName: string | undefined, stateCode: string | undefined;
      if (hrcStateId) {
        const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
        stateName = st?.name; stateCode = st?.code;
      }
      levelLocation = { stateId: hrcStateId, stateName, stateCode };
      locationTitle = stateName || undefined as any;
    } else if (membershipLevel === 'DISTRICT') {
      levelTitle = 'District';
      let districtName: string | undefined, stateName: string | undefined;
      if (hrcDistrictId) {
        const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
        districtName = dist?.name;
        if (dist?.stateId) {
          const st = await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } });
          stateName = st?.name;
        }
      }
      levelLocation = { stateId: hrcStateId, districtId: hrcDistrictId, districtName, stateName };
      locationTitle = [districtName, stateName].filter(Boolean).join(', ') || undefined as any;
    } else if (membershipLevel === 'MANDAL') {
      levelTitle = 'Mandal';
      let mandalName: string | undefined, districtName: string | undefined, stateName: string | undefined;
      if (hrcMandalId) {
        const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
        mandalName = mandal?.name;
        if (mandal?.districtId) {
          const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } });
          districtName = dist?.name;
          if (dist?.stateId) {
            const st = await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } });
            stateName = st?.name;
          }
        }
      }
      levelLocation = { stateId: hrcStateId, districtId: hrcDistrictId, mandalId: hrcMandalId, mandalName, districtName, stateName };
      locationTitle = [mandalName, districtName, stateName].filter(Boolean).join(', ') || undefined as any;
    }
  } catch {}
  const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  const baseUrl = setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`;
  const apiUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}`;
  const htmlUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/html`;
  const qrUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
  // Keep verifyUrl for backward compatibility (points to API JSON), also return htmlUrl and qrUrl for UX
  const verifyUrl = apiUrl;
  // memberLocationName computed for concise display under card
  let memberLocationName: string | null = null;
  try {
    if (membershipLevel === 'NATIONAL') {
      memberLocationName = levelLocation?.countryName || locationTitle || 'India';
    } else if (membershipLevel === 'ZONE') {
      memberLocationName = [levelLocation?.zoneTitle].filter(Boolean).join(' ') || locationTitle || null;
    } else if (membershipLevel === 'STATE') {
      memberLocationName = levelLocation?.stateName || locationTitle || null;
    } else if (membershipLevel === 'DISTRICT') {
      memberLocationName = levelLocation?.districtName || locationTitle || null;
    } else if (membershipLevel === 'MANDAL') {
      memberLocationName = levelLocation?.mandalName || locationTitle || null;
    }
  } catch {}

  // Embed enriched fields inside card for cleaner grouping; also keep top-level for backwards compatibility if needed
  const enrichedCard: any = { ...card, membershipLevel, levelTitle, levelLocation, locationTitle, memberLocationName, designationDisplay, designationNameFormatted };
  return res.json({ success: true, data: { card: enrichedCard, setting, verifyUrl, htmlUrl, qrUrl } });
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
  const raw = String(req.params.cardNumber || '').trim();
  // Case-insensitive lookup to match JSON endpoint behavior
  const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: raw, mode: 'insensitive' } as any } as any });
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
  // Helper to read template either from dist or src
  const readTemplate = (name: 'idcard_front.html' | 'idcard_back.html' | 'idcard_front_vertical.html') => {
    const distPath = path.resolve(__dirname, '../../templates', name);
    const srcPath = path.resolve(process.cwd(), 'src/templates', name);
    const tPath = fs.existsSync(distPath) ? distPath : (fs.existsSync(srcPath) ? srcPath : distPath);
    if (!fs.existsSync(tPath)) throw new Error(`Template not found: ${name}`);
    return fs.readFileSync(tPath, 'utf8');
  };

  const replaceIn = (html: string, id: string, value: string) => {
    const pattern = new RegExp(`(<[^>]*\\bid=\\"${id}\\"[^>]*>)(.*?)(<)`, 'g');
    return html.replace(pattern, `$1${value}$3`);
  };
  const setAttr = (html: string, id: string, attr: string, value?: string | null) => {
    const v = (value ?? '').toString().trim();
    if (!v) return html; return html.replace(new RegExp(`id=\\"${id}\\"([^>]*?)${attr}=\\"[^\\"]*\\"`), `id="${id}"$1${attr}="${v}"`)
      .replace(new RegExp(`id=\\"${id}\\"`), `id="${id}" ${attr}="${v}"`);
  };

  // Compose common values
  const colorsStyle = `<style>:root{--primary:${primary};--secondary:${secondary}}</style>`;
  const issuedAt = fmt(card.issuedAt);
  const expiresAt = fmt(card.expiresAt);
  const footer = s?.frontFooterText || '';
  const side = String(req.query.side || '').toLowerCase();

  // FRONT
  const buildFront = () => {
    const orientation = String(req.query.orientation || '').toLowerCase();
    const isVertical = orientation === 'vertical' || orientation === 'portrait';
    let html = readTemplate(isVertical ? 'idcard_front_vertical.html' : 'idcard_front.html');
    html = html.replace('</head>', `${colorsStyle}</head>`);
    html = replaceIn(html, 'frontH1', String(s?.frontH1 || ''));
    html = replaceIn(html, 'frontH2', String(s?.frontH2 || ''));
    html = replaceIn(html, 'frontH34', [s?.frontH3, s?.frontH4].filter(Boolean).join(' • '));
    html = setAttr(html, 'frontLogo', 'src', s?.frontLogoUrl || '');
    html = setAttr(html, 'secondLogo', 'src', s?.secondLogoUrl || '');
    html = setAttr(html, 'photoUrl', 'src', photoUrl || '');
    html = replaceIn(html, 'fullName', fullName || '-');
    html = replaceIn(html, 'mobileNumber', mobileNumber || '-');
    html = replaceIn(html, 'designationName', designationName || '-');
    html = replaceIn(html, 'cellName', cellName || '-');
    html = replaceIn(html, 'cardNumber', card.cardNumber);
    html = replaceIn(html, 'issuedAt', issuedAt || '-');
    html = replaceIn(html, 'expiresAt', expiresAt || '-');
    html = replaceIn(html, 'frontFooterText', footer);
    html = setAttr(html, 'authorSignUrl', 'src', s?.authorSignUrl || '');
    html = setAttr(html, 'hrciStampUrl', 'src', s?.hrciStampUrl || '');
    return html;
  };

  // BACK
  const buildBack = () => {
    let html = readTemplate('idcard_back.html');
    html = html.replace('</head>', `${colorsStyle}</head>`);
    // Terms list
    const items = terms.length ? terms : ['Carry this card at all times during official duties.'];
    html = html.replace('<ol class="terms" id="termsList">\n          <li>Carry this card at all times during official duties.</li>\n        </ol>', `<ol class="terms" id="termsList">${items.map(t => `<li>${t}</li>`).join('')}</ol>`);
    // Addresses & contacts
    html = replaceIn(html, 'headOfficeAddress', String(s?.headOfficeAddress || ''));
    html = replaceIn(html, 'regionalOfficeAddress', String(s?.regionalOfficeAddress || ''));
    html = replaceIn(html, 'administrationOfficeAddress', String(s?.administrationOfficeAddress || ''));
    const contacts = [s?.contactNumber1, s?.contactNumber2].filter(Boolean).join(', ');
    html = replaceIn(html, 'contactNumbers', contacts);
    // QR SVG
    html = html.replace('<div id="qrSvg"></div>', `<div id="qrSvg">${qrSvg}</div>`);
    return html;
  };

  let out = '';
  if (side === 'front') out = buildFront();
  else if (side === 'back') out = buildBack();
  else {
    // Combined preview page with both sides; add simple wrapper for spacing
    const front = buildFront();
    const back = buildBack();
    out = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>ID Card ${card.cardNumber}</title>
      <style>body{margin:0;padding:8mm;background:#f5f5f5;display:flex;gap:6mm;flex-wrap:wrap;font-family:Arial,Helvetica,sans-serif} .sheet{box-shadow:0 6px 18px rgba(0,0,0,.15)} @media print{body{background:#fff;padding:0} .sheet{box-shadow:none}}</style>
      </head><body>
      <div class="sheet">${front}</div>
      <div class="sheet">${back}</div>
      </body></html>`;
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(out);
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
/**
 * Admin endpoint to regenerate an appointment letter PDF for a specific member.
 * Accepts either a userId or a cardNumber and forces regeneration using the
 * existing generator. Returns the new/public URL if eligible, otherwise a clear
 * message stating the reason (e.g., not ACTIVE or KYC not approved).
 */
/**
 * @swagger
 * /hrci/idcard/appointments/regenerate:
 *   post:
 *     tags: [HRCI ID Cards]
 *     summary: Regenerate appointment letter for a member (admin)
 *     description: "Forces appointment letter PDF regeneration. Provide either userId or cardNumber. Requires HRCI admin."
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID to regenerate for
 *               cardNumber:
 *                 type: string
 *                 description: ID card number to resolve the user
 *               force:
 *                 type: boolean
 *                 description: "Force regeneration even if URL already exists (default: true)"
 *           examples:
 *             byUserId:
 *               value: { userId: "cmgqqzsuz000ijo1eg8g0bzjf" }
 *             byCardNumber:
 *               value: { cardNumber: "hrci-2510-00006" }
 *     responses:
 *       200:
 *         description: Regeneration result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId: { type: string }
 *                     cardNumber: { type: string, nullable: true }
 *                     appointmentLetterPdfUrl: { type: string, nullable: true }
 *                     eligible: { type: boolean }
 *                     message: { type: string, nullable: true }
 *       400:
 *         description: Missing parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (requires HRCI admin)
 *       404:
 *         description: Card not found (when cardNumber provided)
 */
router.post('/appointments/regenerate', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    // Accept params from body or query to reduce 400s from clients sending query strings
    const body = (req.body || {}) as { userId?: string; cardNumber?: string; force?: boolean };
    const q = (req.query || {}) as any;
    const rawUserId = (body.userId || q.userId || '').toString();
    const rawCard = (body.cardNumber || q.cardNumber || '').toString();
    let uid = rawUserId.trim();

    // If userId not provided, resolve from cardNumber
    if (!uid && rawCard) {
      const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: rawCard, mode: 'insensitive' } as any } as any });
      if (!card) return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND', message: `No IDCard found for cardNumber '${rawCard}'.` });
      const membership = await prisma.membership.findUnique({ where: { id: card.membershipId } });
      if (!membership?.userId) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND_FOR_CARD', message: 'Could not resolve user from the provided cardNumber.' });
      uid = membership.userId;
    }
    if (!uid) return res.status(400).json({ success: false, error: 'MISSING_PARAM', message: 'Provide userId or cardNumber (in body or query).' });

    // Force regeneration by default for this admin API.
    const url = await ensureAppointmentLetterForUser(uid, true);

    // Also return the cardNumber for convenience
    const latest = await prisma.membership.findFirst({ where: { userId: uid }, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }], include: { idCard: true } });
    const cn = (latest as any)?.idCard?.cardNumber || null;

    return res.json({ success: true, data: { userId: uid, cardNumber: cn, appointmentLetterPdfUrl: url, eligible: Boolean(url), message: url ? null : 'User not eligible (requires ACTIVE membership, KYC approved, and ID card generated).' } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'FAILED_TO_REGENERATE', message: e?.message || 'Unknown error' });
  }
});
