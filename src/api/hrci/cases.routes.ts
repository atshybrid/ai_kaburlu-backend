import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import sharp from 'sharp';
const db: any = prisma;

const router = Router();
// =========================
// HRCI Admin endpoints
// =========================

// GET /hrci/cases/admin/analytics - overview counts and trends
/**
 * @swagger
 * /hrci/cases/admin/analytics:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: Admin analytics (counts and 7/30 day trends)
 *     description: Overview for admins to monitor workload and trends.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7, minimum: 1, maximum: 60 }
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 total: { type: integer }
 *                 countsByStatus: { type: object, additionalProperties: { type: integer } }
 *                 countsByPriority: { type: object, additionalProperties: { type: integer } }
 *                 trend:
 *                   type: object
 *                   properties:
 *                     createdPerDay:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date: { type: string }
 *                           count: { type: integer }
 */
router.get('/admin/analytics', requireAuth, requireHrcAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(60, Number((req.query as any).days) || 7));
    const allowedStatuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    const priorities = ['LOW','MEDIUM','HIGH','URGENT'];

    const total = await (db as any).hrcCase.count();
    const countsByStatus: Record<string, number> = {};
    for (const s of allowedStatuses) countsByStatus[s] = await (db as any).hrcCase.count({ where: { status: s } });
    const countsByPriority: Record<string, number> = {};
    for (const p of priorities) countsByPriority[p] = await (db as any).hrcCase.count({ where: { priority: p } });

    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const created = await (db as any).hrcCase.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } });
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const createdPerDayMap: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      createdPerDayMap[fmt(d)] = 0;
    }
    for (const r of created) {
      const key = fmt(new Date(r.createdAt));
      if (createdPerDayMap[key] != null) createdPerDayMap[key]++;
    }
    const createdPerDay = Object.entries(createdPerDayMap).map(([date, count]) => ({ date, count }));

    return res.json({ success: true, total, countsByStatus, countsByPriority, trend: { createdPerDay } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ADMIN_ANALYTICS_FAILED', message: e?.message });
  }
});

// POST /hrci/cases/admin/bulk-update - update multiple cases at once
/**
 * @swagger
 * /hrci/cases/admin/bulk-update:
 *   post:
 *     tags: [HRCI Cases]
 *     summary: Admin bulk update cases (status/priority/assignee)
 *     description: Update many cases in one call. Logs events for each change.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [caseIds, set]
 *             properties:
 *               caseIds:
 *                 type: array
 *                 items: { type: string }
 *               set:
 *                 type: object
 *                 properties:
 *                   status: { type: string, enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED] }
 *                   priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *                   assignedToUserId: { type: string }
 *     responses:
 *       200:
 *         description: Per-case results
 */
router.post('/admin/bulk-update', requireAuth, requireHrcAdmin, async (req: any, res) => {
  const actor: any = req.user;
  const { caseIds, set } = (req.body || {}) as { caseIds?: string[]; set?: any };
  if (!Array.isArray(caseIds) || caseIds.length === 0 || !set || typeof set !== 'object') {
    return res.status(400).json({ success: false, error: 'INVALID_BODY' });
  }
  const allowedStatuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
  const allowedPriorities = ['LOW','MEDIUM','HIGH','URGENT'];
  const wantStatus = set.status ? String(set.status) : undefined;
  const wantPriority = set.priority ? String(set.priority) : undefined;
  const wantAssignee = set.assignedToUserId ? String(set.assignedToUserId) : undefined;
  if (wantStatus && !allowedStatuses.includes(wantStatus)) return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
  if (wantPriority && !allowedPriorities.includes(wantPriority)) return res.status(400).json({ success: false, error: 'INVALID_PRIORITY' });

  const results: any[] = [];
  for (const id of caseIds) {
    try {
      const existing = await (db as any).hrcCase.findUnique({ where: { id: String(id) }, select: { id: true, caseNumber: true, status: true, priority: true, assignedToUserId: true } });
      if (!existing) { results.push({ id, success: false, error: 'NOT_FOUND' }); continue; }
      const data: any = {};
      const events: any[] = [];
      if (wantStatus && wantStatus !== existing.status) {
        data.status = wantStatus;
        events.push({ type: 'STATUS_CHANGED', data: { from: existing.status, to: wantStatus } });
      }
      if (wantPriority && wantPriority !== existing.priority) {
        data.priority = wantPriority;
        events.push({ type: 'PRIORITY_CHANGED', data: { from: existing.priority, to: wantPriority } });
      }
      if (wantAssignee && wantAssignee !== existing.assignedToUserId) {
        data.assignedToUserId = wantAssignee;
        events.push({ type: 'ASSIGNED', data: { toUserId: wantAssignee } });
      }
      if (Object.keys(data).length === 0) { results.push({ id, success: true, data: existing, noop: true }); continue; }
      const updated = await (db as any).hrcCase.update({ where: { id: existing.id }, data, select: { id: true, caseNumber: true, status: true, priority: true, assignedToUserId: true } });
      for (const ev of events) {
        try { await (db as any).hrcCaseEvent.create({ data: { caseId: existing.id, type: ev.type, data: ev.data, actorUserId: actor?.id || null } }); } catch {}
      }
      results.push({ id, success: true, data: updated });
    } catch (e: any) {
      results.push({ id, success: false, error: e?.message || 'UPDATE_FAILED' });
    }
  }
  return res.json({ success: true, results });
});

// POST /hrci/cases/admin/escalate - mark a case as ESCALATED with reason
/**
 * @swagger
 * /hrci/cases/admin/escalate:
 *   post:
 *     tags: [HRCI Cases]
 *     summary: Escalate a case (admin)
 *     description: Sets status to ESCALATED and logs an ESCALATED event with reason and target level.
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [caseId, reason]
 *             properties:
 *               caseId: { type: string }
 *               toLevel: { type: string, enum: [DISTRICT, STATE, NATIONAL], nullable: true }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Case escalated
 */
