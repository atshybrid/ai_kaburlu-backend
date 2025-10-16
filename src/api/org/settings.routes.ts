import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

const router = Router();

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
      email: s.email,
      phone: s.phone,
      website: s.website,
      authorizedSignatoryName: s.authorizedSignatoryName,
      authorizedSignatoryTitle: s.authorizedSignatoryTitle,
    };
    return res.json({ success: true, data: pub });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'GET_FAILED', message: e?.message });
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
