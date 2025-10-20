import prisma from '../lib/prisma';
import { razorpayEnabled, getRazorpayPaymentLink } from '../lib/razorpay';

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function envInt(name: string, def: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function startDonationsReconcileJob() {
  const enabled = String(process.env.DONATION_RECONCILE_ENABLED || '').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('[donation-reconcile] Disabled via DONATION_RECONCILE_ENABLED=false');
    return;
  }
  if (!razorpayEnabled()) {
    console.log('[donation-reconcile] Razorpay not configured; job not started');
    return;
  }
  const intervalMs = envInt('DONATION_RECONCILE_INTERVAL_MS', 5 * 60 * 1000); // default 5 minutes
  // run immediately on boot, then schedule
  runOnce().catch((e) => console.warn('[donation-reconcile] initial run failed:', e?.message || e));
  timer = setInterval(() => {
    runOnce().catch((e) => console.warn('[donation-reconcile] run failed:', e?.message || e));
  }, intervalMs);
  timer.unref?.();
  console.log(`[donation-reconcile] Started; interval=${intervalMs}ms`);
}

export async function stopDonationsReconcileJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runOnce() {
  if (isRunning) return; // prevent overlap
  isRunning = true;
  try {
    const batchSize = envInt('DONATION_RECONCILE_BATCH', 50);
    const windowDays = envInt('DONATION_RECONCILE_WINDOW_DAYS', 60);
    const fromDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Fetch a page of pending payment-link donations in the time window
    const pending = await (prisma as any).donation.findMany({
      where: {
        status: 'PENDING',
        providerOrderId: { not: null },
        createdAt: { gte: fromDate },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { id: true, eventId: true, amount: true, status: true, providerOrderId: true, providerPaymentId: true, paymentIntentId: true },
    });

    if (!pending.length) {
      return; // nothing to do
    }

    let updatedCount = 0;
    for (const d of pending) {
      if (!d.providerOrderId) continue;
      try {
        const pl = await getRazorpayPaymentLink(String(d.providerOrderId));
        if (String(pl.status).toLowerCase() !== 'paid') continue;

        // Mark PaymentIntent SUCCESS (best-effort)
        if (d.paymentIntentId) {
          await prisma.paymentIntent.update({ where: { id: d.paymentIntentId }, data: { status: 'SUCCESS' } }).catch(() => null);
        }

        // Update donation status only if currently PENDING
        const res = await (prisma as any).donation.updateMany({
          where: { id: d.id, status: 'PENDING' },
          data: { status: 'SUCCESS', providerPaymentId: (pl as any)?.payments?.[0]?.payment_id || d.providerPaymentId },
        });
        if (res.count === 1) {
          // Increment collectedAmount and share successCount only when we actually changed state
          await prisma.$transaction(async (tx) => {
            const anyTx = tx as any;
            await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
            // Share success count via PaymentIntent.meta.shareCode if available
            if (d.paymentIntentId) {
              const intent = await tx.paymentIntent.findUnique({ where: { id: d.paymentIntentId } }).catch(() => null);
              const code = (intent?.meta as any)?.shareCode || null;
              if (code) {
                const link = await anyTx.donationShareLink.findUnique({ where: { code } }).catch(() => null);
                if (link) await anyTx.donationShareLink.update({ where: { id: link.id }, data: { successCount: { increment: 1 } } });
              }
            }
          });
          updatedCount++;
        }
      } catch (e) {
        // ignore single row failure; continue with others
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[donation-reconcile] row failed', d.id, (e as any)?.message || e);
        }
      }
    }
    if (updatedCount > 0) {
      console.log(`[donation-reconcile] Reconciled ${updatedCount} donations`);
    }
  } finally {
    isRunning = false;
  }
}
