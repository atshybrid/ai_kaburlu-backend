import { Router } from 'express';
import prisma from '../../lib/prisma';
import { verifyRazorpayWebhookSignature, getRazorpayPaymentLink, getRazorpayOrderPayments, razorpayEnabled } from '../../lib/razorpay';
import crypto from 'crypto';

// IMPORTANT: Express must use raw body for webhook signature verification.
// In app.ts, mount this route BEFORE express.json() or with express.raw middleware.

const router = Router();

// POST /payment/webhook (and mounted under /api/v1/payment/webhook via app)
router.post('/webhook', async (req: any, res) => {
  try {
    if (!razorpayEnabled()) return res.status(200).send('ignored');
    const payload = req.rawBody || req.bodyRaw || req._raw || req.body; // rawBody set by custom middleware
    const text = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : JSON.stringify(payload);
    const sig = req.headers['x-razorpay-signature'] as string;
    if (!sig || !verifyRazorpayWebhookSignature(text, sig)) {
      return res.status(400).send('bad signature');
    }
    const evt = typeof payload === 'object' ? payload : JSON.parse(text);
    const payloadHash = crypto.createHash('sha256').update(text).digest('hex');
    const type = evt?.event as string;
    const obj = evt?.payload || {};
    const eventId = evt?.id || obj?.id || undefined;

    // Deduplicate by payload hash
    const existing = await (prisma as any).razorpayWebhookEvent.findUnique({ where: { payloadHash } }).catch(() => null);
    if (existing && existing.status === 'PROCESSED') {
      return res.status(200).send('ok');
    }
    // Record event as RECEIVED (or reuse existing row)
    let eventRow = existing;
    if (!eventRow) {
      eventRow = await (prisma as any).razorpayWebhookEvent.create({ data: { payloadHash, signature: sig, eventType: type, eventId: eventId || null, payload: evt, status: 'RECEIVED' } });
    }

    // Handle payment_link.paid
    if (type === 'payment_link.paid') {
      const pl = obj?.payment_link?.entity || obj?.payment_link || {};
      const ref = pl?.reference_id as string | undefined;
      const notes = pl?.notes || {};
      if (notes?.type === 'DONATION') {
        // locate donation by id == reference_id
        const donation = await (prisma as any).donation.findUnique({ where: { id: String(ref) } }).catch(() => null);
        if (donation && donation.status !== 'SUCCESS') {
          const intent = await prisma.paymentIntent.findUnique({ where: { id: String(donation.paymentIntentId) } }).catch(() => null);
          if (intent) {
            await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS' as any } });
            await prisma.$transaction(async (tx) => {
              const anyTx = tx as any;
              const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS' } });
              await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
              const code = (intent.meta as any)?.shareCode || null;
              if (code) {
                const link = await anyTx.donationShareLink.findUnique({ where: { code } }).catch(() => null);
                if (link) await anyTx.donationShareLink.update({ where: { id: link.id }, data: { successCount: { increment: 1 } } });
              }
            });
          }
        }
      }
      if (notes?.type === 'AD' && notes?.adId) {
        await (prisma as any).ad.update({ where: { id: String(notes.adId) }, data: { status: 'ACTIVE' } }).catch(() => null);
      }
    }

    // Handle order.paid (fallback)
    if (type === 'order.paid') {
      const order = obj?.order?.entity || obj?.order || {};
      const rpOrderId = order?.id as string | undefined;
      if (rpOrderId) {
        // Try donation first
        const intent = await prisma.paymentIntent.findFirst({ where: { meta: { path: ['providerOrderId'], equals: rpOrderId } }, orderBy: { createdAt: 'desc' } });
        if (intent) {
          if (String(intent.intentType) === 'DONATION') {
            const donation = await (prisma as any).donation.findFirst({ where: { paymentIntentId: intent.id } });
            if (donation && donation.status !== 'SUCCESS') {
              await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCESS' as any } });
              await prisma.$transaction(async (tx) => {
                const anyTx = tx as any;
                const d = await anyTx.donation.update({ where: { id: donation.id }, data: { status: 'SUCCESS' } });
                await anyTx.donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: d.amount } } }).catch(() => null);
              });
            }
          } else if (String(intent.intentType) === 'AD') {
            const adId = (intent.meta as any)?.adId;
            if (adId) await (prisma as any).ad.update({ where: { id: String(adId) }, data: { status: 'ACTIVE' } }).catch(() => null);
          }
        }
      }
    }

    // Mark processed
    await (prisma as any).razorpayWebhookEvent.update({ where: { payloadHash }, data: { status: 'PROCESSED', processedAt: new Date() } }).catch(() => null);
    return res.status(200).send('ok');
  } catch (e: any) {
    // Mark failed (best-effort)
    try {
      const payload = req.rawBody || req.bodyRaw || req._raw || req.body;
      const text = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : JSON.stringify(payload);
      const payloadHash = crypto.createHash('sha256').update(text).digest('hex');
      await (prisma as any).razorpayWebhookEvent.update({ where: { payloadHash }, data: { status: 'FAILED', errorMessage: e?.message || String(e) } });
    } catch {}
    return res.status(200).send('ok'); // avoid retries storm; log server-side if needed
  }
});

export default router;
