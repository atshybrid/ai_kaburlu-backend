import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

const router = Router();

type Granularity = 'daily' | 'weekly' | 'monthly';

function parseDateParam(v?: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }

function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

function startOfWeek(d: Date) {
  // ISO week: Monday start. JS getUTCDay: 0=Sun..6=Sat
  const day = d.getUTCDay() || 7; // Sunday -> 7
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - (day - 1));
  return startOfDay(start);
}
function endOfWeek(d: Date) { return endOfDay(addDays(startOfWeek(d), 6)); }

function startOfMonth(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)); }
function endOfMonth(d: Date) { return endOfDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); }

function makeBuckets(from: Date, to: Date, granularity: Granularity) {
  const buckets: Array<{ start: Date; end: Date; label: string }> = [];
  let cursor: Date;
  if (granularity === 'daily') cursor = startOfDay(from);
  else if (granularity === 'weekly') cursor = startOfWeek(from);
  else cursor = startOfMonth(from);

  while (cursor <= to) {
    let start: Date; let end: Date; let label: string;
    if (granularity === 'daily') { start = startOfDay(cursor); end = endOfDay(cursor); label = start.toISOString().slice(0,10); cursor = addDays(cursor, 1); }
    else if (granularity === 'weekly') { start = startOfWeek(cursor); end = endOfWeek(cursor); label = `${start.toISOString().slice(0,10)}..${end.toISOString().slice(0,10)}`; cursor = addDays(end, 1); }
    else { start = startOfMonth(cursor); end = endOfMonth(cursor); label = `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}`; cursor = addMonths(cursor, 1); }
    if (end < from) continue;
    const boundedStart = start < from ? from : start;
    const boundedEnd = end > to ? to : end;
    buckets.push({ start: boundedStart, end: boundedEnd, label });
  }
  return buckets;
}

/**
 * @swagger
 * /hrci/reports/metrics:
 *   get:
 *     tags: [HRCI_admin_reportes]
 *     summary: Membership and donation metrics (daily/weekly/monthly)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         description: Start date (inclusive) in ISO format (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         description: End date (inclusive) in ISO format (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: granularity
 *         description: Grouping granularity
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *           default: daily
 *     responses:
 *       200:
 *         description: Aggregated metrics for memberships, membership fees, and donations
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               range:
 *                 from: '2025-10-01T00:00:00.000Z'
 *                 to: '2025-10-25T23:59:59.999Z'
 *                 granularity: daily
 *               totals:
 *                 memberships:
 *                   joinsCount: 120
 *                   activatedCount: 95
 *                 membershipFees:
 *                   successCount: 90
 *                   successAmount: 245000
 *                 donations:
 *                   totalCount: 60
 *                   totalAmount: 510000
 *                   memberAttributedCount: 40
 *                   memberAttributedAmount: 380000
 *                   directCount: 20
 *                   directAmount: 130000
 *               series:
 *                 - period:
 *                     label: '2025-10-01'
 *                     start: '2025-10-01T00:00:00.000Z'
 *                     end: '2025-10-01T23:59:59.999Z'
 *                   memberships:
 *                     joinsCount: 5
 *                     activatedCount: 4
 *                   membershipFees:
 *                     successCount: 4
 *                     successAmount: 11000
 *                   donations:
 *                     totalCount: 3
 *                     totalAmount: 26000
 *                     memberAttributedCount: 2
 *                     memberAttributedAmount: 18000
 *                     directCount: 1
 *                     directAmount: 8000
 */
