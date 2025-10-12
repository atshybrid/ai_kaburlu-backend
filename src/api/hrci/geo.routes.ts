import { Router } from 'express';
import prisma from '../../lib/prisma';

const router = Router();
// Use the existing shared prisma instance (ensures models after generate)

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: HRCI Geography APIs
 */

/**
 * @swagger
 * /hrci/geo/zones:
 *   get:
 *     tags: [HRCI]
 *     summary: List HRCI zones
 *     responses:
 *       200:
 *         description: List of zones
 */
// List zones (enum values)
router.get('/zones', (_req, res) => {
  res.json({ success: true, data: ['NORTH','SOUTH','EAST','WEST','CENTRAL'] });
});

/**
 * @swagger
 * /hrci/geo/countries:
 *   get:
 *     tags: [HRCI]
 *     summary: List countries
 *     responses:
 *       200:
 *         description: Countries
 */
// Countries
router.get('/countries', async (_req, res) => {
  const countries = await (prisma as any).hrcCountry?.findMany?.({ select: { id: true, name: true, code: true } }) || [];
  res.json({ success: true, count: countries.length, data: countries });
});

/**
 * @swagger
 * /hrci/geo/states:
 *   get:
 *     tags: [HRCI]
 *     summary: List states
 *     parameters:
 *       - in: query
 *         name: countryCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: countryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: zone
 *         schema:
 *           type: string
 *           enum: [NORTH, SOUTH, EAST, WEST, CENTRAL]
 *     responses:
 *       200:
 *         description: States
 */
// States (optionally filter by country code or id, with zone optional)
router.get('/states', async (req, res) => {
  const { countryCode, countryId, zone } = req.query as { countryCode?: string; countryId?: string; zone?: string };
  const where: any = {};
  if (countryId) {
    where.countryId = String(countryId);
  } else if (countryCode) {
    // Heuristic: if countryCode looks like an ID (long nanoid-ish), treat it as countryId for convenience
    if (countryCode.length > 12 && !/^[A-Z]{2,3}$/.test(countryCode)) {
      where.countryId = countryCode;
    } else {
      where.country = { code: countryCode };
    }
  }
  if (zone) where.zone = zone;
  const states = await (prisma as any).hrcState?.findMany?.({
    where,
    select: { id: true, name: true, code: true, zone: true, country: { select: { id: true, code: true } } },
    orderBy: { name: 'asc' }
  }) || [];
  res.json({ success: true, count: states.length, data: states });
});

/**
 * @swagger
 * /hrci/geo/districts:
 *   get:
 *     tags: [HRCI]
 *     summary: List districts
 *     parameters:
 *       - in: query
 *         name: stateId
 *         schema:
 *           type: string
 *       - in: query
 *         name: stateCode
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Districts
 */
// Districts (filter by state code or id)
router.get('/districts', async (req, res) => {
  const { stateId, stateCode } = req.query as { stateId?: string; stateCode?: string };
  const where: any = {};
  if (stateId) where.stateId = stateId;
  if (stateCode) where.state = { code: stateCode };
  const districts = await (prisma as any).hrcDistrict?.findMany?.({
    where,
    select: { id: true, name: true, state: { select: { id: true, name: true, code: true } } },
    orderBy: { name: 'asc' }
  }) || [];
  res.json({ success: true, count: districts.length, data: districts });
});

/**
 * @swagger
 * /hrci/geo/mandals:
 *   get:
 *     tags: [HRCI]
 *     summary: List mandals
 *     parameters:
 *       - in: query
 *         name: districtId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mandals
 */
// Mandals (filter by district id)
router.get('/mandals', async (req, res) => {
  const { districtId } = req.query as { districtId?: string };
  const where: any = {};
  if (districtId) where.districtId = districtId;
  const mandals = await (prisma as any).hrcMandal?.findMany?.({
    where,
    select: { id: true, name: true, district: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' }
  }) || [];
  res.json({ success: true, count: mandals.length, data: mandals });
});

export default router;