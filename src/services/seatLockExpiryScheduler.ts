import prisma from '../lib/prisma';

const SEAT_LOCK_TIMEOUT_MS = Number(process.env.SEAT_LOCK_TIMEOUT_MS) || 5 * 60 * 1000; // default 5 min
const TICK_INTERVAL_MS = 60 * 1000; // run every 1 minute

export function startSeatLockExpiryScheduler() {
  const ENABLED = String(process.env.SEAT_LOCK_EXPIRY_SCHEDULER || 'true').toLowerCase() !== 'false';
  if (!ENABLED) return;

  async function tick() {
    try {
      const lockExpiry = new Date(Date.now() - SEAT_LOCK_TIMEOUT_MS);
      // Mark stale PENDING_PAYMENT memberships as EXPIRED:
      // - lockedAt older than timeout, OR
      // - lockedAt is null (legacy records with no timestamp)
      const res = await (prisma as any).membership.updateMany({
        where: {
          status: 'PENDING_PAYMENT',
          OR: [
            { lockedAt: { lt: lockExpiry } },
            { lockedAt: null },
          ],
        },
        data: {
          status: 'EXPIRED',
          revokedAt: new Date(),
        },
      });
      if (res?.count) {
        console.log(`[seat-lock-expiry] Expired ${res.count} stale PENDING_PAYMENT seat lock(s)`);
      }
    } catch (e: any) {
      console.error('[seat-lock-expiry] tick error:', e?.message || e);
    }
    setTimeout(tick, TICK_INTERVAL_MS);
  }

  // First tick after 1 minute
  setTimeout(tick, TICK_INTERVAL_MS);
  console.log(`[seat-lock-expiry] Scheduler started (lock timeout: ${SEAT_LOCK_TIMEOUT_MS / 1000}s, tick: ${TICK_INTERVAL_MS / 1000}s)`);
}
