import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import { requireAuth, requireAdmin, requireHrcAdmin } from '../middlewares/authz';
import { ensureAppointmentLetterForUser } from '../auth/auth.service';
import QRCode from 'qrcode';
import * as puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

const router = Router();
// Global placeholder used when a member has no real profile photo (media or URL)
const PROFILE_PHOTO_PLACEHOLDER = process.env.PROFILE_PHOTO_PLACEHOLDER || 'https://via.placeholder.com/150x150/0d6efd/ffffff?text=HRCI';

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
 * /hrci/idcard/{cardNumber}:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: Get an ID card JSON with enriched fields (public)
 *     parameters:
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enriched ID card JSON along with active settings and helpful URLs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     card: { type: object }
 *                     setting: { $ref: '#/components/schemas/IdCardSetting' }
 *                     verifyUrl: { type: string }
 *                     htmlUrl: { type: string }
 *                     qrUrl: { type: string }
 *             examples:
 *               ok:
 *                 summary: Example response (National)
 *                 value:
 *                   success: true
 *                   data:
 *                     card:
 *                       levelTitle: National
 *                       levelLocation:
 *                         countryId: "cuid-country"
 *                         countryName: "India"
 *                         stateId: null
 *                         districtId: null
 *                         mandalId: null
 *                         mandalName: null
 *                         districtName: null
 *                         stateName: null
 *                       locationTitle: "India"
 */
