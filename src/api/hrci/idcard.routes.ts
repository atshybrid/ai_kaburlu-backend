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
  let profilePhotoUrl: string | null = (card as any).profilePhotoUrl || null;
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
      // Resolve latest profile photo (prefer explicit profilePhotoUrl or media.url)
      if (!profilePhotoUrl) {
        try {
          const user = await prisma.user.findUnique({ where: { id: (membership as any).userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
          profilePhotoUrl = (user as any)?.profile?.profilePhotoUrl || (user as any)?.profile?.profilePhotoMedia?.url || profilePhotoUrl;
        } catch {}
      }
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
  const baseUrl = (setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
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
  // Normalize and alias photo url for clients expecting `photoUrl`
  let photoUrlFinal: string | null = profilePhotoUrl || (card as any).profilePhotoUrl || (card as any).photoUrl || null;
  if (photoUrlFinal && /^\//.test(photoUrlFinal)) photoUrlFinal = `${baseUrl}${photoUrlFinal}`;
  const enrichedCard: any = { ...card, membershipLevel, levelTitle, levelLocation, locationTitle, memberLocationName, designationDisplay, designationNameFormatted, profilePhotoUrl: photoUrlFinal, photoUrl: photoUrlFinal };
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
  let membershipLevel: string | null = null;
  let zoneValue: string | null = null;
  let hrcCountryId: string | null = null;
  let hrcStateId: string | null = null;
  let hrcDistrictId: string | null = null;
  let hrcMandalId: string | null = null;
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
      membershipLevel = (m as any).level || null;
      zoneValue = (m as any).zone || null;
      hrcCountryId = (m as any).hrcCountryId || null;
      hrcStateId = (m as any).hrcStateId || null;
      hrcDistrictId = (m as any).hrcDistrictId || null;
      hrcMandalId = (m as any).hrcMandalId || null;
    }
  }
  // Always attempt to resolve latest profile photo even if snapshot text fields are present
  if (!photoUrl) {
    try {
      const mRef = await prisma.membership.findUnique({ where: { id: card.membershipId } });
      if (mRef) {
        const uRef: any = await prisma.user.findUnique({ where: { id: (mRef as any).userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
        photoUrl = (uRef?.profile?.profilePhotoUrl || uRef?.profile?.profilePhotoMedia?.url || photoUrl) as any;
      }
    } catch {}
  }
  // If snapshot already had level/location, attempt to read membership anyway if not fetched
  if (!membershipLevel) {
    try {
      const m2 = await prisma.membership.findUnique({ where: { id: card.membershipId } });
      if (m2) {
        membershipLevel = (m2 as any).level || null;
        zoneValue = (m2 as any).zone || null;
        hrcCountryId = (m2 as any).hrcCountryId || null;
        hrcStateId = (m2 as any).hrcStateId || null;
        hrcDistrictId = (m2 as any).hrcDistrictId || null;
        hrcMandalId = (m2 as any).hrcMandalId || null;
      }
    } catch {}
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
  const designVariant = String(req.query.design || '').toLowerCase();

  // Build CR80 exact design variant if requested via ?design=cr80
  const buildCr80 = async () => {
    // Map level/zone to formatted prefix
    const zoneMap: Record<string,string> = { NORTH:'North Zone', SOUTH:'South Zone', EAST:'East Zone', WEST:'West Zone', CENTRAL:'Central Zone' };
    let prefix = '';
    if (membershipLevel === 'ZONE') {
      prefix = zoneValue ? (zoneMap[String(zoneValue).toUpperCase()] || `${String(zoneValue).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} Zone`) : 'Zone';
    } else if (membershipLevel === 'NATIONAL') prefix = 'National';
    else if (membershipLevel === 'STATE') prefix = 'State';
    else if (membershipLevel === 'DISTRICT') prefix = 'District';
    else if (membershipLevel === 'MANDAL') prefix = 'Mandal';
    const designationFormatted = designationName ? [prefix, designationName].filter(Boolean).join(' ') : '';
    // Location display
    let memberLocationName: string | undefined;
    try {
      if (membershipLevel === 'NATIONAL') {
        if (hrcCountryId) {
          const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
          memberLocationName = c?.name || 'India';
        } else memberLocationName = 'India';
      } else if (membershipLevel === 'ZONE') {
        const c = hrcCountryId ? await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } }) : null;
        const zoneTitle = prefix || '';
        memberLocationName = [c?.name, zoneTitle].filter(Boolean).join(', ');
      } else if (membershipLevel === 'STATE' && hrcStateId) {
        const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
        memberLocationName = st?.name;
      } else if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
        const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
        if (dist) {
          const st = await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } });
          memberLocationName = [dist?.name, st?.name].filter(Boolean).join(', ');
        }
      } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
        const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
        if (mandal) {
          const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } });
          const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
          memberLocationName = [mandal?.name, dist?.name, st?.name].filter(Boolean).join(', ');
        }
      }
    } catch {}
    // Ensure we have latest membership/user photo even if snapshot contained basics
    if (!photoUrl) {
      try {
        const mRef = await prisma.membership.findUnique({ where: { id: card.membershipId } });
        if (mRef) {
          const uRef: any = await prisma.user.findUnique({ where: { id: (mRef as any).userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
          photoUrl = (uRef?.profile?.profilePhotoUrl || uRef?.profile?.profilePhotoMedia?.url || photoUrl) as any;
        }
      } catch {}
    }
    const qrEndpointUrl = `${baseHost}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
  // Simple inline SVG fallbacks (data URI) to avoid broken image icons
  const svgPlaceholder = (text: string, w = 120, h = 120) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Verdana' font-size='14' fill='#555'>${text}</text></svg>`)}`;
  const trimOrNull = (v?: string | null) => { if (typeof v !== 'string') return v || null; const t = v.trim(); return t ? t : null; };
  const logoUrl = trimOrNull(s?.frontLogoUrl) || svgPlaceholder('Logo');
  const secondLogoUrl = trimOrNull(s?.secondLogoUrl) || logoUrl;
  const stampUrl = trimOrNull(s?.hrciStampUrl) || svgPlaceholder('Stamp', 140, 140);
  const authorSignUrl = trimOrNull(s?.authorSignUrl) || '';
    const contactNumber1 = s?.contactNumber1 || '';
    const contactNumber2 = s?.contactNumber2 || '';
    const headOfficeAddress = s?.headOfficeAddress || '';
    const regionalOfficeAddress = s?.regionalOfficeAddress || '';
    const administrationOfficeAddress = s?.administrationOfficeAddress || '';
    const website = (s as any)?.registerDetails || '';
    // Registration lines (keeping same static text if not provided in setting)
    // Front band registration lines (exact screenshot spec)
    const registrationLinesFront = [
      'REGISTERED BY NCT, NEW DELHI, GOVT OF INDIA',
      'REGISTERED NO: 4396/2022 (UNDER TRUST ACT 1882)',
      'TO PROTECT & PROMOTE THE HUMAN RIGHTS'
    ];
    // Back body registration lines (corporate / CSR / ISO / UDYAN / social justice / AP reg)
    const registrationLinesBack = [
      'REGISTERED BY MINISTRY OF CORPORATE AFFAIRS, INDIA',
      "REGD NO: CSR00036396 OF 'HRCI', CSR 00038592 OF 'HRCI'",
      "REGD NO: HVR. 46/2022 'HRCI' ISO CERTIFICATE NO: HRCI/AP121209/2022",
      "REGD UNDER 'UDYAN' NO: AP-21-0001051, AP-21-0001502 'HRCI'",
      'REGD BY: MINISTRY OF SOCIAL JUSTICE AND EMPOWERMENT',
      'GOVT OF INDIA REGD BY AP/00003680'
    ];
    const termsLines = terms.length ? terms : [
      'Carry this card at all times during official duties.',
      'Report misuse immediately to headquarters.'
    ];
    // Build lines markup
  const regHtmlFront = registrationLinesFront.map(l => `<span style="display:block">${l}</span>`).join('');
    const termsHtml = termsLines.map(l => `          <p class="term">${l}</p>`).join('\n');
    const contactFooter = `HELP LINE NUMBER ${[contactNumber1, contactNumber2].filter(Boolean).join('  |  ')}`;
    // Inject into provided design
  const scale = Math.max(0.5, Math.min(2, Number(req.query.scale || 1))) || 1;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>HRCI ID Card</title>
<style>${cr80Css}</style>
</head>
<body>

<div style="${'transform:scale(' + scale + '); transform-origin: top left;'}">

<!-- FRONT PAGE -->
<section class="page front">
  <div class="band-red">
    <h1>HUMAN RIGHTS COUNCIL FOR INDIA (HRCI)</h1>
  </div>
  <div class="band-blue">
    <p>${regHtmlFront}</p>
  </div>

  <div class="body">
    <div class="juris-wrap">
      <p class="juris">ALL INDIA JURISDICTION</p>
      <p class="niti1">REGD BY GOVT OF \"NITI AAYOG\"</p>
      <p class="niti2">UNIQUE ID: AP/2022/0324217, AP/2022/0326782</p>
      <p class="works">WORKS AGAINST CRIME, VIOLENCE AND CORRUPTION</p>
      <p class="identity">IDENTITY CARD</p>
    </div>

    <div class="main">
      <div>
        <img class="logo" src="${logoUrl}" alt="Logo" />
        <img class="qr" src="${qrEndpointUrl}" alt="QR" />
      </div>
      <div class="details">
        <p class="cell">${cellName || '-'}</p>
        <p class="name">${fullName || '-'}</p>
        <p class="desig">${designationFormatted || '-'}</p>
        <div class="row"><span class="lbl">Name</span><span>:</span><span class="val">${(fullName || '-').toUpperCase()}</span></div>
        <div class="row"><span class="lbl">Designation</span><span>:</span><span class="val">${(designationFormatted || '-').toUpperCase()}</span></div>
        ${cellName ? `<div class="row"><span class="lbl">Cell</span><span>:</span><span class="val">${cellName.toUpperCase()}</span></div>` : ''}
        <div class="row"><span class="lbl">ID</span><span>:</span><span class="val">${card.cardNumber.toUpperCase()}</span></div>
        <div class="row"><span class="lbl">Mob</span><span>:</span><span class="val">${(mobileNumber || '-').toUpperCase()}</span></div>
        <div class="row"><span class="lbl">Valid</span><span>:</span><span class="val">${(expiresAt || '-').toUpperCase()}</span></div>
        <div class="row"><span class="lbl">Issue Date</span><span>:</span><span class="val">${(issuedAt || '-').toUpperCase()}</span></div>
      </div>
      <div>
        <div class="photo-wrap">
          <img class="photo" src="${photoUrl || svgPlaceholder('Photo')}" alt="Photo" />
          ${stampUrl ? `<img class="stamp" src="${stampUrl}" alt="Stamp" />` : ''}
        </div>
        <div class="sign-wrap">
          ${authorSignUrl ? `<img class="sign" src="${authorSignUrl}" alt="Author Sign" />` : ''}
          <div class="sign-label">Signature Issue Auth.</div>
        </div>
      </div>
    </div>
  </div>
  <div class="footer-red">
    <p>We take help 24x7 From (Police, CBI, Vigilance, NIA) &amp; other Govt. Dept. against crime &amp; corruption.</p>
  </div>
 </section>

<!-- BACK PAGE -->
<section class="page back">
  <div class="band-red">
    <h1>HUMAN RIGHTS COUNCIL FOR INDIA (HRCI)</h1>
  </div>
  <div class="body">
    <div class="row-main">
      <div><img class="qr" src="${qrEndpointUrl}" alt="QR" /></div>
      <div class="reg">
        ${registrationLinesBack.map(l=>`<p class=\"line\">${l}</p>`).join('')}
        <p class="terms-title">Terms &amp; Conditions</p>
${termsHtml}
        ${headOfficeAddress ? `<p class="addr-label">HEAD OFFICE</p><p class="addr">${headOfficeAddress}</p>`: ''}
        ${regionalOfficeAddress ? `<p class="addr-label">REGIONAL OFFICE</p><p class="addr">${regionalOfficeAddress}</p>`: ''}
        ${administrationOfficeAddress ? `<p class="addr-label">ADMINISTRATION OFFICE</p><p class="addr">${administrationOfficeAddress}</p>`: ''}
        ${website ? `<p class="web">${website}</p>`: ''}
      </div>
      <div><img class="logo" src="${secondLogoUrl}" alt="Logo" /></div>
    </div>
  </div>
  <div class="footer-blue"><p>${contactFooter}</p></div>
 </section>

</div>

</body>
</html>`;
    return html;
  };

  // External CSS for CR80 design (inlined for single document)
  const cr80Css = `  @page {\n    size: 85.6mm 54mm;\n    margin: 0;\n  }\n  html, body {\n    margin: 0;\n    padding: 0;\n    background: #f3f4f6;\n  }\n  :root {\n    --card-w: 85.6mm;\n    --card-h: 54mm;\n    --red: #FE0002;\n    --blue: #17007A;\n    --text: #111827;\n    --muted-bg: #F3F4F6;\n    --top-band: 6.1mm;\n    --blue-band: 6.1mm;\n    --bottom-band: 4.6mm;\n    --body-h: calc(var(--card-h) - var(--top-band) - var(--blue-band) - var(--bottom-band));\n  }\n  .page {\n    width: var(--card-w);\n    height: var(--card-h);\n    overflow: hidden;\n    page-break-after: always;\n    background: var(--muted-bg);\n    border: 0.2mm solid #e5e7eb;\n    box-sizing: border-box;\n    position: relative;\n  }\n  .page:last-child { page-break-after: auto; }\n  .band-red {\n    height: var(--top-band);\n    background: var(--red);\n    color: #fff; display:flex;align-items:center;justify-content:center;\n    padding:0 2mm; box-sizing:border-box;\n  }\n  .band-red h1 { margin:0; font:900 5.4mm/1 Verdana,Arial,sans-serif; letter-spacing:0.2mm; text-align:center; text-transform:uppercase; white-space:nowrap; overflow:hidden;}\n  .band-blue { height: var(--blue-band); background: var(--blue); color:#fff; display:flex;align-items:center;justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .band-blue p { margin:0; font:700 2.2mm/3.0mm Verdana,Arial,sans-serif; letter-spacing:0.1mm; text-align:center;}\n  .footer-red { position:absolute; left:0; right:0; bottom:0; height:var(--bottom-band); background:var(--red); color:#fff; display:flex;align-items:center;justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .footer-red p { margin:0; font:800 2mm/1 Verdana,Arial,sans-serif; text-align:center; letter-spacing:0.05mm;}\n  .front .body { position:absolute; top:calc(var(--top-band) + var(--blue-band)); left:0; right:0; height:var(--body-h); padding:1.2mm 2mm 0 2mm; box-sizing:border-box;}\n  .front .juris-wrap { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; margin-top:0.8mm;}\n  .front .juris { margin:0.3mm 0 0 0; font:900 3.2mm/3.8mm Verdana,Arial,sans-serif; color:#000; letter-spacing:0.1mm;}\n  .front .niti1 { margin:0.2mm 0 0 0; font:800 2.2mm/2.8mm Verdana,Arial,sans-serif; color:#000;}\n  .front .niti2 { margin:0.1mm 0 0 0; font:700 2mm/2.5mm Verdana,Arial,sans-serif; color:#000;}\n  .front .works { margin:0.2mm 0 0 0; font:800 1.9mm/2.6mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .identity { margin:0.2mm 0 0 0; font:900 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .main { display:grid; grid-template-columns:18mm auto 26mm; grid-gap:1.2mm; align-items:start; margin-top:1.4mm;}\n  .front .logo { width:13.5mm; height:13.5mm; object-fit:cover; border:0.4mm solid #fff; background:#fff; display:block; margin-bottom:1.2mm;}\n  .front .qr { width:14mm; height:14mm; object-fit:contain; display:block;}\n  .front .details { background:#F3F4F6; border:0.2mm solid #e5e7eb; border-radius:1.8mm; padding:2mm 2.2mm;}\n  .front .cell { margin:0 0 0.8mm 0; font:800 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--blue);}\n  .front .name { margin:0 0 0.8mm 0; font:800 3.0mm/3.6mm Verdana,Arial,sans-serif; color:var(--text);}\n  .front .desig { margin:0 0 1.2mm 0; font:700 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .row { display:grid; grid-template-columns:15mm 2mm auto; align-items:center; column-gap:1mm; margin:0.6mm 0;}\n  .front .lbl { font:900 2.2mm/3.0mm Verdana,Arial,sans-serif; color:var(--text);}\n  .front .val { font:800 2.2mm/3.0mm Verdana,Arial,sans-serif; color:var(--text); overflow:hidden; white-space:nowrap; text-overflow:ellipsis;}\n  .front .photo-wrap { position:relative; width:24mm; height:28mm; border:0.2mm solid #e5e7eb; background:#fff; display:flex; align-items:center; justify-content:center;}\n  .front .photo { width:calc(100% - 1mm); height:calc(100% - 1mm); object-fit:cover;}\n  .front .stamp { position:absolute; right:1mm; bottom:1mm; width:14mm; height:14mm; border-radius:50%; object-fit:cover; background:transparent; box-shadow:0 0 0.4mm rgba(0,0,0,.15);}\n  .front .sign-wrap { margin-top:1mm; display:flex; flex-direction:column; align-items:center;}\n  .front .sign { width:22mm; height:10mm; object-fit:contain; background:transparent;}\n  .front .sign-label { margin-top:-1.2mm; font:900 2mm/1 Verdana,Arial,sans-serif; color:var(--blue);}\n  .back .body { position:absolute; top:var(--top-band); left:0; right:0; height:calc(var(--card-h) - var(--top-band)); box-sizing:border-box; padding:1.2mm 2mm var(--bottom-band) 2mm;}\n  .back .row-main { display:grid; grid-template-columns:16mm auto 16mm; grid-gap:1.2mm; align-items:start; margin-top:2mm;}\n  .back .qr { width:13mm; height:13mm; object-fit:contain;}\n  .back .logo { width:13mm; height:13mm; object-fit:cover; display:block; margin-left:auto;}\n  .back .reg { text-align:center; color:var(--text);}\n  .back .reg .line { margin:0.4mm 0; font:800 2.2mm/2.8mm Verdana,Arial,sans-serif;}\n  .back .terms-title { margin:1mm 0 0.6mm 0; font:900 2.2mm/2.8mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .term { margin:0.3mm 0; font:700 1.8mm/2.4mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .addr-label { margin:0.6mm 0 0.2mm 0; font:900 2mm/2.6mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .addr { margin:0 0 0.4mm 0; font:700 1.8mm/2.4mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .web { margin:0.6mm 0 0 0; font:800 2mm/2.6mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .footer-blue { position:absolute; left:0; right:0; bottom:0; height:var(--bottom-band); background:var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .back .footer-blue p { margin:0; font:800 2mm/1 Verdana,Arial,sans-serif; text-align:center;}\n`;

  // FRONT
  const buildFront = () => {
    const orientation = String(req.query.orientation || '').toLowerCase();
    const isVertical = orientation === 'vertical' || orientation === 'portrait';
    let html = readTemplate(isVertical ? 'idcard_front_vertical.html' : 'idcard_front.html');
    html = html.replace('</head>', `${colorsStyle}</head>`);
    // Simple inline SVG placeholders for legacy templates
    const svgPlaceholder = (text: string, w = 120, h = 80) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Verdana' font-size='14' fill='#555'>${text}</text></svg>`)}`;
    html = replaceIn(html, 'frontH1', String(s?.frontH1 || ''));
    html = replaceIn(html, 'frontH2', String(s?.frontH2 || ''));
    html = replaceIn(html, 'frontH34', [s?.frontH3, s?.frontH4].filter(Boolean).join(' • '));
    html = setAttr(html, 'frontLogo', 'src', s?.frontLogoUrl || svgPlaceholder('Logo'));
    html = setAttr(html, 'secondLogo', 'src', s?.secondLogoUrl || s?.frontLogoUrl || svgPlaceholder('Logo'));
    html = setAttr(html, 'photoUrl', 'src', photoUrl || svgPlaceholder('Photo', 140, 180));
    html = replaceIn(html, 'fullName', fullName || '-');
    html = replaceIn(html, 'mobileNumber', mobileNumber || '-');
    html = replaceIn(html, 'designationName', designationName || '-');
    html = replaceIn(html, 'cellName', cellName || '-');
    html = replaceIn(html, 'cardNumber', card.cardNumber);
    html = replaceIn(html, 'issuedAt', issuedAt || '-');
    html = replaceIn(html, 'expiresAt', expiresAt || '-');
    html = replaceIn(html, 'frontFooterText', footer);
    html = setAttr(html, 'authorSignUrl', 'src', s?.authorSignUrl || svgPlaceholder('Sign', 160, 60));
    html = setAttr(html, 'hrciStampUrl', 'src', s?.hrciStampUrl || svgPlaceholder('Stamp', 120, 120));
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
  if (designVariant === 'cr80') {
    out = await buildCr80();
  } else if (side === 'front') out = buildFront();
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
