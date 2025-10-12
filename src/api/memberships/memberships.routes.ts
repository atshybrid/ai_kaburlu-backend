import { Router, Request, Response } from 'express';
import { membershipService } from '../../lib/membershipService';

const router = Router();

// GET /api/v1/memberships/availability
router.get('/availability', async (req: Request, res: Response) => {
  try {
    const { designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.query as any;
    if (!designationId || !level) {
      return res.status(400).json({ success: false, error: 'designationId and level are required' });
    }
    const availability = await membershipService.getAvailability({
      designationCode: String(designationId), // expecting code in current service shape
      cellCodeOrName: '', // placeholder if future extension needed
      level: String(level) as any,
      zone: zone ? String(zone) as any : undefined,
      hrcCountryId: hrcCountryId ? String(hrcCountryId) : undefined,
      hrcStateId: hrcStateId ? String(hrcStateId) : undefined,
      hrcDistrictId: hrcDistrictId ? String(hrcDistrictId) : undefined,
      hrcMandalId: hrcMandalId ? String(hrcMandalId) : undefined,
    } as any);
    return res.json({ success: true, data: availability });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Failed to get availability', message: e?.message });
  }
});

// POST /api/v1/memberships/join
router.post('/join', async (req: Request, res: Response) => {
  try {
    const { userId, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = req.body;
    if (!userId || !designationId || !level) {
      return res.status(400).json({ success: false, error: 'userId, designationId and level are required' });
    }
    const result = await membershipService.joinSeat({
      userId: String(userId),
      cellCodeOrName: '',
      designationCode: String(designationId),
      level: String(level) as any,
      zone: zone ? String(zone) as any : undefined,
      hrcCountryId: hrcCountryId ? String(hrcCountryId) : undefined,
      hrcStateId: hrcStateId ? String(hrcStateId) : undefined,
      hrcDistrictId: hrcDistrictId ? String(hrcDistrictId) : undefined,
      hrcMandalId: hrcMandalId ? String(hrcMandalId) : undefined,
    } as any);
    return res.json({ success: true, data: result });
  } catch (e: any) {
    const status = /not found|missing/i.test(e?.message) ? 404 : (/capacity|unavailable|exists/i.test(e?.message) ? 400 : 500);
    return res.status(status).json({ success: false, error: 'Failed to join membership', message: e?.message });
  }
});

export default router;