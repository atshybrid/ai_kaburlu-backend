import { Router } from 'express';
import passport from 'passport';
// Inline role guard (avoids module resolution issue); keep original file but not required here
function ensureSuperAdminOrManager(req: any, res: any, next: any) {
  const roleName = (req.user?.role?.name || '').toUpperCase();
  if (['SUPER_ADMIN', 'SUPERADMIN', 'NEWS_DESK_ADMIN', 'LANGUAGE_ADMIN'].includes(roleName)) return next();
  return res.status(403).json({ error: 'Forbidden: insufficient role' });
}
import { validationMiddleware } from '../middlewares/validation.middleware';
import { PaymentOrderRequestDto, VolunteerOnboardDto, VolunteerOnboardDtoExtended, IdCardIssueDto, CreateCaseDto, ListCasesQueryDto, CaseUpdateDto, CaseAssignDto, CaseStatusChangeDto, CaseAttachmentDto, CreateIdCardPlanDto, ListIdCardPlansQueryDto } from './hrc.dto';
import { validatePlanApplicability } from './hrc.plan.util';
import { verifyRazorpaySignature } from './hrc.razorpay';
import prisma from '../../lib/prisma';
import { resolveFee } from './hrc.fees.service';
import { createRazorpayOrder } from './hrc.razorpay';
import { createCase, listCases, getCaseById, addCaseUpdate, assignCase, changeCaseStatus, addAttachment } from './hrc.cases.service';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: Human Rights & Citizen Initiative module (volunteers, teams, ID cards, cases, donations)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PaymentOrderRequestDto:
 *       type: object
 *       required: [purpose]
 *       properties:
 *         purpose:
 *           type: string
 *           enum: [ID_CARD_ISSUE, ID_CARD_RENEW, DONATION, OTHER]
 *         teamId:
 *           type: string
 *         mandalId:
 *           type: string
 *         districtId:
 *           type: string
 *         stateId:
 *           type: string
 *         amountMinorOverride:
 *           type: integer
 *           description: Required for DONATION if no fee config
 *         currency:
 *           type: string
 *           example: INR
 *     PaymentOrderResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         paymentTransactionId:
 *           type: string
 *         order:
 *           type: object
 *           description: Razorpay order payload
 *     VolunteerOnboardDto:
 *       type: object
 *       properties:
 *         userId:
 *           type: string
 *         teamIds:
 *           type: array
 *           items:
 *             type: string
 *         bio:
 *           type: string
 *         aadhaarNumber:
 *           type: string
 *     VolunteerOnboardDtoExtended:
 *       type: object
 *       allOf:
 *         - $ref: '#/components/schemas/VolunteerOnboardDto'
 *         - type: object
 *           properties:
 *             hierarchyLevel:
 *               type: string
 *               enum: [NHRC, SHRC, DISTRICT, MANDAL, VILLAGE]
 *             countryCode:
 *               type: string
 *             stateId:
 *               type: string
 *             districtId:
 *               type: string
 *             mandalId:
 *               type: string
 *             villageName:
 *               type: string
 *             fullName:
 *               type: string
 *             cellId:
 *               type: string
 *             idCardPlanId:
 *               type: string
 *     CreateIdCardPlanDto:
 *       type: object
 *       required: [name, amountMinor]
 *       properties:
 *         name: { type: string }
 *         description: { type: string }
 *         amountMinor: { type: integer }
 *         currency: { type: string, example: INR }
 *         renewalDays: { type: integer, example: 365 }
 *         allowedHierarchyLevels: { type: array, items: { type: string, enum: [NHRC, SHRC, DISTRICT, MANDAL, VILLAGE] } }
 *         stateId: { type: string }
 *         districtId: { type: string }
 *         mandalId: { type: string }
 *         isActive: { type: boolean }
 *     ListIdCardPlansQueryDto:
 *       type: object
 *       properties:
 *         active: { type: boolean }
 *         hierarchyLevel: { type: string, enum: [NHRC, SHRC, DISTRICT, MANDAL, VILLAGE] }
 *         stateId: { type: string }
 *         districtId: { type: string }
 *         mandalId: { type: string }
 *         skip: { type: integer }
 *         take: { type: integer }
 *     IdCardIssueDto:
 *       type: object
 *       required: [paymentTransactionId]
 *       properties:
 *         paymentTransactionId:
 *           type: string
 *         providerPaymentId:
 *           type: string
 *         providerSignature:
 *           type: string
 *         renewalIntervalMonths:
 *           type: integer
 *     CreateCaseDto:
 *       type: object
 *       required: [title, description]
 *       properties:
 *         title: { type: string }
 *         description: { type: string }
 *         priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *         teamId: { type: string }
 *         assignedToVolunteerId: { type: string }
 *         locationStateId: { type: string }
 *         locationDistrictId: { type: string }
 *         locationMandalId: { type: string }
 *     CaseUpdateDto:
 *       type: object
 *       properties:
 *         note: { type: string }
 *         newStatus: { type: string, enum: [NEW, UNDER_REVIEW, IN_PROGRESS, ESCALATED, RESOLVED, CLOSED, REJECTED] }
 *     CaseAssignDto:
 *       type: object
 *       properties:
 *         teamId: { type: string }
 *         assignedToVolunteerId: { type: string }
 *     CaseStatusChangeDto:
 *       type: object
 *       required: [status]
 *       properties:
 *         status: { type: string, enum: [NEW, UNDER_REVIEW, IN_PROGRESS, ESCALATED, RESOLVED, CLOSED, REJECTED] }
 *         note: { type: string }
 *     CaseAttachmentDto:
 *       type: object
 *       required: [url]
 *       properties:
 *         url: { type: string }
 *         mimeType: { type: string }
 */

