import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import multer from 'multer';
import sharp from 'sharp';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MEDIA_MAX_IMAGE_MB || 15) * 1024 * 1024 } });

/** Helper to ensure ordering within a story */
async function nextOrderForStory(storyId: string): Promise<number> {
  const rows: any[] = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(MAX("order"), 0) as max_order FROM "DonationSuccessImage" WHERE "storyId" = ${storyId}
  `;
  return Number(rows?.[0]?.max_order || 0) + 1;
}

/**
 * @swagger
 * tags:
 *   - name: Donations - Stories
 *     description: Donation success stories (public + admin)
 */

/**
 * @swagger
 * /donations/stories:
 *   get:
 *     tags: [Donations, Donations - Stories]
 *     summary: List donation success stories (public)
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *     responses:
 *       200:
 *         description: Stories list
 */
router.get('/stories', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows: any[] = await prisma.$queryRaw<any[]>`
      SELECT id, title, "heroImageUrl", "createdAt", "updatedAt"
      FROM "DonationSuccessStory" WHERE "isActive" = true
      ORDER BY "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countRows: any[] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int as total FROM "DonationSuccessStory" WHERE "isActive" = true
    `;
    const total = Number(countRows?.[0]?.total || 0);
    return res.json({ success: true, count: rows.length, total, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STORY_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/stories/{id}:
 *   get:
 *     tags: [Donations, Donations - Stories]
 *     summary: Get a story by id with gallery (public)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Story details }
 *       404: { description: Not found }
 */
router.get('/stories/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const storyRows: any[] = await prisma.$queryRaw<any[]>`
      SELECT id, title, description, "heroImageUrl", "isActive", "createdAt", "updatedAt"
      FROM "DonationSuccessStory" WHERE id = ${id}
    `;
    const story = storyRows[0];
    if (!story) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const images: any[] = await prisma.$queryRaw<any[]>`
      SELECT id, url, caption, "order", "isActive", "createdAt", "updatedAt"
      FROM "DonationSuccessImage" WHERE "storyId" = ${id} AND "isActive" = true
      ORDER BY "order" ASC, "createdAt" DESC
    `;
    return res.json({ success: true, data: { ...story, images } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STORY_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories:
 *   post:
 *     tags: [Donations - Stories]
 *     summary: Create a success story (admin)
 *     security: [ { bearerAuth: [] } ]
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
 *               heroImageUrl: { type: string }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       200: { description: Created }
 */
router.post('/admin/stories', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { title, description, heroImageUrl, isActive } = req.body || {};
    if (!title) return res.status(400).json({ success: false, error: 'TITLE_REQUIRED' });
    const id = randomUUID();
    const rows: any[] = await prisma.$queryRaw<any[]>`
      INSERT INTO "DonationSuccessStory" (id, title, description, "heroImageUrl", "isActive")
      VALUES (${id}, ${String(title)}, ${description || null}, ${heroImageUrl || null}, ${typeof isActive === 'boolean' ? isActive : true})
      RETURNING id, title, description, "heroImageUrl", "isActive", "createdAt", "updatedAt"
    `;
    return res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STORY_CREATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories/{id}:
 *   put:
 *     tags: [Donations - Stories]
 *     summary: Update a success story (admin)
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
 *               description: { type: string }
 *               heroImageUrl: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/admin/stories/:id', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const currRows: any[] = await prisma.$queryRaw<any[]>`
      SELECT id, title, description, "heroImageUrl", "isActive" FROM "DonationSuccessStory" WHERE id = ${id}
    `;
    const curr = currRows[0];
    if (!curr) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const b = req.body || {};
    const rows: any[] = await prisma.$queryRaw<any[]>`
      UPDATE "DonationSuccessStory"
      SET title = ${'title' in b ? (b.title ?? curr.title) : curr.title},
          description = ${'description' in b ? (b.description ?? curr.description) : curr.description},
          "heroImageUrl" = ${'heroImageUrl' in b ? (b.heroImageUrl ?? curr["heroImageUrl"]) : curr["heroImageUrl"]},
          "isActive" = ${'isActive' in b ? (b.isActive ?? curr["isActive"]) : curr["isActive"]},
          "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING id, title, description, "heroImageUrl", "isActive", "createdAt", "updatedAt"
    `;
    return res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'STORY_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories/{id}/hero-image:
 *   post:
 *     tags: [Donations - Stories]
 *     summary: Upload hero image (admin)
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
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200: { description: Uploaded and updated }
 */
router.post('/admin/stories/:id/hero-image', requireAuth, requireHrcAdmin, upload.single('image'), async (req: any, res) => {
  try {
    const id = String(req.params.id);
    const file: Express.Multer.File | undefined = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'IMAGE_REQUIRED' });
    if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });

    let buf = file.buffer;
    let mime = 'image/webp';
    try { buf = await sharp(file.buffer).webp({ quality: 82 }).toBuffer(); } catch {}
    const d = new Date();
    const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `donations/stories/${id}/${datePath}/hero-${Date.now()}-${rand}.webp`;
    await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000' }));
    const url = getPublicUrl(key);

    const rows: any[] = await prisma.$queryRaw<any[]>`
      UPDATE "DonationSuccessStory" SET "heroImageUrl" = ${url}, "updatedAt" = NOW() WHERE id = ${id}
      RETURNING id, title, description, "heroImageUrl", "isActive", "createdAt", "updatedAt"
    `;
    return res.json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'HERO_UPLOAD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories/{id}/gallery/upload:
 *   post:
 *     tags: [Donations - Stories]
 *     summary: Upload gallery images (admin)
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
 *               caption: { type: string }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       200: { description: Uploaded images }
 */
router.post('/admin/stories/:id/gallery/upload', requireAuth, requireHrcAdmin, upload.array('images'), async (req: any, res) => {
  try {
    const id = String(req.params.id);
    const files: Express.Multer.File[] = req.files || [];
    const { caption } = req.body || {};
    const isActiveRaw = (req.body?.isActive ?? 'true');
    const isActive = String(isActiveRaw).toLowerCase() === 'true' || String(isActiveRaw) === '1';
    if (!files.length) return res.status(400).json({ success: false, error: 'IMAGES_REQUIRED' });
    if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });

    const createdItems: any[] = [];
    let skipped = 0;
    let orderBase = await nextOrderForStory(id);
    const d = new Date();
    const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!((file.mimetype || '').startsWith('image/'))) { skipped++; continue; }
      let buf = file.buffer;
      let mime = 'image/webp';
      try { buf = await sharp(file.buffer).webp({ quality: 80 }).toBuffer(); } catch {}
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `donations/stories/${id}/${datePath}/${Date.now()}-${rand}.webp`;
      await r2Client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000' }));
      const url = getPublicUrl(key);
      const imageId = randomUUID();
      const rows = await prisma.$queryRaw<any[]>`
        INSERT INTO "DonationSuccessImage" (id, "storyId", url, caption, "order", "isActive")
        VALUES (${imageId}, ${id}, ${url}, ${caption || null}, ${orderBase + i}, ${isActive})
        RETURNING id, url, caption, "order", "isActive", "createdAt", "updatedAt"
      `;
      createdItems.push(rows[0]);
    }

    if (!createdItems.length) return res.status(400).json({ success: false, error: 'NO_VALID_IMAGES' });
    return res.json({ success: true, count: createdItems.length, skipped, data: createdItems });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_UPLOAD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories/{id}/gallery:
 *   put:
 *     tags: [Donations - Stories]
 *     summary: Add/delete gallery images by story (admin)
 *     description: Send arrays to add new images (as URLs) and delete by image IDs.
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
 *               add:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *                     caption: { type: string }
 *                     order: { type: integer }
 *                     isActive: { type: boolean }
 *               delete:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200: { description: Updated gallery }
 */
router.put('/admin/stories/:id/gallery', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const { add, delete: del } = req.body || {};
    const added: any[] = [];
    const deleted: string[] = [];

    if (Array.isArray(add) && add.length) {
      let orderBase = await nextOrderForStory(id);
      for (let i = 0; i < add.length; i++) {
        const item = add[i] || {};
        if (!item.url) continue;
        const imageId = randomUUID();
        const rows = await prisma.$queryRaw<any[]>`
          INSERT INTO "DonationSuccessImage" (id, "storyId", url, caption, "order", "isActive")
          VALUES (${imageId}, ${id}, ${String(item.url)}, ${item.caption || null}, ${Number(item.order ?? (orderBase + i))}, ${typeof item.isActive === 'boolean' ? item.isActive : true})
          RETURNING id, url, caption, "order", "isActive", "createdAt", "updatedAt"
        `;
        added.push(rows[0]);
      }
    }

    if (Array.isArray(del) && del.length) {
      for (const imgId of del) {
        await prisma.$executeRaw`
          DELETE FROM "DonationSuccessImage" WHERE id = ${String(imgId)} AND "storyId" = ${id}
        `;
        deleted.push(String(imgId));
      }
    }

    return res.json({ success: true, addedCount: added.length, deletedCount: deleted.length, added, deleted });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_UPDATE_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /donations/admin/stories/{id}/gallery/{imageId}:
 *   delete:
 *     tags: [Donations - Stories]
 *     summary: Delete a gallery image (admin)
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
router.delete('/admin/stories/:id/gallery/:imageId', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const imageId = String(req.params.imageId);
    const result: any = await prisma.$executeRaw`
      DELETE FROM "DonationSuccessImage" WHERE id = ${imageId} AND "storyId" = ${id}
    `;
    return res.json({ success: true, deleted: Number(result) || 0 });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GALLERY_DELETE_FAILED', message: e?.message });
  }
});

export default router;
