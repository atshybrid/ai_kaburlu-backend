import { Router } from 'express';
import prisma from '../../lib/prisma';
import { verifyRazorpayWebhookSignature, getRazorpayPaymentLink, getRazorpayOrderPayments, razorpayEnabled } from '../../lib/razorpay';
import crypto from 'crypto';
import { sendTextMessage, sendDocumentMessage } from '../../lib/whatsapp';
import { generateDonationReceiptPdf } from '../../lib/pdf/generateDonationReceipt';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import QRCode from 'qrcode';

const APP_ORIGIN = (process.env.PROD_BASE_URL || 'https://app.humanrightscouncilforindia.org/api/v1').replace('/api/v1', '');

/** Generate 80G receipt PDF, upload to R2, persist on donation, send via WhatsApp */
async function sendWhatsAppDonationReceipt(donationId: string, waPhone: string): Promise<void> {
  const donation = await (prisma as any).donation.findUnique({
    where: { id: donationId },
    select: { id: true, amount: true, donorName: true, donorAddress: true, donorPan: true, donorMobile: true,
              providerPaymentId: true, receiptPdfUrl: true, receiptHtmlUrl: true, createdAt: true },
  }).catch(() => null);
  if (!donation) return;

  // Re-send if already generated
  if (donation.receiptPdfUrl) {
    const filename = `HRCI-80G-Receipt-DN-${donationId.slice(-8).toUpperCase()}.pdf`;
    await sendTextMessage(waPhone,
      `✅ *Donation Confirmed! Thank you!*\n\n` +
      `📋 *Receipt No:* DN-${donationId.slice(-8).toUpperCase()}\n` +
      `💰 *Amount:* ₹${(donation.amount || 0).toLocaleString('en-IN')}\n\n` +
      `Your *80G tax exemption receipt* is attached below.\n` +
      `_Valid for tax deduction under Section 80G, Income Tax Act._\n\n` +
      `— *Human Rights Council for India*`,
    ).catch(() => null);
    await sendDocumentMessage(waPhone, donation.receiptPdfUrl, filename, `80G Donation Receipt`).catch(() => null);
    return;
  }

  const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null);
  if (!org) return; // No org settings — skip silently

  const receiptNo   = `DN-${donationId.slice(-8).toUpperCase()}`;
  const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
  const donorName   = donation.donorName || 'HRCI Donor';
  const amountFmt   = (donation.amount || 0).toLocaleString('en-IN');
  const htmlUrl     = `${APP_ORIGIN}/donations/receipt/${donationId}/html`;
  const qrDataUrl   = await QRCode.toDataURL(htmlUrl).catch(() => undefined);

  const pdfBuffer = await generateDonationReceiptPdf({
    orgName: org.orgName,
    addressLine1: org.addressLine1, addressLine2: org.addressLine2,
    city: org.city, state: org.state, pincode: org.pincode, country: org.country,
    pan: org.pan, eightyGNumber: org.eightyGNumber,
    eightyGValidFrom: org.eightyGValidFrom, eightyGValidTo: org.eightyGValidTo,
    authorizedSignatoryName: org.authorizedSignatoryName,
    authorizedSignatoryTitle: org.authorizedSignatoryTitle,
    hrciLogoUrl: `${APP_ORIGIN}/api/v1/org/settings/logo`,
    stampRoundUrl: `${APP_ORIGIN}/api/v1/org/settings/stamp`,
  }, {
    receiptNo, receiptDate, donorName,
    donorAddress: donation.donorAddress || '',
    donorPan: donation.donorPan || undefined,
    amount: amountFmt,
    mode: donation.providerPaymentId ? 'UPI/Card/Net Banking' : 'Online',
    purpose: 'Donation',
    qrDataUrl,
  });

  const r2Key  = `donations/receipts/${donationId}.pdf`;
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: r2Key, Body: pdfBuffer,
    ContentType: 'application/pdf', CacheControl: 'public, max-age=31536000',
  }));
  const pdfUrl = getPublicUrl(r2Key);

  await (prisma as any).donation.update({
    where: { id: donationId },
    data: { receiptPdfUrl: pdfUrl, receiptHtmlUrl: htmlUrl, receiptGeneratedAt: new Date() },
  }).catch(() => null);

  const filename = `HRCI-80G-Receipt-${receiptNo}.pdf`;
  await sendTextMessage(waPhone,
    `✅ *Donation Confirmed! Thank you!*\n\n` +
    `📋 *Receipt No:* ${receiptNo}\n` +
    `💰 *Amount:* ₹${amountFmt}\n` +
    `📅 *Date:* ${receiptDate}\n\n` +
    `Your *80G tax exemption receipt* is attached below.\n` +
    `_Valid for tax deduction under Section 80G, Income Tax Act._\n\n` +
    `— *Human Rights Council for India*`,
  ).catch(() => null);
  await sendDocumentMessage(waPhone, pdfUrl, filename, `80G Donation Receipt – ${receiptNo}`).catch(() => null);
}

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
        // Auto-send 80G receipt via WhatsApp if donated from WhatsApp bot
        const waPhone = notes?.waPhone as string | undefined;
        if (waPhone && donation) {
          const finalDonationId = donation.id;
          sendWhatsAppDonationReceipt(finalDonationId, waPhone).catch((e) =>
            console.error('[Webhook] WhatsApp 80G receipt send failed:', e?.message),
          );
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
          } else {
            // Membership payment (intentType is null / MEMBERSHIP / default)
            // Mark the intent as SUCCESS so the user can complete /register even if the
            // client timed out before calling /confirm.
            if (intent.status === 'PENDING' && !intent.membershipId) {
              await prisma.paymentIntent.update({
                where: { id: intent.id },
                data: { status: 'SUCCESS' as any }
              }).catch(() => null);
            }
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
