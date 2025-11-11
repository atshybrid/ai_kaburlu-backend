import { Router } from 'express';
import passport from 'passport';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import prisma from '../../lib/prisma';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const router = Router();
// Simple configuration guard for R2. Returns a human-readable error if misconfigured.
function ensureR2Configured(res: any): boolean {
  const missing: string[] = [];
  if (!R2_BUCKET) missing.push('R2_BUCKET');
  // Endpoint/credentials are configured in the r2 client. We only check bucket here.
  if (missing.length > 0) {
    res.status(500).json({ error: 'Storage not configured', missing });
    return false;
  }
  return true;
}

// Configure ffmpeg/ffprobe binaries (works on Windows/Linux/Mac)
try {
  if (ffmpegStatic) {
    // @ts-ignore - types may declare string | null
    ffmpeg.setFfmpegPath(ffmpegStatic as string);
  }
  if ((ffprobeStatic as any)?.path) {
    ffmpeg.setFfprobePath((ffprobeStatic as any).path as string);
  }
} catch {}

// Allowed MIME types for images and videos
const IMAGE_MIMES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const VIDEO_MIMES = new Set<string>([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
]);

// Common document and archive MIME types allowed for generic file uploads
const DOC_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
]);

function mimeToExt(mime: string, fallbackExt: string): string {
  switch ((mime || '').toLowerCase()) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    case 'video/mp4': return 'mp4';
    case 'video/quicktime': return 'mov';
    case 'video/x-matroska': return 'mkv';
    case 'video/webm': return 'webm';
    case 'video/3gpp': return '3gp';
    case 'video/3gpp2': return '3g2';
    case 'application/pdf': return 'pdf';
    case 'application/msword': return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
    case 'application/vnd.ms-excel': return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx';
    case 'application/vnd.ms-powerpoint': return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return 'pptx';
    case 'text/plain': return 'txt';
    case 'text/csv': return 'csv';
    case 'application/json': return 'json';
    case 'application/zip':
    case 'application/x-zip-compressed': return 'zip';
    case 'application/x-rar-compressed': return 'rar';
    case 'application/x-7z-compressed': return '7z';
    default: return fallbackExt || 'bin';
  }
}

const upload = multer({ storage: multer.memoryStorage() });

async function transcodeToWebm(inputBuffer: Buffer): Promise<Buffer> {
  // Write to temp file and transcode via ffmpeg to WebM (VP9 + Opus)
  const tmpDir = os.tmpdir();
  const base = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inPath = path.join(tmpDir, `${base}.input`);
  const outPath = path.join(tmpDir, `${base}.webm`);
  await fs.writeFile(inPath, inputBuffer);
  return await new Promise<Buffer>((resolve, reject) => {
    ffmpeg(inPath)
      .videoCodec('libvpx-vp9')
      .audioCodec('libopus')
      .outputOptions([
        '-b:v 0',            // constant quality mode
        '-crf 32',           // quality (lower is better, 24-36 reasonable)
        '-deadline good',    // better quality
        '-cpu-used 4',       // speed/quality tradeoff
      ])
      .format('webm')
      .on('end', async () => {
        try {
          const buf = await fs.readFile(outPath);
          await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)]);
          resolve(buf);
        } catch (e) {
          await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)]);
          reject(e);
        }
      })
      .on('error', async (err: any) => {
        await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)]);
        reject(err);
      })
      .save(outPath);
  });
}

/**
 * @swagger
 * /media/upload:
 *   post:
 *     summary: Upload a file directly (multipart/form-data)
 *     description: Converts images to WebP (except PNG stays PNG) and videos to WebM before storing in R2. Generic document files are stored as-is.
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               key:
 *                 type: string
 *                 description: Optional destination key. If omitted, server generates <kind>/<YYYY>/<MM>/<DD>/<timestamp-rand>.<ext>
 *               filename:
 *                 type: string
 *                 description: Optional base filename (without extension). Server will append an extension based on MIME type.
 *               folder:
 *                 type: string
 *                 description: Optional root folder (e.g., images, videos, shortnews/uploads). Defaults to images/videos/files based on MIME.
 *               kind:
 *                 type: string
 *                 enum: [image, video, file]
 *                 description: Optional file kind. If provided, server validates MIME accordingly. For kind=file, common document types like PDF/DOCX/XLSX/ZIP are allowed.
 *     responses:
 *       200:
 *         description: File uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 publicUrl:
 *                   type: string
 */
