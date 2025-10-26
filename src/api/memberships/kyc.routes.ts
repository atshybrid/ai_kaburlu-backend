import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

const router = Router();

// KYC endpoints - using existing "Member APIs" tag from payfirst.routes.ts

// Helper: pick the user's relevant membership (prefer ACTIVE else most recent)
async function pickUserMembership(userId: string) {
  const active = await prisma.membership.findFirst({
    where: { userId, status: 'ACTIVE' as any },
    orderBy: { updatedAt: 'desc' },
    include: { designation: true },
  });
  if (active) return active;
  return prisma.membership.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: { designation: true },
  });
}

/**
 * @swagger
 * /memberships/kyc/pending:
 *   get:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Get all pending KYC submissions (HRCI Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: 
 *           type: string
 *           enum: [PENDING, UNDER_REVIEW, APPROVED, REJECTED]
 *         description: Filter by KYC status (optional, defaults to PENDING)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *         description: Limit number of results (optional, defaults to 50)
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0 }
 *         description: Number of records to skip (optional, defaults to 0)
 *     responses:
 *       200:
 *         description: List of KYC submissions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       membershipId: { type: string }
 *                       status: { type: string }
 *                       remarks: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *                       membership:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           userId: { type: string }
 *                           level: { type: string }
 *                           zone: { type: string, nullable: true }
 *                           hrcCountryId: { type: string, nullable: true }
 *                           hrcStateId: { type: string, nullable: true }
 *                           hrcDistrictId: { type: string, nullable: true }
 *                           hrcMandalId: { type: string, nullable: true }
 *                           cell:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               name: { type: string }
 *                               code: { type: string }
 *                           designation:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               name: { type: string }
 *                               code: { type: string }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     limit: { type: integer }
 *                     offset: { type: integer }
 *       401:
 *         description: Authentication required
 *       403:
 *         description: HRCI Admin access required
 */
router.get('/pending', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const { status = 'PENDING', limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(Math.max(parseInt(String(limit)), 1), 100);
    const offsetNum = Math.max(parseInt(String(offset)), 0);
    
    const where: any = {};
    if (status && ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(String(status))) {
      if (String(status) === 'PENDING') {
        // Include both explicit 'PENDING' and NULL status (default to pending)
        where.OR = [
          { status: 'PENDING' },
          { status: null }
        ];
      } else {
        where.status = String(status);
      }
    }
    
    const [kycRecords, total] = await Promise.all([
      (prisma as any).membershipKyc.findMany({
        where,
        take: limitNum,
        skip: offsetNum,
        orderBy: { createdAt: 'desc' },
        include: {
          membership: {
            select: {
              id: true,
              userId: true,
              level: true,
              zone: true,
              hrcCountryId: true,
              hrcStateId: true,
              hrcDistrictId: true,
              hrcMandalId: true,
              createdAt: true,
              updatedAt: true,
              cell: { select: { id: true, name: true, code: true } },
              designation: { select: { id: true, name: true, code: true } },
              idCard: { select: { cardNumber: true } }
            }
          }
        }
      }),
      (prisma as any).membershipKyc.count({ where })
    ]);
    
    // Normalize status field (null -> 'PENDING') for consistent API response
    const normalizedRecords = kycRecords.map((record: any) => ({
      ...record,
      status: record.status || 'PENDING'
    }));

    return res.json({ 
      success: true, 
      data: normalizedRecords,
      meta: { total, limit: limitNum, offset: offsetNum }
    });
  } catch (e: any) {
    return res.status(500).json({ 
      success: false, 
      error: 'KYC_LIST_FAILED', 
      message: e?.message 
    });
  }
});

/**
 * @swagger
 * /memberships/kyc/{membershipId}:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get KYC details for a membership (JWT required)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: membershipId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: KYC record (may be empty)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id: { type: string }
 *                     membershipId: { type: string }
 *                     aadhaarNumber: { type: string }
 *                     aadhaarFrontUrl: { type: string }
 *                     aadhaarBackUrl: { type: string }
 *                     panNumber: { type: string }
 *                     panCardUrl: { type: string }
 *                     llbRegistrationNumber: { type: string }
 *                     llbSupportDocUrl: { type: string }
 *                     status: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *       404:
 *         description: Membership not found
 */
