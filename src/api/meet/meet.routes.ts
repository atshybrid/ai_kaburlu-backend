import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth } from '../middlewares/authz';
import { createMeetingJoinInfo, generateRoomName, generateMeetingPassword } from '../../lib/jitsi';
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

// Normalize possibly-empty string values to undefined
function emptyToUndef<T>(v: T): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
}

// Parse dates leniently, accepting single-digit hour like T1:.. by padding to T01:
function parseDateLenient(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'string') {
    let s = input.trim();
    let d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // Pad single-digit hour after 'T'
    s = s.replace(/T(\d)(?=:\d{2}:\d{2})/, 'T0$1');
    d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Compute a runtime status based on scheduledAt/endsAt and persisted status
function computeRuntimeStatus(m: any, now = new Date()): 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED' {
  const status = String(m.status || '').toUpperCase();
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'ENDED') return 'ENDED';
  const endsAt = m.endsAt ? new Date(m.endsAt) : null;
  // Require explicit start: only treat as LIVE when persisted status is LIVE
  if (status === 'LIVE') {
    if (endsAt && now >= endsAt) return 'ENDED';
    return 'LIVE';
  }
  // Otherwise remain SCHEDULED until started or cancelled/ended
  if (endsAt && now >= endsAt) return 'ENDED';
  return 'SCHEDULED';
}

async function persistStatusIfElapsed(meeting: any): Promise<any | null> {
  const runtime = computeRuntimeStatus(meeting);
  // Only auto-persist when transitioning to ENDED due to time elapse
  if (runtime === 'ENDED' && meeting.status !== 'ENDED') {
    try {
      const updated = await (prisma as any).meeting.update({ where: { id: meeting.id }, data: { status: 'ENDED', endsAt: meeting.endsAt || new Date() } });
      return updated;
    } catch { /* ignore */ }
  }
  return null;
}

