import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import multer from 'multer';
import sharp from 'sharp';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MEDIA_MAX_IMAGE_MB || 10) * 1024 * 1024 } });

function mask(str?: string | null, kind?: 'mobile' | 'email' | 'pan'): string | null {
  if (!str) return null;
  const s = String(str);
  if (kind === 'mobile') {
    return s.replace(/\d(?=\d{4})/g, 'X');
  }
  if (kind === 'email') {
    const [user, domain] = s.split('@');
    if (!domain) return s;
    return user[0] + '***@' + domain;
  }
  if (kind === 'pan') {
    return s.replace(/.(?=.{4}$)/g, 'X');
  }
  return s;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     TopDonor:
 *       type: object
 *       properties:
 *         key: { type: string, description: "Grouping key (mobile/email/pan/name fallback)" }
 *         displayName: { type: string }
 *         mobileMasked: { type: string, nullable: true }
 *         emailMasked: { type: string, nullable: true }
 *         panMasked: { type: string, nullable: true }
 *         totalAmount: { type: integer, description: "Total successful donation amount" }
 *         donationCount: { type: integer, description: "Number of successful donations" }
 *         latestDonationId: { type: string, nullable: true, description: "Most recent donation id for this donor" }
 *         photoUrl: { type: string, nullable: true }
 *     TopDonorListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         count: { type: integer }
 *         data:
 *           type: array
 *           items: { $ref: '#/components/schemas/TopDonor' }
 *     DonorPhotoUpdateRequestJson:
 *       type: object
 *       required: [donationId, photoUrl]
 *       properties:
 *         donationId: { type: string }
 *         mobile: { type: string, nullable: true, description: "Optional. Fallback if donationId not provided" }
 *         email: { type: string, nullable: true, description: "Optional. Fallback if donationId not provided" }
 *         pan: { type: string, nullable: true, description: "Optional. Fallback if donationId not provided" }
 *         name: { type: string, nullable: true }
 *         photoUrl: { type: string }
 *     DonationPhotoUpdateResult:
 *       type: object
 *       properties:
 *         donationId: { type: string }
 *         donorPhotoUrl: { type: string }
 *     DonorProfile:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string, nullable: true }
 *         donorMobile: { type: string, nullable: true }
 *         donorEmail: { type: string, nullable: true }
 *         donorPan: { type: string, nullable: true }
 *         photoUrl: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     DonorPhotoUpdateResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         data: { $ref: '#/components/schemas/DonorProfile' }
 */

/**
 * @swagger
 * /donations/top-donors:
 *   get:
 *     tags: [Donations]
 *     summary: Public - Top donors list (by total successful donations)
  *     description: |
  *       Aggregates donors by their best-available identifier (mobile → email → PAN → name) and returns the top donors by total successful donations.
 *     parameters:
 *       - in: query
 *         name: limit
  *         description: Number of donors to return
  *         schema:
  *           type: integer
  *           default: 20
  *           minimum: 1
  *           maximum: 100
 *       - in: query
 *         name: eventId
  *         description: Optional donation event filter
  *         schema:
  *           type: string
 *     responses:
 *       200:
  *         description: Top donors
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/TopDonorListResponse'
  *             examples:
  *               sample:
  *                 value:
  *                   success: true
  *                   count: 2
  *                   data:
  *                     - key: "987XXXX3210"
  *                       displayName: "Sita"
  *                       mobileMasked: "987XXXX3210"
  *                       emailMasked: null
  *                       panMasked: null
  *                       totalAmount: 15000
  *                       donationCount: 3
  *                       photoUrl: "https://cdn.example.com/donations/donors/1.webp"
  *                     - key: "ravi@example.com"
  *                       displayName: "Ravi"
  *                       mobileMasked: null
  *                       emailMasked: "r***@example.com"
  *                       panMasked: null
  *                       totalAmount: 12000
  *                       donationCount: 2
  *                       photoUrl: null
 */
