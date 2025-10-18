import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { createMeetingJoinInfo, generateRoomName } from '../../lib/jitsi';
import { notificationQueue } from '../../lib/notification-queue';
import { sendToUserEnhanced } from '../../lib/fcm-enhanced';

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
/**
 * @swagger
 * /hrci/meet/admin/meetings:
 *   post:
 *     summary: Create an HRCI meeting
 *     description: HRCI Admin or President can create a meeting with scope and schedule.
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: State leadership sync
 *               cellId:
 *                 type: string
 *                 example: clxyzcell123
 *               level:
 *                 type: string
 *                 enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL]
 *                 example: STATE
 *               includeChildren:
 *                 type: boolean
 *                 example: true
 *               zone:
 *                 type: string
 *                 example: SOUTH
 *               hrcCountryId:
 *                 type: string
 *               hrcStateId:
 *                 type: string
 *                 example: clstate123
 *               hrcDistrictId:
 *                 type: string
 *               hrcMandalId:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 example: 2025-10-20T10:30:00.000Z
 *               endsAt:
 *                 type: string
 *                 format: date-time
 *               password:
 *                 type: string
 *                 example: secret123
 *     responses:
 *       200:
 *         description: Meeting created
 */
router.post('/admin/meetings', requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    if (!canCreateMeeting(user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });

    const { title } = req.body || {};
    let { cellId, level, includeChildren, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId, scheduledAt, endsAt, password } = req.body || {};
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    // Scope flags encoded in meta (so we don't need schema changes)
    const meta: any = {};

    // If creator is PRESIDENT, default to children-only audience under their scope
    const creatorIsPresident = String(user?.role?.name || '').toUpperCase() === 'PRESIDENT';
    if (creatorIsPresident) {
      meta.presidentChildrenOnly = true;
      if (includeChildren === undefined) includeChildren = true;
    }

    // If admin didn't provide cellId: allow any cell (skip same-cell constraint)
    if (!cellId) {
      meta.allowAnyCell = true;
      // We still must persist a valid cellId to satisfy FK; pick a common cell such as GENERAL_BODY or the first cell.
      const defaultCell = await (prisma as any).cell.findFirst({
        where: {}, orderBy: { createdAt: 'asc' }
      });
      if (!defaultCell) return res.status(400).json({ success: false, error: 'NO_CELLS_CONFIGURED' });
      cellId = defaultCell.id;
    }

    // If admin didn't provide level: this becomes global (all HRCI members)
    if (!level) {
      meta.allowAllMembers = true;
      // Use NATIONAL as default level placeholder
      level = 'NATIONAL';
      zone = undefined;
      hrcCountryId = undefined;
      hrcStateId = undefined;
      hrcDistrictId = undefined;
      hrcMandalId = undefined;
    } else {
      const scope = validateScope(level, req.body || {});
      if (!scope.ok) return res.status(400).json({ success: false, error: 'INVALID_SCOPE', message: scope.error });
    }

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
        meta: Object.keys(meta).length ? meta : undefined,
      }
    });

    // Add creator as HOST participant
    await (prisma as any).meetingParticipant.create({ data: { meetingId: meeting.id, userId: user.id, role: 'HOST', displayName: user?.fullName || user?.name || 'Host' } });

    // Auto-schedule a reminder notification (default 10 minutes before start) if scheduledAt exists
    try {
      if (meeting.scheduledAt) {
        const minutesBefore = Number(process.env.MEETING_REMINDER_MIN_BEFORE || 10);
        await scheduleMeetingReminder(meeting.id, Math.max(0, minutesBefore));
      }
    } catch {}

    const join = createMeetingJoinInfo(domain, roomName, password || null, null);
    return res.json({ success: true, data: { meeting, join } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CREATE_MEETING_FAILED', message: e?.message });
  }
});

