import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { createMeetingJoinInfo, generateRoomName } from '../../lib/jitsi';

const router = Router();

function isAdminOrPresident(user: any): boolean {
  const role = String(user?.role?.name || '').toUpperCase();
  return role === 'HRCI_ADMIN' || role === 'ADMIN' || role === 'SUPERADMIN' || role === 'SUPER_ADMIN' || role === 'PRESIDENT';
}

function canCreateMeeting(user: any): boolean {
  return isAdminOrPresident(user);
}

// Validate scope by level requires proper geo fields
function validateScope(level: string, body: any): { ok: boolean; error?: string } {
  switch (String(level)) {
    case 'ZONE':
      if (!body.zone) return { ok: false, error: 'zone is required for level ZONE' };
      return { ok: true };
    case 'STATE':
      if (!body.hrcStateId) return { ok: false, error: 'hrcStateId is required for level STATE' };
      return { ok: true };
    case 'DISTRICT':
      if (!body.hrcDistrictId) return { ok: false, error: 'hrcDistrictId is required for level DISTRICT' };
      return { ok: true };
    case 'MANDAL':
      if (!body.hrcMandalId) return { ok: false, error: 'hrcMandalId is required for level MANDAL' };
      return { ok: true };
    case 'NATIONAL':
      return { ok: true };
    default:
      return { ok: false, error: 'Unsupported level' };
  }
}

// Create meeting (HRCI_ADMIN or PRESIDENT)
router.post('/admin/meetings', requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    if (!canCreateMeeting(user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });

    const { title, cellId, level, includeChildren, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId, scheduledAt, endsAt, password } = req.body || {};
    if (!title || !cellId || !level) return res.status(400).json({ success: false, error: 'title, cellId, level required' });
    const scope = validateScope(level, req.body || {});
    if (!scope.ok) return res.status(400).json({ success: false, error: 'INVALID_SCOPE', message: scope.error });

    // Ensure cell exists
    const cell = await (prisma as any).cell.findUnique({ where: { id: String(cellId) } });
    if (!cell) return res.status(400).json({ success: false, error: 'INVALID_CELL' });

    const domain = process.env.JITSI_DOMAIN?.trim() || 'meet.jit.si';
    const roomName = generateRoomName('hrci');

    const meeting = await (prisma as any).meeting.create({
      data: {
        title: String(title),
        provider: 'JITSI',
        domain,
        roomName,
        password: password ? String(password) : null,
        level: String(level), // Prisma enum (OrgLevel) accepts string values
        cellId: String(cellId),
        includeChildren: !!includeChildren,
        zone: zone || null, // HrcZone enum
        hrcCountryId: hrcCountryId || null,
        hrcStateId: hrcStateId || null,
        hrcDistrictId: hrcDistrictId || null,
        hrcMandalId: hrcMandalId || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        status: scheduledAt ? 'SCHEDULED' : 'LIVE',
        createdByUserId: user.id,
      }
    });

    // Add creator as HOST participant
    await (prisma as any).meetingParticipant.create({ data: { meetingId: meeting.id, userId: user.id, role: 'HOST', displayName: user?.fullName || user?.name || 'Host' } });

    const join = createMeetingJoinInfo(domain, roomName, password || null, null);
    return res.json({ success: true, data: { meeting, join } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CREATE_MEETING_FAILED', message: e?.message });
  }
});

// List meetings for admin/president (filter by createdBy or scope)
router.get('/admin/meetings', requireAuth, async (req: any, res) => {
  try {
    if (!isAdminOrPresident(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const rows = await (prisma as any).meeting.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LIST_MEETINGS_FAILED', message: e?.message });
  }
});

// Start or end a meeting
router.post('/admin/meetings/:id/start', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.update({ where: { id }, data: { status: 'LIVE', scheduledAt: new Date() } });
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'START_FAILED', message: e?.message }); }
});

router.post('/admin/meetings/:id/end', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.update({ where: { id }, data: { status: 'ENDED', endsAt: new Date() } });
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'END_FAILED', message: e?.message }); }
});

// Check if user is allowed to join based on meeting scope
async function userCanJoin(meeting: any, user: any): Promise<boolean> {
  const role = String(user?.role?.name || '').toUpperCase();
  if (role === 'HRCI_ADMIN' || role === 'ADMIN' || role === 'SUPERADMIN' || role === 'SUPER_ADMIN') return true;
  if (role === 'PRESIDENT') return true; // presidents can join their scoped meetings

  // Fetch the user's memberships to match scope
  const memberships = await (prisma as any).membership.findMany({ where: { userId: user.id }, include: { designation: true } });
  const ok = memberships.some((mem: any) => {
    // Must match cell and level
    if (String(mem.cellId) !== String(meeting.cellId)) return false;
    if (String(mem.level) !== String(meeting.level)) return false;

    // Location match by level
    if (meeting.level === 'STATE' && meeting.hrcStateId && String(mem.hrcStateId) !== String(meeting.hrcStateId)) return false;
    if (meeting.level === 'DISTRICT' && meeting.hrcDistrictId && String(mem.hrcDistrictId) !== String(meeting.hrcDistrictId)) return false;
    if (meeting.level === 'MANDAL' && meeting.hrcMandalId && String(mem.hrcMandalId) !== String(meeting.hrcMandalId)) return false;
    if (meeting.level === 'ZONE' && meeting.zone && String(mem.zone) !== String(meeting.zone)) return false;

    return true;
  });

  if (ok) return true;

  // If includeChildren is true, allow narrower geo within same cell.
  if (meeting.includeChildren) {
    return memberships.some((mem: any) => {
      if (String(mem.cellId) !== String(meeting.cellId)) return false;
      // Allow join if member is at same or deeper granularity under the same cell
      if (meeting.level === 'STATE' && mem.hrcStateId === meeting.hrcStateId) return true;
      if (meeting.level === 'DISTRICT' && mem.hrcDistrictId === meeting.hrcDistrictId) return true;
      if (meeting.level === 'MANDAL' && mem.hrcMandalId === meeting.hrcMandalId) return true;
      if (meeting.level === 'ZONE' && mem.zone === meeting.zone) return true;
      if (meeting.level === 'NATIONAL') return true; // all under cell
      return false;
    });
  }

  return false;
}

// Join endpoint: returns domain, room, url (and future jwt)
router.get('/meetings/:id/join', requireAuth, async (req: any, res) => {
  try {
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    const allowed = await userCanJoin(m, req.user);
    if (!allowed) return res.status(403).json({ success: false, error: 'FORBIDDEN' });

    // Record participation
    try {
      const existing = await (prisma as any).meetingParticipant.findFirst({ where: { meetingId: m.id, userId: req.user.id } });
      if (!existing) await (prisma as any).meetingParticipant.create({ data: { meetingId: m.id, userId: req.user.id, role: 'GUEST', displayName: req.user?.fullName || req.user?.name || null, joinedAt: new Date() } });
    } catch {}

    const join = createMeetingJoinInfo(m.domain, m.roomName, m.password || null, null);
    return res.json({ success: true, data: { join, meeting: { id: m.id, title: m.title, status: m.status } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'JOIN_FAILED', message: e?.message });
  }
});

export default router;
