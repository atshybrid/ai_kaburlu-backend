import { Router } from 'express';
import prisma from '../../lib/prisma';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
import bcrypt from 'bcrypt';
import { membershipService } from '../../lib/membershipService';

const router = Router();

// Helper: validate required geo fields based on level (mirrors pay-first)
function validateGeoByLevel(level: string, q: any): { ok: boolean; error?: string } {
  switch (String(level)) {
    case 'ZONE':
      if (!q.zone) return { ok: false, error: 'zone is required for level ZONE' };
      return { ok: true };
    case 'STATE':
      if (!q.hrcStateId) return { ok: false, error: 'hrcStateId is required for level STATE' };
      return { ok: true };
    case 'DISTRICT':
      if (!q.hrcDistrictId) return { ok: false, error: 'hrcDistrictId is required for level DISTRICT' };
      return { ok: true };
    case 'MANDAL':
      if (!q.hrcMandalId) return { ok: false, error: 'hrcMandalId is required for level MANDAL' };
      return { ok: true };
    case 'NATIONAL':
      return { ok: true };
    default:
      return { ok: false, error: 'Unsupported level' };
  }
}

// Availability with explicit cell and level + geo chain
/**
 * @swagger
 * /memberships/public/availability:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Check seat availability by cell + level + geo
 *     parameters:
 *       - in: query
 *         name: cell
 *         schema:
 *           type: string
 *         description: Cell id/code/name
 *       - in: query
 *         name: designationCode
 *         schema:
 *           type: string
 *         description: Designation code or id
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL]
 *         description: Organizational level (geo fields below are required depending on level)
 *       - in: query
 *         name: zone
 *         schema:
 *           type: string
 *         description: Required when level=ZONE
 *       - in: query
 *         name: hrcCountryId
 *         schema:
 *           type: string
 *         description: Optional unless multi-country support
 *       - in: query
 *         name: hrcStateId
 *         schema:
 *           type: string
 *         description: Required when level=STATE
 *       - in: query
 *         name: hrcDistrictId
 *         schema:
 *           type: string
 *         description: Required when level=DISTRICT
 *       - in: query
 *         name: hrcMandalId
 *         schema:
 *           type: string
 *         description: Required when level=MANDAL
 *       - in: query
 *         name: includeAggregate
 *         schema:
 *           type: boolean
 *         description: Set true to include aggregate capacity for the cell+level under data.aggregate (defaults to false)
 *     responses:
 *       200:
 *         description: Availability info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     capacity: { type: integer }
 *                     used: { type: integer }
 *                     remaining: { type: integer }
 *                     fee: { type: integer }
 *                     validityDays: { type: integer }
 *                     aggregate:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         capacity: { type: integer }
 *                         used: { type: integer }
 *                         remaining: { type: integer }
 */