// List meetings for admin/president (filter by createdBy or scope)
/**
 * @swagger
 * /hrci/meet/admin/meetings:
 *   get:
 *     summary: List recent HRCI meetings
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of meetings
 */
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
    // Optional broadcast on start
    if (String(req.query.notify || 'true') === 'true') {
      await notifyMeetingAudience(m, {
        title: `Meeting started: ${m.title}`,
        body: 'Tap to join now',
        data: {
          type: 'meeting',
          action: 'start',
          meetingId: m.id,
          status: m.status,
          scheduledAt: m.scheduledAt?.toISOString() || ''
        }
      });
    }
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'START_FAILED', message: e?.message }); }
});

router.post('/admin/meetings/:id/end', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.update({ where: { id }, data: { status: 'ENDED', endsAt: new Date() } });
    // Optional broadcast on end
    if (String(req.query.notify || 'false') === 'true') {
      await notifyMeetingAudience(m, {
        title: `Meeting ended: ${m.title}`,
        body: 'Thanks for joining',
        data: { type: 'meeting', action: 'end', meetingId: m.id, status: m.status }
      });
    }
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'END_FAILED', message: e?.message }); }
});

// Helpers to resolve geo hierarchy for includeChildren
async function getStateIdForDistrict(districtId?: string | null): Promise<string | null> {
  if (!districtId) return null;
  const d = await (prisma as any).hrcDistrict.findUnique({ where: { id: String(districtId) }, select: { stateId: true } });
  return d?.stateId || null;
}

async function getStateIdForMandal(mandalId?: string | null): Promise<string | null> {
  if (!mandalId) return null;
  const md = await (prisma as any).hrcMandal.findUnique({ where: { id: String(mandalId) }, select: { districtId: true } });
  if (!md?.districtId) return null;
  return await getStateIdForDistrict(md.districtId);
}

async function getDistrictIdForMandal(mandalId?: string | null): Promise<string | null> {
  if (!mandalId) return null;
  const md = await (prisma as any).hrcMandal.findUnique({ where: { id: String(mandalId) }, select: { districtId: true } });
  return md?.districtId || null;
}

async function getZoneForState(stateId?: string | null): Promise<string | null> {
  if (!stateId) return null;
  const st = await (prisma as any).hrcState.findUnique({ where: { id: String(stateId) }, select: { zone: true } });
  return st?.zone || null;
}