router.get('/:cardNumber', async (req, res) => {
  try {
    const raw = String(req.params.cardNumber || '').trim();
    const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: raw, mode: 'insensitive' } as any } as any });
    if (!card) return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND' });
    const s = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);

    // Snapshots in card
    let fullName = (card as any).fullName || '';
    let designationName = (card as any).designationName || '';
    let cellName = (card as any).cellName || '';
    let mobileNumber = (card as any).mobileNumber || '';
    let profilePhotoUrl: string | undefined;

    // Membership-level context
    let membershipLevel: string | null = null;
    let zoneValue: string | null = null;
    let hrcCountryId: string | null = null;
    let hrcStateId: string | null = null;
    let hrcDistrictId: string | null = null;
    let hrcMandalId: string | null = null;

    const m = await prisma.membership.findUnique({ where: { id: (card as any).membershipId }, include: { designation: true, cell: true } });
    if (m) {
      membershipLevel = (m as any).level || null;
      zoneValue = (m as any).zone || null;
      hrcCountryId = (m as any).hrcCountryId || null;
      hrcStateId = (m as any).hrcStateId || null;
      hrcDistrictId = (m as any).hrcDistrictId || null;
      hrcMandalId = (m as any).hrcMandalId || null;
      // Fill snapshot basics if missing
      if (!fullName || !mobileNumber) {
        try {
          const user: any = await prisma.user.findUnique({ where: { id: (m as any).userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
          fullName = fullName || (user?.profile?.fullName || '');
          mobileNumber = mobileNumber || (user?.mobileNumber || '');
          profilePhotoUrl = (user?.profile?.profilePhotoMedia?.url || user?.profile?.profilePhotoUrl || undefined) as any;
        } catch {}
      }
      designationName = designationName || ((m as any).designation?.name || '');
      cellName = cellName || ((m as any).cell?.name || '');
      // Always try to get latest photo
      if (!profilePhotoUrl) {
        try {
          const u: any = await prisma.user.findUnique({ where: { id: (m as any).userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
          profilePhotoUrl = (u?.profile?.profilePhotoMedia?.url || u?.profile?.profilePhotoUrl || undefined) as any;
        } catch {}
      }
    }

    // Build location names
    let levelTitle: string | null = null;
    let memberLocationName: string | null = null;
    // Extend levelLocation to include country for National/Zone display requirements
    let levelLocation: any = {
      countryId: null as string | null,
      countryName: null as string | null,
      stateId: null as string | null,
      districtId: null as string | null,
      mandalId: null as string | null,
      mandalName: null as string | null,
      districtName: null as string | null,
      stateName: null as string | null
    };
    const titleMap: Record<string, string> = { NATIONAL: 'National', ZONE: 'Zone', STATE: 'State', DISTRICT: 'District', MANDAL: 'Mandal' };
    if (membershipLevel) levelTitle = titleMap[String(membershipLevel).toUpperCase()] || String(membershipLevel);
    try {
      if (membershipLevel === 'NATIONAL') {
        // Show country for National; fallback to 'India' if not resolvable
        if (hrcCountryId) {
          const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
          levelLocation.countryId = hrcCountryId;
          levelLocation.countryName = c?.name || 'India';
          memberLocationName = levelLocation.countryName;
        } else {
          levelLocation.countryName = 'India';
          memberLocationName = 'India';
        }
      } else if (membershipLevel === 'ZONE') {
        // Zone: include country name also
        if (hrcCountryId) {
          const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
          levelLocation.countryId = hrcCountryId;
          levelLocation.countryName = c?.name || 'India';
        } else {
          levelLocation.countryName = 'India';
        }
        // memberLocationName for zone will primarily show country (zone is implied by membershipLevel/prefix)
        memberLocationName = levelLocation.countryName;
      } else if (membershipLevel === 'STATE' && hrcStateId) {
        const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
        levelLocation.stateId = hrcStateId; levelLocation.stateName = st?.name || null; memberLocationName = st?.name || null;
      } else if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
        const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
        const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
        levelLocation.districtId = hrcDistrictId; levelLocation.districtName = dist?.name || null; levelLocation.stateId = dist?.stateId || null; levelLocation.stateName = st?.name || null; memberLocationName = dist?.name || null;
      } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
        const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
        const dist = mandal ? await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } }) : null;
        const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
        levelLocation.mandalId = hrcMandalId; levelLocation.mandalName = mandal?.name || null; levelLocation.districtId = mandal?.districtId || null; levelLocation.districtName = dist?.name || null; levelLocation.stateId = dist?.stateId || null; levelLocation.stateName = st?.name || null; memberLocationName = mandal?.name || null;
      }
    } catch {}

    // Location title (most specific to broader, include country if present)
    const locationTitle = [
      levelLocation.mandalName,
      levelLocation.districtName,
      levelLocation.stateName,
      levelLocation.countryName
    ].filter(Boolean).join(', ');

    // Designation formatting with prefix
    const prefixMap: Record<string, string> = { NATIONAL: 'National', ZONE: '', STATE: 'State', DISTRICT: 'District', MANDAL: 'Mandal' };
    const prefix = prefixMap[String(membershipLevel || '').toUpperCase()] || '';
    const designationDisplay = [prefix, designationName || ''].filter(Boolean).join(' ').trim() || designationName || '';
    const designationNameFormatted = designationDisplay;

    const baseHost = ((s?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`) as string).replace(/\/$/, '');
    const verifyUrl = `${baseHost}/hrci/idcard/${encodeURIComponent((card as any).cardNumber)}`;
    const htmlUrl = `${verifyUrl}/html`;
    const qrUrl = `${verifyUrl}/qr`;

    return res.json({
      success: true,
      data: {
        card: {
          id: (card as any).id,
          membershipId: (card as any).membershipId,
          cardNumber: (card as any).cardNumber,
          issuedAt: (card as any).issuedAt,
          expiresAt: (card as any).expiresAt,
          meta: (card as any).meta ?? null,
          status: (card as any).status,
          fullName,
          designationName,
          cellName,
          mobileNumber,
          appointmentLetterPdfUrl: (card as any).appointmentLetterPdfUrl || null,
          appointmentLetterGeneratedAt: (card as any).appointmentLetterGeneratedAt || null,
          createdAt: (card as any).createdAt,
          updatedAt: (card as any).updatedAt,
          membershipLevel,
          levelTitle,
          levelLocation,
          locationTitle,
          memberLocationName,
          designationDisplay,
          designationNameFormatted,
          profilePhotoUrl: profilePhotoUrl || null,
          photoUrl: profilePhotoUrl || null
        },
        setting: s || null,
        verifyUrl,
        htmlUrl,
        qrUrl
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'FAILED', message: e?.message || 'Unknown error' });
  }
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
 *             examples:
 *               ok:
 *                 value: { success: true, data: { id: 'cuid', name: 'ID Card', isActive: true } }
 */

// (Removed an older experimental HTML route to avoid duplication)

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
  // Prefer active IdCardSetting; if none, fall back to any available row to avoid undefined settings in renders
  let s: any = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  if (!s) {
    s = await (prisma as any).idCardSetting.findFirst().catch(() => null);
  }
  if (process.env.PDF_DEBUG) {
    try {
      console.log('[IDCARD][setting]', {
        id: s?.id,
        isActive: s?.isActive,
        frontLogoUrl: s?.frontLogoUrl,
        secondLogoUrl: s?.secondLogoUrl,
        watermarkLogoUrl: (s as any)?.watermarkLogoUrl,
        authorSignUrl: s?.authorSignUrl,
        hrciStampUrl: s?.hrciStampUrl,
        headOfficeAddress: s?.headOfficeAddress,
        regionalOfficeAddress: s?.regionalOfficeAddress,
        administrationOfficeAddress: s?.administrationOfficeAddress,
        contactNumber1: s?.contactNumber1,
        contactNumber2: s?.contactNumber2,
      });
    } catch {}
  }
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
  // Prefer media URL over potentially seeded placeholder profilePhotoUrl
  const mediaFirst = (user?.profile?.profilePhotoMedia?.url || user?.profile?.profilePhotoUrl || undefined) as any;
  photoUrl = mediaFirst;
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
  photoUrl = (uRef?.profile?.profilePhotoMedia?.url || uRef?.profile?.profilePhotoUrl || photoUrl) as any;
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
  // Generate inline QR SVG targeting public verification URL (configurable)
  const publicIdBase = (process.env.PUBLIC_IDCARD_BASE_URL || 'https://humanrightscouncilforindia.org/idcard').replace(/\/$/, '');
  // Use server origin for local asset/QR endpoints; do NOT use settings URL here
  const baseHost = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  const landingUrl = `${publicIdBase}/${encodeURIComponent(card.cardNumber)}`;
  let qrSvg = '';
  try {
    qrSvg = await QRCode.toString(landingUrl, { type: 'svg', margin: 0, width: 160 });
  } catch {
    qrSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='10'>QR</text></svg>`;
  }
  // Helper to read template either from dist or src
  const readTemplate = (name: string) => {
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
  const normalizeUrl = (u?: string | null) => {
    const t = (u || '').toString().trim();
    if (!t) return '';
    // Protocol-relative URLs (//host/path) -> assume https for safety
    if (/^\/\//.test(t)) return `https:${t}`;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^\//.test(t)) return `${baseHost}${t}`;
    return t;
  };

  // Server-side helper: fetch an image URL and return a data URL (base64). Returns null on failure.
  const toDataUrl = async (u?: string | null): Promise<string | null> => {
    try {
      const url = (u || '').toString().trim();
      if (!url || url.startsWith('data:')) return url || null;
      const resp = await fetch(url as any);
      if (!resp.ok) return null;
      const buf = new Uint8Array(await resp.arrayBuffer());
      const mime = resp.headers.get('content-type') || 'image/png';
      // base64 encode
      let binary = '';
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      const b64 = Buffer.from(binary, 'binary').toString('base64');
      return `data:${mime};base64,${b64}`;
    } catch {
      return null;
    }
  };

  // Compose common values
  const colorsStyle = `<style>:root{--primary:${primary};--secondary:${secondary}}</style>`;
  const issuedAt = fmt(card.issuedAt);
  const expiresAt = fmt(card.expiresAt);
  const footer = s?.frontFooterText || '';
  const side = String(req.query.side || '').toLowerCase();
  const designVariant = String(req.query.design || '').toLowerCase();

  // Compute a simple Work Place string from membership location
  let workPlace: string = '';
  try {
    if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
      const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
      const st = dist?.stateId ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
      workPlace = [dist?.name, st?.name].filter(Boolean).join(', ');
    } else if (membershipLevel === 'STATE' && hrcStateId) {
      const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } }); workPlace = st?.name || '';
    } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
      const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
      const dist = mandal?.districtId ? await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } }) : null;
      const st = dist?.stateId ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
      workPlace = [mandal?.name, dist?.name, st?.name].filter(Boolean).join(', ');
    }
  } catch {}

  // Allow overriding member photo in HTML using any of these query keys:
  // photoUrl, profilePhotoUrl, photo, img, image, avatar, pp
  try {
    const pickFirst = (v: any) => Array.isArray(v) ? v[0] : v;
    const keys = ['photoUrl','profilePhotoUrl','photo','img','image','avatar','pp'];
    let override: string | undefined;
    for (const k of keys) {
      if (req.query[k] != null) {
        const raw = pickFirst(req.query[k]);
        if (raw != null) {
          const val = String(raw).trim();
          if (val) { override = val; break; }
        }
      }
    }
    if (override) {
      if (/^\//.test(override)) override = `${baseHost}${override}`;
      photoUrl = override;
    }
    // Also allow overriding author sign via query (sign, signUrl, signature, authorSign, authorSignUrl)
    const signKeys = ['sign','signUrl','signature','authorSign','authorSignUrl'];
    let signOverride: string | undefined;
    for (const k of signKeys) {
      if (req.query[k] != null) {
        const raw = pickFirst(req.query[k]);
        if (raw != null) {
          const val = String(raw).trim();
          if (val) { signOverride = val; break; }
        }
      }
    }
    if (signOverride) {
      if (/^\//.test(signOverride)) signOverride = `${baseHost}${signOverride}`;
      // set into a mutable holder so template below uses override
      (global as any).__hrciSignOverride = signOverride;
    }
  } catch {}

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
  const inlineQr = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
  const expiresDdMmYyyy = card.expiresAt ? (() => { const d=new Date(card.expiresAt as any); return isNaN(d.getTime())? '' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })() : '';
  // Simple inline SVG fallbacks (data URI) to avoid broken image icons
  const svgPlaceholder = (text: string, w = 120, h = 120) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Verdana' font-size='14' fill='#555'>${text}</text></svg>`)}`;
  const trimOrNull = (v?: string | null) => { if (typeof v !== 'string') return v || null; const t = v.trim(); return t ? t : null; };
  const logoUrl = trimOrNull(s?.frontLogoUrl) || svgPlaceholder('Logo');
  const secondLogoUrl = trimOrNull(s?.secondLogoUrl) || logoUrl;
  const stampUrl = trimOrNull(s?.hrciStampUrl) || svgPlaceholder('Stamp', 140, 140);
  let authorSignUrl = trimOrNull(s?.authorSignUrl) || svgPlaceholder('Sign', 160, 60);
  // Optional watermark configured in IdCardSetting.watermarkLogoUrl (png/webp). Normalize to absolute when needed.
  // Optional override via query: ?watermark=<url>
  const wmOverride = (() => { try { const v = String((req.query as any)?.watermark || '').trim(); return v || null; } catch { return null; } })();
  const watermarkUrlRaw = wmOverride || trimOrNull(s?.watermarkLogoUrl) || trimOrNull(s?.secondLogoUrl) || trimOrNull(s?.frontLogoUrl) || null;
  let watermarkUrl = watermarkUrlRaw;
  if (watermarkUrl && /^\//.test(watermarkUrl)) watermarkUrl = `${baseHost}${watermarkUrl}`;
  // Normalize all asset URLs to absolute (except data: URIs) so they can be fetched/inlined server-side
  const toAbs = (u?: string | null) => normalizeUrl(u || '');
  let logoSrc = toAbs(logoUrl);
  let secondLogoSrc = toAbs(secondLogoUrl);
  let stampSrc = toAbs(stampUrl);
  let signSrcEff = toAbs((global as any).__hrciSignOverride || authorSignUrl || '');
  let photoSrc = toAbs(photoUrl || '');
  let wmSrc = toAbs(watermarkUrl || '');
  // Optional server-side pre-inlining for CR80 when PDF_INLINE_IMAGES is set
  if (process.env.PDF_INLINE_IMAGES) {
    try {
      const [l, sl, st, sg, ph, wm] = await Promise.all([
        toDataUrl(logoSrc),
        toDataUrl(secondLogoSrc),
        toDataUrl(stampSrc),
        toDataUrl(signSrcEff),
        toDataUrl(photoSrc),
        toDataUrl(wmSrc)
      ]);
      if (l) logoSrc = l;
      if (sl) secondLogoSrc = sl;
      if (st) stampSrc = st;
      if (sg) signSrcEff = sg;
      if (ph) photoSrc = ph;
      if (wm) wmSrc = wm;
      if (process.env.PDF_DEBUG) {
        try { console.log('[IDCARD][CR80][inline]', { logo: !!l, secondLogo: !!sl, stamp: !!st, sign: !!sg, photo: !!ph, watermark: !!wm }); } catch {}
      }
    } catch (e) {
      if (process.env.PDF_DEBUG) {
        try { console.warn('[IDCARD][CR80][inline-failed]', (e as any)?.message || e); } catch {}
      }
    }
  }
  // Original CR80 watermark size was 70mm x 40mm; reduced to 20% (14mm x 8mm)
  // Updated CR80 watermark target size: 30mm x 30mm, higher opacity for visibility
  const watermarkCss = `.watermark{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0;opacity:0.30;display:flex;align-items:center;justify-content:center;width:30mm;height:30mm;} .watermark img, img.watermark{max-width:100%;max-height:100%;object-fit:contain;filter:sepia(1) saturate(5) hue-rotate(10deg) brightness(1.05) contrast(1.1);}`;
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
<style>${watermarkCss}</style>
<style>.front .body,.back .body{background:#fff} .band-blue p{line-height:2.4mm}</style>
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
    ${watermarkUrl ? `<div class=\"watermark\" aria-hidden=\"true\"><img src=\"${watermarkUrl}\" alt=\"Watermark\" style=\"width:30mm;height:30mm;opacity:.30\"/></div>` : ''}
    <div class="juris-wrap">
      <p class="juris">ALL INDIA JURISDICTION</p>
      <p class="niti1">REGD BY GOVT OF \"NITI AAYOG\"</p>
      <p class="niti2">UNIQUE ID: AP/2022/0324217, AP/2022/0326782</p>
      <p class="works">WORKS AGAINST CRIME, VIOLENCE AND CORRUPTION</p>
      <p class="identity">IDENTITY CARD</p>
    </div>

    <div class="main">
      <div>
      <div>
  <img class="logo" src="${logoSrc}" alt="Logo" />
        <img class="qr" src="${inlineQr}" alt="QR" onerror="this.onerror=null;this.src='${qrEndpointUrl}'" />
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
  <div class="row"><span class="lbl">Valid</span><span>:</span><span class="val">${(expiresDdMmYyyy || '-').toUpperCase()}</span></div>
        <div class="row"><span class="lbl">Issue Date</span><span>:</span><span class="val">${(issuedAt || '-').toUpperCase()}</span></div>
      </div>
      <div>
      <div>
        <div class="photo-wrap">
          <img class="photo" src="${photoSrc || svgPlaceholder('Photo')}" alt="Photo" />
          ${stampSrc ? `<img class="stamp" src="${stampSrc}" alt="Stamp" />` : ''}
        </div>
        <div class="sign-wrap">
          <img class="sign" src="${signSrcEff}" alt="Author Sign" />
          <div class="sign-label">Signature Issue Auth.</div>
        </div>
      </div>
    </div>
  </div>
  .band-red h1 { margin:0; font:900 5.2mm/1 Verdana,Arial,sans-serif; letter-spacing:0.15mm; text-align:center; text-transform:uppercase; white-space:nowrap; overflow:hidden;}
  .front .stamp { position:absolute; left:1mm; bottom:1mm; width:14mm; height:14mm; border-radius:50%; object-fit:cover; background:transparent; box-shadow:0 0 0.4mm rgba(0,0,0,.15);}  
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
  ${watermarkUrl ? `<div class=\"watermark\" aria-hidden=\"true\"><img src=\"${watermarkUrl}\" alt=\"Watermark\" style=\"width:30mm;height:30mm;opacity:.30\"/></div>` : ''}
  <div class="row-main">
  <div><img class="qr" src="${inlineQr}" alt="QR" onerror="this.onerror=null;this.src='${qrEndpointUrl}'" /></div>
      <div class="reg">
        ${registrationLinesBack.map(l=>`<p class=\"line\">${l}</p>`).join('')}
        <p class="terms-title">Terms &amp; Conditions</p>
${termsHtml}
        ${headOfficeAddress ? `<p class="addr-label">HEAD OFFICE</p><p class="addr">${headOfficeAddress}</p>`: ''}
        ${regionalOfficeAddress ? `<p class="addr-label">REGIONAL OFFICE</p><p class="addr">${regionalOfficeAddress}</p>`: ''}
        ${administrationOfficeAddress ? `<p class="addr-label">ADMINISTRATION OFFICE</p><p class="addr">${administrationOfficeAddress}</p>`: ''}
        ${website ? `<p class="web">${website}</p>`: ''}
      </div>
  <div><img class="logo" src="${secondLogoSrc}" alt="Logo" /></div>
    </div>
  </div>
  <div class="footer-blue"><p>${contactFooter}</p></div>
 </section>

${(() => {
  const dbg = String(req.query.debug || '').toLowerCase();
  if (dbg === '1' || dbg === 'true') {
    const info: Record<string, any> = {
      cardNumber: card.cardNumber,
      membershipLevel,
      zoneValue,
      hrcCountryId,
      hrcStateId,
      hrcDistrictId,
      hrcMandalId,
      fullName,
      designationName,
      cellName,
      photoUrl: photoUrl || null,
      settingAssets: {
        frontLogoUrl: s?.frontLogoUrl || null,
        secondLogoUrl: s?.secondLogoUrl || null,
        hrciStampUrl: s?.hrciStampUrl || null,
        authorSignUrl: s?.authorSignUrl || null
      }
    };
    const safeJson = JSON.stringify(info, null, 2).replace(/</g,'&lt;');
    return `<pre style="position:fixed;top:4px;left:4px;z-index:9999;background:rgba(0,0,0,.75);color:#0f0;padding:8px;max-width:340px;font-size:11px;line-height:1.2;white-space:pre-wrap;border:1px solid #0f0">${safeJson}</pre>`;
  }
  return '';
})()}
</div>

</body>
</html>`;
    return html;
  };

  // New: Attached design (Poppins-based) front+back builder
  const buildAttached = async () => {
    // Simple inline SVG placeholders 
    const svgPlaceholder = (text: string, w = 120, h = 80) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Verdana' font-size='14' fill='#555'>${text}</text></svg>`)}`;
    
    // Compute location display similar to CR80
    let memberLocationName: string | undefined;
    try {
      if (membershipLevel === 'NATIONAL') {
        if (hrcCountryId) {
          const c = await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } });
          memberLocationName = c?.name || 'India';
        } else memberLocationName = 'India';
      } else if (membershipLevel === 'ZONE') {
        const c = hrcCountryId ? await (prisma as any).hrcCountry.findUnique({ where: { id: hrcCountryId } }) : null;
        // Reuse CR80 prefix for zone title
        const zmap: Record<string,string> = { NORTH:'North Zone', SOUTH:'South Zone', EAST:'East Zone', WEST:'West Zone', CENTRAL:'Central Zone' };
        const zoneTitle = zoneValue ? (zmap[String(zoneValue).toUpperCase()] || `${String(zoneValue).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} Zone`) : 'Zone';
        // For display as Work Place, use Country name only for Zone
        memberLocationName = c?.name || 'India';
      } else if (membershipLevel === 'STATE' && hrcStateId) {
        const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
        memberLocationName = st?.name;
      } else if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
        const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
        if (dist) {
          const st = await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } });
          // For Work Place, show district name only
          memberLocationName = dist?.name || st?.name || undefined;
        }
      } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
        const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
        if (mandal) {
          const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } });
          const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
          // For Work Place, show mandal name only
          memberLocationName = mandal?.name || dist?.name || st?.name || undefined;
        }
      }
    } catch {}

  const qrEndpointUrl = `${baseHost}/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
  const inlineQr = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
  const logoUrl = normalizeUrl(s?.frontLogoUrl || '') || svgPlaceholder('Logo', 120, 80);
  const secondLogoUrl = normalizeUrl(s?.secondLogoUrl || s?.frontLogoUrl || '') || svgPlaceholder('Logo', 120, 80);
  // Back logo should match frontLogoUrl per request (fallback secondLogo)
  const backLogoUrl = logoUrl || secondLogoUrl;
    const stampUrl = normalizeUrl(s?.hrciStampUrl || '') || svgPlaceholder('Stamp', 120, 120);
    const authorSign = normalizeUrl((global as any).__hrciSignOverride || s?.authorSignUrl || '') || svgPlaceholder('Sign', 160, 60);
  // Unified effective Work Place rule for Attached
  const workPlace = (() => {
    const lvl = String(membershipLevel || '').toUpperCase();
    if (lvl === 'NATIONAL' || lvl === 'ZONE') return (memberLocationName || 'India');
    return memberLocationName || '';
  })();
    const helpNumbers = [s?.contactNumber1, s?.contactNumber2].filter(Boolean).join(', ') || '+91-XXXX-XXXX-XX';
    const headAddr = s?.headOfficeAddress || 'Head Office Address Not Available';
    const regAddr = s?.regionalOfficeAddress || 'Regional Office Address Not Available';
    const adminAddr = s?.administrationOfficeAddress || 'Administration Office Address Not Available';
  let watermarkSrc = normalizeUrl(s?.watermarkLogoUrl || s?.secondLogoUrl || '') || '';
  if (!watermarkSrc) {
    // Use a default watermark if none configured
    watermarkSrc = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><circle cx='50' cy='50' r='45' fill='none' stroke='#ddd' stroke-width='3'/><text x='50' y='55' text-anchor='middle' font-family='serif' font-size='12' fill='#999'>HRCI</text></svg>`);
  }

  const attachedCss = `body{margin:0;padding:8mm;background:#f4f4f4;display:flex;gap:8mm;flex-wrap:wrap;justify-content:flex-start} .card{width:85.6mm;height:54mm;background:#fff;border-radius:0mm;box-shadow:0 0 5px rgba(0,0,0,0.2);overflow:hidden;font-family:'Poppins',sans-serif;position:relative} .strip-top{background:#FE0002;height:6.35mm;color:#fff;display:flex;justify-content:center;align-items:center;font-weight:700;text-transform:uppercase;font-size:9pt} .strip-blue{background:#1D0DA1;height:6.35mm;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font-size:4.5pt;line-height:1.05;font-weight:600;text-transform:uppercase;padding-top:0.2mm} .center{display:flex;justify-content:space-between;align-items:flex-start;height:36.7mm;padding:2mm;position:relative} .left{width:19mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start} .left img{width:13mm;margin-bottom:2mm;display:block} .middle{flex:1;padding:0 1mm;font-size:4.8pt;line-height:1.3;box-sizing:border-box} .jurisdiction{font-weight:700;font-size:8pt;color:#000;text-align:center;margin-bottom:0.4mm;width:100%;display:flex;justify-content:center;align-items:center} .regd,.unique,.work-against,.identity{display:block;text-transform:uppercase;white-space:nowrap;text-align:center;margin-bottom:0.25mm} .unique{font-size:5pt;color:#000;font-weight:600} .work-against{color:#FE0002;font-size:4pt;font-weight:700} .identity{color:#FE0002;font-size:6pt;font-weight:700} .member-info{margin-top:1mm;font-size:4.5pt;text-align:left;line-height:1.5;width:calc(100% - 20mm)} .member-info div{display:grid;grid-template-columns:14mm 1.5mm auto;align-items:center} .member-info .label{font-weight:600;text-align:left} .member-info .colon{text-align:center} .member-info .value{text-align:left;white-space:nowrap;overflow:visible;text-overflow:unset} .right{width:18mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;margin-right:2mm;margin-top:4mm;position:relative} .member-photo{width:16.5mm;height:21mm;border-radius:3mm;border:1px solid #ccc;object-fit:cover} .sign-img{position:absolute;width:11mm;bottom:-10mm;opacity:0.9} .signature-text{font-weight:700;font-size:5pt;color:#000;text-align:center;position:absolute;bottom:-9mm;width:100%} .stamp{position:absolute;width:9mm;bottom:-3mm;left:-3mm;opacity:0.9} .strip-bottom{background:#FE0002;height:4.6mm;color:#fff;font-size:4.5pt;text-align:center;display:flex;align-items:center;justify-content:center;white-space:nowrap;position:absolute;bottom:0;width:100%} /* back */ html,body{height:auto} .back-center{position:absolute;top:6.35mm;left:0;right:0;bottom:4.6mm;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;padding:2.5mm;box-sizing:border-box;background:#fff;z-index:4} .back-strip-top{height:6.35mm;background:linear-gradient(to bottom,#FE0002 0%,#FE0002 49.999%,#1D0DA1 50%,#1D0DA1 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;text-transform:uppercase;font-size:9pt;padding:0 4mm;position:absolute;top:0;left:0;right:0;z-index:5} .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30mm;height:30mm;opacity:0.30;pointer-events:none;z-index:3;object-fit:contain} .qr-large{position:absolute;top:2mm;left:2mm;width:12mm;height:12mm;border:1px solid #e0e0e0;display:block;margin:0;z-index:6} .registration-text,.terms,.office-address{position:relative;z-index:5} .registration-text{font-size:4.2pt;line-height:1.5;color:#000;font-weight:600;text-transform:uppercase;margin-left:16mm;margin-top:0} .terms{margin-left:2mm;margin-top:1mm;font-size:4pt;color:#000} .terms strong{color:#FE0002;font-weight:700} .terms ol{margin:0;padding-left:2mm} .terms li{margin:0} .office-address{margin-top:1mm;font-size:4pt;line-height:1;text-align:center} .office-address strong{display:block;color:#000;font-weight:700;margin-bottom:0.2mm;text-align:center} .hrci-logo-right{position:absolute;top:2mm;right:4mm;width:12mm;height:12mm;opacity:1;z-index:6;object-fit:contain} .back-strip-bottom{position:absolute;bottom:0;left:0;right:0;background:#FE0002;height:4.6mm;color:#fff;display:flex;align-items:center;justify-content:center;font-size:4.5pt;text-align:center;padding:0 3mm;z-index:6} .watermark img, img.watermark{max-width:100%;max-height:100%;object-fit:contain;filter:sepia(1) saturate(5) hue-rotate(10deg) brightness(1.05) contrast(1.1)}`;

    const scale = Math.max(0.5, Math.min(2, Number(req.query.scale || 1))) || 1;
    const frontHtml = `
    <div class="card" style="${'transform:scale(' + scale + '); transform-origin: top left;'}">
  ${watermarkSrc ? `<img class="watermark" src="${watermarkSrc}" alt="watermark" style="top:55%;width:30mm;height:30mm;opacity:.30"/>` : ''}
      <div class="strip-top">Human Rights Council for India (HRCI)</div>
      <div class="strip-blue">
        REGISTERED BY NCT, NEW DELHI, GOVT OF INDIA<br>
        REGISTERED NO: 4396/2022 (UNDER TRUST ACT 1882)<br>
        TO PROTECT & PROMOTE THE HUMAN RIGHTS
      </div>
      <div class="center">
        <div class="left">
          <img id="frontLogo" src="${logoUrl}" alt="Logo" onerror="this.src='${svgPlaceholder('Logo')}';this.onerror=null;">
          <img src="${inlineQr}" alt="QR Code" onerror="this.onerror=null;this.src='${qrEndpointUrl}'">
        </div>
        <div class="middle">
          <span class="jurisdiction">ALL INDIA JURISDICTION</span>
          <span class="regd">REGD BY GOVT OF NITI AAYOG</span>
          <span class="unique">UNIQUE ID: AP/2022/0324217, AP/2022/0326782</span>
          <span class="work-against">WORKS AGAINST CRIME, VIOLENCE AND CORRUPTION</span>
          <span class="identity">IDENTITY CARD</span>
          <div class="member-info">
            <div><span class="label">Name</span><span class="colon">:</span><span class="value">${(fullName || '-').toString().toUpperCase()}</span></div>
            <div><span class="label">Designation</span><span class="colon">:</span><span class="value">${(designationName || '-').toString().toUpperCase()}</span></div>
            ${cellName ? `<div><span class=\"label\">Cell</span><span class=\"colon\">:</span><span class=\"value\">${String(cellName).toUpperCase()}</span></div>` : ''}
            ${workPlace ? `<div><span class=\"label\">Work Place</span><span class=\"colon\">:</span><span class=\"value\">${String(workPlace).toUpperCase()}</span></div>` : ''}
            <div><span class="label">ID No</span><span class="colon">:</span><span class="value">${String(card.cardNumber || '').toUpperCase()}</span></div>
            <div><span class="label">Contact No</span><span class="colon">:</span><span class="value">${String(mobileNumber || '-').toUpperCase()}</span></div>
            <div><span class="label">Valid Upto</span><span class="colon">:</span><span class="value" style="color:#FE0002;font-weight:700">${(() => { try { const dt=new Date(expiresAt); if(isNaN(dt.getTime())) return '-'; const dd=String(dt.getDate()).padStart(2,'0'); const mm=String(dt.getMonth()+1).padStart(2,'0'); const yyyy=dt.getFullYear(); return `${dd}/${mm}/${yyyy}`.toUpperCase(); } catch { return '-'; } })()}</span></div>
          </div>
        </div>
        <div class="right">
          <img class="member-photo" src="${photoUrl || svgPlaceholder('Photo', 140, 180)}" alt="Member Photo" onerror="this.src='${svgPlaceholder('Photo', 140, 180)}';this.onerror=null;">
          <img class="sign-img" src="${authorSign}" alt="Authorized Signature" onerror="this.src='${svgPlaceholder('Sign', 160, 60)}';this.onerror=null;">
          <div class="signature-text">Signature Auth.</div>
          <img class="stamp" src="${stampUrl}" alt="HRCI Stamp" onerror="this.src='${svgPlaceholder('Stamp', 120, 120)}';this.onerror=null;">
        </div>
      </div>
      <div class="strip-bottom">We take help 24x7 From (Police, CBI, Vigilance, NIA) & other Govt. Dept. Against Crime & Corruption.</div>
    </div>`;

    const backHtml = `
    <div class="card" style="${'transform:scale(' + scale + '); transform-origin: top left;'}">
      <div class="back-strip-top">Human Rights Council for India (HRCI)</div>
      <div class="back-center">
  <img class="watermark" src="${watermarkSrc}" alt="watermark" style="top:55%;width:30mm;height:30mm;opacity:.30"/>
        <div class="registration-text">
          REGISTERED BY MINISTRY OF CORPORATE AFFAIRS, INDIA<br>
          REGD NO: CSR0036936 OF "HRCI", CSR 00038592 OF "HRCI"<br>
          REGD NO: BK-IV-46/2022 "HRCI" ISO CERTIFICATE NO: ΙΝΟ/ΑΡ12129/0922<br>
          REGD UNDER "UDYAM" NO: AP-21-0001051, AP-21-0001502 "HRCI"<br>
          REGD BY: MINISTRY OF SOCIAL JUSTICE AND EMPOWERMENT<br>
          GOVT OF INDIA REGD BY AP/00036080
        </div>
  <img class="qr-large" src="${inlineQr}" alt="QR Code" onerror="this.onerror=null;this.src='${qrEndpointUrl}'" />
        <div class="terms">
          <strong>Terms & Conditions:-</strong>
          <ol>
            ${(terms && terms.length ? terms : [
              'This card is the property of HRCI and must be returned upon request to HRCI management.',
              'This card can be withdrawn any time without notice.',
              'Use this card as per the terms and conditions of the card holder agreement.',
              'If found please return this card to nearest police station or HRCI office.'
            ]).map(t=>`<li>${String(t)}</li>`).join('')}
          </ol>
          <hr style='border:0;border-top:0.3mm solid #000;margin:1mm 0;'>
          <div class="office-address">
            <p><strong>Head Office:</strong> ${headAddr}</p>
            <p><strong>Regional Office:</strong> ${regAddr}</p>
            <p><strong>Administration Office:</strong> ${adminAddr}</p>
          </div>
        </div>
  <img id="backLogo" src="${backLogoUrl}" alt="Logo" class="hrci-logo-right" onerror="this.src='${svgPlaceholder('Logo')}';this.onerror=null;"/>
      </div>
      <div class="back-strip-bottom"><span class="help-label">Help Line Number:</span> ${helpNumbers}</div>
    </div>`;

    // Full document
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>ID Card ${card.cardNumber}</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap" rel="stylesheet"><style>${attachedCss}</style></head><body>${frontHtml}${backHtml}</body></html>`;
  };

  // External CSS for CR80 design (inlined for single document)
  const cr80Css = `  @page {\n    size: 85.6mm 54mm;\n    margin: 0;\n  }\n  html, body {\n    margin: 0;\n    padding: 0;\n    background: #f3f4f6;\n  }\n  :root {\n    --card-w: 85.6mm;\n    --card-h: 54mm;\n    --red: #FE0002;\n    --blue: #17007A;\n    --text: #111827;\n    --muted-bg: #F3F4F6;\n    --top-band: 6.1mm;\n    --blue-band: 6.1mm;\n    --bottom-band: 4.6mm;\n    --body-h: calc(var(--card-h) - var(--top-band) - var(--blue-band) - var(--bottom-band));\n  }\n  .page {\n    width: var(--card-w);\n    height: var(--card-h);\n    overflow: hidden;\n    page-break-after: always;\n    background: var(--muted-bg);\n    border: 0.2mm solid #e5e7eb;\n    box-sizing: border-box;\n    position: relative;\n  }\n  .page:last-child { page-break-after: auto; }\n  .band-red {\n    height: var(--top-band);\n    background: var(--red);\n    color: #fff; display:flex;align-items:center;justify-content:center;\n    padding:0 2mm; box-sizing:border-box;\n  }\n  .band-red h1 { margin:0; font:900 5.4mm/1 Verdana,Arial,sans-serif; letter-spacing:0.2mm; text-align:center; text-transform:uppercase; white-space:nowrap; overflow:hidden;}\n  .band-blue { height: var(--blue-band); background: var(--blue); color:#fff; display:flex;align-items:center;justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .band-blue p { margin:0; font:700 2.2mm/3.0mm Verdana,Arial,sans-serif; letter-spacing:0.1mm; text-align:center;}\n  .footer-red { position:absolute; left:0; right:0; bottom:0; height:var(--bottom-band); background:var(--red); color:#fff; display:flex;align-items:center;justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .footer-red p { margin:0; font:800 2mm/1 Verdana,Arial,sans-serif; text-align:center; letter-spacing:0.05mm;}\n  .front .body { position:absolute; top:calc(var(--top-band) + var(--blue-band)); left:0; right:0; height:var(--body-h); padding:1.2mm 2mm 0 2mm; box-sizing:border-box;}\n  .front .juris-wrap { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; margin-top:0.8mm;}\n  .front .juris { margin:0.3mm 0 0 0; font:900 3.2mm/3.8mm Verdana,Arial,sans-serif; color:#000; letter-spacing:0.1mm;}\n  .front .niti1 { margin:0.2mm 0 0 0; font:800 2.2mm/2.8mm Verdana,Arial,sans-serif; color:#000;}\n  .front .niti2 { margin:0.1mm 0 0 0; font:700 2mm/2.5mm Verdana,Arial,sans-serif; color:#000;}\n  .front .works { margin:0.2mm 0 0 0; font:800 1.9mm/2.6mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .identity { margin:0.2mm 0 0 0; font:900 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .main { display:grid; grid-template-columns:18mm auto 26mm; grid-gap:1.2mm; align-items:start; margin-top:1.4mm;}\n  .front .logo { width:13.5mm; height:13.5mm; object-fit:cover; border:0.4mm solid #fff; background:#fff; display:block; margin-bottom:1.2mm;}\n  .front .qr { width:14mm; height:14mm; object-fit:contain; display:block;}\n  .front .details { background:#F3F4F6; border:0.2mm solid #e5e7eb; border-radius:1.8mm; padding:2mm 2.2mm;}\n  .front .cell { margin:0 0 0.8mm 0; font:800 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--blue);}\n  .front .name { margin:0 0 0.8mm 0; font:800 3.0mm/3.6mm Verdana,Arial,sans-serif; color:var(--text);}\n  .front .desig { margin:0 0 1.2mm 0; font:700 2.4mm/3.0mm Verdana,Arial,sans-serif; color:var(--red);}\n  .front .row { display:grid; grid-template-columns:15mm 2mm auto; align-items:center; column-gap:1mm; margin:0.6mm 0;}\n  .front .lbl { font:900 2.2mm/3.0mm Verdana,Arial,sans-serif; color:var(--text);}\n  .front .val { font:800 2.2mm/3.0mm Verdana,Arial,sans-serif; color:var(--text); overflow:hidden; white-space:nowrap; text-overflow:ellipsis;}\n  .front .photo-wrap { position:relative; width:24mm; height:28mm; border:0.2mm solid #e5e7eb; background:#fff; display:flex; align-items:center; justify-content:center;}\n  .front .photo { width:calc(100% - 1mm); height:calc(100% - 1mm); object-fit:cover;}\n  .front .stamp { position:absolute; right:1mm; bottom:1mm; width:14mm; height:14mm; border-radius:50%; object-fit:cover; background:transparent; box-shadow:0 0 0.4mm rgba(0,0,0,.15);}\n  .front .sign-wrap { margin-top:1mm; display:flex; flex-direction:column; align-items:center;}\n  .front .sign { width:22mm; height:10mm; object-fit:contain; background:transparent;}\n  .front .sign-label { margin-top:-1.2mm; font:900 2mm/1 Verdana,Arial,sans-serif; color:var(--blue);}\n  .back .body { position:absolute; top:var(--top-band); left:0; right:0; height:calc(var(--card-h) - var(--top-band)); box-sizing:border-box; padding:1.2mm 2mm var(--bottom-band) 2mm;}\n  .back .row-main { display:grid; grid-template-columns:16mm auto 16mm; grid-gap:1.2mm; align-items:start; margin-top:2mm;}\n  .back .qr { width:13mm; height:13mm; object-fit:contain;}\n  .back .logo { width:13mm; height:13mm; object-fit:cover; display:block; margin-left:auto;}\n  .back .reg { text-align:center; color:var(--text);}\n  .back .reg .line { margin:0.4mm 0; font:800 2.2mm/2.8mm Verdana,Arial,sans-serif;}\n  .back .terms-title { margin:1mm 0 0.6mm 0; font:900 2.2mm/2.8mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .term { margin:0.3mm 0; font:700 1.8mm/2.4mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .addr-label { margin:0.6mm 0 0.2mm 0; font:900 2mm/2.6mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .addr { margin:0 0 0.4mm 0; font:700 1.8mm/2.4mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .web { margin:0.6mm 0 0 0; font:800 2mm/2.6mm Verdana,Arial,sans-serif; text-align:center;}\n  .back .footer-blue { position:absolute; left:0; right:0; bottom:0; height:var(--bottom-band); background:var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; padding:0 2mm; box-sizing:border-box;}\n  .back .footer-blue p { margin:0; font:800 2mm/1 Verdana,Arial,sans-serif; text-align:center;}\n`;

  // FRONT
  const buildFront = async () => {
    const orientation = String(req.query.orientation || '').toLowerCase();
    const isVertical = orientation === 'vertical' || orientation === 'portrait';
    // Always use the new HTML+CSS front template
    let html = readTemplate('hrci_id_card_front_html_css.html');
    html = html.replace('</head>', `${colorsStyle}</head>`);
    // Watermark for Poppins front: allow override via ?watermark, fallback to setting
    try {
      const wmOverride = (() => { try { const v = String((req.query as any)?.watermark || '').trim(); return v || null; } catch { return null; } })();
      const raw = wmOverride || (s?.watermarkLogoUrl || s?.secondLogoUrl || s?.frontLogoUrl || '');
      const wmUrl = normalizeUrl(raw);
      if (wmUrl) {
        // Add minimal styling for front watermark (centered inside .card)
  // Original Poppins front watermark size 70mm x 40mm; shrink to 14mm x 8mm (20%)
  html = html.replace('</head>', `<style>.watermark{position:absolute;left:50%;top:55%;transform:translate(-50%,-50%);pointer-events:none;z-index:0;opacity:0.30;width:30mm;height:30mm;display:flex;align-items:center;justify-content:center} .watermark img, img.watermark{max-width:100%;max-height:100%;object-fit:contain;filter:sepia(1) saturate(5) hue-rotate(10deg) brightness(1.05) contrast(1.1);}</style></head>`);
        html = html.replace('<div class="card">', `<div class="card"><div class="watermark"><img src="${wmUrl}" alt="watermark"/></div>`);
      }
    } catch {}
    // Simple inline SVG placeholders for legacy templates
    const svgPlaceholder = (text: string, w = 120, h = 80) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#fff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Verdana' font-size='14' fill='#555'>${text}</text></svg>`)}`;
    // Add onerror fallback to secondLogo/front if primary fails
    let frontLogoSrc = normalizeUrl(s?.frontLogoUrl) || normalizeUrl(s?.secondLogoUrl) || svgPlaceholder('Logo');
    // Server-side pre-inline critical images when PDF_INLINE_IMAGES is set
    if (process.env.PDF_INLINE_IMAGES) {
      const inlined = await toDataUrl(frontLogoSrc);
      if (inlined) frontLogoSrc = inlined;
    }
  html = setAttr(html, 'frontLogo', 'src', frontLogoSrc);
  html = html.replace(/id=\"frontLogo\"([^>]*?)>/, (m, rest) => `id="frontLogo"${rest} onerror="this.onerror=null;this.src='${normalizeUrl(s?.secondLogoUrl) || svgPlaceholder('Logo')}'">`);
    // Prefer inline SVG via data URL to avoid mixed-content/CSP/network blockers
    try {
      const qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
      html = setAttr(html, 'qrFront', 'src', qrDataUrl);
      // Fallback to relative QR endpoint if the data URI fails in any client
      const relQr = `/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
      html = html.replace(/id=\"qrFront\"([^>]*?)>/, (m, rest) => `id="qrFront"${rest} onerror="this.onerror=null;this.src='${relQr}'">`);
    } catch {
      // As a safety net, use a relative endpoint (avoids protocol/host mismatches)
      const relQr = `/hrci/idcard/${encodeURIComponent(card.cardNumber)}/qr`;
      html = setAttr(html, 'qrFront', 'src', relQr);
      html = html.replace(/id=\"qrFront\"([^>]*?)>/, (m, rest) => `id="qrFront"${rest} onerror="this.onerror=null;this.src='${relQr}'">`);
    }
    let photoSrc = normalizeUrl(photoUrl || '') || svgPlaceholder('Photo', 140, 180);
    if (process.env.PDF_INLINE_IMAGES) {
      const inlinedPhoto = await toDataUrl(photoSrc);
      if (inlinedPhoto) photoSrc = inlinedPhoto;
    }
    html = setAttr(html, 'photoUrl', 'src', photoSrc);
    const fmtUpper = (v: any) => (v == null || v === '') ? '-' : String(v).toUpperCase();
    // Format expiresAt to DD/MM/YYYY if parsable
    const fmtDate = (d: any) => {
      try {
        if (!d) return '-';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '-';
        const dd = String(dt.getDate()).padStart(2,'0');
        const mm = String(dt.getMonth()+1).padStart(2,'0');
        const yyyy = dt.getFullYear();
        return `${dd}/${mm}/${yyyy}`.toUpperCase();
      } catch { return '-'; }
    };
    html = replaceIn(html, 'fullName', fmtUpper(fullName));
    html = replaceIn(html, 'mobileNumber', fmtUpper(mobileNumber));
  // Use a formatted designation display (e.g., State Legal Secretary)
  const prefixMap: Record<string,string> = { NATIONAL:'National', ZONE:'', STATE:'State', DISTRICT:'District', MANDAL:'Mandal' };
  const designationDisplay = [prefixMap[String(membershipLevel || '').toUpperCase()] || '', designationName || ''].filter(Boolean).join(' ').trim() || (designationName || '-').toString();
  html = replaceIn(html, 'designationName', fmtUpper(designationDisplay));
  html = replaceIn(html, 'cellName', fmtUpper(cellName));
  // Compute effective Work Place for Poppins
  const effectiveWorkPlace = (() => {
    const lvl = String(membershipLevel || '').toUpperCase();
    if (lvl === 'NATIONAL') {
      // Prefer country from membership; fallback INDIA
      try {
        if (hrcCountryId) return 'INDIA';
        return 'INDIA';
      } catch { return 'INDIA'; }
    }
    if (lvl === 'ZONE') {
      // Work Place should be Country name
      return 'INDIA';
    }
    if (lvl === 'STATE') return String(workPlace || '').split(',')[0] || workPlace || '';
    if (lvl === 'DISTRICT') return String(workPlace || '').split(',')[0] || workPlace || '';
    if (lvl === 'MANDAL') return String(workPlace || '').split(',')[0] || workPlace || '';
    return workPlace || '';
  })();
  html = replaceIn(html, 'workPlace', fmtUpper(effectiveWorkPlace));
  html = replaceIn(html, 'cardNumber', fmtUpper(card.cardNumber));
  html = replaceIn(html, 'validUpto', fmtDate(expiresAt));
    let signSrc = normalizeUrl((global as any).__hrciSignOverride || s?.authorSignUrl || '') || svgPlaceholder('Sign', 160, 60);
    let stampSrc = normalizeUrl(s?.hrciStampUrl || '') || svgPlaceholder('Stamp', 120, 120);
    if (process.env.PDF_INLINE_IMAGES) {
      const [signInline, stampInline] = await Promise.all([toDataUrl(signSrc), toDataUrl(stampSrc)]);
      if (signInline) signSrc = signInline;
      if (stampInline) stampSrc = stampInline;
    }
    html = setAttr(html, 'authorSignUrl', 'src', signSrc);
    html = setAttr(html, 'hrciStampUrl', 'src', stampSrc);
    return html;
  };

  // BACK
  const buildBack = async () => {
    // Use the new HTML+CSS back template
    let html = readTemplate('hrci_id_card_back_html_css.html');
  html = html.replace('</head>', `${colorsStyle}</head>`);
    // Terms list
    const items = terms.length ? terms : [
      'This card is the property of HRCI and must be returned upon request to HRCI management.',
      'This card can be withdrawn any time without notice.',
      'Use this card as per the terms and conditions of the card holder agreement.',
      'If found please return this card to nearest police station or HRCI office.'
    ];
    // Replace the <ol> inside the .terms block regardless of exact attributes/whitespace
    html = html.replace(
      /(\<div\s+class=\"terms\"[\s\S]*?<ol[\s\S]*?>)[\s\S]*?(<\/ol>)/,
      (_m, start, end) => `${start}${items.map(t => `<li>${t}</li>`).join('')}${end}`
    );
    // Addresses & contacts
    html = replaceIn(html, 'headOfficeAddress', String(s?.headOfficeAddress || ''));
    html = replaceIn(html, 'regionalOfficeAddress', String(s?.regionalOfficeAddress || ''));
    html = replaceIn(html, 'administrationOfficeAddress', String(s?.administrationOfficeAddress || ''));
    const contacts = [s?.contactNumber1, s?.contactNumber2].filter(Boolean).join(', ');
    html = replaceIn(html, 'contactNumbers', contacts);
    // Set second logo and watermark if present
    let backPrimary = normalizeUrl(s?.frontLogoUrl) || normalizeUrl(s?.secondLogoUrl) || '';
    const backFallback = normalizeUrl(s?.secondLogoUrl) || normalizeUrl(s?.frontLogoUrl) || '';
    if (process.env.PDF_INLINE_IMAGES) {
      const inlinedBack = await toDataUrl(backPrimary);
      if (inlinedBack) backPrimary = inlinedBack;
    }
    html = setAttr(html, 'secondLogo', 'src', backPrimary);
  html = html.replace(/id=\"secondLogo\"([^>]*?)>/, (m, rest) => `id="secondLogo"${rest} onerror="this.onerror=null;this.src='${backFallback}'">`);
  // Watermark override via ?watermark for back; fallback to settings
  try {
    const wmOverride = (() => { try { const v = String((req.query as any)?.watermark || '').trim(); return v || null; } catch { return null; } })();
    const wmRaw = wmOverride || (s?.watermarkLogoUrl || s?.secondLogoUrl || s?.frontLogoUrl || '');
    let wmSrc = normalizeUrl(wmRaw);
    if (process.env.PDF_INLINE_IMAGES) {
      const wmi = await toDataUrl(wmSrc);
      if (wmi) wmSrc = wmi;
    }
    html = setAttr(html, 'watermark', 'src', wmSrc);
  } catch {
    html = setAttr(html, 'watermark', 'src', (normalizeUrl(s?.watermarkLogoUrl) || normalizeUrl(s?.frontLogoUrl) || normalizeUrl(s?.secondLogoUrl) || ''));
  }
    // QR SVG (scale to container: 12mm)
    // Scale QR to container: force width/height="100%" safely regardless of original quoting
    let qrScaled = qrSvg
      .replace(/width\s*=\s*(['"]).*?\1/i, 'width="100%"')
      .replace(/height\s*=\s*(['"]).*?\1/i, 'height="100%"')
      .replace(/width='?\d+'?/i, 'width="100%"')
      .replace(/height='?\d+'?/i, 'height="100%"');
    // If viewBox missing, add a reasonable default to fit
    if (!/viewBox=/i.test(qrScaled)) {
      qrScaled = qrScaled.replace(/<svg /i, "<svg viewBox=\"0 0 160 160\" ");
    }
    html = html.replace(/<div id=\"qrSvg[^>]*>\s*<\/div>/, `<div id="qrSvg" class="qr-large">${qrScaled}</div>`);
    return html;
  };

  let out = '';
  if (designVariant === 'cr80') {
    out = await buildCr80();
  } else if (designVariant === 'poppins' || designVariant === 'attached' || designVariant === 'v2') {
    // Respect side for poppins/attached when requested (e.g., during PDF generation)
    if (side === 'front') out = await buildFront();
    else if (side === 'back') out = await buildBack();
    else out = await buildAttached();
  } else if (side === 'front') out = await buildFront();
  else if (side === 'back') out = await buildBack();
  else {
    // Combined preview page with both sides; add simple wrapper for spacing
    const [front, back] = await Promise.all([buildFront(), buildBack()]);
    out = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>ID Card ${card.cardNumber}</title>
      <style>body{margin:0;padding:8mm;background:#f5f5f5;display:flex;gap:6mm;flex-wrap:wrap;font-family:Arial,Helvetica,sans-serif} .sheet{box-shadow:0 6px 18px rgba(0,0,0,.15)} @media print{body{background:#fff;padding:0} .sheet{box-shadow:none}}</style>
      </head><body>
      <div class="sheet">${front}</div>
      <div class="sheet">${back}</div>
      </body></html>`;
  }

  // Optional simple debug overlay for combined/template variants: ?debug=1
  try {
    const dbg = String(req.query.debug || '').toLowerCase();
    if (dbg === '1' || dbg === 'true') {
      const debugInfo: any = {
        cardNumber: card.cardNumber,
        membershipLevel,
        fullName,
        designationName,
        cellName,
        photoUrl: photoUrl || null,
        frontLogoUrl: s?.frontLogoUrl || null,
        secondLogoUrl: s?.secondLogoUrl || null,
        authorSignUrl: s?.authorSignUrl || null,
        hrciStampUrl: s?.hrciStampUrl || null
      };
      const safe = JSON.stringify(debugInfo, null, 2).replace(/</g,'&lt;');
      out = out.replace(/<body[^>]*>/i, match => `${match}\n<pre style="position:fixed;top:4px;left:4px;z-index:99999;background:rgba(0,0,0,.8);color:#0f0;padding:8px;font:12px/1.3 monospace;max-width:380px;max-height:90vh;overflow:auto;border:1px solid #0f0">${safe}</pre>`);
    }
  } catch {}
  // Append debug enriched JSON panel when ?full=1 or ?data=1 or ?debugData=1 OR always if user wants "complete data in html view"
  try {
    const wantFull = ['full','data','debugData'].some(k => {
      const v = String(req.query[k] || '').toLowerCase();
      return v === '1' || v === 'true' || v === 'yes' || v === 'all';
    });
    if (wantFull) {
      // Reconstruct enriched JSON (mirrors /hrci/idcard/:cardNumber JSON endpoint)
      const levelLocation: any = { stateId: hrcStateId, districtId: hrcDistrictId, mandalId: hrcMandalId, mandalName: null, districtName: null, stateName: null };
      try {
        if (membershipLevel === 'STATE' && hrcStateId) {
          const st = await (prisma as any).hrcState.findUnique({ where: { id: hrcStateId } });
          levelLocation.stateName = st?.name || null;
        } else if (membershipLevel === 'DISTRICT' && hrcDistrictId) {
          const dist = await (prisma as any).hrcDistrict.findUnique({ where: { id: hrcDistrictId } });
          const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
          levelLocation.districtName = dist?.name || null;
          levelLocation.stateId = dist?.stateId || levelLocation.stateId;
          levelLocation.stateName = st?.name || null;
        } else if (membershipLevel === 'MANDAL' && hrcMandalId) {
          const mandal = await (prisma as any).hrcMandal.findUnique({ where: { id: hrcMandalId } });
          const dist = mandal ? await (prisma as any).hrcDistrict.findUnique({ where: { id: mandal.districtId } }) : null;
          const st = dist ? await (prisma as any).hrcState.findUnique({ where: { id: dist.stateId } }) : null;
          levelLocation.mandalName = mandal?.name || null;
          levelLocation.districtId = mandal?.districtId || levelLocation.districtId;
          levelLocation.districtName = dist?.name || null;
          levelLocation.stateId = dist?.stateId || levelLocation.stateId;
          levelLocation.stateName = st?.name || null;
        }
      } catch {}
      const titleMap: Record<string,string> = { NATIONAL:'National', ZONE:'Zone', STATE:'State', DISTRICT:'District', MANDAL:'Mandal' };
      const levelTitle = membershipLevel ? (titleMap[membershipLevel.toUpperCase()] || membershipLevel) : null;
      const prefixMap: Record<string,string> = { NATIONAL:'National', ZONE:'', STATE:'State', DISTRICT:'District', MANDAL:'Mandal' };
      const designationDisplay = [prefixMap[membershipLevel?.toUpperCase() || ''] || '', designationName || ''].filter(Boolean).join(' ').trim() || designationName || '';
      const locationTitle = [levelLocation.mandalName, levelLocation.districtName, levelLocation.stateName].filter(Boolean).join(', ');
      const enriched = {
        success: true,
        data: {
          card: {
            id: (card as any).id,
            membershipId: (card as any).membershipId,
            cardNumber: (card as any).cardNumber,
            issuedAt: (card as any).issuedAt,
            expiresAt: (card as any).expiresAt,
            meta: (card as any).meta ?? null,
            status: (card as any).status,
            fullName,
            designationName,
            cellName,
            mobileNumber,
            appointmentLetterPdfUrl: (card as any).appointmentLetterPdfUrl || null,
            appointmentLetterGeneratedAt: (card as any).appointmentLetterGeneratedAt || null,
            createdAt: (card as any).createdAt,
            updatedAt: (card as any).updatedAt,
            membershipLevel,
            levelTitle,
            levelLocation,
            locationTitle,
            memberLocationName: levelLocation.mandalName || levelLocation.districtName || levelLocation.stateName || null,
            designationDisplay,
            designationNameFormatted: designationDisplay,
            profilePhotoUrl: photoUrl || null,
            photoUrl: photoUrl || null
          },
          setting: s || null,
          verifyUrl: `${baseHost}/hrci/idcard/${encodeURIComponent((card as any).cardNumber)}`,
          htmlUrl: `${baseHost}/hrci/idcard/${encodeURIComponent((card as any).cardNumber)}/html`,
          qrUrl: `${baseHost}/hrci/idcard/${encodeURIComponent((card as any).cardNumber)}/qr`
        }
      };
      const safeJson = JSON.stringify(enriched, null, 2).replace(/</g,'&lt;');
      // Insert at end before </body>
      out = out.replace(/<\/body>/i, `<pre id="idcardData" style="position:relative;z-index:9999;box-sizing:border-box;margin:16px;padding:16px;background:#111;color:#0f0;font-size:12px;line-height:1.3;max-width:880px;overflow:auto;border:2px solid #0f0;border-radius:6px">${safeJson}</pre></body>`);
    }
  } catch {}

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
  const idBase = (process.env.PUBLIC_IDCARD_BASE_URL || 'https://humanrightscouncilforindia.org/idcard').replace(/\/$/, '');
  // Public verification URL for QR target
  const url = `${idBase}/${encodeURIComponent(card.cardNumber)}`;
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

// ---- PDF generation helpers and routes ----

// Get Chrome executable path for production environments
const getChromeExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  if (process.env.GOOGLE_CHROME_BIN) {
    return process.env.GOOGLE_CHROME_BIN;
  }
  
  // Common Chrome paths in containerized environments
  if (process.platform === 'linux') {
    const paths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    for (const path of paths) {
      try {
        require('fs').accessSync(path, require('fs').constants.F_OK);
        return path;
      } catch (e) {
        // Continue to next path
      }
    }
  }

  // Fallback: auto-discover Chrome inside Puppeteer cache directory (.cache/puppeteer)
  try {
    const cacheRoot = process.env.PUPPETEER_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'puppeteer');
    const chromeRoot = path.resolve(cacheRoot, 'chrome');
    if (fs.existsSync(chromeRoot)) {
      const entries = fs.readdirSync(chromeRoot).filter(name => {
        try { return fs.statSync(path.join(chromeRoot, name)).isDirectory(); } catch { return false; }
      }).sort((a,b) => a.localeCompare(b));
      // Prefer latest entry
      for (let i = entries.length - 1; i >= 0; i--) {
        const base = path.join(chromeRoot, entries[i]);
        // Windows
        const win64 = path.join(base, 'chrome-win64', 'chrome-win64', 'chrome.exe');
        const win64Alt = path.join(base, 'chrome-win64', 'chrome.exe');
        const win32 = path.join(base, 'chrome-win32', 'chrome.exe');
        // Linux
        const linux64 = path.join(base, 'chrome-linux64', 'chrome');
        const linux = path.join(base, 'chrome-linux', 'chrome');
        // Mac (Chromium builds naming may vary)
        const mac1 = path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
        const mac2 = path.join(base, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');

        const candidates = [win64, win64Alt, win32, linux64, linux, mac1, mac2];
        for (const p of candidates) {
          try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
        }
      }
    }
  } catch {}
  
  return undefined; // Let Puppeteer use its bundled Chrome
};

// Lazy singleton browser to avoid relaunching for each request
let __pdfBrowserPromise: Promise<puppeteer.Browser> | null = null;
const getPdfBrowser = () => {
  if (!__pdfBrowserPromise) {
    const executablePath = getChromeExecutablePath();
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps'
      ],
      ...(executablePath && { executablePath })
    };
    __pdfBrowserPromise = puppeteer.launch(launchOptions);
  }
  return __pdfBrowserPromise;
};

// Render provided HTML to a PDF buffer sized exactly to CR80 card
async function htmlToCardPdf(html: string): Promise<Buffer> {
  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  try {
    // Debug instrumentation: network + console logging when PDF_DEBUG env flag set
    if (process.env.PDF_DEBUG) {
      try {
        page.on('requestfailed', (req) => {
          console.warn('[PDF][requestfailed]', req.url(), req.failure()?.errorText);
        });
        page.on('response', (resp) => {
          try {
            const url = resp.url();
            const status = resp.status();
            const rType = resp.request().resourceType();
            if (rType === 'image' && status >= 400) {
              console.warn('[PDF][image-response][error]', status, url);
            } else if (process.env.PDF_DEBUG_VERBOSE && rType === 'image') {
              console.log('[PDF][image-response]', status, url);
            }
          } catch {}
        });
        page.on('console', (msg) => {
          try {
            console.log('[PDF][page-console]', msg.type(), msg.text());
          } catch {}
        });
        page.on('pageerror', (err) => {
          console.error('[PDF][pageerror]', err?.message || err);
        });
      } catch (e) {
        console.error('[PDF][debug-setup-failed]', (e as any)?.message || e);
      }
    }
    // Ensure page size for print
    const injected = html.replace('</head>', `<style>@page{size:85.6mm 54mm;margin:0} html,body{margin:0;padding:0}</style></head>`);
    await page.setContent(injected, { waitUntil: 'networkidle0' });
    // Optional inlining of <img> tags into data URLs to avoid network dependence (flag: PDF_INLINE_IMAGES=1)
    if (process.env.PDF_INLINE_IMAGES) {
      try {
        await page.evaluate(async () => {
          const g: any = (globalThis as any);
          const doc: any = g.document;
          const enc = (bytes: any) => {
            const btoaFn = g.btoa || ((s: string) => Buffer.from(s, 'binary').toString('base64'));
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoaFn(binary);
          };
          if (!doc) return;
          const nodeList: any = doc.querySelectorAll('img');
          const imgs: any[] = Array.prototype.slice.call(nodeList);
          const whitelist = ['logo','stamp','sign','photo','qr','watermark','frontLogo','secondLogo','member-photo'];
          let inlinedCount = 0;
          for (const img of imgs) {
            try {
              const src = String(img.getAttribute('src') || '');
              const lower = src.toLowerCase();
              const shouldInline = /^https?:/.test(src) && whitelist.some(w => lower.includes(w));
              if (!shouldInline) continue;
              const fetchFn: any = g.fetch;
              if (!fetchFn) continue;
              const resp: any = await fetchFn(src);
              if (!resp || !resp.ok) { console.warn('inline-skip-status', src, resp && resp.status); continue; }
              const ab = await resp.arrayBuffer();
              const buf = new Uint8Array(ab);
              const mime = (resp.headers && (resp.headers.get && resp.headers.get('content-type'))) || 'image/png';
              const b64 = enc(buf);
              img.setAttribute('data-original-src', src);
              img.setAttribute('src', `data:${mime};base64,${b64}`);
              inlinedCount++;
            } catch (e: any) {
              console.warn('inline-error', e && (e.message || String(e)));
            }
          }
          g.__PDF_INLINED_IMAGES = inlinedCount;
          console.log('PDF inline images done count=', inlinedCount);
        });
        if (process.env.PDF_DEBUG) {
          try {
            const inlined = await page.evaluate(() => (globalThis as any).__PDF_INLINED_IMAGES || 0);
            console.log('[PDF][inline-summary] inlined images:', inlined);
          } catch {}
        }
      } catch (e) {
        console.warn('[PDF][inline-failed]', (e as any)?.message || e);
      }
    }
    await page.emulateMediaType('screen');
    const pdf = await page.pdf({
      printBackground: true,
      width: '85.6mm',
      height: '54mm',
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });
    return pdf as Buffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// Merge multiple single-page PDFs into one
async function mergePdfPages(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];
  const outDoc = await PDFDocument.create();
  for (const b of buffers) {
    const src = await PDFDocument.load(b);
    const [page] = await outDoc.copyPages(src, [0]);
    outDoc.addPage(page);
  }
  const out = await outDoc.save();
  return Buffer.from(out);
}

// Fetch HTML for a given side from our own HTML endpoint
async function fetchCardHtml(baseHost: string, cardNumber: string, side: 'front'|'back', design?: string, extraQuery?: string): Promise<string> {
  const params = new URLSearchParams();
  params.set('side', side);
  if (design) params.set('design', design);
  if (extraQuery) {
    // Merge any extra raw query string pairs like debug=1
    const extra = new URLSearchParams(extraQuery);
    extra.forEach((v, k) => params.set(k, v));
  }
  const url = `${baseHost}/hrci/idcard/${encodeURIComponent(cardNumber)}/html?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load HTML (${resp.status})`);
  return await resp.text();
}

/**
 * @swagger
 * /hrci/idcard/{cardNumber}/pdf:
 *   get:
 *     tags: [HRCI ID Cards]
 *     summary: Generate a PDF of the ID card (front, back, or both) using the HTML templates
 *     parameters:
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: side
 *         schema: { type: string, enum: [front, back, both], default: both }
 *       - in: query
 *         name: design
 *         schema: { type: string, enum: [poppins, attached, v2, cr80] }
 *     responses:
 *       200:
 *         description: PDF binary
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:cardNumber/pdf', async (req, res) => {
  try {
    const cardNumber = String(req.params.cardNumber || '').trim();
    const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: cardNumber, mode: 'insensitive' } } as any });
    if (!card) return res.status(404).send('Card not found');
    const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
    const baseHost = (setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const side = (String(req.query.side || 'both').toLowerCase() as 'front'|'back'|'both');
    // Honor design for PDF (e.g., cr80 to include watermark)
    const designParam = String(req.query.design || '').toLowerCase();
    const design: string | undefined = designParam || undefined;
    // Propagate watermark override if provided
    const wm = String((req.query as any)?.watermark || '').trim();
    const extraQuery = wm ? `watermark=${encodeURIComponent(wm)}` : undefined;

    const buffers: Buffer[] = [];
    if (side === 'front' || side === 'both') {
      const frontHtml = await fetchCardHtml(baseHost, cardNumber, 'front', design, extraQuery);
      buffers.push(await htmlToCardPdf(frontHtml));
    }
    if (side === 'back' || side === 'both') {
      const backHtml = await fetchCardHtml(baseHost, cardNumber, 'back', design, extraQuery);
      buffers.push(await htmlToCardPdf(backHtml));
    }
    const pdf = await mergePdfPages(buffers);
  res.setHeader('Content-Type', 'application/pdf');
  // Default to attachment to ensure Swagger UI and browsers download as a file
  const disp = `attachment; filename="${encodeURIComponent(cardNumber)}-${side}.pdf"`;
  res.setHeader('Content-Disposition', disp);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ success: false, error: 'PDF_GENERATION_FAILED', message: e?.message || 'Unknown error' });
  }
});

/**
 * @swagger
 * /hrci/idcard/pdf:
 *   post:
 *     tags: [HRCI ID Cards]
 *     summary: Generate an ID card PDF by cardNumber; returns PDF binary
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cardNumber: { type: string }
 *               side: { type: string, enum: [front, back, both], default: both }
 *               design: { type: string, enum: [poppins, attached, v2, cr80] }
 *     responses:
 *       200:
 *         description: PDF binary
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.post('/pdf', async (req, res) => {
  try {
    const body = (req.body || {}) as { cardNumber?: string; side?: 'front'|'back'|'both'; design?: string; watermark?: string };
    const cardNumber = String(body.cardNumber || '').trim();
    if (!cardNumber) return res.status(400).json({ success: false, error: 'MISSING_CARD_NUMBER' });
    const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: cardNumber, mode: 'insensitive' } } as any });
    if (!card) return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND' });
    const setting = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
    const baseHost = (setting?.qrLandingBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const side = (String(body.side || 'both').toLowerCase() as 'front'|'back'|'both');
    // Honor design for PDF if provided (e.g., 'cr80' to include watermark)
    const design: string | undefined = (body.design ? String(body.design).toLowerCase() : undefined) || undefined;
    // Merge watermark override from body or query
    const wm = (body.watermark && String(body.watermark).trim()) || (req.query?.watermark && String(req.query.watermark).trim()) || '';
    const extraQuery = wm ? `watermark=${encodeURIComponent(wm)}` : undefined;
    const buffers: Buffer[] = [];
    if (side === 'front' || side === 'both') {
      const frontHtml = await fetchCardHtml(baseHost, cardNumber, 'front', design, extraQuery);
      buffers.push(await htmlToCardPdf(frontHtml));
    }
    if (side === 'back' || side === 'both') {
      const backHtml = await fetchCardHtml(baseHost, cardNumber, 'back', design, extraQuery);
      buffers.push(await htmlToCardPdf(backHtml));
    }
    const pdf = await mergePdfPages(buffers);
  res.setHeader('Content-Type', 'application/pdf');
  const disp = `attachment; filename="${encodeURIComponent(cardNumber)}-${side}.pdf"`;
  res.setHeader('Content-Disposition', disp);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ success: false, error: 'PDF_GENERATION_FAILED', message: e?.message || 'Unknown error' });
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