// Validate scope by level requires proper geo fields
function validateScope(level: string, body: any): { ok: boolean; error?: string } {
  switch (String(level)) {
    case 'ZONE':
      // If zone is omitted, interpret as "all zones" in the selected cell
      return { ok: true };
    case 'STATE':
      // If hrcStateId is omitted, interpret as "all states" in the selected cell
      return { ok: true };
    case 'DISTRICT':
      // If hrcDistrictId is omitted, interpret as "all districts" in the selected cell
      return { ok: true };
    case 'MANDAL':
      // If hrcMandalId is omitted, interpret as "all mandals" in the selected cell
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
 *                 description: |
 *                   If geo identifiers are omitted, the scope includes ALL within the selected cell.
 *                   Examples:
 *                     - ZONE without zone => all zones
 *                     - STATE without hrcStateId => all states
 *                     - DISTRICT without hrcDistrictId => all districts
 *                     - MANDAL without hrcMandalId => all mandals
 *                   With includeChildren=true, deeper levels under that broad scope are also included.
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

  // Scope flags + audience overrides encoded in meta (no schema change)
  const meta: any = {};

    // If creator is PRESIDENT, default to children-only audience under their scope
    const creatorIsPresident = String(user?.role?.name || '').toUpperCase() === 'PRESIDENT';
    if (creatorIsPresident) {
      meta.presidentChildrenOnly = true;
      if (includeChildren === undefined) includeChildren = true;
    }

    // Normalize blank strings to undefined for geo fields
    zone = emptyToUndef(zone) as any;
    hrcCountryId = emptyToUndef(hrcCountryId) as any;
    hrcStateId = emptyToUndef(hrcStateId) as any;
    hrcDistrictId = emptyToUndef(hrcDistrictId) as any;
    hrcMandalId = emptyToUndef(hrcMandalId) as any;

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
  const finalPassword = password ? String(password) : generateMeetingPassword();

    // Audience whitelist support (optional)
    if (Array.isArray((req.body || {}).audienceUserIds)) {
      const ids = ((req.body as any).audienceUserIds as any[]).map(String).filter(Boolean);
      if (ids.length) meta.whitelistUserIds = Array.from(new Set(ids));
    }
    if ((req.body || {}).whitelistOnly !== undefined) meta.whitelistOnly = !!(req.body as any).whitelistOnly;

    // Parse dates (lenient); return 400 if provided but invalid
    const scheduledAtDate = parseDateLenient(scheduledAt);
    const endsAtDate = parseDateLenient(endsAt);
    if (scheduledAt !== undefined && scheduledAtDate === null) {
      return res.status(400).json({ success: false, error: 'INVALID_SCHEDULED_AT', message: 'Provide a valid ISO date-time for scheduledAt' });
    }
    if (endsAt !== undefined && endsAtDate === null) {
      return res.status(400).json({ success: false, error: 'INVALID_ENDS_AT', message: 'Provide a valid ISO date-time for endsAt' });
    }

    const meeting = await (prisma as any).meeting.create({
      data: {
        title: String(title),
        provider: 'JITSI',
        domain,
        roomName,
  password: finalPassword,
        level: String(level), // Prisma enum (OrgLevel) accepts string values
        cellId: String(cellId),
        includeChildren: !!includeChildren,
        zone: zone || null, // HrcZone enum
        hrcCountryId: hrcCountryId || null,
        hrcStateId: hrcStateId || null,
        hrcDistrictId: hrcDistrictId || null,
        hrcMandalId: hrcMandalId || null,
        scheduledAt: scheduledAtDate,
        endsAt: endsAtDate,
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

    // Immediate notification to audience on creation (announce schedule)
    try {
      const dataPayload: Record<string, string> = {
        type: 'meeting',
        action: 'created',
        meetingId: String(meeting.id),
        status: String(meeting.status)
      };
      if (meeting.scheduledAt) dataPayload.scheduledAt = new Date(meeting.scheduledAt).toISOString();
      await notifyMeetingAudience(meeting, {
        title: `Meeting scheduled: ${meeting.title}`,
        body: meeting.scheduledAt ? `Starts at ${new Date(meeting.scheduledAt).toLocaleString()}` : 'Join will be announced soon',
        data: dataPayload
      });
    } catch {}

    // Schedule additional reminders: 60,50,40,30,20,5 minutes before (skip any past times)
    try {
      if (meeting.scheduledAt) {
        const now = Date.now();
        const sa = new Date(meeting.scheduledAt).getTime();
        const defaultMin = Number(process.env.MEETING_REMINDER_MIN_BEFORE || 10);
        const marks = [60, 50, 40, 30, 20, 5];
        for (const min of marks) {
          if (min === defaultMin) continue; // avoid duplicate reminder
          const whenTs = sa - min * 60000;
          if (whenTs > now) {
            await notifyMeetingAudience(meeting, {
              title: `Reminder: ${meeting.title}`,
              body: `Starts in ${min} minutes`,
              data: { type: 'meeting', action: 'reminder', meetingId: String(meeting.id), scheduledAt: new Date(meeting.scheduledAt).toISOString() }
            }, new Date(whenTs));
          }
        }
      }
    } catch {}

  const join = createMeetingJoinInfo(domain, roomName, finalPassword, null);
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
    // Compute runtimeStatus and best-effort persist if drifted
    const data = [] as any[];
    for (const m of rows) {
      const runtimeStatus = computeRuntimeStatus(m);
      if (runtimeStatus !== m.status) persistStatusIfElapsed(m).catch(() => {});
      data.push({ ...m, runtimeStatus });
    }
    return res.json({ success: true, count: data.length, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LIST_MEETINGS_FAILED', message: e?.message });
  }
});

// Start or end a meeting
/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}/start:
 *   post:
 *     summary: Start a meeting (sets status to LIVE)
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: notify
 *         required: false
 *         schema: { type: boolean }
 *         description: Send a broadcast to audience on start (default true)
 *     responses:
 *       200:
 *         description: Meeting started
 */
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
  return res.json({ success: true, data: { ...m, runtimeStatus: computeRuntimeStatus(m) } });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'START_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/meet/admin/meetings/{id}/end:
 *   post:
 *     summary: End a meeting (sets status to ENDED)
 *     tags: [HRCI Meetings - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: notify
 *         required: false
 *         schema: { type: boolean }
 *         description: Send a broadcast to audience on end (default false)
 *     responses:
 *       200:
 *         description: Meeting ended
 */
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
  return res.json({ success: true, data: { ...m, runtimeStatus: 'ENDED' } });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'END_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/meet/meetings/{id}/close:
 *   post:
 *     summary: Host closes meeting (sets status to ENDED)
 *     tags: [HRCI Meetings - Member]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Meeting closed }
 */
router.post('/meetings/:id/close', requireAuth, async (req: any, res) => {
  try {
    const id = String(req.params.id);
    const m = await (prisma as any).meeting.findUnique({ where: { id } });
    if (!m) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    // Only HOST participant or admin/president can close
    const isPrivileged = isAdminOrPresident(req.user);
    let isHost = false;
    if (!isPrivileged) {
      const host = await (prisma as any).meetingParticipant.findFirst({ where: { meetingId: id, userId: req.user.id, role: 'HOST' } });
      isHost = !!host;
    }
    if (!isPrivileged && !isHost) return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    const updated = await (prisma as any).meeting.update({ where: { id }, data: { status: 'ENDED', endsAt: new Date() } });
    return res.json({ success: true, data: { ...updated, runtimeStatus: 'ENDED' } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CLOSE_FAILED', message: e?.message });
  }
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
  const whitelist: string[] = Array.isArray((meeting as any).meta?.whitelistUserIds) ? (meeting as any).meta.whitelistUserIds.map(String) : [];
  const whitelistOnly = !!(meeting as any).meta?.whitelistOnly;

  // If whitelistOnly, only allow listed userIds regardless of scope
  if (whitelistOnly) {
    return whitelist.includes(String(user.id));
  }

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
          // If a specific zone is set, restrict to that zone; else include all zones
          if (meeting.zone) {
            // Allow members whose zone matches via their own zone or via their state zone
            if (mem.zone && String(mem.zone) === String(meeting.zone)) return true;
            if (mem.hrcStateId) {
              const stZone = await getZoneForState(mem.hrcStateId);
              if (stZone && String(stZone) === String(meeting.zone)) return true;
            }
          } else {
            // No zone specified => include members in any zone in this cell
            if (mem.zone || mem.hrcStateId || mem.hrcDistrictId || mem.hrcMandalId) return true;
          }
          break;
        }
        case 'STATE': {
          // If a specific state is set, restrict to that state's hierarchy
          if (meeting.hrcStateId) {
            if (mem.hrcStateId && String(mem.hrcStateId) === String(meeting.hrcStateId)) return true;
            if (mem.hrcDistrictId) {
              const stId = await getStateIdForDistrict(mem.hrcDistrictId);
              if (stId && String(stId) === String(meeting.hrcStateId)) return true;
            }
            if (mem.hrcMandalId) {
              const stId = await getStateIdForMandal(mem.hrcMandalId);
              if (stId && String(stId) === String(meeting.hrcStateId)) return true;
            }
          } else {
            // No state specified => include children across all states in this cell
            if (mem.hrcStateId || mem.hrcDistrictId || mem.hrcMandalId) return true;
          }
          break;
        }
        case 'DISTRICT': {
          // If a specific district is set, restrict to that district; else include all districts
          if (meeting.hrcDistrictId) {
            // Allow mandal members inside the district
            if (mem.hrcDistrictId && String(mem.hrcDistrictId) === String(meeting.hrcDistrictId)) return true;
            if (mem.hrcMandalId) {
              const dId = await getDistrictIdForMandal(mem.hrcMandalId);
              if (dId && String(dId) === String(meeting.hrcDistrictId)) return true;
            }
          } else {
            // No district specified => include members at DISTRICT or MANDAL levels
            if (mem.hrcDistrictId || mem.hrcMandalId) return true;
          }
          break;
        }
        case 'MANDAL':
          // No deeper level under mandal; exact match already checked
          break;
      }
    }
  }

  // If not matched by scope rules but the user is whitelisted, allow
  if (whitelist.length && whitelist.includes(String(user.id))) return true;

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
    // Enforce: do not allow join before host/admin starts the meeting
    if (String(m.status).toUpperCase() !== 'LIVE') {
      return res.status(403).json({ success: false, error: 'MEETING_NOT_STARTED', message: 'Host has not started the meeting yet.' });
    }

    // Record participation
    try {
      const existing = await (prisma as any).meetingParticipant.findFirst({ where: { meetingId: m.id, userId: req.user.id } });
      if (!existing) await (prisma as any).meetingParticipant.create({ data: { meetingId: m.id, userId: req.user.id, role: 'GUEST', displayName: req.user?.fullName || req.user?.name || null, joinedAt: new Date() } });
    } catch {}

    const join = createMeetingJoinInfo(m.domain, m.roomName, m.password || null, null);
  const runtimeStatus = computeRuntimeStatus(m);
  if (runtimeStatus !== m.status) persistStatusIfElapsed(m).catch(() => {});
  return res.json({ success: true, data: { join, meeting: { id: m.id, title: m.title, status: m.status, runtimeStatus, scheduledAt: m.scheduledAt, endsAt: m.endsAt } } });
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
  const runtimeStatus = computeRuntimeStatus(m);
  if (runtimeStatus !== m.status) persistStatusIfElapsed(m).catch(() => {});
  return res.json({ success: true, data: { ...m, runtimeStatus } });
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
    if (body.includeChildren !== undefined) data.includeChildren = !!body.includeChildren;
    if (body.level !== undefined) data.level = String(body.level);
    if (body.zone !== undefined) data.zone = emptyToUndef(body.zone) || null;
    if (body.hrcCountryId !== undefined) data.hrcCountryId = emptyToUndef(body.hrcCountryId) || null;
    if (body.hrcStateId !== undefined) data.hrcStateId = emptyToUndef(body.hrcStateId) || null;
    if (body.hrcDistrictId !== undefined) data.hrcDistrictId = emptyToUndef(body.hrcDistrictId) || null;
    if (body.hrcMandalId !== undefined) data.hrcMandalId = emptyToUndef(body.hrcMandalId) || null;

    if (body.scheduledAt !== undefined) {
      const d = parseDateLenient(body.scheduledAt);
      if (d === null && body.scheduledAt !== null) return res.status(400).json({ success: false, error: 'INVALID_SCHEDULED_AT' });
      data.scheduledAt = d;
    }
    if (body.endsAt !== undefined) {
      const d = parseDateLenient(body.endsAt);
      if (d === null && body.endsAt !== null) return res.status(400).json({ success: false, error: 'INVALID_ENDS_AT' });
      data.endsAt = d;
    }

    // Meta flags to expand audience without schema changes
    if (
      body.allowAnyCell !== undefined ||
      body.allowAllMembers !== undefined ||
      body.presidentChildrenOnly !== undefined ||
      body.whitelistOnly !== undefined ||
      Array.isArray(body.audienceUserIds)
    ) {
      const current = await (prisma as any).meeting.findUnique({ where: { id }, select: { meta: true } });
      const meta = { ...(current?.meta || {}) } as any;
      if (body.allowAnyCell !== undefined) meta.allowAnyCell = !!body.allowAnyCell;
      if (body.allowAllMembers !== undefined) meta.allowAllMembers = !!body.allowAllMembers;
      if (body.presidentChildrenOnly !== undefined) meta.presidentChildrenOnly = !!body.presidentChildrenOnly;
      if (body.whitelistOnly !== undefined) meta.whitelistOnly = !!body.whitelistOnly;
      if (Array.isArray(body.audienceUserIds)) {
        const ids = (body.audienceUserIds as any[]).map(String).filter(Boolean);
        if (ids.length) meta.whitelistUserIds = Array.from(new Set(ids));
        else delete meta.whitelistUserIds;
      }
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
      if (await userCanJoin(m, req.user)) {
        const runtimeStatus = computeRuntimeStatus(m);
        if (runtimeStatus !== m.status) persistStatusIfElapsed(m).catch(() => {});
        allowed.push({ ...m, runtimeStatus });
      }
    }
    return res.json({ success: true, count: allowed.length, data: allowed });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MY_UPCOMING_FAILED', message: e?.message });
  }
});