// Check if user is allowed to join based on meeting scope
async function userCanJoin(meeting: any, user: any): Promise<boolean> {
  const role = String(user?.role?.name || '').toUpperCase();
  if (role === 'HRCI_ADMIN' || role === 'ADMIN' || role === 'SUPERADMIN' || role === 'SUPER_ADMIN') return true;
  if (role === 'PRESIDENT') return true; // presidents can join their scoped meetings

  // Fetch the user's memberships to match scope
  const memberships = await (prisma as any).membership.findMany({ where: { userId: user.id }, select: {
    id: true, cellId: true, level: true, zone: true,
    hrcCountryId: true, hrcStateId: true, hrcDistrictId: true, hrcMandalId: true
  }});

  // Meta flags to control audience
  const allowAnyCell = !!(meeting as any).meta?.allowAnyCell;
  const allowAllMembers = !!(meeting as any).meta?.allowAllMembers;
  const presidentChildrenOnly = !!(meeting as any).meta?.presidentChildrenOnly;

  // If allowAllMembers: any membership qualifies (skip cell/geo checks)
  if (allowAllMembers && memberships.length > 0) return true;

  // Same-cell constraint applies unless allowAnyCell
  const sameCell = (mem: any) => allowAnyCell || String(mem.cellId) === String(meeting.cellId);

  // Exact level match
  const exactOk = async (mem: any) => {
    if (!sameCell(mem)) return false;
    if (String(mem.level) !== String(meeting.level)) return false;
    switch (String(meeting.level)) {
      case 'NATIONAL':
        return true; // within same cell
      case 'ZONE':
        return !meeting.zone || String(mem.zone) === String(meeting.zone);
      case 'STATE':
        return !meeting.hrcStateId || String(mem.hrcStateId) === String(meeting.hrcStateId);
      case 'DISTRICT':
        return !meeting.hrcDistrictId || String(mem.hrcDistrictId) === String(meeting.hrcDistrictId);
      case 'MANDAL':
        return !meeting.hrcMandalId || String(mem.hrcMandalId) === String(meeting.hrcMandalId);
      default:
        return false;
    }
  };

  for (const mem of memberships) {
    if (await exactOk(mem)) return true;
  }

  // Include-children: allow narrower geo under the same cell (or any cell if allowAnyCell)
  if (meeting.includeChildren) {
    for (const mem of memberships) {
      if (!sameCell(mem)) continue;
      // If member is at a DEEPER level than the meeting scope, confirm it sits under the meeting geo
      switch (String(meeting.level)) {
        case 'NATIONAL':
          // everyone in same cell is allowed
          return true;
        case 'ZONE': {
          // Allow members whose zone matches via their own zone or via their state zone
          if (mem.zone && meeting.zone && String(mem.zone) === String(meeting.zone)) return true;
          if (mem.hrcStateId && meeting.zone) {
            const stZone = await getZoneForState(mem.hrcStateId);
            if (stZone && String(stZone) === String(meeting.zone)) return true;
          }
          break;
        }
        case 'STATE': {
          if (!meeting.hrcStateId) break;
          // Member may be STATE (handled above) or deeper (DISTRICT/MANDAL)
          if (mem.hrcStateId && String(mem.hrcStateId) === String(meeting.hrcStateId)) return true;
          if (mem.hrcDistrictId) {
            const stId = await getStateIdForDistrict(mem.hrcDistrictId);
            if (stId && String(stId) === String(meeting.hrcStateId)) return true;
          }
          if (mem.hrcMandalId) {
            const stId = await getStateIdForMandal(mem.hrcMandalId);
            if (stId && String(stId) === String(meeting.hrcStateId)) return true;
          }
          break;
        }
        case 'DISTRICT': {
          if (!meeting.hrcDistrictId) break;
          // Allow mandal members inside the district
          if (mem.hrcDistrictId && String(mem.hrcDistrictId) === String(meeting.hrcDistrictId)) return true;
          if (mem.hrcMandalId) {
            const dId = await getDistrictIdForMandal(mem.hrcMandalId);
            if (dId && String(dId) === String(meeting.hrcDistrictId)) return true;
          }
          break;
        }
        case 'MANDAL':
          // No deeper level under mandal; exact match already checked
          break;
      }
    }
  }

  // PRESIDENT meetings with children-only constraint: if set explicitly, only allow deeper geo than the creator's scope.
  // This is enforced at creation via includeChildren=true and meta.presidentChildrenOnly.
  // Note: Exact match handled earlier; this block prevents broader audiences from being allowed implicitly.
  if (presidentChildrenOnly) {
    // If none of the includeChildren or exact checks passed, deny.
    return false;
  }

  return false;
}

// Join endpoint: returns domain, room, url (and future jwt)
/**
 * @swagger
 * /hrci/meet/meetings/{id}/join:
 *   get:
 *     summary: Get join info for a meeting
 *     tags: [HRCI Meetings - Member]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Join info returned
 */
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

// Get meeting details (admin/president)
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}:
 *   get:
 *     summary: Get meeting details
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Meeting details
 */
router.get('/admin/meetings/:id', requireAuth, async (req: any, res) => {
  try {
    if (!isAdminOrPresident(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: m });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'DETAILS_FAILED', message: e?.message });
  }
});

// Update meeting (title/time/password/scope as needed)
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}:
 *   patch:
 *     summary: Update an HRCI meeting
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated meeting
 */