router.get('/metrics', requireAuth, requireHrcAdmin, async (req: any, res) => {
  try {
    const fromParam = parseDateParam(req.query.from);
    const toParam = parseDateParam(req.query.to);
    const granularity: Granularity = ['daily','weekly','monthly'].includes(String(req.query.granularity))
      ? String(req.query.granularity) as Granularity
      : 'daily';

  const now = new Date();
  // If daily selected and no explicit range, default to TODAY only
  const defaultTo = (!fromParam && !toParam && granularity === 'daily') ? endOfDay(now) : endOfDay(now);
  const defaultFrom = (!fromParam && !toParam && granularity === 'daily') ? startOfDay(now) : startOfDay(addDays(now, -30));
    const from = startOfDay(fromParam || defaultFrom);
    const to = endOfDay(toParam || defaultTo);

    // Safety cap: max 400 days range to prevent heavy scans
    const maxRangeDays = 400;
    if ((to.getTime() - from.getTime()) / (24*3600*1000) > maxRangeDays) {
      return res.status(400).json({ success: false, error: 'RANGE_TOO_LARGE', message: `Please limit date range to ${maxRangeDays} days or less` });
    }

    // Preload relevant records once for range, then bucket in-memory for simplicity
    const [memberships, membershipPayments, donations] = await Promise.all([
      prisma.membership.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { id: true, status: true, activatedAt: true, createdAt: true }
      }),
      prisma.membershipPayment.findMany({
        where: { createdAt: { gte: from, lte: to }, status: 'SUCCESS' },
        select: { id: true, amount: true, createdAt: true }
      }),
      prisma.donation.findMany({
        where: { createdAt: { gte: from, lte: to }, status: 'SUCCESS' },
        select: { id: true, amount: true, createdAt: true, referrerUserId: true }
      })
    ]);

    const buckets = makeBuckets(from, to, granularity);

    const toKeyDaily = (d: Date) => startOfDay(d).toISOString();
    const inRange = (t: Date, s: Date, e: Date) => t >= s && t <= e;

    const series = buckets.map(b => {
      const m = memberships.filter(x => inRange(x.createdAt, b.start, b.end));
      const mActivated = memberships.filter(x => x.activatedAt && inRange(x.activatedAt, b.start, b.end));
      const pay = membershipPayments.filter(x => inRange(x.createdAt, b.start, b.end));
      const dons = donations.filter(x => inRange(x.createdAt, b.start, b.end));
      const donsMember = dons.filter(x => !!x.referrerUserId);
      const donsDirect = dons.filter(x => !x.referrerUserId);
      const sum = (arr: { amount: number }[]) => arr.reduce((s, r) => s + (r.amount || 0), 0);
      return {
        period: { label: b.label, start: b.start, end: b.end },
        memberships: {
          joinsCount: m.length,
          activatedCount: mActivated.length
        },
        membershipFees: {
          successCount: pay.length,
          successAmount: sum(pay)
        },
        donations: {
          totalCount: dons.length,
          totalAmount: sum(dons),
          memberAttributedCount: donsMember.length,
          memberAttributedAmount: sum(donsMember),
          directCount: donsDirect.length,
          directAmount: sum(donsDirect)
        }
      };
    });

    const totals = series.reduce((acc: any, s: any) => {
      acc.memberships.joinsCount += s.memberships.joinsCount;
      acc.memberships.activatedCount += s.memberships.activatedCount;
      acc.membershipFees.successCount += s.membershipFees.successCount;
      acc.membershipFees.successAmount += s.membershipFees.successAmount;
      acc.donations.totalCount += s.donations.totalCount;
      acc.donations.totalAmount += s.donations.totalAmount;
      acc.donations.memberAttributedCount += s.donations.memberAttributedCount;
      acc.donations.memberAttributedAmount += s.donations.memberAttributedAmount;
      acc.donations.directCount += s.donations.directCount;
      acc.donations.directAmount += s.donations.directAmount;
      return acc;
    }, {
      memberships: { joinsCount: 0, activatedCount: 0 },
      membershipFees: { successCount: 0, successAmount: 0 },
      donations: { totalCount: 0, totalAmount: 0, memberAttributedCount: 0, memberAttributedAmount: 0, directCount: 0, directAmount: 0 }
    });

    return res.json({ success: true, range: { from, to, granularity }, totals, series });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'REPORTS_FAILED', message: e?.message });
  }
});

export default router;
/**
 * @swagger
 * /hrci/reports/member-donations:
 *   get:
 *     tags: [HRCI_admin_reportes]
 *     summary: Per-member donation metrics (generated vs success)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         description: User ID to aggregate donations for (referrer)
 *         schema:
 *           type: string
 *       - in: query
 *         name: membershipId
 *         description: Membership ID; if provided, system resolves to its userId
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         description: Start date (inclusive) in ISO format (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         description: End date (inclusive) in ISO format (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Member-attributed donation counts and amounts
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               range:
 *                 from: '2025-10-01T00:00:00.000Z'
 *                 to: '2025-10-25T23:59:59.999Z'
 *               target:
 *                 userId: 'cm123'
 *               totals:
 *                 generatedCount: 25
 *                 successCount: 18
 *                 successAmount: 145000
 *                 pendingCount: 5
 *                 failedCount: 2
 */
router.get('/member-donations', requireAuth, requireHrcAdmin, async (req: any, res) => {
  try {
    const membershipId = req.query.membershipId ? String(req.query.membershipId) : undefined;
    let userId = req.query.userId ? String(req.query.userId) : undefined;
    if (!userId && membershipId) {
      const m = await prisma.membership.findUnique({ where: { id: membershipId }, select: { userId: true } });
      if (!m) return res.status(404).json({ success: false, error: 'MEMBERSHIP_NOT_FOUND' });
      userId = m.userId;
    }
    if (!userId) return res.status(400).json({ success: false, error: 'USER_OR_MEMBERSHIP_REQUIRED', message: 'Provide userId or membershipId' });

    const fromParam = parseDateParam(req.query.from);
    const toParam = parseDateParam(req.query.to);
    const now = new Date();
    const from = startOfDay(fromParam || addDays(now, -30));
    const to = endOfDay(toParam || now);

    // Cap to 400 days
    const maxRangeDays = 400;
    if ((to.getTime() - from.getTime()) / (24*3600*1000) > maxRangeDays) {
      return res.status(400).json({ success: false, error: 'RANGE_TOO_LARGE', message: `Please limit date range to ${maxRangeDays} days or less` });
    }

    const donations = await prisma.donation.findMany({
      where: { referrerUserId: userId, createdAt: { gte: from, lte: to } },
      select: { id: true, amount: true, status: true }
    });
    const generatedCount = donations.length;
    const success = donations.filter(d => d.status === 'SUCCESS');
    const pending = donations.filter(d => d.status === 'PENDING');
    const failed = donations.filter(d => d.status === 'FAILED' || d.status === 'REFUND');
    const sum = (arr: { amount: number }[]) => arr.reduce((s, r) => s + (r.amount || 0), 0);
    const successAmount = sum(success);

    return res.json({
      success: true,
      range: { from, to },
      target: { userId },
      totals: {
        generatedCount,
        successCount: success.length,
        successAmount,
        pendingCount: pending.length,
        failedCount: failed.length
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'REPORTS_FAILED', message: e?.message });
  }
});