// Helpers: resolve audience and send notifications
async function resolveMeetingAudienceUserIds(meeting: any): Promise<string[]> {
  const meta = (meeting as any).meta || {};
  const allowAllMembers = !!meta.allowAllMembers;
  const allowAnyCell = !!meta.allowAnyCell;
  const whitelistOnly = !!meta.whitelistOnly;
  const whitelist: string[] = Array.isArray(meta.whitelistUserIds) ? meta.whitelistUserIds.map(String) : [];

  // If whitelistOnly, short-circuit: return whitelist as recipients (or none if empty)
  if (whitelistOnly) {
    return whitelist.length ? Array.from(new Set(whitelist)) : [];
  }

  // Build base where clause for memberships
  const where: any = {};
  if (!allowAnyCell) where.cellId = meeting.cellId; // restrict cell unless allowAnyCell

  if (!allowAllMembers) {
    if (!meeting.includeChildren) {
      // Exact scope only
      where.level = meeting.level;
      if (meeting.level === 'STATE' && meeting.hrcStateId) where.hrcStateId = meeting.hrcStateId;
      if (meeting.level === 'DISTRICT' && meeting.hrcDistrictId) where.hrcDistrictId = meeting.hrcDistrictId;
      if (meeting.level === 'MANDAL' && meeting.hrcMandalId) where.hrcMandalId = meeting.hrcMandalId;
      if (meeting.level === 'ZONE' && meeting.zone) where.zone = meeting.zone;
    } else {
      // includeChildren true: keep broad (cell-only restriction already applied above unless allowAnyCell)
    }
  } else {
    // allowAllMembers: no geo filters
  }

  const rows = await (prisma as any).membership.findMany({ where, select: { userId: true }, distinct: ['userId'], take: 10000 });
  let ids = rows.map((r: any) => r.userId).filter(Boolean).map(String);

  // Merge whitelist users if present (acts as additive allow-list when not whitelistOnly)
  if (whitelist.length) ids = Array.from(new Set(ids.concat(whitelist)));
  return ids;
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