router.patch('/admin/meetings/:id', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const body = req.body || {};
    const data: any = {};
    if (body.title !== undefined) data.title = String(body.title);
    if (body.password !== undefined) data.password = body.password ? String(body.password) : null;
    if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (body.includeChildren !== undefined) data.includeChildren = !!body.includeChildren;
    if (body.level !== undefined) data.level = String(body.level);
    if (body.zone !== undefined) data.zone = body.zone || null;
    if (body.hrcCountryId !== undefined) data.hrcCountryId = body.hrcCountryId || null;
    if (body.hrcStateId !== undefined) data.hrcStateId = body.hrcStateId || null;
    if (body.hrcDistrictId !== undefined) data.hrcDistrictId = body.hrcDistrictId || null;
    if (body.hrcMandalId !== undefined) data.hrcMandalId = body.hrcMandalId || null;

    // Meta flags to expand audience without schema changes
    if (body.allowAnyCell !== undefined || body.allowAllMembers !== undefined || body.presidentChildrenOnly !== undefined) {
      const current = await (prisma as any).meeting.findUnique({ where: { id }, select: { meta: true } });
      const meta = { ...(current?.meta || {}) } as any;
      if (body.allowAnyCell !== undefined) meta.allowAnyCell = !!body.allowAnyCell;
      if (body.allowAllMembers !== undefined) meta.allowAllMembers = !!body.allowAllMembers;
      if (body.presidentChildrenOnly !== undefined) meta.presidentChildrenOnly = !!body.presidentChildrenOnly;
      data.meta = meta;
    }

    const m = await (prisma as any).meeting.update({ where: { id }, data });

    // If scheduledAt changed, reschedule default reminder
    if (data.scheduledAt !== undefined) {
      const minutesBefore = Number(process.env.MEETING_REMINDER_MIN_BEFORE || 10);
      await scheduleMeetingReminder(id, Math.max(0, minutesBefore));
    }

    return res.json({ success: true, data: m });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'UPDATE_FAILED', message: e?.message });
  }
});

// Cancel a meeting
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}/cancel:
 *   post:
 *     summary: Cancel a meeting
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cancelled meeting
 */
router.post('/admin/meetings/:id/cancel', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.update({ where: { id }, data: { status: 'CANCELLED' } });
    if (String(req.query.notify || 'true') === 'true') {
      await notifyMeetingAudience(m, { title: `Meeting cancelled: ${m.title}`, body: 'We will update with a new time soon', data: { type: 'meeting', action: 'cancel', meetingId: m.id, status: m.status } });
    }
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'CANCEL_FAILED', message: e?.message }); }
});

// Immediate or scheduled broadcast to meeting audience
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}/notify:
 *   post:
 *     summary: Notify meeting audience (immediate or scheduled)
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: Reminder
 *               body:
 *                 type: string
 *                 example: Meeting starts soon
 *               scheduleAt:
 *                 type: string
 *                 format: date-time
 *               minutesBefore:
 *                 type: number
 *                 example: 10
 *     responses:
 *       200:
 *         description: Notification queued/sent
 */
router.post('/admin/meetings/:id/notify', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    const { title, body, scheduleAt, minutesBefore } = req.body || {};
    const when = scheduleAt ? new Date(scheduleAt) : (minutesBefore != null && m.scheduledAt ? new Date(new Date(m.scheduledAt).getTime() - Math.max(0, Number(minutesBefore)) * 60000) : undefined);

    const dataPayload: Record<string, string> = {
      type: 'meeting',
      action: 'notify',
      meetingId: String(m.id),
      status: String(m.status)
    };
    if (m.scheduledAt) dataPayload.scheduledAt = new Date(m.scheduledAt).toISOString();
    const result = await notifyMeetingAudience(m, {
      title: String(title || `Upcoming meeting: ${m.title}`),
      body: String(body || (m.scheduledAt ? `Starts at ${new Date(m.scheduledAt).toLocaleString()}` : 'Join now')),
      data: dataPayload
    }, when);

    return res.json({ success: true, data: { scheduled: !!when, recipients: result.recipients } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'NOTIFY_FAILED', message: e?.message });
  }
});

// Schedule default reminder (e.g., 10 minutes before)
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}/schedule-reminder:
 *   post:
 *     summary: Schedule a default reminder before meeting start
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               minutesBefore:
 *                 type: number
 *                 example: 10
 *     responses:
 *       200:
 *         description: Reminder scheduled
 */
router.post('/admin/meetings/:id/schedule-reminder', requireAuth, async (req: any, res) => {
  try {
    if (!canCreateMeeting(req.user)) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const id = String(req.params.id);
    const minutesBefore = Number((req.body && req.body.minutesBefore) ?? (process.env.MEETING_REMINDER_MIN_BEFORE || 10));
    const when = await scheduleMeetingReminder(id, Math.max(0, minutesBefore));
    return res.json({ success: true, data: { scheduledAt: when?.toISOString() } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'SCHEDULE_REMINDER_FAILED', message: e?.message });
  }
});

