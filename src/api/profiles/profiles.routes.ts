
import { Router } from 'express';
import passport from 'passport';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import prisma from '../../lib/prisma';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { getProfileByUserId, createProfile, upsertProfile, updateProfile, deleteProfile, listProfiles } from './profiles.service';
import { CreateProfileDto, UpdateProfileDto } from './profiles.dto';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MEDIA_MAX_IMAGE_MB || 10) * 1024 * 1024 } });

/**
 * @swagger
 * tags:
 *   name: Profiles
 *   description: User profile management
 */

/**
 * @swagger
 * /profiles/me:
 *   get:
 *     summary: Get the authenticated user's own profile (Best Practice)
 *     tags: [Profiles, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your profile was retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       404:
 *         description: Profile not found. You can create one via POST /api/profiles/me.
 *       401:
 *         description: Unauthorized.
 */
router.get('/me', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  try {
    const profile = await getProfileByUserId(req.user.id);
    res.status(200).json(profile);
  } catch (error: any) {
    if (error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(500).json({ error: 'Failed to retrieve profile.' });
    }
  }
});

/**
 * @swagger
 * /profiles/me:
 *   post:
 *     summary: Create or update a profile for the authenticated user (upsert)
 *     tags: [Profiles, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserProfileDto'
 *           example:
 *             fullName: "John Doe"
 *             profilePhotoUrl: "https://example.com/photo.jpg"
 *             bio: "Software Engineer"
 *     responses:
 *       200:
 *         description: Your profile was created or updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       400:
 *         description: Invalid input.
 *       401:
 *         description: Unauthorized.
 */
router.post('/me', passport.authenticate('jwt', { session: false }), validationMiddleware(CreateProfileDto), async (req: any, res) => {
  try {
    const profile = await upsertProfile(req.user.id, req.body);
    res.status(200).json({ success: true, message: 'Profile updated successfully', data: profile });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /profiles/me:
 *   put:
 *     summary: Update the authenticated user's own profile
 *     tags: [Profiles, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserProfileDto'
 *     responses:
 *       200:
 *         description: Your profile was updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       404:
 *         description: Profile not found. You should create one first.
 *       401:
 *         description: Unauthorized.
 */
router.put('/me', passport.authenticate('jwt', { session: false }), validationMiddleware(UpdateProfileDto), async (req: any, res) => {
  try {
    const updatedProfile = await updateProfile(req.user.id, req.body);
    res.status(200).json(updatedProfile);
  } catch (error: any) {
    if (error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(400).json({ error: error.message });
    }
  }
});

/**
 * @swagger
 * /profiles/me:
 *   delete:
 *     summary: Delete the authenticated user's profile
 *     tags: [Profiles, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile deleted.
 *       404:
 *         description: Profile not found.
 */
router.delete('/me', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  try {
    const out = await deleteProfile(req.user.id);
    res.status(200).json(out);
  } catch (e: any) {
    if (String(e.message || '').includes('not found')) return res.status(404).json({ error: e.message });
    return res.status(400).json({ error: 'Failed to delete profile.' });
  }
});

/**
 * @swagger
 * /profiles/{userId}:
 *   get:
 *     summary: Get a user's profile by ID (Admin Only)
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to retrieve.
 *     responses:
 *       200:
 *         description: The user's profile was retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
 *       403:
 *         description: Forbidden. You do not have permission to access this resource.
 *       404:
 *         description: Profile not found for the specified user.
 *       401:
 *         description: Unauthorized.
 */
router.get('/:userId', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  const authenticatedUser = req.user;
  const requestedUserId = req.params.userId;

  // Check if the user is an admin
  const isAdmin = ['SUPERADMIN','SUPER_ADMIN','LANGUAGE_ADMIN','ADMIN'].includes((authenticatedUser.role?.name || '').toUpperCase());

  // Admins can access any profile. Regular users can only access their own (covered by /me).
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden: You do not have permission to access this resource.' });
  }
  
  try {
    const profile = await getProfileByUserId(requestedUserId);
    res.status(200).json(profile);
  } catch (error: any) {
     if (error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(500).json({ error: 'Failed to retrieve profile.' });
    }
  }
});

/**
 * @swagger
 * /profiles:
 *   get:
 *     summary: List user profiles (Admin Only)
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list of profiles
 */
router.get('/', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  const authenticatedUser = req.user;
  const isAdmin = ['SUPERADMIN','SUPER_ADMIN','LANGUAGE_ADMIN','ADMIN'].includes((authenticatedUser.role?.name || '').toUpperCase());
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  const out = await listProfiles(page, pageSize);
  res.json(out);
});