// HEALTH / VERSION
router.get('/health', (_req, res) => {
  res.json({ success: true, module: 'HRCI', status: 'scaffold', version: 1 });
});

// --- ID CARD PLANS ---
/**
 * @swagger
 * /api/v1/hrc/idcard-plans:
 *   post:
 *     summary: Create ID card subscription plan
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateIdCardPlanDto'
 *     responses:
 *       200:
 *         description: Plan created
 *   get:
 *     summary: List ID card subscription plans
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema: { type: boolean }
 *       - in: query
 *         name: hierarchyLevel
 *         schema: { type: string, enum: [NHRC, SHRC, DISTRICT, MANDAL, VILLAGE] }
 *       - in: query
 *         name: stateId
 *         schema: { type: string }
 *       - in: query
 *         name: districtId
 *         schema: { type: string }
 *       - in: query
 *         name: mandalId
 *         schema: { type: string }
 *       - in: query
 *         name: skip
 *         schema: { type: integer }
 *       - in: query
 *         name: take
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Plans list
 */
router.post('/idcard-plans', passport.authenticate('jwt', { session: false }), ensureSuperAdminOrManager, validationMiddleware(CreateIdCardPlanDto), async (req: any, res) => {
  try {
    const body = req.body as CreateIdCardPlanDto;
    const plan = await (prisma as any).hrcIdCardPlan.create({
      data: {
        planName: body.name,
        amountMinor: body.amountMinor,
        currency: body.currency || 'INR',
        renewalDays: body.renewalDays || 365,
        hierarchyLevel: undefined, // mapping allowedHierarchyLevels -> if single level; multi-level left null (global logic handled in applicability util)
        stateId: body.stateId,
        districtId: body.districtId,
        mandalId: body.mandalId,
        active: body.isActive ?? true,
        createdBy: req.user?.id
      }
    });
    // store allowedHierarchyLevels in meta via separate table later; for now ignore multi-level nuance
    res.json({ success: true, plan });
  } catch (e: any) {
    console.error('Create plan error', e);
    res.status(500).json({ error: 'Failed to create plan', message: e?.message });
  }
});

router.get('/idcard-plans', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  try {
    const filters: ListIdCardPlansQueryDto = {
      active: req.query.active !== undefined ? ['true','1','yes'].includes(String(req.query.active).toLowerCase()) : undefined,
      hierarchyLevel: req.query.hierarchyLevel,
      stateId: req.query.stateId,
      districtId: req.query.districtId,
      mandalId: req.query.mandalId,
      skip: req.query.skip ? parseInt(req.query.skip,10) : undefined,
      take: req.query.take ? parseInt(req.query.take,10) : undefined
    } as any;
    const where: any = {};
    if (filters.active !== undefined) where.active = filters.active;
    if (filters.hierarchyLevel) where.hierarchyLevel = filters.hierarchyLevel; // may be null for global
    if (filters.stateId) where.stateId = filters.stateId;
    if (filters.districtId) where.districtId = filters.districtId;
    if (filters.mandalId) where.mandalId = filters.mandalId;
    const plans = await (prisma as any).hrcIdCardPlan.findMany({ where, skip: filters.skip, take: filters.take, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, plans });
  } catch (e: any) {
    console.error('List plan error', e);
    res.status(500).json({ error: 'Failed to list plans', message: e?.message });
  }
});

