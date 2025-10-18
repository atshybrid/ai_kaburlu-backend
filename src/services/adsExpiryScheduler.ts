import prisma from '../lib/prisma';

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }

export function startAdsExpiryScheduler() {
  const ENABLED = String(process.env.ADS_EXPIRY_SCHEDULER || 'true').toLowerCase() !== 'false';
  if (!ENABLED) return;

  async function tick() {
    try {
      const now = new Date();
      // Mark ACTIVE ads with endAt < now as EXPIRED
      const res = await (prisma as any).ad.updateMany({
        where: { status: 'ACTIVE', endAt: { lt: now } },
        data: { status: 'EXPIRED' },
      });
      if ((res as any)?.count) {
        console.log(`[ads-expiry] Marked ${res?.count} ads as EXPIRED`);
      }
      // Optionally resume ads whose startAt <= now and (endAt null or > now) and currently not ACTIVE (e.g., RESET)
      const res2 = await (prisma as any).ad.updateMany({
        where: {
          status: { in: ['PAUSED','DRAFT'] },
          startAt: { lte: now },
          OR: [ { endAt: null }, { endAt: { gt: now } } ],
        },
        data: { status: 'ACTIVE' },
      });
      if ((res2 as any)?.count) {
        console.log(`[ads-expiry] Re-activated ${res2?.count} ads`);
      }
    } catch (e) {
      console.error('[ads-expiry] tick error', (e as any)?.message || e);
    }
  }

  // Run on startup, then every 5 minutes
  tick();
  (async () => {
    // 5 minutes
    const intervalMs = Number(process.env.ADS_EXPIRY_INTERVAL_MS || 5 * 60 * 1000);
    while (true) {
      await wait(intervalMs);
      await tick();
    }
  })();
}