/**
 * @swagger
 * /profiles/{userId}:
 *   delete:
 *     summary: Delete a user's profile by userId (Admin Only)
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile deleted.
 *       404:
 *         description: Not found
 */
router.delete('/:userId', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  const authenticatedUser = req.user;
  const isAdmin = ['SUPERADMIN','SUPER_ADMIN','LANGUAGE_ADMIN','ADMIN'].includes((authenticatedUser.role?.name || '').toUpperCase());
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const out = await deleteProfile(req.params.userId);
    res.status(200).json(out);
  } catch (e: any) {
    if (String(e.message || '').includes('not found')) return res.status(404).json({ error: e.message });
    return res.status(400).json({ error: 'Failed to delete profile.' });
  }
});

/**
 * @swagger
 * /profiles/me/photo:
 *   post:
 *     summary: Upload or update your profile photo (used for ID card)
 *     tags: [Profiles, Member APIs]
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
 *                 description: Image file (JPEG/PNG/WebP). Will be optimized.
 *     responses:
 *       200:
 *         description: Profile photo updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     profilePhotoUrl: { type: string }
 */
router.post('/me/photo', passport.authenticate('jwt', { session: false }), upload.single('file'), async (req: any, res) => {
  try {
    if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'file is required' });
    const mime = (file.mimetype || '').toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) return res.status(400).json({ success: false, error: 'INVALID_IMAGE_TYPE' });

    // Optimize and convert: keep PNG as PNG; otherwise convert to WebP
    const isPng = mime === 'image/png';
    const img = sharp(file.buffer).rotate();
    const optimized = isPng ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.webp({ quality: 85 }).toBuffer();
    const ext = isPng ? 'png' : 'webp';

    // Build key under profile-photos/YYYY/MM/DD
    const d = new Date();
    const datePath = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `profile-photos/${datePath}/${req.user.id}-${Date.now()}-${rand}.${ext}`;

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: optimized,
      ContentType: isPng ? 'image/png' : 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const publicUrl = getPublicUrl(key);

    // Update profile: set URL and clear mediaId (mutually exclusive)
    await (prisma as any).userProfile.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, profilePhotoUrl: publicUrl, profilePhotoMediaId: null },
      update: { profilePhotoUrl: publicUrl, profilePhotoMediaId: null },
    });

    return res.json({ success: true, data: { profilePhotoUrl: publicUrl } });
  } catch (e: any) {
    console.error('profile photo upload failed', e);
    return res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: e?.message });
  }
});

export default router;

/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfileDto:
 *       type: object
 *       properties:
 *         fullName:
 *           type: string
 *         gender:
 *           type: string
 *         dob:
 *           type: string
 *           description: Date of birth in formats like DD/MM/YYYY or DD-MM-YYYY
 *         maritalStatus:
 *           type: string
 *         bio:
 *           type: string
 *         profilePhotoUrl:
 *           type: string
 *           format: uri
 *         profilePhotoMediaId:
 *           type: string
 *         emergencyContactNumber:
 *           type: string
 *         address:
 *           type: object
 *           additionalProperties: true
 *         stateId:
 *           type: string
 *         districtId:
 *           type: string
 *         assemblyId:
 *           type: string
 *         mandalId:
 *           type: string
 *         villageId:
 *           type: string
 *         occupation:
 *           type: string
 *         education:
 *           type: string
 *         socialLinks:
 *           type: object
 *           additionalProperties: true
 *     UserProfile:
 *       allOf:
 *         - $ref: '#/components/schemas/UserProfileDto'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *             userId:
 *               type: string
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time
 */