// --- TEAMS (phase 1 minimal placeholders) ---
router.post('/teams', passport.authenticate('jwt', { session: false }), ensureSuperAdminOrManager, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.get('/teams', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- VOLUNTEERS ---
router.post('/volunteers/onboard', passport.authenticate('jwt', { session: false }), validationMiddleware(VolunteerOnboardDtoExtended), async (req: any, res) => {
  try {
    const userId = req.body.userId || req.user?.id;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const { hierarchyLevel, countryCode, stateId, districtId, mandalId, villageName, cellTypes, fullName, cellId, idCardPlanId } = req.body as any;
    if (hierarchyLevel) {
      if (!countryCode) return res.status(400).json({ error: 'countryCode required for hierarchyLevel' });
      if (['SHRC','DISTRICT','MANDAL','VILLAGE'].includes(hierarchyLevel) && !stateId) return res.status(400).json({ error: 'stateId required' });
      if (['DISTRICT','MANDAL','VILLAGE'].includes(hierarchyLevel) && !districtId) return res.status(400).json({ error: 'districtId required' });
      if (['MANDAL','VILLAGE'].includes(hierarchyLevel) && !mandalId) return res.status(400).json({ error: 'mandalId required' });
      if (hierarchyLevel === 'VILLAGE' && !villageName) return res.status(400).json({ error: 'villageName required' });
    }

    const user = await (prisma as any).user.findUnique({ where: { id: userId }, include: { hrcVolunteerProfile: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Upsert fullName into profile (assuming user has profile or we store in user.name fallback)
    if (fullName) {
      // try userProfile
      try {
        await (prisma as any).userProfile.upsert({ where: { userId }, update: { fullName }, create: { userId, fullName } });
      } catch (_) {
        // fallback: update user name if column exists
        try { await (prisma as any).user.update({ where: { id: userId }, data: { name: fullName } }); } catch (_) { /* ignore */ }
      }
    }

    let volunteer = user.hrcVolunteerProfile;
    if (!volunteer) {
      volunteer = await (prisma as any).hrcVolunteerProfile.create({ data: { userId, bio: req.body.bio, aadhaarNumber: req.body.aadhaarNumber, addressLine1: req.body.addressLine1, addressLine2: req.body.addressLine2, pincode: req.body.pincode, active: true } });
    } else if (req.body.bio || req.body.aadhaarNumber) {
      volunteer = await (prisma as any).hrcVolunteerProfile.update({ where: { id: volunteer.id }, data: { bio: req.body.bio ?? volunteer.bio, aadhaarNumber: req.body.aadhaarNumber ?? volunteer.aadhaarNumber, addressLine1: req.body.addressLine1 ?? volunteer.addressLine1, addressLine2: req.body.addressLine2 ?? volunteer.addressLine2, pincode: req.body.pincode ?? volunteer.pincode, active: true } });
    }

    // Base team (non-cell) for the hierarchy level
    const autoTeams: string[] = [];
    if (hierarchyLevel) {
      let baseName = '';
      let scopeLevel = 'GLOBAL';
      const baseData: any = { active: true };
      switch (hierarchyLevel) {
        case 'NHRC': baseName = 'NHRC Country Cell'; scopeLevel = 'COUNTRY'; baseData.countryCode = countryCode; break;
        case 'SHRC': baseName = `SHRC State Cell ${stateId}`; scopeLevel = 'STATE'; baseData.stateId = stateId; break;
        case 'DISTRICT': baseName = `District Human Rights Volunteer ${districtId}`; scopeLevel = 'DISTRICT'; baseData.districtId = districtId; break;
        case 'MANDAL': baseName = `Mandal Human Rights Volunteer ${mandalId}`; scopeLevel = 'MANDAL'; baseData.mandalId = mandalId; break;
        case 'VILLAGE': baseName = `Village Committee ${villageName}`; scopeLevel = 'MANDAL'; baseData.mandalId = mandalId; break;
      }
      const baseTeam = await (prisma as any).hrcTeam.upsert({ where: { name: baseName }, update: {}, create: { name: baseName, scopeLevel, ...baseData, description: `Auto-created base team for ${hierarchyLevel}` } });
      autoTeams.push(baseTeam.id);

      // Cell teams
      if (Array.isArray(cellTypes) && cellTypes.length) {
        for (const cellType of cellTypes) {
          let cellName = '';
          switch (cellType) {
            case 'COMPLAINT_LEGAL_SUPPORT': cellName = `${baseName} - Complaint & Legal Support`; break;
            case 'WOMEN_CHILD_RIGHTS': cellName = `${baseName} - Women & Child Rights`; break;
            case 'SOCIAL_JUSTICE': cellName = `${baseName} - Social Justice`; break;
            case 'AWARENESS_EDUCATION': cellName = `${baseName} - Awareness & Education`; break;
            default: cellName = `${baseName} - Cell`; break;
          }
          const cellTeam = await (prisma as any).hrcTeam.upsert({ where: { name: cellName }, update: {}, create: { name: cellName, scopeLevel, ...baseData, description: `Auto-created cell team ${cellType}`, cellType } });
          autoTeams.push(cellTeam.id);
        }
      }
    }

    const teamIds: string[] = [...(req.body.teamIds || []), ...autoTeams];
    // attach explicit cellId if provided (must reference a team with cellType)
    if (cellId) {
      const cellTeam = await (prisma as any).hrcTeam.findUnique({ where: { id: cellId } });
      if (!cellTeam || !cellTeam.cellType) return res.status(400).json({ error: 'cellId invalid or not a cell team' });
      if (!teamIds.includes(cellId)) teamIds.push(cellId);
    }
    const memberships: any[] = [];
    for (const tId of teamIds) {
      const team = await (prisma as any).hrcTeam.findUnique({ where: { id: tId } });
      if (!team) continue;
      const member = await (prisma as any).hrcTeamMember.upsert({ where: { teamId_volunteerId: { teamId: tId, volunteerId: volunteer.id } }, update: { active: true }, create: { teamId: tId, volunteerId: volunteer.id, membershipRole: 'MEMBER' } });
      memberships.push(member);
    }

    // If plan specified attempt immediate ID card creation (free issuance path - no payment here)
    let issuedIdCard: any = null;
    if (idCardPlanId) {
      const vContext = { planId: idCardPlanId, hierarchyLevel, stateId, districtId, mandalId };
      const validation = await validatePlanApplicability(vContext);
      if (!validation.ok) return res.status(400).json({ error: 'Plan not applicable', reason: validation.reason });
      const plan = validation.plan as any;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (plan.renewalDays || 365));
      issuedIdCard = await (prisma as any).hrcIdCard.create({ data: {
        volunteerId: volunteer.id,
        planId: plan.id,
        expiryDate: expiry,
        renewalIntervalMonths: Math.round((plan.renewalDays || 365)/30),
        feeAmountMinor: plan.amountMinor,
        currency: plan.currency,
        status: 'ACTIVE'
      }});
    }
    res.json({ success: true, volunteer, membershipsCount: memberships.length, autoTeamsCreated: autoTeams.length, idCardIssued: !!issuedIdCard, idCard: issuedIdCard });
  } catch (e: any) {
    console.error('Volunteer onboard error', e);
    res.status(500).json({ error: 'Failed to onboard volunteer', message: e?.message });
  }
});

/**
 * @swagger
 * /api/v1/hrc/payments/order:
 *   post:
 *     summary: Create payment order (Razorpay) for ID card or donation
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentOrderRequestDto'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentOrderResponse'
 */

// --- ID CARDS ---
router.post('/idcards/issue', passport.authenticate('jwt', { session: false }), validationMiddleware(IdCardIssueDto), async (req: any, res) => {
  try {
    const { paymentTransactionId, providerPaymentId, providerSignature, renewalIntervalMonths } = req.body as IdCardIssueDto;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    // Load transaction
    const txn = await (prisma as any).paymentTransaction.findUnique({ where: { id: paymentTransactionId } });
    if (!txn) return res.status(404).json({ error: 'Payment transaction not found' });
    if (txn.purpose !== 'ID_CARD_ISSUE' && txn.purpose !== 'ID_CARD_RENEW') return res.status(400).json({ error: 'Invalid purpose for ID card issuance' });

    // Optionally verify signature if provided
    if (providerPaymentId && providerSignature) {
      if (!txn.providerOrderId) return res.status(400).json({ error: 'Transaction missing providerOrderId for signature check' });
      const ok = verifyRazorpaySignature(txn.providerOrderId, providerPaymentId, providerSignature);
      if (!ok) return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Mark transaction paid if still pending
    if (txn.status === 'PENDING' || txn.status === 'CREATED') {
      await (prisma as any).paymentTransaction.update({ where: { id: txn.id }, data: { status: 'PAID', providerPaymentId, providerSignature, paidAt: new Date() } });
    }

    // Ensure volunteer exists (auto create profile if missing)
    let volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId } });
    if (!volunteer) {
      volunteer = await (prisma as any).hrcVolunteerProfile.create({ data: { userId, active: true } });
    }

    const interval = renewalIntervalMonths || txn.meta?.renewalIntervalMonths || 12;
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + interval);

    // Create ID card (one active at a time rule – optional future enhancement: revoke current active first)
    const idCard = await (prisma as any).hrcIdCard.create({
      data: {
        volunteerId: volunteer.id,
        expiryDate,
        renewalIntervalMonths: interval,
        feeAmountMinor: txn.amountMinor,
        currency: txn.currency,
        status: 'ACTIVE',
        paymentTxnId: txn.id
      }
    });

    res.json({ success: true, idCard });
  } catch (e: any) {
    console.error('ID card issue error', e);
    res.status(500).json({ error: 'Failed to issue ID card', message: e?.message });
  }
});

// --- CASES ---
router.post('/cases', passport.authenticate('jwt', { session: false }), validationMiddleware(CreateCaseDto), async (req: any, res) => {
  try {
    // Ensure user has volunteer profile
    let volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId: req.user.id } });
    if (!volunteer) {
      return res.status(400).json({ error: 'User is not a volunteer' });
    }
    const body = req.body as CreateCaseDto;
    const created = await createCase({
      title: body.title,
      description: body.description,
      priority: body.priority,
      reporterVolunteerId: volunteer.id,
      teamId: body.teamId,
      assignedToVolunteerId: body.assignedToVolunteerId,
      locationStateId: body.locationStateId,
      locationDistrictId: body.locationDistrictId,
      locationMandalId: body.locationMandalId
    });
    res.json({ success: true, case: created });
  } catch (e: any) {
    console.error('Create case error', e);
    res.status(500).json({ error: 'Failed to create case', message: e?.message });
  }
});

