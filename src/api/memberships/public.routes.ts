import { Router } from 'express';
import prisma from '../../lib/prisma';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
import bcrypt from 'bcrypt';
import { membershipService } from '../../lib/membershipService';

const router = Router();

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
 *       - in: query
 *         name: designationCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL]
 *       - in: query
 *         name: zone
 *         schema:
 *           type: string
 *       - in: query
 *         name: hrcCountryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: hrcStateId
 *         schema:
 *           type: string
 *       - in: query
 *         name: hrcDistrictId
 *         schema:
 *           type: string
 *       - in: query
 *         name: hrcMandalId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability info
 */
router.get('/availability', async (req, res) => {
  try {
    const { cell, designationCode, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.query as any;
    if (!cell || !designationCode || !level) return res.status(400).json({ success: false, error: 'cell, designationCode and level are required' });
    const data = await membershipService.getAvailability({
      cellCodeOrName: String(cell),
      designationCode: String(designationCode),
      level: String(level) as any,
      zone: zone ? String(zone) as any : undefined,
      hrcCountryId: hrcCountryId ? String(hrcCountryId) : undefined,
      hrcStateId: hrcStateId ? String(hrcStateId) : undefined,
      hrcDistrictId: hrcDistrictId ? String(hrcDistrictId) : undefined,
      hrcMandalId: hrcMandalId ? String(hrcMandalId) : undefined,
    });
    return res.json({ success: true, data });
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