router.get('/:membershipId', requireAuth, async (req, res, next) => {
  try {
    const membershipId = String(req.params.membershipId);
    // Avoid path collision: if someone hit '/pending' and it routed here, skip to the correct route
    if (membershipId.toLowerCase() === 'pending') return next('route');
    // Delegate '/me' to self handler semantics
    if (membershipId.toLowerCase() === 'me') {
      const user: any = (req as any).user;
      const m = await pickUserMembership(user.id);
      if (!m) return res.status(404).json({ success: false, error: 'NO_MEMBERSHIP' });
      const kyc = await (prisma as any).membershipKyc.findUnique({ where: { membershipId: m.id } }).catch(() => null);
      const hasKyc = !!kyc;
      const status = hasKyc ? (kyc.status || 'PENDING') : 'NOT_SUBMITTED';
      return res.json({ success: true, data: kyc || null, membershipId: m.id, hasKyc, status });
    }
    const user: any = (req as any).user;
    
    // Check if user is HRCI_ADMIN or owns this membership
    const role = user?.role?.name?.toString()?.toLowerCase();
    const isHrcAdmin = role === 'hrci_admin' || role === 'superadmin' || role === 'super_admin';
    
    if (!isHrcAdmin) {
      // Regular user can only view their own KYC
      const membership = await prisma.membership.findFirst({ 
        where: { id: membershipId, userId: user.id } 
      });
      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'FORBIDDEN', 
          message: 'You can only view your own KYC details' 
        });
      }
    }
    
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
 * /memberships/kyc:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Submit or update KYC for a membership (JWT required)
 *     security:
 *       - bearerAuth: []
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
 *               llbRegistrationNumber: { type: string, description: "Required for Legal Secretary positions" }
 *               llbSupportDocUrl: { type: string, description: "Required for Legal Secretary positions" }
 *           example:
 *             membershipId: "membership-uuid-123"
 *             aadhaarNumber: "1234-5678-9012"
 *             aadhaarFrontUrl: "https://example.com/aadhaar-front.jpg"
 *             aadhaarBackUrl: "https://example.com/aadhaar-back.jpg"
 *             panNumber: "ABCDE1234F"
 *             panCardUrl: "https://example.com/pan-card.jpg"
 *     responses:
 *       200:
 *         description: KYC upserted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     membershipId: { type: string }
 *                     aadhaarNumber: { type: string }
 *                     aadhaarFrontUrl: { type: string }
 *                     aadhaarBackUrl: { type: string }
 *                     panNumber: { type: string }
 *                     panCardUrl: { type: string }
 *                     llbRegistrationNumber: { type: string }
 *                     llbSupportDocUrl: { type: string }
 *                     status: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *       400:
 *         description: Missing required fields or LLB validation failed
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Access denied - can only update your own KYC
 *       404:
 *         description: Membership not found
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { membershipId, aadhaarNumber, aadhaarFrontUrl, aadhaarBackUrl, panNumber, panCardUrl, llbRegistrationNumber, llbSupportDocUrl } = req.body || {};
    if (!membershipId) return res.status(400).json({ success: false, error: 'membershipId required' });
    
    const user: any = (req as any).user;
    
    // Check if user is HRCI_ADMIN or owns this membership
    const isHrcAdmin = user?.role?.name?.toString()?.toLowerCase() === 'hrci_admin';
    const isSuperAdmin = user?.role?.name?.toString()?.toLowerCase() === 'superadmin';
    
    if (!isHrcAdmin && !isSuperAdmin) {
      // Regular user can only update their own KYC
      const ownsMembership = await prisma.membership.findFirst({ 
        where: { id: String(membershipId), userId: user.id } 
      });
      if (!ownsMembership) {
        return res.status(403).json({ 
          success: false, 
          error: 'FORBIDDEN', 
          message: 'You can only update your own KYC details' 
        });
      }
    }
    
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

/**
 * @swagger
 * /memberships/kyc/me:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Get your KYC details (JWT required; membership auto-detected)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your KYC record (may be null); includes normalized status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   nullable: true
 *                 membershipId: { type: string }
 *                 hasKyc: { type: boolean }
 *                 status:
 *                   type: string
 *                   description: Normalized KYC status
 *                   enum: [NOT_SUBMITTED, PENDING, UNDER_REVIEW, APPROVED, REJECTED]
 *       404:
 *         description: No membership found for user
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user: any = (req as any).user;
    const m = await pickUserMembership(user.id);
    if (!m) return res.status(404).json({ success: false, error: 'NO_MEMBERSHIP' });
    const kyc = await (prisma as any).membershipKyc.findUnique({ where: { membershipId: m.id } }).catch(() => null);
    const hasKyc = !!kyc;
    const status = hasKyc ? (kyc.status || 'PENDING') : 'NOT_SUBMITTED';
    return res.json({ success: true, data: kyc || null, membershipId: m.id, hasKyc, status });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'KYC_ME_GET_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /memberships/kyc/me:
 *   post:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Submit or update your KYC (JWT required; membership auto-detected)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               aadhaarNumber: { type: string }
 *               aadhaarFrontUrl: { type: string }
 *               aadhaarBackUrl: { type: string }
 *               panNumber: { type: string }
 *               panCardUrl: { type: string }
 *               llbRegistrationNumber: { type: string }
 *               llbSupportDocUrl: { type: string }
 *     responses:
 *       200:
 *         description: KYC upserted successfully
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: No membership found for user
 */