router.get('/availability', async (req, res) => {
  try {
    const { cell, designationCode, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.query as any;
    if (!cell || !designationCode || !level) return res.status(400).json({ success: false, error: 'cell, designationCode and level are required' });

    // Enforce required geo per level to avoid ambiguous capacities
    const geoCheck = validateGeoByLevel(String(level), req.query || {});
    if (!geoCheck.ok) return res.status(400).json({ success: false, error: 'MISSING_LOCATION', message: geoCheck.error });

    const avail: any = await membershipService.getAvailability({
      cellCodeOrName: String(cell),
      designationCode: String(designationCode),
      level: String(level) as any,
      zone: zone ? String(zone) as any : undefined,
      hrcCountryId: hrcCountryId ? String(hrcCountryId) : undefined,
      hrcStateId: hrcStateId ? String(hrcStateId) : undefined,
      hrcDistrictId: hrcDistrictId ? String(hrcDistrictId) : undefined,
      hrcMandalId: hrcMandalId ? String(hrcMandalId) : undefined,
    });
    const result: any = {
      capacity: avail.designation.capacity,
      used: avail.designation.used,
      remaining: avail.designation.remaining,
      fee: avail.designation.fee,
      validityDays: avail.designation.validityDays
    };
    const includeAggregate = String(req.query.includeAggregate || '').toLowerCase() === 'true';
    if (includeAggregate && avail.levelAggregate) {
      result.aggregate = {
        capacity: avail.levelAggregate.capacity,
        used: avail.levelAggregate.used,
        remaining: avail.levelAggregate.remaining
      };
    } else {
      result.aggregate = null;
    }
    return res.json({ success: true, data: result });
  } catch (e: any) {
    const status = /CELL_NOT_FOUND|DESIGNATION_NOT_FOUND|not found|missing/i.test(e?.message) ? 404 : 500;
    return res.status(status).json({ success: false, error: 'FAILED_AVAILABILITY', message: e?.message });
  }
});

// DEPRECATED: Use pay-first flow instead (/memberships/payfirst/orders -> /confirm -> /register)
/*
/**
 * @swagger
 * /memberships/public/register:
 *   post:
 *     tags: [DEPRECATED APIs]
 *     summary: DEPRECATED - Use pay-first flow instead
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mobileNumber:
 *                 type: string
 *               mpin:
 *                 type: string
 *               fullName:
 *                 type: string
 *               dob:
 *                 type: string
 *                 format: date
 *               address:
 *                 type: string
 *               cell:
 *                 type: string
 *               designationCode:
 *                 type: string
 *               level:
 *                 type: string
 *               zone:
 *                 type: string
 *               hrcCountryId:
 *                 type: string
 *               hrcStateId:
 *                 type: string
 *               hrcDistrictId:
 *                 type: string
 *               hrcMandalId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Registration outcome
 */

// DEPRECATED ENDPOINT - Returns helpful error with redirect info
router.post('/register', async (req, res) => {
  return res.status(410).json({ 
    success: false, 
    error: 'ENDPOINT_DEPRECATED', 
    message: 'This endpoint has been deprecated. Use the new pay-first flow for better reliability.',
    newFlow: {
      step1: 'POST /memberships/payfirst/orders - Create payment order',
      step2: 'POST /memberships/payfirst/confirm - Confirm payment', 
      step3: 'POST /memberships/payfirst/register - Complete registration'
    },
    benefits: [
      'Guaranteed seat reservation after payment',
      'No quota blocking by unpaid users',
      'Better error handling and recovery',
      'Simplified registration form'
    ]
  });
});

export default router;

// --------------------
// Public Discount Preview (Simplified: mobile-only, percent-only)
// --------------------

function withinWindow(d: any): boolean {
  const now = new Date();
  if (d.activeFrom && new Date(d.activeFrom) > now) return false;
  if (d.activeTo && new Date(d.activeTo) < now) return false;
  return true;
}

function pickPercentOnly(d: any, baseAmount: number): { amount: number; type: 'PERCENT' | null; percent?: number | null } {
  if (!d) return { amount: 0, type: null, percent: null };
  const percentOk = typeof d.percentOff === 'number' && d.percentOff > 0;
  if (percentOk) return { amount: Math.max(0, Math.floor((baseAmount * d.percentOff) / 100)), type: 'PERCENT', percent: d.percentOff };
  return { amount: 0, type: null, percent: null };
}

/**
 * @swagger
 * /memberships/public/discounts/preview:
 *   get:
 *     tags: [HRCI Membership - Member APIs]
 *     summary: Public preview of applicable discount by mobile
 *     description: "Returns applicable discount percent for a mobile number (no seat parameters). Policy: mobile-number-only and percentage-based discount."
 *     parameters:
 *       - in: query
 *         name: mobileNumber
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Discount preview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     discountPercent: { type: number, nullable: true }
 *                     appliedType: { type: string, nullable: true, enum: [PERCENT] }
 *                     note: { type: string, nullable: true }
 */
router.get('/discounts/preview', async (req, res) => {
  try {
    const { mobileNumber } = req.query as any;
    if (!mobileNumber) return res.status(400).json({ success: false, error: 'mobileNumber required' });
    // Mobile-number-only, percent-only
    let appliedDiscount: any | null = null;
    const candidates = await (prisma as any).discount.findMany({ where: { mobileNumber: String(mobileNumber), status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 3 });
    for (const d of candidates) if (withinWindow(d)) { appliedDiscount = d; break; }
    const discountPercent = appliedDiscount?.percentOff || null;
    const appliedType = discountPercent ? 'PERCENT' : null;
    return res.json({ success: true, data: { discountPercent, appliedType, note: appliedDiscount ? 'Mobile-based percentage discount applied' : null } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'PREVIEW_FAILED', message: e?.message });
  }
});