// List cases
router.get('/cases', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  try {
    const filters: ListCasesQueryDto = {
      status: req.query.status,
      priority: req.query.priority,
      teamId: req.query.teamId,
      reporterId: req.query.reporterId,
      assignedToId: req.query.assignedToId,
      skip: req.query.skip ? parseInt(req.query.skip, 10) : undefined,
      take: req.query.take ? parseInt(req.query.take, 10) : undefined
    };
    const results = await listCases(filters);
    res.json({ success: true, cases: results });
  } catch (e: any) {
    console.error('List cases error', e);
    res.status(500).json({ error: 'Failed to list cases', message: e?.message });
  }
});

// Get case detail
router.get('/cases/:id', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
  try {
    const c = await getCaseById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Case not found' });
    res.json({ success: true, case: c });
  } catch (e: any) {
    console.error('Get case error', e);
    res.status(500).json({ error: 'Failed to load case', message: e?.message });
  }
});

// Add update to case
router.post('/cases/:id/updates', passport.authenticate('jwt', { session: false }), validationMiddleware(CaseUpdateDto), async (req: any, res) => {
  try {
    const caseId = req.params.id;
    const volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId: req.user.id } });
    const upd = await addCaseUpdate({ caseId, authorVolunteerId: volunteer?.id, note: req.body.note, newStatus: req.body.newStatus });
    res.json({ success: true, update: upd });
  } catch (e: any) {
    console.error('Add case update error', e);
    res.status(500).json({ error: 'Failed to add case update', message: e?.message });
  }
});