router.post('/me', requireAuth, async (req, res) => {
  try {
    const user: any = (req as any).user;
    const m = await pickUserMembership(user.id);
    if (!m) return res.status(404).json({ success: false, error: 'NO_MEMBERSHIP' });

    const { aadhaarNumber, aadhaarFrontUrl, aadhaarBackUrl, panNumber, panCardUrl, llbRegistrationNumber, llbSupportDocUrl } = req.body || {};
    // Enforce LLB for Legal Secretary
    const legalSec = (m as any).designation?.code && /LEGAL[_\s-]*SECRETARY/i.test((m as any).designation.code);
    if (legalSec && (!llbRegistrationNumber || !llbSupportDocUrl)) {
      return res.status(400).json({ success: false, error: 'LLB_REQUIRED', message: 'LLB registration number and support document are required for Legal Secretary' });
    }

    const data: any = {
      membershipId: m.id,
      aadhaarNumber: aadhaarNumber || null,
      aadhaarFrontUrl: aadhaarFrontUrl || null,
      aadhaarBackUrl: aadhaarBackUrl || null,
      panNumber: panNumber || null,
      panCardUrl: panCardUrl || null,
      llbRegistrationNumber: llbRegistrationNumber || null,
      llbSupportDocUrl: llbSupportDocUrl || null,
    };

    const existing = await (prisma as any).membershipKyc.findUnique({ where: { membershipId: m.id } }).catch(() => null);
    const saved = existing
      ? await (prisma as any).membershipKyc.update({ where: { membershipId: m.id }, data })
      : await (prisma as any).membershipKyc.create({ data });

    return res.json({ success: true, data: saved, membershipId: m.id });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'KYC_ME_SAVE_FAILED', message: e?.message });
  }
});


/**
 * @swagger
 * /memberships/kyc/{membershipId}/approve:
 *   put:
 *     tags: [HRCI Membership - Admin APIs]
 *     summary: Approve or reject KYC (HRCI Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: membershipId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: 
 *                 type: string
 *                 enum: [APPROVED, REJECTED, PENDING]
 *                 description: KYC approval status
 *               remarks:
 *                 type: string
 *                 description: Optional remarks for approval/rejection
 *           example:
 *             status: "APPROVED"
 *             remarks: "All documents verified successfully"
 *     responses:
 *       200:
 *         description: KYC status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     membershipId: { type: string }
 *                     status: { type: string }
 *                     remarks: { type: string }
 *                     updatedAt: { type: string, format: date-time }
 *       400:
 *         description: Invalid status value
 *       401:
 *         description: Authentication required
 *       403:
 *         description: HRCI Admin access required
 *       404:
 *         description: KYC record not found
 */
router.put('/:membershipId/approve', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const membershipId = String(req.params.membershipId);
    const { status, remarks } = req.body || {};
    const user: any = (req as any).user;
    
    if (!status || !['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'INVALID_STATUS', 
        message: 'Status must be APPROVED, REJECTED, or PENDING' 
      });
    }
    
    // Check if KYC exists
    const existingKyc = await (prisma as any).membershipKyc.findUnique({ 
      where: { membershipId } 
    });
    
    if (!existingKyc) {
      return res.status(404).json({ 
        success: false, 
        error: 'KYC_NOT_FOUND', 
        message: 'KYC record not found for this membership' 
      });
    }
    
    // Update KYC with approval status
    const updateData: any = {
      status,
    };
    
    if (remarks) {
      updateData.remarks = remarks;
    }
    
    const updatedKyc = await (prisma as any).membershipKyc.update({
      where: { membershipId },
      data: updateData,
    });
    
    return res.json({ success: true, data: updatedKyc });
  } catch (e: any) {
    return res.status(500).json({ 
      success: false, 
      error: 'KYC_APPROVAL_FAILED', 
      message: e?.message 
    });
  }
});

export default router;