// List upcoming meetings the current user can join soon
/**
 * @swagger
 * /hrci/meet/meetings/my/upcoming:
 *   get:
 *     summary: List my upcoming HRCI meetings
 *     tags: [HRCI Meetings - Member]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Upcoming meetings
 */
router.get('/meetings/my/upcoming', requireAuth, async (req: any, res) => {
  try {
    const now = new Date();
    const horizonMinutes = Number(process.env.MEETING_UPCOMING_MINUTES || 240);
    const maxAt = new Date(now.getTime() + horizonMinutes * 60000);
    // Start with recent scheduled/live meetings
    const rows = await (prisma as any).meeting.findMany({
      where: {
        OR: [
          { status: 'SCHEDULED', scheduledAt: { gte: new Date(now.getTime() - 3600000), lte: maxAt } },
          { status: 'LIVE' }
        ]
      },
      orderBy: [{ status: 'desc' }, { scheduledAt: 'asc' }],
      take: 100
    });
    const allowed = [] as any[];
    for (const m of rows) {
      if (await userCanJoin(m, req.user)) allowed.push(m);
    }
    return res.json({ success: true, count: allowed.length, data: allowed });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MY_UPCOMING_FAILED', message: e?.message });
  }
});

// Helpers: resolve audience and send notifications
async function resolveMeetingAudienceUserIds(meeting: any): Promise<string[]> {
  const where: any = { cellId: meeting.cellId };
  if (!meeting.includeChildren) {
    where.level = meeting.level;
    if (meeting.level === 'STATE' && meeting.hrcStateId) where.hrcStateId = meeting.hrcStateId;
    if (meeting.level === 'DISTRICT' && meeting.hrcDistrictId) where.hrcDistrictId = meeting.hrcDistrictId;
    if (meeting.level === 'MANDAL' && meeting.hrcMandalId) where.hrcMandalId = meeting.hrcMandalId;
    if (meeting.level === 'ZONE' && meeting.zone) where.zone = meeting.zone;
  }
  const rows = await (prisma as any).membership.findMany({ where, select: { userId: true }, distinct: ['userId'], take: 10000 });
  const ids = rows.map((r: any) => r.userId).filter(Boolean);
  return Array.from(new Set(ids));
}

async function notifyMeetingAudience(meeting: any, payload: { title: string; body: string; data?: Record<string, string> }, scheduleAt?: Date): Promise<{ recipients: number }>
{
  const userIds = await resolveMeetingAudienceUserIds(meeting);
  const maxRecipients = Number(process.env.MEETING_NOTIFY_MAX || 1000);
  const targets = userIds.slice(0, maxRecipients);

  const options = { priority: 'high' as const, sourceController: 'meet-api', sourceAction: 'meeting-broadcast', scheduledAt: scheduleAt };

  // Use queue for scheduling or bulk; fallback to direct send if immediate and small set
  if (scheduleAt || targets.length > 50) {
    for (const uid of targets) {
      await notificationQueue.addJob('user', uid, { title: payload.title, body: payload.body, data: payload.data || {} }, { ...options });
    }
  } else {
    await Promise.all(targets.map(uid => sendToUserEnhanced(uid, { title: payload.title, body: payload.body, data: payload.data || {} }, options)));
  }
  return { recipients: targets.length };
}

async function scheduleMeetingReminder(meetingId: string, minutesBefore: number): Promise<Date | undefined> {
  const m = await (prisma as any).meeting.findUnique({ where: { id: meetingId } });
  if (!m || !m.scheduledAt) return undefined;
  const when = new Date(new Date(m.scheduledAt).getTime() - minutesBefore * 60000);
  if (when.getTime() < Date.now()) return undefined;
  await notifyMeetingAudience(m, {
    title: `Reminder: ${m.title}`,
    body: `Starts at ${new Date(m.scheduledAt).toLocaleString()}`,
    data: { type: 'meeting', action: 'reminder', meetingId: m.id, scheduledAt: new Date(m.scheduledAt).toISOString() }
  }, when);
  return when;
}

export default router;