router.get('/top-donors', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const eventId = req.query.eventId ? String(req.query.eventId) : null;

    // Aggregate totals from Donation table for non-anonymous, SUCCESS donors.
    let rows: any[] = [];
    if (eventId) {
      rows = await prisma.$queryRaw<any[]>`
        SELECT donor_key,
               SUM(amount)::int AS total_amount,
               COUNT(*)::int AS donation_count,
               MAX("donorName") AS donor_name,
               MAX("donorMobile") AS donor_mobile,
               MAX("donorEmail") AS donor_email,
               MAX("donorPan") AS donor_pan
        FROM (
          SELECT COALESCE("donorMobile", "donorEmail", "donorPan", "donorName") AS donor_key,
                 amount, "donorName", "donorMobile", "donorEmail", "donorPan"
          FROM "Donation"
          WHERE status = 'SUCCESS'
            AND ("isAnonymous" IS NULL OR "isAnonymous" = false)
            AND "eventId" = ${eventId}
        ) t
        WHERE donor_key IS NOT NULL AND donor_key <> ''
        GROUP BY donor_key
        ORDER BY total_amount DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await prisma.$queryRaw<any[]>`
        SELECT donor_key,
               SUM(amount)::int AS total_amount,
               COUNT(*)::int AS donation_count,
               MAX("donorName") AS donor_name,
               MAX("donorMobile") AS donor_mobile,
               MAX("donorEmail") AS donor_email,
               MAX("donorPan") AS donor_pan
        FROM (
          SELECT COALESCE("donorMobile", "donorEmail", "donorPan", "donorName") AS donor_key,
                 amount, "donorName", "donorMobile", "donorEmail", "donorPan"
          FROM "Donation"
          WHERE status = 'SUCCESS'
            AND ("isAnonymous" IS NULL OR "isAnonymous" = false)
        ) t
        WHERE donor_key IS NOT NULL AND donor_key <> ''
        GROUP BY donor_key
        ORDER BY total_amount DESC
        LIMIT ${limit}
      `;
    }

    // Fetch photos from DonationDonorProfile matching on any identifier
    const out: any[] = [];
    for (const r of rows) {
      const keyMobile = r.donor_mobile || null;
      const keyEmail = r.donor_email || null;
      const keyPan = r.donor_pan || null;
      const profRows: any[] = await prisma.$queryRaw<any[]>`
        SELECT photoUrl FROM "DonationDonorProfile"
        WHERE (donorMobile IS NOT NULL AND donorMobile = ${keyMobile})
           OR (donorEmail IS NOT NULL AND donorEmail = ${keyEmail})
           OR (donorPan IS NOT NULL AND donorPan = ${keyPan})
        LIMIT 1
      `;
      const photoUrl = profRows?.[0]?.photoUrl ?? profRows?.[0]?.photourl ?? null;

      // Find latest donation id for this donor (priority: mobile > email > PAN > name)
      let latestDonationId: string | null = null;
      try {
        const whereBase: any = { status: 'SUCCESS' };
        if (eventId) whereBase.eventId = eventId;
        if (keyMobile) whereBase.donorMobile = keyMobile;
        else if (keyEmail) whereBase.donorEmail = keyEmail;
        else if (keyPan) whereBase.donorPan = keyPan;
        else if (r.donor_name) whereBase.donorName = r.donor_name;
        const latest = await (prisma as any).donation.findFirst({
          where: whereBase,
          orderBy: { createdAt: 'desc' },
          select: { id: true }
        });
        latestDonationId = latest?.id || null;
      } catch {}
      out.push({
        key: r.donor_key,
        displayName: r.donor_name || keyMobile || keyEmail || 'Donor',
        mobileMasked: mask(r.donor_mobile, 'mobile'),
        emailMasked: mask(r.donor_email, 'email'),
        panMasked: mask(r.donor_pan, 'pan'),
        totalAmount: Number(r.total_amount || 0),
        donationCount: Number(r.donation_count || 0),
        latestDonationId,
        photoUrl: photoUrl || null,
      });
    }

    return res.json({ success: true, count: out.length, data: out });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'TOP_DONORS_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/donors/photo:
 *   put:
 *     tags: [Donations]
 *     summary: Set or upload donor photo (admin)
 *     description: |
 *       Only donationId and photoUrl are required. The server will update that donation's donorPhotoUrl directly.
 *       If the donation has identifiers (mobile/email/PAN), a donor profile will also be created/updated for reuse across donations. Mobile/email/PAN are optional.
 *       You can also send a multipart file with field name `photo` instead of photoUrl.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
  *           schema:
  *             $ref: '#/components/schemas/DonorPhotoUpdateRequestJson'
  *           examples:
 *             byDonationId:
 *               summary: Prefer donationId for accurate matching
 *               value:
  *                 donationId: "don_abc123"
 *                 photoUrl: "https://cdn.example.com/donors/john.webp"
  *             byMobileUrl:
  *               value:
  *                 mobile: "9876543210"
  *                 name: "Sita"
  *                 photoUrl: "https://cdn.example.com/donors/sita.webp"
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               donationId: { type: string }
 *               mobile: { type: string }
 *               email: { type: string }
 *               pan: { type: string }
 *               photo: { type: string, format: binary }
 *     responses:
  *       200:
  *         description: Updated donor profile
  *         content:
  *           application/json:
  *             schema:
    *               oneOf:
    *                 - $ref: '#/components/schemas/DonorPhotoUpdateResponse'
    *                 - $ref: '#/components/schemas/DonationPhotoUpdateResult'
  *       400:
  *         description: Missing identifiers or photo data
  *       401:
  *         description: Unauthorized
  *       403:
  *         description: Forbidden (requires HRCI Admin or Superadmin)
 */
router.put('/admin/donors/photo', requireAuth, requireHrcAdmin, upload.single('photo'), async (req: any, res) => {
  try {
    const { donationId, mobile, email, pan, photoUrl } = req.body || {};
    let keyMobile = mobile ? String(mobile) : undefined;
    let keyEmail = email ? String(email) : undefined;
    let keyPan = pan ? String(pan).toUpperCase() : undefined;

    // If donationId provided, fetch donation to validate and to optionally derive identifiers
    let donationRow: any | null = null;
    if (donationId) {
      donationRow = await (prisma as any).donation.findUnique({ where: { id: String(donationId) } });
      if (!donationRow) return res.status(404).json({ success: false, error: 'DONATION_NOT_FOUND' });
      if (!keyMobile && !keyEmail && !keyPan) {
        keyMobile = donationRow.donorMobile || undefined;
        keyEmail = donationRow.donorEmail || undefined;
        keyPan = (donationRow.donorPan ? String(donationRow.donorPan).toUpperCase() : undefined) || undefined;
      }
    }

    // Upload file if provided
    let finalPhotoUrl: string | undefined = photoUrl;
    if (!finalPhotoUrl && req.file) {
      if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });
      const file: Express.Multer.File = req.file;
      let buf = file.buffer;
      let mime = 'image/webp';
      try { buf = await sharp(file.buffer).webp({ quality: 82 }).toBuffer(); } catch {}
      const d = new Date();
      const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `donations/donors/${datePath}/${Date.now()}-${rand}.webp`;
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000' }));
      finalPhotoUrl = getPublicUrl(key);
    }

    if (!finalPhotoUrl) return res.status(400).json({ success: false, error: 'PHOTO_REQUIRED' });

    // If donationId is provided, always update that donation's donorPhotoUrl directly
    if (donationRow) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Donation" SET "donorPhotoUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
        finalPhotoUrl,
        String(donationId)
      );
      // If there are no identifiers to build or match a profile, return success now
      if (!keyMobile && !keyEmail && !keyPan) {
        return res.json({ success: true, data: { donationId: String(donationId), donorPhotoUrl: finalPhotoUrl } });
      }
    }

    // If neither donationId nor any identifiers were provided, we cannot proceed
    if (!donationRow && !keyMobile && !keyEmail && !keyPan) {
      return res.status(400).json({ success: false, error: 'IDENTIFIER_REQUIRED', message: 'Provide donationId or one of mobile/email/pan' });
    }

    // Upsert logic: try find by mobile/email/pan in priority order
    let profRows: any[] = [];
    if (keyMobile) {
      profRows = await prisma.$queryRaw<any[]>`SELECT * FROM "DonationDonorProfile" WHERE donorMobile = ${keyMobile} LIMIT 1`;
    }
    if ((!profRows || !profRows.length) && keyEmail) {
      profRows = await prisma.$queryRaw<any[]>`SELECT * FROM "DonationDonorProfile" WHERE donorEmail = ${keyEmail} LIMIT 1`;
    }
    if ((!profRows || !profRows.length) && keyPan) {
      profRows = await prisma.$queryRaw<any[]>`SELECT * FROM "DonationDonorProfile" WHERE donorPan = ${keyPan} LIMIT 1`;
    }

    if (profRows && profRows.length) {
      const id = profRows[0].id;
      const rows = await prisma.$queryRaw<any[]>`
        UPDATE "DonationDonorProfile"
        SET photoUrl = ${finalPhotoUrl}, "updatedAt" = NOW(),
            donorMobile = COALESCE(donorMobile, ${keyMobile || null}),
            donorEmail = COALESCE(donorEmail, ${keyEmail || null}),
            donorPan = COALESCE(donorPan, ${keyPan || null})
        WHERE id = ${id}
        RETURNING id, name, donorMobile, donorEmail, donorPan, photoUrl, "createdAt", "updatedAt"
      `;
      // Also denormalize onto Donation rows for convenience in admin lists
      await prisma.$executeRawUnsafe(
        `UPDATE "Donation" SET "donorPhotoUrl" = $1, "updatedAt" = NOW()
          WHERE ($2 IS NOT NULL AND "donorMobile" = $2)
             OR ($3 IS NOT NULL AND "donorEmail" = $3)
             OR ($4 IS NOT NULL AND UPPER(COALESCE("donorPan",'')) = $4)`,
        finalPhotoUrl,
        keyMobile || null,
        keyEmail || null,
        keyPan || null
      );
      return res.json({ success: true, data: rows[0] });
    }

    const id = randomUUID();
    const nameGuess = req.body?.name || undefined;
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO "DonationDonorProfile" (id, name, donorMobile, donorEmail, donorPan, photoUrl)
      VALUES (${id}, ${nameGuess || null}, ${keyMobile || null}, ${keyEmail || null}, ${keyPan || null}, ${finalPhotoUrl})
      RETURNING id, name, donorMobile, donorEmail, donorPan, photoUrl, "createdAt", "updatedAt"
    `;
    // Also denormalize onto Donation rows for convenience in admin lists
    await prisma.$executeRawUnsafe(
      `UPDATE "Donation" SET "donorPhotoUrl" = $1, "updatedAt" = NOW()
        WHERE ($2 IS NOT NULL AND "donorMobile" = $2)
           OR ($3 IS NOT NULL AND "donorEmail" = $3)
           OR ($4 IS NOT NULL AND UPPER(COALESCE("donorPan",'')) = $4)`,
      finalPhotoUrl,
      keyMobile || null,
      keyEmail || null,
      keyPan || null
    );
    return res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DONOR_PHOTO_UPDATE_FAILED', message: e?.message });
  }
});

export default router;