// Assign case
router.patch('/cases/:id/assign', passport.authenticate('jwt', { session: false }), validationMiddleware(CaseAssignDto), async (req: any, res) => {
  try {
    // TODO: permission check for assignment (admin / coordinator)
    const c = await assignCase({ caseId: req.params.id, teamId: req.body.teamId, assignedToVolunteerId: req.body.assignedToVolunteerId });
    res.json({ success: true, case: c });
  } catch (e: any) {
    console.error('Assign case error', e);
    res.status(500).json({ error: 'Failed to assign case', message: e?.message });
  }
});

// Change status
router.patch('/cases/:id/status', passport.authenticate('jwt', { session: false }), validationMiddleware(CaseStatusChangeDto), async (req: any, res) => {
  try {
    // TODO: permission check
    const volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId: req.user.id } });
    const upd = await changeCaseStatus({ caseId: req.params.id, status: req.body.status, note: req.body.note, authorVolunteerId: volunteer?.id });
    res.json({ success: true, update: upd });
  } catch (e: any) {
    console.error('Status change error', e);
    res.status(500).json({ error: 'Failed to change status', message: e?.message });
  }
});

// Add attachment
router.post('/cases/:id/attachments', passport.authenticate('jwt', { session: false }), validationMiddleware(CaseAttachmentDto), async (req: any, res) => {
  try {
    const volunteer = await (prisma as any).hrcVolunteerProfile.findUnique({ where: { userId: req.user.id } });
    const att = await addAttachment({ caseId: req.params.id, url: req.body.url, mimeType: req.body.mimeType, uploadedByVolunteerId: volunteer?.id });
    res.json({ success: true, attachment: att });
  } catch (e: any) {
    console.error('Add attachment error', e);
    res.status(500).json({ error: 'Failed to add attachment', message: e?.message });
  }
});