router.post('/upload', passport.authenticate('jwt', { session: false }), upload.single('file'), async (req, res) => {
  try {
    if (!ensureR2Configured(res)) return;
    const file = req.file;
    const { key, filename, kind, folder } = req.body as { key?: string; filename?: string; kind?: 'image' | 'video' | 'file'; folder?: string };
    if (!file) return res.status(400).json({ error: 'file is required (multipart/form-data)' });

    // Validate kind if provided
    if (kind) {
      const isImage = IMAGE_MIMES.has(file.mimetype);
      const isVideo = VIDEO_MIMES.has(file.mimetype);
      const isDoc = DOC_MIMES.has(file.mimetype) || (!isImage && !isVideo && file.mimetype.startsWith('application/'));
      if (kind === 'image' && !isImage) return res.status(400).json({ error: 'Expected an image file' });
      if (kind === 'video' && !isVideo) return res.status(400).json({ error: 'Expected a video file' });
      if (kind === 'file' && !(isDoc || !file.mimetype)) return res.status(400).json({ error: 'Expected a document file (pdf, docx, xlsx, zip, etc.)' });
    }

    const original = file.originalname || 'upload.bin';
    const originalExt = (original.includes('.') ? original.substring(original.lastIndexOf('.') + 1) : 'bin').toLowerCase();
    const detectedExt = mimeToExt(file.mimetype || '', originalExt);
    const d = new Date();
    const datePath = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const random = Math.random().toString(36).slice(2, 8);
    // Choose root folder (sanitized), default to kind-based root
    const sanitizedFolder = (folder ? String(folder).trim() : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const rootByKind = file.mimetype.startsWith('image/') ? 'images' : (file.mimetype.startsWith('video/') ? 'videos' : 'files');
    const root = sanitizedFolder || rootByKind;

    // Decide target content type and extension based on conversion policy
  const isImage = file.mimetype.startsWith('image/');
  const isVideo = file.mimetype.startsWith('video/');
  const isDoc = DOC_MIMES.has(file.mimetype) || (!isImage && !isVideo && file.mimetype.startsWith('application/'));
    let targetExt = detectedExt;
    let targetContentType = file.mimetype || 'application/octet-stream';
    if (isImage) {
      // For raster images, convert to WebP except PNG stays PNG. For SVG, keep as-is.
      if (file.mimetype === 'image/svg+xml') {
        targetExt = 'svg';
        targetContentType = 'image/svg+xml';
      } else if (file.mimetype === 'image/png') {
        targetExt = 'png';
        targetContentType = 'image/png';
      } else {
        targetExt = 'webp';
        targetContentType = 'image/webp';
      }
    } else if (isVideo) {
      // Convert all videos to WebM
      targetExt = 'webm';
      targetContentType = 'video/webm';
    }

    // If filename is provided, use it (without extension), otherwise generate a timestamp-based name
    const safeBase = (filename ? String(filename).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '') : `${Date.now()}-${random}`).replace(/\.[^.]+$/, '');
    const generatedKey = `${root}/${datePath}/${safeBase}.${targetExt}`;
    // If a key is supplied, replace its extension to match target
    let finalKey = (key && String(key).trim().length > 0) ? String(key).trim() : generatedKey;
    if (finalKey && (isImage || isVideo)) {
      finalKey = finalKey.replace(/\.[^.\/]+$/, '') + `.${targetExt}`;
    }

    // Enforce size limits and perform light compression for images
  const MAX_IMAGE_BYTES = Number(process.env.MEDIA_MAX_IMAGE_MB || 10) * 1024 * 1024; // default 10MB
  const MAX_VIDEO_BYTES = Number(process.env.MEDIA_MAX_VIDEO_MB || 100) * 1024 * 1024; // default 100MB
  const MAX_FILE_BYTES = Number(process.env.MEDIA_MAX_FILE_MB || 25) * 1024 * 1024; // default 25MB

    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      return res.status(400).json({ error: `Video too large. Max ${Math.round(MAX_VIDEO_BYTES / (1024*1024))}MB` });
    }

  let uploadBuffer = file.buffer;
    let uploadContentType = targetContentType;

    if (isImage) {
      try {
        if (file.mimetype === 'image/svg+xml') {
          // No conversion for SVG; keep original buffer
          uploadBuffer = file.buffer;
        } else {
          // Convert raster images to WebP (or keep PNG); rotate to respect EXIF
          const img = sharp(file.buffer).rotate();
          if (targetContentType === 'image/png') {
            uploadBuffer = await img.png({ compressionLevel: 9 }).toBuffer();
          } else {
            // target is webp
            uploadBuffer = await img.webp({ quality: 85 }).toBuffer();
          }
        }
        // Enforce final size limit for images
        if (uploadBuffer.length > MAX_IMAGE_BYTES) {
          return res.status(400).json({ error: `Image too large after optimization. Max ${Math.round(MAX_IMAGE_BYTES / (1024*1024))}MB` });
        }
      } catch (optErr) {
        console.warn('image optimize failed, using original buffer', optErr);
        if (file.size > MAX_IMAGE_BYTES) {
          return res.status(400).json({ error: `Image too large. Max ${Math.round(MAX_IMAGE_BYTES / (1024*1024))}MB` });
        }
      }
    }

    if (isVideo) {
      try {
        uploadBuffer = await transcodeToWebm(file.buffer);
        uploadContentType = 'video/webm';
      } catch (vidErr) {
        console.error('video transcode failed', vidErr);
        return res.status(500).json({ error: 'Video transcoding failed' });
      }
    }

    // For generic document files, enforce size limit (no conversion)
    if (!isImage && !isVideo) {
      if (uploadBuffer.length > MAX_FILE_BYTES) {
        return res.status(400).json({ error: `File too large. Max ${Math.round(MAX_FILE_BYTES / (1024*1024))}MB` });
      }
    }

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: finalKey,
      Body: uploadBuffer,
      ContentType: uploadContentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

  const publicUrl = getPublicUrl(finalKey);

    // Insert DB record (best-effort; if it fails, still return upload success)
    try {
      const ownerId = (req.user as any)?.id || undefined;
      const folderValue = root;
      const prismaAny = prisma as any;
      await prismaAny.media.create({
        data: {
          key: finalKey,
          url: publicUrl,
          name: original,
          contentType: uploadContentType,
          size: Number(uploadBuffer.length || 0),
          kind: (isImage ? 'image' : (isVideo ? 'video' : 'file')),
          folder: folderValue,
          ownerId,
        },
      } as any);
    } catch (dbErr) {
      console.warn('media db create failed (non-fatal):', dbErr);
    }

    res.json({
      key: finalKey,
      publicUrl,
      name: original,
      contentType: uploadContentType,
      size: uploadBuffer.length,
      kind: (isImage ? 'image' : (isVideo ? 'video' : 'file')),
    });
  } catch (e) {
    console.error('direct upload error', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * @swagger
 * /media/object:
 *   get:
 *     summary: Get object metadata (HEAD)
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Object key
 *     responses:
 *       200:
 *         description: Object metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 key:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 contentLength:
 *                   type: number
 *                 lastModified:
 *                   type: string
 *                   format: date-time
 */
router.get('/object', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const key = String(req.query.key || '');
    if (!key) return res.status(400).json({ error: 'key is required' });
    const head = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const contentType = (head as any).ContentType || 'application/octet-stream';
    const contentLength = Number((head as any).ContentLength || 0);
    const lastModified = (head as any).LastModified || null;
    res.json({ key, contentType, contentLength, lastModified });
  } catch (e) {
    console.error('object meta error', e);
    res.status(404).json({ error: 'Object not found' });
  }
});

/**
 * @swagger
 * /media/list:
 *   get:
 *     summary: List objects by prefix
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *         description: Key prefix to filter (e.g., shortnews/2025/09/13)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Continuation token
 *     responses:
 *       200:
 *         description: Object list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       size:
 *                         type: number
 *                       lastModified:
 *                         type: string
 *                         format: date-time
 *                 nextCursor:
 *                   type: string
 */
router.get('/list', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const prefix = String(req.query.prefix || '');
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const resp = await r2Client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix || undefined,
      MaxKeys: limit,
      ContinuationToken: cursor,
    }));
    const items = (resp.Contents || []).map(obj => ({
      key: obj.Key || '',
      size: Number(obj.Size || 0),
      lastModified: obj.LastModified || null,
    }));
    res.json({ items, nextCursor: resp.NextContinuationToken || null });
  } catch (e) {
    console.error('list error', e);
    res.status(500).json({ error: 'List failed' });
  }
});

