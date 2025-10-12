import { Router } from 'express';
import prisma from '../../lib/prisma';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Memberships KYC
 *   description: Public KYC submission for memberships
 */

/**
 * @swagger
 * /memberships/public/kyc/{membershipId}:
 *   get:
 *     tags: [Memberships KYC]
 *     summary: Get KYC details for a membership
 *     parameters:
 *       - in: path
 *         name: membershipId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: KYC record (may be empty)
 */
router.get('/:membershipId', async (req, res) => {
  try {
    const membershipId = String(req.params.membershipId);
    const m = await prisma.membership.findUnique({ where: { id: membershipId } });
    if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });
  const kyc = await (prisma as any).membershipKyc.findUnique({ where: { membershipId } }).catch(() => null);
    return res.json({ success: true, data: kyc || null });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'KYC_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/public/kyc:
 *   post:
 *     tags: [Memberships KYC]
 *     summary: Submit or update KYC for a membership
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [membershipId]
 *             properties:
 *               membershipId: { type: string }
 *               aadhaarNumber: { type: string }
 *               aadhaarFrontUrl: { type: string }
 *               aadhaarBackUrl: { type: string }
 *               panNumber: { type: string }
 *               panCardUrl: { type: string }
 *               llbRegistrationNumber: { type: string }
 *               llbSupportDocUrl: { type: string }
 *     responses:
 *       200:
 *         description: KYC upserted
 */
router.post('/', async (req, res) => {
  try {
    const { membershipId, aadhaarNumber, aadhaarFrontUrl, aadhaarBackUrl, panNumber, panCardUrl, llbRegistrationNumber, llbSupportDocUrl } = req.body || {};
    if (!membershipId) return res.status(400).json({ success: false, error: 'membershipId required' });
    const m = await prisma.membership.findUnique({ where: { id: String(membershipId) }, include: { designation: true } });
    if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });

    // Basic server-side requirement: if designation code indicates Legal Secretary, require LLB fields
    const legalSec = (m as any).designation?.code && /LEGAL[_\s-]*SECRETARY/i.test((m as any).designation.code);
    if (legalSec && (!llbRegistrationNumber || !llbSupportDocUrl)) {
      return res.status(400).json({ success: false, error: 'LLB_REQUIRED', message: 'LLB registration number and support document are required for Legal Secretary' });
    }

    const data: any = {
      membershipId: String(membershipId),
      aadhaarNumber: aadhaarNumber || null,
      aadhaarFrontUrl: aadhaarFrontUrl || null,
      aadhaarBackUrl: aadhaarBackUrl || null,
      panNumber: panNumber || null,
      panCardUrl: panCardUrl || null,
      llbRegistrationNumber: llbRegistrationNumber || null,
      llbSupportDocUrl: llbSupportDocUrl || null,
    };

    const existing = await (prisma as any).membershipKyc.findUnique({ where: { membershipId: String(membershipId) } }).catch(() => null);
    let saved;
    if (existing) {
      saved = await (prisma as any).membershipKyc.update({ where: { membershipId: String(membershipId) }, data });
    } else {
      saved = await (prisma as any).membershipKyc.create({ data });
    }
    return res.json({ success: true, data: saved });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'KYC_SAVE_FAILED', message: e?.message });
  }
});

export default router;