router.post('/payments/order', passport.authenticate('jwt', { session: false }), validationMiddleware(PaymentOrderRequestDto), async (req: any, res) => {
  try {
    const { purpose, teamId, mandalId, districtId, stateId, amountMinorOverride, currency } = req.body as PaymentOrderRequestDto;

    // Resolve fee unless override provided for donation
    let amountMinor: number | undefined;
    let renewalIntervalMonths: number | undefined;
    if (purpose === 'DONATION' && amountMinorOverride) {
      amountMinor = amountMinorOverride;
    } else {
      const fee = await resolveFee({ purpose: purpose as any, teamId, mandalId, districtId, stateId });
      if (!fee) return res.status(404).json({ error: 'Fee configuration not found' });
      amountMinor = fee.amountMinor;
      renewalIntervalMonths = fee.renewalIntervalMonths || undefined;
    }
    if (!amountMinor || amountMinor <= 0) return res.status(400).json({ error: 'Invalid amount resolved' });

    const cur = currency || process.env.HRCI_DEFAULT_CURRENCY || 'INR';
    const receipt = `HRC-${purpose}-${Date.now()}`;

    // Create PaymentTransaction (status CREATED)
  const paymentTxn = await (prisma as any).paymentTransaction.create({
      data: {
        purpose: purpose as any,
        amountMinor,
        currency: cur,
        status: 'CREATED',
        meta: { teamId, mandalId, districtId, stateId, renewalIntervalMonths }
      }
    });

    // Create Razorpay order
    const order = await createRazorpayOrder({ amountMinor, currency: cur, receipt, notes: { paymentTxnId: paymentTxn.id, purpose } });

    // Update transaction with provider order id
  await (prisma as any).paymentTransaction.update({ where: { id: paymentTxn.id }, data: { providerOrderId: order.id, status: 'PENDING' } });

    res.json({ success: true, paymentTransactionId: paymentTxn.id, order });
  } catch (e: any) {
    console.error('Payment order error', e);
    res.status(500).json({ error: 'Failed to create payment order', message: e?.message });
  }
});

/**
 * @swagger
 * /api/v1/hrc/volunteers/onboard:
 *   post:
 *     summary: Onboard user as volunteer and optionally attach to teams
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VolunteerOnboardDto'
 *     responses:
 *       200:
 *         description: Volunteer onboarded
 */

/**
 * @swagger
 * /api/v1/hrc/idcards/issue:
 *   post:
 *     summary: Issue (or finalize) ID card after successful payment
 *     tags: [HRCI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IdCardIssueDto'
 *     responses:
 *       200:
 *         description: ID card issued
 */

router.post('/payments/webhook', (_req, res) => {
  // signature verification will be added; keep body raw (configure in app when implementing)
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
