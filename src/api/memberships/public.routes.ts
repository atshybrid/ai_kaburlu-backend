import { Router } from 'express';
import prisma from '../../lib/prisma';
import { generateNextIdCardNumber } from '../../lib/idCardNumber';
import bcrypt from 'bcrypt';
import { membershipService } from '../../lib/membershipService';

/**
 * @swagger
 * tags:
 *   name: Memberships Public
 *   description: Public membership onboarding APIs
 */
const router = Router();

// Availability with explicit cell and level + geo chain
/**
 * @swagger
 * /memberships/public/availability:
 *   get:
 *     tags: [Memberships Public]
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

// Public registration and join: creates/uses user by mobile, hashes mpin, then join seat.
/**
 * @swagger
 * /memberships/public/register:
 *   post:
 *     tags: [Memberships Public]
 *     summary: Register user and join membership seat
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
router.post('/register', async (req, res) => {
  try {
    const { mobileNumber, mpin, fullName, dob, address, cell, designationCode, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body || {};
    if (!mobileNumber || !mpin || !fullName || !cell || !designationCode || !level) {
      return res.status(400).json({ success: false, error: 'mobileNumber, mpin, fullName, cell, designationCode, level are required' });
    }
    // Find or create user by mobile
    let user = await prisma.user.findFirst({ where: { mobileNumber: String(mobileNumber) } });
    const mpinHash = await bcrypt.hash(String(mpin), 10);
    if (!user) {
      // Minimal required fields: roleId and languageId are required in schema; pick defaults
      const role = await prisma.role.findFirst({ where: { name: { in: ['USER','user'] as any } } }) || await prisma.role.findFirst();
      const lang = await prisma.language.findFirst();
      if (!role || !lang) return res.status(500).json({ success: false, error: 'CONFIG_MISSING', message: 'Default role or language missing' });
  user = await prisma.user.create({ data: { mobileNumber: String(mobileNumber), mpin: null as any, mpinHash, roleId: role.id, languageId: (lang as any).id, status: 'PENDING' } });
    } else {
      // Update mpinHash
  await prisma.user.update({ where: { id: user.id }, data: { mpin: null as any, mpinHash } });
    }
    // Optional profile upsert
    await prisma.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, fullName, dob: dob ? new Date(dob) : undefined, address: address ? { text: String(address) } as any : undefined }, update: { fullName, dob: dob ? new Date(dob) : undefined, address: address ? { text: String(address) } as any : undefined } });

    // Join membership seat
    const join = await membershipService.joinSeat({
      userId: user.id,
      cellCodeOrName: String(cell),
      designationCode: String(designationCode),
      level: String(level) as any,
      zone: zone ? String(zone) as any : undefined,
      hrcCountryId: hrcCountryId || undefined,
      hrcStateId: hrcStateId || undefined,
      hrcDistrictId: hrcDistrictId || undefined,
      hrcMandalId: hrcMandalId || undefined
    } as any);

    // If fee=0, upgrade membership to ACTIVE immediately and create ID card
    let order: any = null;
    let idCardCreated = false; let idCardReason: string | null = null;
    if (join.accepted && !join.requiresPayment) {
      await prisma.membership.update({ where: { id: join.membershipId }, data: { status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', activatedAt: new Date() } });
      // Issue ID card only if profile with photo present
      const userWithProfile = await prisma.user.findUnique({ where: { id: user.id }, include: { profile: true } });
      const hasPhoto = !!(userWithProfile?.profile?.profilePhotoUrl || userWithProfile?.profile?.profilePhotoMediaId);
      if (!userWithProfile?.profile || !hasPhoto) {
        idCardCreated = false; idCardReason = 'PROFILE_PHOTO_REQUIRED';
      } else {
  const cardNumber = await generateNextIdCardNumber(prisma);
        // Snapshot fields
        let designationName: string | undefined; let cellName: string | undefined;
        try {
          const mem = await prisma.membership.findUnique({ where: { id: join.membershipId }, include: { designation: true, cell: true } });
          designationName = (mem as any)?.designation?.name || undefined;
          cellName = (mem as any)?.cell?.name || undefined;
        } catch {}
        await prisma.iDCard.create({ data: { membershipId: join.membershipId, cardNumber, expiresAt: new Date(Date.now() + 365*24*60*60*1000), fullName, mobileNumber, designationName, cellName } as any });
        idCardCreated = true;
      }
    } else if (join.accepted && join.requiresPayment) {
      // Prepare placeholder order (front-end will process payment)
      order = { orderId: `rzp_${join.membershipId}`, amount: join.fee, currency: 'INR' };
    }

    return res.json({ success: true, data: { userId: user.id, membershipId: join.membershipId, paymentRequired: join.requiresPayment, amount: join.fee, order, idCardCreated, idCardReason } });
  } catch (e: any) {
    const status = /CELL_NOT_FOUND|DESIGNATION_NOT_FOUND|not found|missing/i.test(e?.message) ? 404 : (/capacity|NO_SEATS/i.test(e?.message) ? 400 : 500);
    return res.status(status).json({ success: false, error: 'REGISTER_FAILED', message: e?.message });
  }
});

export default router;