/**
 * @swagger
 * /media/object:
 *   delete:
 *     summary: Delete an object
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               key:
 *                 type: string
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete('/object', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const { key } = req.body as { key?: string };
    if (!key) return res.status(400).json({ error: 'key is required' });
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    try {
      const prismaAny = prisma as any;
      await prismaAny.media.delete({ where: { key } });
    } catch (e) {
      // ignore if not found
    }
    res.json({ deleted: true, key });
  } catch (e) {
    console.error('delete error', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * @swagger
 * /media/rename:
 *   put:
 *     summary: Rename/move an object (copy + delete)
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromKey:
 *                 type: string
 *               toKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Renamed
 */
router.put('/rename', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { CopyObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const { fromKey, toKey } = req.body as { fromKey?: string; toKey?: string };
    if (!fromKey || !toKey) return res.status(400).json({ error: 'fromKey and toKey are required' });
    await r2Client.send(new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: `/${R2_BUCKET}/${fromKey}`,
      Key: toKey,
      MetadataDirective: 'COPY',
    } as any));
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: fromKey }));
    try {
      // upsert new key, delete old if exists
      const url = getPublicUrl(toKey);
      const prismaAny = prisma as any;
      await prisma.$transaction([
        prismaAny.media.deleteMany({ where: { key: fromKey } }),
        prismaAny.media.upsert({
          where: { key: toKey },
          update: { url },
          create: {
            key: toKey,
            url,
            name: toKey.split('/').pop() || toKey,
            contentType: 'application/octet-stream',
            size: 0,
            kind: 'other',
            folder: toKey.split('/')[0] || null,
          },
        })
      ]);
    } catch (e) {
      console.warn('media db rename sync failed (non-fatal):', e);
    }
    res.json({ renamed: true, fromKey, toKey, publicUrl: getPublicUrl(toKey) });
  } catch (e) {
    console.error('rename error', e);
    res.status(500).json({ error: 'Rename failed' });
  }
});

// Note: The presign endpoints (/media/presign-upload, /media/presign-get) were intentionally removed.

export default router;
