import { Router } from 'express';
import prisma from '../../lib/prisma';

const router = Router();
// Use the existing shared prisma instance (ensures models after generate)

// List zones (enum values)
router.get('/zones', (_req, res) => {
  res.json({ success: true, data: ['NORTH','SOUTH','EAST','WEST','CENTRAL'] });
});

// Countries
router.get('/countries', async (_req, res) => {
  const countries = await (prisma as any).hrcCountry?.findMany?.({ select: { id: true, name: true, code: true } }) || [];
  res.json({ success: true, count: countries.length, data: countries });
});

// States (optionally filter by country code)
router.get('/states', async (req, res) => {
  const { countryCode, zone } = req.query as { countryCode?: string; zone?: string };
  const where: any = {};
  if (countryCode) where.country = { code: countryCode };
  if (zone) where.zone = zone;
  const states = await (prisma as any).hrcState?.findMany?.({
    where,
    select: { id: true, name: true, code: true, zone: true, country: { select: { code: true } } },
    orderBy: { name: 'asc' }
  }) || [];
  res.json({ success: true, count: states.length, data: states });
});

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