router.post('/admin/escalate', requireAuth, requireHrcAdmin, async (req: any, res) => {
  try {
    const actor: any = req.user;
    const { caseId, toLevel, reason } = (req.body || {}) as { caseId?: string; toLevel?: string; reason?: string };
    if (!caseId || !reason) return res.status(400).json({ success: false, error: 'INVALID_BODY' });
    const existing = await (db as any).hrcCase.findUnique({ where: { id: String(caseId) }, select: { id: true, status: true, caseNumber: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const updated = await (db as any).hrcCase.update({ where: { id: existing.id }, data: { status: 'ESCALATED' }, select: { id: true, caseNumber: true, status: true } });
    try {
      await (db as any).hrcCaseEvent.create({ data: { caseId: existing.id, type: 'ESCALATED', data: { from: existing.status, to: 'ESCALATED', toLevel: toLevel || null, reason }, actorUserId: actor?.id || null } });
    } catch {}
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ESCALATE_FAILED', message: e?.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MEDIA_MAX_IMAGE_MB || 15) * 1024 * 1024 } });

/**
 * @swagger
 * /hrci/cases:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List cases with status
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "Cases list with status and summary counts"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 nextCursor: { type: string, nullable: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       caseNumber: { type: string }
 *                       title: { type: string }
 *                       priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *                       status: { type: string, enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED] }
 *                       visibility: { type: string, enum: [PRIVATE, PUBLIC_LINK] }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *                 counts:
 *                   type: object
 *                   additionalProperties: { type: integer }
 *             example:
 *               success: true
 *               count: 2
 *               nextCursor: null
 *               data:
 *                 - id: cmh0000000000aaaaaaa00001
 *                   caseNumber: HRCI-20251018-ABCD
 *                   title: Police Issue
 *                   priority: MEDIUM
 *                   status: NEW
 *                   visibility: PRIVATE
 *                   createdAt: "2025-10-18T07:10:00.000Z"
 *                   updatedAt: "2025-10-18T07:10:00.000Z"
 *                 - id: cmh0000000000aaaaaaa00002
 *                   caseNumber: HRCI-20251018-EFGH
 *                   title: Land Dispute
 *                   priority: HIGH
 *                   status: TRIAGED
 *                   visibility: PRIVATE
 *                   createdAt: "2025-10-18T07:12:00.000Z"
 *                   updatedAt: "2025-10-18T07:15:00.000Z"
 *               counts:
 *                 NEW: 12
 *                 TRIAGED: 4
 *                 IN_PROGRESS: 7
 *                 LEGAL_REVIEW: 2
 *                 ACTION_TAKEN: 1
 *                 RESOLVED: 3
 *                 REJECTED: 0
 *                 CLOSED: 0
 *                 ESCALATED: 0
 */
function pad2(n: number) { return String(n).padStart(2, '0'); }
async function generateCaseNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
  // Try a few random suffixes to avoid collisions
  for (let i = 0; i < 5; i++) {
    const suf = Math.random().toString(36).slice(2, 6).toUpperCase();
    const num = `HRCI-${ymd}-${suf}`;
    const exists = await (db as any).hrcCase.count({ where: { caseNumber: num } });
    if (exists === 0) return num;
  }
  // Fallback with timestamp
  return `HRCI-${ymd}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * @swagger
 * /hrci/cases:
 *   post:
 *     tags: [HRCI Cases]
 *     summary: Create a new case (member/staff)
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               incidentAt: { type: string, format: date-time, nullable: true }
 *               latitude: { type: number, nullable: true }
 *               longitude: { type: number, nullable: true }
 *               address: { type: string, nullable: true }
 *               category: { type: string, nullable: true }
 *               priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT], default: MEDIUM }
 *     responses:
 *       201:
 *         description: Created case
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     caseNumber: { type: string }
 *                     title: { type: string }
 *                     status: { type: string }
 *                     priority: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: cmh0000000000aaaaaaa00009
 *                 caseNumber: HRCI-20251018-XY12
 *                 title: Police Issue
 *                 status: NEW
 *                 priority: MEDIUM
 *                 createdAt: "2025-10-18T07:20:30.000Z"
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const user: any = (req as any).user;
    const b = req.body || {};
    if (!b.title || !b.description) {
      return res.status(400).json({ success: false, error: 'TITLE_AND_DESCRIPTION_REQUIRED' });
    }
    const caseNumber = await generateCaseNumber();
    const created = await (db as any).hrcCase.create({
      data: {
        caseNumber,
        title: String(b.title),
        description: String(b.description),
        incidentAt: b.incidentAt ? new Date(b.incidentAt) : null,
        // If the authenticated principal is a MEMBER user, set themselves as complainant.
        // Otherwise, allow explicit complainantUserId (e.g., staff creating on behalf of someone).
        complainantUserId: (() => {
          const roleName = user?.role?.name?.toString()?.toUpperCase?.();
          if (roleName === 'MEMBER') return user?.id ?? null;
          return b.complainantUserId || null;
        })(),
        createdByUserId: user?.id,
        latitude: b.latitude != null ? Number(b.latitude) : null,
        longitude: b.longitude != null ? Number(b.longitude) : null,
        address: b.address || null,
        category: b.category || null,
        priority: b.priority || 'MEDIUM',
        status: 'NEW',
        visibility: 'PRIVATE',
        source: 'WEB'
      },
      select: { id: true, caseNumber: true, title: true, status: true, priority: true, createdAt: true }
    });
    await (db as any).hrcCaseEvent.create({ data: { caseId: created.id, type: 'CREATED', data: { via: 'API' }, actorUserId: user?.id || null } });
    return res.status(201).json({ success: true, data: created });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_CREATE_FAILED', message: e?.message });
  }
});

// PATCH /hrci/cases/:id/legal - update legal status/suggestion
router.patch('/:id/legal', requireAuth, async (req, res) => {
  try {
    const actor: any = (req as any).user;
    const id = String(req.params.id);
    const { legalStatus, legalSuggestion } = (req.body || {}) as { legalStatus?: string; legalSuggestion?: string | null };

    if (legalStatus == null && legalSuggestion == null) {
      return res.status(400).json({ success: false, error: 'NO_FIELDS_TO_UPDATE' });
    }

    const allowedLegal = ['NOT_REQUIRED','ADVISED','FILED','IN_COURT'];
    if (legalStatus != null && !allowedLegal.includes(String(legalStatus))) {
      return res.status(400).json({ success: false, error: 'INVALID_LEGAL_STATUS' });
    }

    // Authorization: Admin roles or LEGAL_SECRETARY designation holders
    const actorRole = String(actor?.role?.name || '').toUpperCase();
    let allowed = ['HRCI_ADMIN','ADMIN','SUPERADMIN','SUPER_ADMIN'].includes(actorRole);
    if (!allowed) {
      const mems: any[] = await (db as any).membership.findMany({
        where: { userId: actor?.id, status: 'ACTIVE' },
        select: { designation: { select: { code: true } } }
      });
      allowed = mems.some((m: any) => String(m?.designation?.code || '').toUpperCase() === 'LEGAL_SECRETARY');
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Required: admin or LEGAL_SECRETARY' });
    }

    const existing = await (db as any).hrcCase.findUnique({ where: { id }, select: { id: true, caseNumber: true, legalStatus: true, legalSuggestion: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    const data: any = {};
    if (legalStatus != null) data.legalStatus = String(legalStatus);
    if (legalSuggestion !== undefined) data.legalSuggestion = legalSuggestion === null ? null : String(legalSuggestion);

    const updated = await (db as any).hrcCase.update({
      where: { id },
      data,
      select: { id: true, caseNumber: true, legalStatus: true, legalSuggestion: true, updatedAt: true }
    });

    try {
      const eventData: any = { suggestion: legalSuggestion ?? null };
      if (legalStatus != null) {
        eventData.from = existing.legalStatus;
        eventData.to = String(legalStatus);
      }
      await (db as any).hrcCaseEvent.create({
        data: {
          caseId: id,
          type: legalStatus != null ? 'LEGAL_STATUS_CHANGED' : 'LEGAL_SUGGESTION',
          data: eventData,
          actorUserId: actor?.id || null
        }
      });
    } catch {}

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_LEGAL_UPDATE_FAILED', message: e?.message });
  }
});

// GET /hrci/cases - list cases (staff) with status filter and summary counts
// Query params: status?, priority?, search?, limit?, cursor?
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, priority, search } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;

    const where: any = {};
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (search) where.OR = [
      { caseNumber: { contains: String(search), mode: 'insensitive' } },
      { title: { contains: String(search), mode: 'insensitive' } },
      { description: { contains: String(search), mode: 'insensitive' } }
    ];

    const rows = await (db as any).hrcCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        priority: true,
        status: true,
        visibility: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    // Summary counts by status (fast aggregated glance for filters)
    const statuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    const counts: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      counts[s] = await (db as any).hrcCase.count({ where: { ...where, status: s } });
    }));

    return res.json({ success: true, count: rows.length, nextCursor, data: rows, counts });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASES_LIST_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/me - my cases (created by me or where I am the complainant)
/**
 * @swagger
 * /hrci/cases/me:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List my cases (created by me or where I am complainant)
 *     description: |
 *       - Default: returns cases created by you or where you are the complainant.
 *       - If you hold an ACTIVE LEGAL_SECRETARY membership, this returns a global list of cases (not just yours) to enable legal triage.
 *       - Each case includes HRCI location fields to support client-side filtering.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "My cases list"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 nextCursor: { type: string, nullable: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       caseNumber: { type: string }
 *                       title: { type: string }
 *                       priority: { type: string }
 *                       status: { type: string }
 *                       visibility: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user: any = (req as any).user;
    const { status, priority, search } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;

    // Does caller have ACTIVE LEGAL_SECRETARY membership?
    let isLegal = false;
    try {
      const mems: any[] = await (db as any).membership.findMany({ where: { userId: user?.id, status: 'ACTIVE' }, select: { designation: { select: { code: true } } } });
      isLegal = mems.some((m: any) => String(m?.designation?.code || '').toUpperCase() === 'LEGAL_SECRETARY');
    } catch {}

    // Build filter
    let where: any = {};
    if (!isLegal) {
      // personal scope
      const myUserId = user?.kind === 'device' ? (user?.userId ?? null) : user?.id;
      const myPrincipalId = user?.id;
      const whereAny: any[] = [];
      if (myPrincipalId) whereAny.push({ createdByUserId: myPrincipalId });
      if (myUserId) whereAny.push({ complainantUserId: myUserId });
      if (whereAny.length === 0) return res.json({ success: true, count: 0, nextCursor: null, data: [] });
      where = { OR: whereAny };
    }
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (search) where.OR = [
      { caseNumber: { contains: String(search), mode: 'insensitive' } },
      { title: { contains: String(search), mode: 'insensitive' } },
      { description: { contains: String(search), mode: 'insensitive' } }
    ];

    const rows: any[] = await (db as any).hrcCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        priority: true,
        status: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        hrcCountryId: true, hrcStateId: true, hrcDistrictId: true, hrcMandalId: true,
        assignedToUserId: true
      }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    // Enrich with geo names for filtering convenience
    const stateIds = Array.from(new Set(rows.map(r => r.hrcStateId).filter(Boolean)));
    const districtIds = Array.from(new Set(rows.map(r => r.hrcDistrictId).filter(Boolean)));
    const mandalIds = Array.from(new Set(rows.map(r => r.hrcMandalId).filter(Boolean)));
    let statesById = new Map<string, any>();
    let districtsById = new Map<string, any>();
    let mandalsById = new Map<string, any>();
    if (stateIds.length) {
      const states: any[] = await (db as any).hrcState.findMany({ where: { id: { in: stateIds } }, select: { id: true, name: true, code: true } });
      statesById = new Map(states.map(s => [s.id, s]));
    }
    if (districtIds.length) {
      const districts: any[] = await (db as any).hrcDistrict.findMany({ where: { id: { in: districtIds } }, select: { id: true, name: true } });
      districtsById = new Map(districts.map(d => [d.id, d]));
    }
    if (mandalIds.length) {
      const mandals: any[] = await (db as any).hrcMandal.findMany({ where: { id: { in: mandalIds } }, select: { id: true, name: true } });
      mandalsById = new Map(mandals.map(m => [m.id, m]));
    }

    const data = rows.map((r: any) => ({
      ...r,
      state: r.hrcStateId ? statesById.get(r.hrcStateId) || null : null,
      district: r.hrcDistrictId ? districtsById.get(r.hrcDistrictId) || null : null,
      mandal: r.hrcMandalId ? mandalsById.get(r.hrcMandalId) || null : null,
    }));

    // Optional: counts to drive filters
    const statuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    const counts: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      counts[s] = await (db as any).hrcCase.count({ where: { ...where, status: s } });
    }));

    return res.json({ success: true, count: rows.length, nextCursor, data, counts, scope: isLegal ? 'GLOBAL_LEGAL' : 'MINE' });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'MY_CASES_LIST_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/assignees - list users at same cell/level/geography as caller (simple)
/**
 * @swagger
 * /hrci/cases/assignees:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List users at the same cell, level, and location as your membership
 *     description: |
 *       This endpoint ignores filters and uses your JWT's active membership to return users in the same scope.
 *       - If you have multiple memberships, the most specific scope is used (MANDAL > DISTRICT > STATE > ZONE > NATIONAL).
 *       - Returns 403 if you have no active membership.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: List of potential assignees
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId: { type: string }
 *                       fullName: { type: string, nullable: true }
 *                       mobileNumber: { type: string, nullable: true }
 *                       role: { type: string, nullable: true }
 *                       designationCode: { type: string }
 *                       designationName: { type: string }
 *                       level: { type: string }
 *                       zone: { type: string, nullable: true }
 *                       hrcStateId: { type: string, nullable: true }
 *                       hrcDistrictId: { type: string, nullable: true }
 *                       hrcMandalId: { type: string, nullable: true }
 *                       cellId: { type: string, nullable: true }
 *                       cellName: { type: string, nullable: true }
 *             examples:
 *               simple:
 *                 summary: Same-scope users
 *                 value:
 *                   success: true
 *                   count: 2
 *                   data:
 *                     - userId: "u_123"
 *                       fullName: "Ravi Kumar"
 *                       mobileNumber: "+919999999999"
 *                       role: "MEMBER"
 *                       designationCode: "HRCI_VOL"
 *                       designationName: "Volunteer"
 *                       level: "MANDAL"
 *                       zone: null
 *                       hrcStateId: "st_01"
 *                       hrcDistrictId: "dt_02"
 *                       hrcMandalId: "md_03"
 *                       cellId: "cell_01"
 *                       cellName: "Mandal Cell A"
 *                     - userId: "u_456"
 *                       fullName: "Sita Devi"
 *                       mobileNumber: "+919888888888"
 *                       role: "MEMBER"
 *                       designationCode: "HRCI_COORD"
 *                       designationName: "Coordinator"
 *                       level: "MANDAL"
 *                       zone: null
 *                       hrcStateId: "st_01"
 *                       hrcDistrictId: "dt_02"
 *                       hrcMandalId: "md_03"
 *                       cellId: "cell_01"
 *                       cellName: "Mandal Cell A"
 *       403:
 *         description: Caller has no active membership to scope by
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 error: { type: string }
 *             examples:
 *               noScope:
 *                 value: { success: false, error: "NO_SCOPE_MEMBERSHIP" }
 */
router.get('/assignees', requireAuth, async (req, res) => {
  try {
  const actor: any = (req as any).user;
  const limit = 50; // fixed cap to keep response bounded

    // Determine caller scope from their most specific active membership
    const myMems: any[] = await (db as any).membership.findMany({
      where: { userId: actor?.id, status: 'ACTIVE' },
      select: { cellId: true, level: true, zone: true, hrcCountryId: true, hrcStateId: true, hrcDistrictId: true, hrcMandalId: true }
    });
    if (myMems.length === 0) {
      return res.status(403).json({ success: false, error: 'NO_SCOPE_MEMBERSHIP' });
    }
    const pick = (lvl?: string) => myMems.find(m => m.level === lvl);
    const my = pick('MANDAL') || pick('DISTRICT') || pick('STATE') || pick('ZONE') || pick('NATIONAL') || myMems[0];

    const where: any = { status: 'ACTIVE' };
    if (my.cellId) where.cellId = my.cellId;
    if (my.level) where.level = my.level;
    if (my.zone) where.zone = my.zone;
    if (my.hrcCountryId) where.hrcCountryId = my.hrcCountryId;
    if (my.hrcStateId) where.hrcStateId = my.hrcStateId;
    if (my.hrcDistrictId) where.hrcDistrictId = my.hrcDistrictId;
    if (my.hrcMandalId) where.hrcMandalId = my.hrcMandalId;

    const mems = await (db as any).membership.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        userId: true,
        designationId: true,
        designation: { select: { id: true, code: true, name: true } },
        cellId: true,
        level: true,
        zone: true,
        hrcStateId: true,
        hrcDistrictId: true,
        hrcMandalId: true
      }
    });
    const userIds = Array.from(new Set(mems.map((m: any) => m.userId).filter(Boolean)));
    if (userIds.length === 0) return res.json({ success: true, count: 0, data: [] });

    // Fetch user basic details
    const users: any[] = await (db as any).user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        mobileNumber: true,
        role: { select: { name: true } },
        profile: { select: { fullName: true } }
      }
    });
    const usersById = new Map(users.map((u) => [u.id, u]));

  // Cell names (map once)
    const cellIds = Array.from(new Set(mems.map((m: any) => m.cellId).filter(Boolean)));
    let cellsById = new Map<string, any>();
    if (cellIds.length) {
      const cells: any[] = await (db as any).cell.findMany({ where: { id: { in: cellIds } }, select: { id: true, name: true } });
      cellsById = new Map(cells.map((c: any) => [c.id, c]));
    }

    const seen = new Set<string>();
    const data = mems.reduce((acc: any[], m: any) => {
      const u: any = usersById.get(m.userId);
      if (!u) return acc;
      if (seen.has(u.id)) return acc;
      seen.add(u.id);
      const cell = m.cellId ? cellsById.get(m.cellId) : null;
      acc.push({
        userId: u.id,
        fullName: u.profile?.fullName || null,
        mobileNumber: u.mobileNumber || null,
        role: u.role?.name || null,
        designationCode: m.designation?.code || '',
        designationName: m.designation?.name || '',
        level: m.level,
        zone: m.zone || null,
        hrcStateId: m.hrcStateId || null,
        hrcDistrictId: m.hrcDistrictId || null,
        hrcMandalId: m.hrcMandalId || null,
        cellId: m.cellId || null,
        cellName: cell?.name || null
      });
      return acc;
    }, [] as any[]);

    return res.json({ success: true, count: data.length, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ASSIGNEES_LIST_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/assignees/legal-secretaries - list LEGAL_SECRETARY users in same scope as caller
/**
 * @swagger
 * /hrci/cases/assignees/legal-secretaries:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List all LEGAL_SECRETARY users (global)
 *     description: |
 *       - Returns LEGAL_SECRETARY users across all levels and cells.
 *       - Access restricted to ADDI_GENERAL_SECRETARY or PRESIDENT (also allows admin roles).
 *       - No query params; requires JWT.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: List of LEGAL_SECRETARY users in scope
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId: { type: string }
 *                       fullName: { type: string, nullable: true }
 *                       mobileNumber: { type: string, nullable: true }
 *                       role: { type: string, nullable: true }
 *                       designationCode: { type: string }
 *                       designationName: { type: string }
 *                       level: { type: string }
 *                       cellId: { type: string, nullable: true }
 *                       cellName: { type: string, nullable: true }
 *       403:
 *         description: Caller has no active membership to scope by
 */
router.get('/assignees/legal-secretaries', requireAuth, async (req, res) => {
  try {
    const actor: any = (req as any).user;
    // Authorization: only ADDI/ADDL_GENERAL_SECRETARY or PRESIDENT (or admins)
    const actorRole = String(actor?.role?.name || '').toUpperCase();
    let allowed = ['HRCI_ADMIN','SUPERADMIN','SUPER_ADMIN','ADMIN'].includes(actorRole);
    if (!allowed) {
      const myMems: any[] = await (db as any).membership.findMany({
        where: { userId: actor?.id, status: 'ACTIVE' },
        select: { designation: { select: { code: true } } }
      });
      const desired = new Set(['ADDI_GENERAL_SECRETARY','ADDL_GENERAL_SECRETARY','PRESIDENT']);
      allowed = myMems.some((m: any) => desired.has(String(m?.designation?.code || '').toUpperCase()));
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'DESIGNATION_REQUIRED', message: 'Only ADDI_GENERAL_SECRETARY or PRESIDENT can access this endpoint' });
    }
    const limit = 50;
    const mems = await (db as any).membership.findMany({
      where: { status: 'ACTIVE', designation: { code: 'LEGAL_SECRETARY' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        userId: true,
        designation: { select: { code: true, name: true } },
        cellId: true,
        level: true,
      }
    });
    const userIds = Array.from(new Set(mems.map((m: any) => m.userId).filter(Boolean)));
    if (userIds.length === 0) return res.json({ success: true, count: 0, data: [] });
    const users: any[] = await (db as any).user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, mobileNumber: true, role: { select: { name: true } }, profile: { select: { fullName: true } } }
    });
    const usersById = new Map(users.map((u) => [u.id, u]));
    const cellIds = Array.from(new Set(mems.map((m: any) => m.cellId).filter(Boolean)));
    let cellsById = new Map<string, any>();
    if (cellIds.length) {
      const cells: any[] = await (db as any).cell.findMany({ where: { id: { in: cellIds } }, select: { id: true, name: true } });
      cellsById = new Map(cells.map((c: any) => [c.id, c]));
    }
    const seen = new Set<string>();
    const data = mems.reduce((acc: any[], m: any) => {
      const u: any = usersById.get(m.userId);
      if (!u) return acc;
      if (seen.has(u.id)) return acc;
      seen.add(u.id);
      const cell = m.cellId ? cellsById.get(m.cellId) : null;
      acc.push({
        userId: u.id,
        fullName: u.profile?.fullName || null,
        mobileNumber: u.mobileNumber || null,
        role: u.role?.name || null,
        designationCode: m.designation?.code || '',
        designationName: m.designation?.name || '',
        level: m.level,
        cellId: m.cellId || null,
        cellName: cell?.name || null
      });
      return acc;
    }, [] as any[]);
    return res.json({ success: true, count: data.length, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LEGAL_SECRETARIES_LIST_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /hrci/cases/summary:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: Get counts of cases by buckets (open, pending, closed, rejected)
 *     description: |-
 *       - Accepts multipart/form-data with field name `file` or a `mediaId` to link existing media.
 *       - Images are automatically converted to WebP for consistent storage and optimization.
 *       - Stores the file in object storage and links it to the case.
 *       - closed = RESOLVED + CLOSED
 *       - rejected = REJECTED
 *       - open = IN_PROGRESS + LEGAL_REVIEW + ACTION_TAKEN + ESCALATED
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: Summary counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     open: { type: integer }
 *                     pending: { type: integer }
 *                     closed: { type: integer }
 *                     rejected: { type: integer }
 *                     total: { type: integer }
 *                     breakdown:
 *                       type: object
 *                       additionalProperties: { type: integer }
 *             example:
 *               success: true
 *               data:
 *                 open: 8
 *                 pending: 5
 *                 closed: 3
 *                 rejected: 1
 *                 total: 17
 *                 breakdown:
 *                   NEW: 3
 *                   TRIAGED: 2
 *                   IN_PROGRESS: 4
 *                   LEGAL_REVIEW: 2
 *                   ACTION_TAKEN: 1
 *                   ESCALATED: 1
 *                   RESOLVED: 2
 *                   CLOSED: 1
 *                   REJECTED: 1
 */
router.get('/summary', requireAuth, async (_req, res) => {
  try {
    const statuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    const breakdown: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      breakdown[s] = await (db as any).hrcCase.count({ where: { status: s } });
    }));
    const pending = (breakdown['NEW'] || 0) + (breakdown['TRIAGED'] || 0);
    const closed = (breakdown['RESOLVED'] || 0) + (breakdown['CLOSED'] || 0);
    const rejected = (breakdown['REJECTED'] || 0);
    const open = (breakdown['IN_PROGRESS'] || 0) + (breakdown['LEGAL_REVIEW'] || 0) + (breakdown['ACTION_TAKEN'] || 0) + (breakdown['ESCALATED'] || 0);
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return res.json({ success: true, data: { open, pending, closed, rejected, total, breakdown } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASES_SUMMARY_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/legal - global case listing for LEGAL_SECRETARY (and admins)
/**
 * @swagger
 * /hrci/cases/legal:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: Global cases list for Legal Secretaries
 *     description: |
 *       - Requires ACTIVE LEGAL_SECRETARY membership or admin role.
 *       - Supports filters: status, priority, search, hrcStateId, hrcDistrictId, hrcMandalId.
 *       - Returns location info to ease client filtering.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: hrcStateId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcDistrictId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcMandalId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Global cases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 nextCursor: { type: string, nullable: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       caseNumber: { type: string }
 *                       title: { type: string }
 *                       status: { type: string }
 *                       priority: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       hrcStateId: { type: string, nullable: true }
 *                       hrcDistrictId: { type: string, nullable: true }
 *                       hrcMandalId: { type: string, nullable: true }
 *                       state: { type: object, nullable: true }
 *                       district: { type: object, nullable: true }
 *                       mandal: { type: object, nullable: true }
 *                 counts:
 *                   type: object
 *                   additionalProperties: { type: integer }
 *       403:
 *         description: Forbidden
 */
router.get('/legal', requireAuth, async (req, res) => {
  try {
    const user: any = (req as any).user;
    const actorRole = String(user?.role?.name || '').toUpperCase();
    let allowed = ['HRCI_ADMIN','ADMIN','SUPERADMIN','SUPER_ADMIN'].includes(actorRole);
    if (!allowed) {
      const mems: any[] = await (db as any).membership.findMany({ where: { userId: user?.id, status: 'ACTIVE' }, select: { designation: { select: { code: true } } } });
      allowed = mems.some((m: any) => String(m?.designation?.code || '').toUpperCase() === 'LEGAL_SECRETARY');
    }
    if (!allowed) return res.status(403).json({ success: false, error: 'FORBIDDEN' });

    const { status, priority, search, hrcStateId, hrcDistrictId, hrcMandalId } = req.query as any;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const cursor = (req.query.cursor as string) || undefined;

    const where: any = {};
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (hrcStateId) where.hrcStateId = String(hrcStateId);
    if (hrcDistrictId) where.hrcDistrictId = String(hrcDistrictId);
    if (hrcMandalId) where.hrcMandalId = String(hrcMandalId);
    if (search) where.OR = [
      { caseNumber: { contains: String(search), mode: 'insensitive' } },
      { title: { contains: String(search), mode: 'insensitive' } },
      { description: { contains: String(search), mode: 'insensitive' } }
    ];

    const rows: any[] = await (db as any).hrcCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true, caseNumber: true, title: true, status: true, priority: true, createdAt: true,
        hrcCountryId: true, hrcStateId: true, hrcDistrictId: true, hrcMandalId: true
      }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    // Enrich names
    const stateIds = Array.from(new Set(rows.map(r => r.hrcStateId).filter(Boolean)));
    const districtIds = Array.from(new Set(rows.map(r => r.hrcDistrictId).filter(Boolean)));
    const mandalIds = Array.from(new Set(rows.map(r => r.hrcMandalId).filter(Boolean)));
    let statesById = new Map<string, any>();
    let districtsById = new Map<string, any>();
    let mandalsById = new Map<string, any>();
    if (stateIds.length) {
      const states: any[] = await (db as any).hrcState.findMany({ where: { id: { in: stateIds } }, select: { id: true, name: true, code: true } });
      statesById = new Map(states.map(s => [s.id, s]));
    }
    if (districtIds.length) {
      const districts: any[] = await (db as any).hrcDistrict.findMany({ where: { id: { in: districtIds } }, select: { id: true, name: true } });
      districtsById = new Map(districts.map(d => [d.id, d]));
    }
    if (mandalIds.length) {
      const mandals: any[] = await (db as any).hrcMandal.findMany({ where: { id: { in: mandalIds } }, select: { id: true, name: true } });
      mandalsById = new Map(mandals.map(m => [m.id, m]));
    }

    const data = rows.map((r: any) => ({
      ...r,
      state: r.hrcStateId ? statesById.get(r.hrcStateId) || null : null,
      district: r.hrcDistrictId ? districtsById.get(r.hrcDistrictId) || null : null,
      mandal: r.hrcMandalId ? mandalsById.get(r.hrcMandalId) || null : null,
    }));

    const statuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    const counts: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      counts[s] = await (db as any).hrcCase.count({ where: { ...where, status: s } });
    }));

    return res.json({ success: true, count: rows.length, nextCursor, data, counts });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LEGAL_CASES_LIST_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/categories - return categories from config file if present; else built-in list
router.get('/categories', async (_req, res) => {
  try {
    // Try DB first
    const rows: any[] = await db.hrcCaseCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, parentId: true }
    });
    if (rows.length > 0) {
      // Build tree
      const byId = new Map<string, { code: string; name: string; children: any[] }>(
        rows.map((r: any) => [r.id, { code: r.code, name: r.name, children: [] }])
      );
      const roots: any[] = [];
      for (const r of rows) {
        const node = byId.get(r.id)!;
        if (r.parentId && byId.has(r.parentId)) {
          const parent = byId.get(r.parentId)!;
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return res.json({ success: true, data: roots });
    }
  } catch (e: any) {
    // fallthrough to JSON
    console.warn('[cases.categories] DB fetch failed, fallback to JSON:', e?.message);
  }
  try {
    const cfg = path.join(process.cwd(), 'config', 'hrci.case.categories.json');
    if (fs.existsSync(cfg)) {
      const data = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      return res.json({ success: true, data });
    }
  } catch {}
  // Defaults fallback if nothing else
  const defaults = [
    { code: 'HUMAN_RIGHTS_VIOLATION', name: 'Human Rights Violation', children: [
      { code: 'POLICE_BRUTALITY', name: 'Police Brutality' },
      { code: 'DISCRIMINATION', name: 'Discrimination' },
      { code: 'UNLAWFUL_DETENTION', name: 'Unlawful Detention' }
    ]},
    { code: 'CIVIL_ISSUES', name: 'Civil Issues', children: [
      { code: 'LAND_DISPUTE', name: 'Land / Property Dispute' },
      { code: 'DOMESTIC_ABUSE', name: 'Domestic Abuse' },
      { code: 'LABOUR_RIGHTS', name: 'Labour Rights' }
    ]},
    { code: 'LEGAL_AID', name: 'Legal Aid', children: [
      { code: 'ADVICE', name: 'Advice / Counseling' },
      { code: 'DRAFTING', name: 'Drafting Support' }
    ]}
  ];
  return res.json({ success: true, data: defaults });
});

// GET /hrci/cases/:id - get case detail
/**
 * @swagger
 * /hrci/cases/{id}:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: Get case detail by ID or caseNumber
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Case detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     caseNumber: { type: string }
 *                     title: { type: string }
 *                     description: { type: string }
 *                     incidentAt: { type: string, format: date-time, nullable: true }
 *                     latitude: { type: number, nullable: true }
 *                     longitude: { type: number, nullable: true }
 *                     address: { type: string, nullable: true }
 *                     category: { type: string, nullable: true }
 *                     priority: { type: string }
 *                     status: { type: string }
 *                     visibility: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *             example:
 *               success: true
 *               data:
 *                 id: cmh0000000000aaaaaaa00001
 *                 caseNumber: HRCI-20251018-ABCD
 *                 title: Police Issue
 *                 description: "Not taking my case"
 *                 incidentAt: "2025-10-18T07:04:53.044Z"
 *                 latitude: 17.385
 *                 longitude: 78.4867
 *                 address: Hyderabad
 *                 category: Civil Issues
 *                 priority: MEDIUM
 *                 status: NEW
 *                 visibility: PRIVATE
 *                 createdAt: "2025-10-18T07:10:00.000Z"
 *                 updatedAt: "2025-10-18T07:10:00.000Z"
 *       404: { description: Not found }
 */

// GET /hrci/cases/:id/timeline - events for a case
/**
 * @swagger
 * /hrci/cases/{id}/timeline:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: Get case timeline/events
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of events for the case (most recent first)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       type: { type: string }
 *                       data: { type: object, additionalProperties: true }
 *                       actorUserId: { type: string, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *       404: { description: Case not found }
 */
router.get('/:id/timeline', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    // Ensure case exists before listing events
    const exists = await (db as any).hrcCase.findFirst({ where: { OR: [{ id }, { caseNumber: id }] }, select: { id: true } });
    if (!exists) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const caseId = exists.id;
    const events = await (db as any).hrcCaseEvent.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, data: true, actorUserId: true, createdAt: true }
    });
    // Enrich ATTACHMENT_ADDED events with media URL
    const mediaIds: string[] = [];
    for (const ev of events) {
      if (String(ev.type) === 'ATTACHMENT_ADDED') {
        const mid = (ev as any).data?.mediaId;
        if (mid) mediaIds.push(String(mid));
      }
    }
    let mediaMap: Record<string, string> = {};
    if (mediaIds.length > 0) {
      const uniq = Array.from(new Set(mediaIds));
      const medias = await (db as any).media.findMany({ where: { id: { in: uniq } }, select: { id: true, url: true } });
      mediaMap = Object.fromEntries(medias.map((m: any) => [m.id, m.url]));
    }
    const enriched = events.map((ev: any) => {
      if (String(ev.type) === 'ATTACHMENT_ADDED' && ev?.data?.mediaId) {
        return { ...ev, data: { ...ev.data, url: mediaMap[String(ev.data.mediaId)] || null } };
      }
      return ev;
    });
    return res.json({ success: true, count: enriched.length, data: enriched });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_TIMELINE_FAILED', message: e?.message });
  }
});
// IMPORTANT: Keep non-parameter routes (e.g., /assignees) before this /:id catch-all
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const key = String(req.params.id);
    const row = await (db as any).hrcCase.findFirst({
      where: { OR: [{ id: key }, { caseNumber: key }] },
      select: {
        id: true,
        caseNumber: true,
        title: true,
        description: true,
        incidentAt: true,
        latitude: true,
        longitude: true,
        address: true,
        category: true,
        priority: true,
        status: true,
        visibility: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!row) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_GET_FAILED', message: e?.message });
  }
});

// PATCH /hrci/cases/:id/assign - assign case
/**
 * @swagger
 * /hrci/cases/{id}/assign:
 *   patch:
 *     tags: [HRCI Cases]
 *     summary: Assign a case to a staff member (HRCI_ADMIN or ADDI_GENERAL_SECRETARY)
 *     description: |
 *       - Admins can assign to any user.
 *       - ADDI/ADDL_GENERAL_SECRETARY can assign only to users who have an ACTIVE LEGAL_SECRETARY membership (any cell/level – no location restriction).
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignedToUserId]
 *             properties:
 *               assignedToUserId: { type: string }
 *               assignedRoleHint: { type: string, nullable: true, description: "Optional role/designation hint e.g., STATE_LEGAL_SECRETARY" }
 *           example:
 *             assignedToUserId: "cmuser001"
 *             assignedRoleHint: "STATE_LEGAL_SECRETARY"
 *     responses:
 *       200:
 *         description: Assignment updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     caseNumber: { type: string }
 *                     assignedToUserId: { type: string }
 *                     assignedRoleHint: { type: string }
 *             example:
 *               success: true
 *               data:
 *                 id: "cmgvy39f20000ugowwnxcwude"
 *                 caseNumber: "HRCI-20251018-QUFY"
 *                 assignedToUserId: "cmuser001"
 *                 assignedRoleHint: "STATE_LEGAL_SECRETARY"
 *       404: { description: Not found }
 */
router.patch('/:id/assign', requireAuth, async (req, res) => {
  try {
    const actor: any = (req as any).user;
    // Authorization: allow admins OR members with designation ADDI/ADDL_GENERAL_SECRETARY
    const actorRole = String(actor?.role?.name || '').toUpperCase();
    let allowed = ['HRCI_ADMIN','SUPERADMIN','SUPER_ADMIN','ADMIN'].includes(actorRole);
    if (!allowed) {
      const mems: any[] = await (db as any).membership.findMany({
        where: { userId: actor?.id, status: 'ACTIVE' },
        select: { designation: { select: { code: true } } }
      });
      const desired = new Set(['ADDI_GENERAL_SECRETARY','ADDL_GENERAL_SECRETARY']);
      allowed = mems.some((m: any) => desired.has(String(m?.designation?.code || '').toUpperCase()));
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'HRCI_ADMIN or ADDI_GENERAL_SECRETARY required' });
    }
    const id = String(req.params.id);
    const { assignedToUserId, assignedRoleHint } = req.body || {};
    if (!assignedToUserId) {
      return res.status(400).json({ success: false, error: 'ASSIGNEE_REQUIRED' });
    }
    // Validate case exists
    const existing = await (db as any).hrcCase.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    // Validate user exists
    const user = await (db as any).user.findUnique({ where: { id: String(assignedToUserId) }, select: { id: true } });
    if (!user) return res.status(400).json({ success: false, error: 'INVALID_ASSIGNEE' });

    // If caller is ADDI/ADDL_GENERAL_SECRETARY (not admin), enforce assignee must be LEGAL_SECRETARY (global, any cell/location)
    if (!['HRCI_ADMIN','SUPERADMIN','SUPER_ADMIN','ADMIN'].includes(actorRole)) {
      const allowedAssigneeMems: any[] = await (db as any).membership.findMany({
        where: {
          userId: String(assignedToUserId),
          status: 'ACTIVE',
          designation: { code: 'LEGAL_SECRETARY' },
        },
        select: { id: true }
      });
      if (allowedAssigneeMems.length === 0) {
        return res.status(403).json({ success: false, error: 'ASSIGNEE_NOT_LEGAL_SECRETARY', message: 'Assignee must have an ACTIVE LEGAL_SECRETARY membership' });
      }
    }

    const updated = await (db as any).hrcCase.update({
      where: { id },
      data: { assignedToUserId: String(assignedToUserId), assignedRoleHint: assignedRoleHint ? String(assignedRoleHint) : null },
      select: { id: true, caseNumber: true, assignedToUserId: true, assignedRoleHint: true }
    });
    await (db as any).hrcCaseEvent.create({
      data: {
        caseId: id,
        type: 'ASSIGNED',
        data: { toUserId: String(assignedToUserId), roleHint: assignedRoleHint || null },
        actorUserId: actor?.id || null
      }
    });
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_ASSIGN_FAILED', message: e?.message });
  }
});

// PATCH /hrci/cases/:id/status - update status
/**
 * @swagger
 * /hrci/cases/{id}/status:
 *   patch:
 *     tags: [HRCI Cases]
 *     summary: Update case status with optional note
 *     description: |
 *       Allowed callers:
 *       - Admin roles: HRCI_ADMIN, ADMIN, SUPERADMIN, SUPER_ADMIN
 *       - Members holding one of these designations: ADDI_GENERAL_SECRETARY, ADDL_GENERAL_SECRETARY, PRESIDENT
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED]
 *               note:
 *                 type: string
 *                 nullable: true
 *           example:
 *             status: TRIAGED
 *             note: "Initial triage completed"
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     caseNumber: { type: string }
 *                     status: { type: string }
 *                     updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Forbidden (insufficient role/designation)
 *       404:
 *         description: Case not found
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const actor: any = (req as any).user;
    const id = String(req.params.id);
    const { status, note } = req.body || {};

    const allowedStatuses = ['NEW','TRIAGED','IN_PROGRESS','LEGAL_REVIEW','ACTION_TAKEN','RESOLVED','REJECTED','CLOSED','ESCALATED'];
    if (!status || !allowedStatuses.includes(String(status))) {
      return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
    }

    // Authorization: admins or specific designations
    const actorRole = String(actor?.role?.name || '').toUpperCase();
    let allowed = ['HRCI_ADMIN','ADMIN','SUPERADMIN','SUPER_ADMIN'].includes(actorRole);
    if (!allowed) {
      const mems: any[] = await (db as any).membership.findMany({
        where: { userId: actor?.id, status: 'ACTIVE' },
        select: { designation: { select: { code: true } } }
      });
      const designationsAllowed = new Set(['ADDI_GENERAL_SECRETARY','ADDL_GENERAL_SECRETARY','PRESIDENT']);
      allowed = mems.some((m: any) => designationsAllowed.has(String(m?.designation?.code || '').toUpperCase()));
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Required: admin or ADDI/ADDL_GENERAL_SECRETARY/PRESIDENT' });
    }

    // Fetch case
    const existing = await (db as any).hrcCase.findUnique({ where: { id }, select: { id: true, caseNumber: true, status: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });

    // Update status
    const updated = await (db as any).hrcCase.update({ where: { id }, data: { status: String(status) } , select: { id: true, caseNumber: true, status: true, updatedAt: true } });
    // Log event
    try {
      await (db as any).hrcCaseEvent.create({
        data: {
          caseId: id,
          type: 'STATUS_CHANGED',
          data: { from: existing.status, to: String(status), note: note || null },
          actorUserId: actor?.id || null
        }
      });
    } catch {}

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_STATUS_UPDATE_FAILED', message: e?.message });
  }
});

// POST /hrci/cases/:id/comments - add external comment
router.post('/:id/comments', requireAuth, async (_req, res) => {
  return res.status(201).json({ success: true });
});

// POST /hrci/cases/:id/attachments - attach a file to a case (multipart/form-data)
/**
 * @swagger
 * /hrci/cases/{id}/attachments:
 *   post:
 *     tags: [HRCI Cases]
 *     summary: Upload and attach a file to a case
 *     description: |
 *       - Accepts multipart/form-data with field name `file` or a `mediaId` to link existing media.
 *       - Stores the file in object storage and links it to the case.
 *       - Allowed roles/designations: case owner (creator or complainant), admin roles (HRCI_ADMIN/ADMIN/SUPERADMIN/SUPER_ADMIN), LEGAL_SECRETARY, ADDI_GENERAL_SECRETARY.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               mediaId:
 *                 type: string
 *                 description: Existing mediaId to link (if provided, file upload is optional)
 *     responses:
 *       200:
 *         description: Attachment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     caseId: { type: string }
 *                     mediaId: { type: string }
 *                     fileName: { type: string }
 *                     mime: { type: string }
 *                     size: { type: integer }
 *                     url: { type: string }
 *       400: { description: Bad request }
 *       404: { description: Case not found }
 */
router.post('/:id/attachments', requireAuth, upload.single('file'), async (req: any, res) => {
  try {
    const actor: any = req.user;
    const id = String(req.params.id);
    const file = req.file as Express.Multer.File | undefined;
    const mediaIdFromBody: string | undefined = req.body?.mediaId;
    // Validate case exists and basic authorization
    const existing = await (db as any).hrcCase.findUnique({ where: { id }, select: { id: true, caseNumber: true, createdByUserId: true, complainantUserId: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const roleName = actor?.role?.name?.toString()?.toLowerCase?.();
    const isOwner = actor?.id && (existing.createdByUserId === actor.id || existing.complainantUserId === actor.id);
    const isAdmin = roleName === 'admin' || roleName === 'superadmin' || roleName === 'hrci_admin';
    // Allow LEGAL_SECRETARY or ADDI_GENERAL_SECRETARY designation holders as well
    let hasAllowedDesignation = false;
    if (!isOwner && !isAdmin) {
      try {
        const mems: any[] = await (db as any).membership.findMany({
          where: { userId: actor?.id, status: 'ACTIVE' },
          select: { designation: { select: { code: true } } }
        });
        const allowedDesigs = new Set(['LEGAL_SECRETARY','ADDI_GENERAL_SECRETARY']);
        hasAllowedDesignation = mems.some((m: any) => allowedDesigs.has(String(m?.designation?.code || '').toUpperCase()));
      } catch {}
    }
    if (!isOwner && !isAdmin && !hasAllowedDesignation) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'Only case owner, admin, LEGAL_SECRETARY, or ADDI_GENERAL_SECRETARY can attach files' });
    }

    // Support two modes: (1) multipart file upload, (2) link an existing mediaId
    if (!file && !mediaIdFromBody) {
      return res.status(400).json({ success: false, error: 'FILE_OR_MEDIA_ID_REQUIRED' });
    }

    let media: { id: string; url: string } | null = null;
    let safeName = 'attachment.bin';
    let mime: string | null = null;
    let size = 0;
    if (file) {
      if (!R2_BUCKET) return res.status(500).json({ success: false, error: 'STORAGE_NOT_CONFIGURED' });
      const d = new Date();
      const datePath = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      const rand = Math.random().toString(36).slice(2, 8);
      const originalName = (file.originalname || 'attachment.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
      const isImage = (file.mimetype || '').toLowerCase().startsWith('image/');
      let bodyBuffer: Buffer = file.buffer;
      if (isImage) {
        // Convert to WebP for consistent handling
        try {
          bodyBuffer = await sharp(file.buffer).webp({ quality: 80 }).toBuffer();
          mime = 'image/webp';
          // Replace extension with .webp
          const base = originalName.replace(/\.[^.]+$/, '');
          safeName = `${base}.webp`;
        } catch (convErr) {
          // Fallback to original if conversion fails
          mime = file.mimetype || 'application/octet-stream';
          safeName = originalName;
          bodyBuffer = file.buffer;
        }
      } else {
        // Non-images are stored as-is
        mime = file.mimetype || 'application/octet-stream';
        safeName = originalName;
      }
      const key = `cases/${id}/${datePath}/${Date.now()}-${rand}-${safeName}`;

      await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: bodyBuffer,
        ContentType: mime || 'application/octet-stream',
        CacheControl: 'private, max-age=31536000',
      }));
      const url = getPublicUrl(key);
      size = Number(bodyBuffer.length || file.size || 0);
      // Create Media row
      media = await (db as any).media.create({
        data: {
          key,
          url,
          name: safeName,
          contentType: mime,
          size,
          kind: (mime?.startsWith('image/') ? 'image' : (mime?.startsWith('video/') ? 'video' : 'other')),
          folder: 'cases',
          ownerId: actor?.id || null,
        },
  select: { id: true, url: true }
      });
    } else if (mediaIdFromBody) {
      // Link existing media
      const found = await (db as any).media.findUnique({ where: { id: String(mediaIdFromBody) }, select: { id: true, url: true, name: true, contentType: true, size: true } });
      if (!found) return res.status(404).json({ success: false, error: 'MEDIA_NOT_FOUND' });
      media = { id: found.id, url: found.url };
      safeName = found.name || safeName;
      mime = (found as any).contentType || null;
      size = Number((found as any).size || 0);
    }

    // Link as HrcCaseAttachment
    const attachment = await (db as any).hrcCaseAttachment.create({
      data: {
        caseId: id,
        mediaId: (media as any).id,
        fileName: safeName,
        mime: mime,
        size: size
      },
      select: { id: true, caseId: true, mediaId: true, fileName: true, mime: true, size: true, createdAt: true }
    });

    // Log event
    try {
      await (db as any).hrcCaseEvent.create({
        data: { caseId: id, type: 'ATTACHMENT_ADDED', data: { mediaId: (media as any).id, fileName: safeName, mime, size }, actorUserId: actor?.id || null }
      });
    } catch {}

    return res.json({ success: true, data: { ...attachment, url: (media as any).url } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'ATTACHMENT_UPLOAD_FAILED', message: e?.message });
  }
});

// GET /hrci/cases/:id/attachments - list attachments (same access as upload)
/**
 * @swagger
 * /hrci/cases/{id}/attachments:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List all attachments for a case
 *     description: |
 *       Returns all attachments with media URL.
 *       Allowed roles/designations: case owner (creator or complainant), admin roles (HRCI_ADMIN/ADMIN/SUPERADMIN/SUPER_ADMIN), LEGAL_SECRETARY, ADDI_GENERAL_SECRETARY.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Attachments list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       caseId: { type: string }
 *                       mediaId: { type: string }
 *                       fileName: { type: string }
 *                       mime: { type: string }
 *                       size: { type: integer }
 *                       createdAt: { type: string, format: date-time }
 *                       url: { type: string }
 *       403: { description: Forbidden }
 *       404: { description: Case not found }
 */
router.get('/:id/attachments', requireAuth, async (req: any, res) => {
  try {
    const actor: any = req.user;
    const id = String(req.params.id);
    const existing = await (db as any).hrcCase.findUnique({ where: { id }, select: { id: true, createdByUserId: true, complainantUserId: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    const roleName = actor?.role?.name?.toString()?.toLowerCase?.();
    const isOwner = actor?.id && (existing.createdByUserId === actor.id || existing.complainantUserId === actor.id);
    const isAdmin = roleName === 'admin' || roleName === 'superadmin' || roleName === 'hrci_admin';
    let hasAllowedDesignation = false;
    if (!isOwner && !isAdmin) {
      try {
        const mems: any[] = await (db as any).membership.findMany({
          where: { userId: actor?.id, status: 'ACTIVE' },
          select: { designation: { select: { code: true } } }
        });
        const allowedDesigs = new Set(['LEGAL_SECRETARY','ADDI_GENERAL_SECRETARY']);
        hasAllowedDesignation = mems.some((m: any) => allowedDesigs.has(String(m?.designation?.code || '').toUpperCase()));
      } catch {}
    }
    if (!isOwner && !isAdmin && !hasAllowedDesignation) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    }

    const rows = await (db as any).hrcCaseAttachment.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, caseId: true, mediaId: true, fileName: true, mime: true, size: true, createdAt: true }
    });
    const mids = Array.from(new Set(rows.map((r: any) => String(r.mediaId))));
    const medias = await (db as any).media.findMany({ where: { id: { in: mids } }, select: { id: true, url: true } });
    const urlMap = Object.fromEntries(medias.map((m: any) => [m.id, m.url]));
    const data = rows.map((r: any) => ({ ...r, url: urlMap[r.mediaId] || null }));
    return res.json({ success: true, count: data.length, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'CASE_ATTACHMENTS_LIST_FAILED', message: e?.message });
  }
});

// Move this route above '/:id' to avoid being captured by it
// GET /hrci/cases/assignees - list potential assignees by designation/level/geography/cell
/**
 * @swagger
 * /hrci/cases/assignees:
 *   get:
 *     tags: [HRCI Cases]
 *     summary: List users eligible to be assignees by designation, level, cell, and geography (HRCI_ADMIN)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: designationCode
 *         schema: { type: string }
 *       - in: query
 *         name: designationId
 *         schema: { type: string }
 *       - in: query
 *         name: cellCode
 *         schema: { type: string }
 *       - in: query
 *         name: cellId
 *         schema: { type: string }
 *       - in: query
 *         name: level
 *         schema: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *       - in: query
 *         name: zone
 *         schema: { type: string, enum: [NORTH, SOUTH, EAST, WEST, CENTRAL] }
 *       - in: query
 *         name: hrcCountryId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcStateId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcDistrictId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcMandalId
 *         schema: { type: string }
 *       - in: query
 *         name: roleName
 *         schema: { type: string, default: MEMBER }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "Search by user mobileNumber" }
 *     responses:
 *       200:
 *         description: List of potential assignees
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 count: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId: { type: string }
 *                       fullName: { type: string, nullable: true }
 *                       mobileNumber: { type: string, nullable: true }
 *                       role: { type: string, nullable: true }
 *                       designationCode: { type: string }
 *                       designationName: { type: string }
 *                       level: { type: string }
 *                       zone: { type: string, nullable: true }
 *                       hrcStateId: { type: string, nullable: true }
 *                       hrcDistrictId: { type: string, nullable: true }
 *                       hrcMandalId: { type: string, nullable: true }
 *                       cellId: { type: string, nullable: true }
 *                       cellName: { type: string, nullable: true }
 * */

export default router;
