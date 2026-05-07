/**
 * WhatsApp Cloud API Webhook + Bot
 *
 * GET  /whatsapp/webhook        — Meta verification
 * POST /whatsapp/webhook        — Incoming messages / bot logic
 * GET  /whatsapp/leads          — Admin: list bot leads
 * PATCH /whatsapp/leads/:id     — Admin: update lead status
 *
 * Webhook URL: https://app.humanrightscouncilforindia.org/api/v1/whatsapp/webhook
 * Verify Token: khabarx_wa_verify_2025
 */

import { Router, Request, Response } from 'express';
import {
  sendTextMessage, sendButtonMessage, sendDocumentMessage,
  sendImageMessage, sendListMessage, markAsRead,
} from '../../lib/whatsapp';
import prisma from '../../lib/prisma';
import { normalizeMobileNumber } from '../../lib/mobileNumber';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';
import { r2Client, R2_BUCKET, getPublicUrl } from '../../lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createRazorpayPaymentLink, createRazorpayPlan, createRazorpaySubscription,
  getRazorpayPaymentLink, razorpayEnabled,
} from '../../lib/razorpay';
import { generateDonationReceiptPdf } from '../../lib/pdf/generateDonationReceipt';
import QRCode from 'qrcode';

const BASE_URL    = (process.env.PROD_BASE_URL || 'https://app.humanrightscouncilforindia.org/api/v1').replace('/api/v1', '');
const ADMIN_PHONE = process.env.WHATSAPP_SUPPORT_MOBILE || '918906189999';

/* ─────────────────────────────────────────────────────────────────────────────
   In-memory bot session store (10-min TTL per phone)
───────────────────────────────────────────────────────────────────────────── */
type BotStep =
  | 'ASK_NAME' | 'ASK_AREA' | 'ASK_POST'    // lead capture
  | 'DONATE_CUSTOM_AMOUNT';                   // donation: entering custom amount

interface BotSession {
  step: BotStep;
  fullName?: string;
  area?: string;
  lastActivity: number;
  // donation context
  donationEventId?: string;
  donationEventTitle?: string;
  donationPresets?: number[];
  donationCustomType?: 'once' | 'recurring';
}

const sessions = new Map<string, BotSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

function getSession(phone: string): BotSession | undefined {
  const s = sessions.get(phone);
  if (!s) return undefined;
  if (Date.now() - s.lastActivity > SESSION_TTL_MS) { sessions.delete(phone); return undefined; }
  s.lastActivity = Date.now();
  return s;
}

function setSession(phone: string, step: BotStep, data: Partial<BotSession> = {}) {
  sessions.set(phone, { step, lastActivity: Date.now(), ...data });
}

function clearSession(phone: string) { sessions.delete(phone); }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (now - v.lastActivity > SESSION_TTL_MS) sessions.delete(k);
  }
}, 5 * 60 * 1000);

/* ─────────────────────────────────────────────────────────────────────────────
   DB helpers
───────────────────────────────────────────────────────────────────────────── */
async function lookupIdCardByPhone(waPhone: string): Promise<{ cardNumber: string; fullName: string | null } | null> {
  try {
    const norm = normalizeMobileNumber(waPhone);
    if (!norm) return null;
    const user = await (prisma as any).user.findFirst({
      where: { OR: [{ mobileNumber: norm }, { mobileNumber: { endsWith: norm } }] },
      select: { id: true },
    });
    if (!user) return null;
    const membership = await (prisma as any).membership.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { idCard: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!membership?.idCard) return null;
    return { cardNumber: membership.idCard.cardNumber, fullName: membership.idCard.fullName || null };
  } catch { return null; }
}

async function checkSeatAvailability(designationName: string): Promise<number> {
  try {
    const desig = await (prisma as any).designation.findFirst({
      where: { name: { contains: designationName, mode: 'insensitive' } },
      select: { id: true, defaultCapacity: true },
    });
    if (!desig) return -1;
    const filled = await (prisma as any).membership.count({
      where: { designationId: desig.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'PENDING_APPROVAL'] } },
    });
    return Math.max(0, (desig.defaultCapacity || 0) - filled);
  } catch { return -1; }
}

async function getTopDesignations(): Promise<string[]> {
  try {
    const rows = await (prisma as any).designation.findMany({
      orderBy: { orderRank: 'asc' },
      take: 3,
      select: { name: true },
    });
    if (rows.length >= 3) return rows.map((r: any) => r.name as string);
  } catch { /* ignore */ }
  return ['State President', 'District Secretary', 'Mandal Coordinator'];
}

async function saveWaBotLead(args: {
  phone: string; fullName: string; area: string; postInterested: string; seatsAvailable: number;
}) {
  return (prisma as any).waBotLead.create({
    data: {
      phone: args.phone,
      fullName: args.fullName,
      area: args.area,
      postInterested: args.postInterested,
      seatsAvailable: args.seatsAvailable,
      status: 'NEW',
      notifiedAdmin: false,
    },
  });
}

/** Fetch up to 5 active donation events with their presets */
async function getActiveDonationEvents(): Promise<Array<{
  id: string; title: string; description: string | null; coverImageUrl: string | null; presets: number[];
}>> {
  try {
    const now = new Date();
    const rows = await (prisma as any).donationEvent.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, description: true, coverImageUrl: true, presets: true },
    });
    return rows;
  } catch { return []; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   ID Card PDF helper — generate via internal endpoint, upload to R2, return URL
───────────────────────────────────────────────────────────────────────────── */
async function generateAndCacheIdCardPdf(cardNumber: string): Promise<string> {
  const safeNum  = cardNumber.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const r2Key    = `idcards/pdf/${safeNum}.pdf`;
  const pdfApiUrl = `${BASE_URL}/api/v1/hrci/idcard/${encodeURIComponent(cardNumber)}/pdf`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const pdfResp = await fetch(pdfApiUrl, { signal: controller.signal });
    if (!pdfResp.ok) throw new Error(`PDF gen returned ${pdfResp.status}`);
    const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=604800',
    }));

    return getPublicUrl(r2Key);
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Ensure a default donation event exists (General Donation)
───────────────────────────────────────────────────────────────────────────── */
async function ensureDefaultDonationEvent(): Promise<{ id: string; title: string; presets: number[] }> {
  const existing = await (prisma as any).donationEvent.findFirst({
    where: { status: 'ACTIVE', title: 'General Donation' },
    select: { id: true, title: true, presets: true },
  }).catch(() => null);
  if (existing) return existing;
  const created = await (prisma as any).donationEvent.create({
    data: { title: 'General Donation', status: 'ACTIVE', allowCustom: true, presets: [100, 500, 1000] },
    select: { id: true, title: true, presets: true },
  });
  return created;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Razorpay helpers for donation — creates actual DB records
───────────────────────────────────────────────────────────────────────────── */
async function createDonationPaymentLink(args: {
  amountPaise: number;
  eventTitle: string;
  eventId: string;
  phone: string;
}): Promise<{ url: string; donationId: string }> {
  const amount = Math.round(args.amountPaise / 100);

  // Create PaymentIntent
  const intent = await (prisma as any).paymentIntent.create({
    data: {
      amount,
      currency: 'INR',
      status: 'PENDING',
      intentType: 'DONATION',
      cellCodeOrName: args.eventTitle,
      designationCode: 'DONATION',
      level: 'NATIONAL',
      meta: { source: 'whatsapp_bot', waPhone: args.phone, eventId: args.eventId },
    },
  });

  // Create Donation record
  const donation = await (prisma as any).donation.create({
    data: {
      eventId: args.eventId,
      amount,
      donorMobile: `+${args.phone}`,
      isAnonymous: false,
      status: 'PENDING',
      paymentIntentId: intent.id,
    },
  });

  // Create Razorpay payment link
  const safeTitle = args.eventTitle.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 60);
  const pl = await createRazorpayPaymentLink({
    amountPaise: args.amountPaise,
    description: `Donation - ${safeTitle}`,
    reference_id: donation.id,
    notify: { sms: false, email: false },
    notes: { type: 'DONATION', donationId: donation.id, waPhone: args.phone, source: 'whatsapp_bot' },
  }).catch((err: any) => {
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
    throw new Error(`Razorpay 400: ${detail}`);
  });

  await (prisma as any).donation.update({ where: { id: donation.id }, data: { providerOrderId: pl.id } });
  await (prisma as any).paymentIntent.update({ where: { id: intent.id }, data: { meta: { source: 'whatsapp_bot', waPhone: args.phone, eventId: args.eventId, payment_link_id: pl.id } } });

  return { url: pl.short_url, donationId: donation.id };
}

async function createDonationSubscriptionLink(args: {
  amountPaise: number;
  eventTitle: string;
  eventId: string;
  phone: string;
}): Promise<{ url: string; donationId: string }> {
  const amount = Math.round(args.amountPaise / 100);

  const plan = await createRazorpayPlan({
    period: 'monthly',
    interval: 1,
    name: `Monthly Donation – ${args.eventTitle}`,
    amountPaise: args.amountPaise,
    notes: { source: 'whatsapp_bot', eventId: args.eventId },
  });
  const sub = await createRazorpaySubscription({
    planId: plan.id,
    totalCount: 12,
    customer: { contact: `+${args.phone}` },
    notes: { type: 'DONATION', waPhone: args.phone, source: 'whatsapp_bot', eventId: args.eventId },
  });

  // Create a donation record so we can send receipt when subscription is charged
  const intent = await (prisma as any).paymentIntent.create({
    data: {
      amount,
      currency: 'INR',
      status: 'PENDING',
      intentType: 'DONATION',
      cellCodeOrName: args.eventTitle,
      designationCode: 'DONATION',
      level: 'NATIONAL',
      meta: { source: 'whatsapp_bot', waPhone: args.phone, eventId: args.eventId, subscriptionId: sub.id },
    },
  });
  const donation = await (prisma as any).donation.create({
    data: {
      eventId: args.eventId,
      amount,
      donorMobile: `+${args.phone}`,
      isAnonymous: false,
      status: 'PENDING',
      paymentIntentId: intent.id,
      providerOrderId: sub.id,
    },
  });

  return { url: sub.short_url, donationId: donation.id };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Generate 80G receipt PDF and send via WhatsApp
───────────────────────────────────────────────────────────────────────────── */
async function generateAndSendDonationReceipt(donationId: string, waPhone: string): Promise<void> {
  const donation = await (prisma as any).donation.findUnique({ where: { id: donationId } });
  if (!donation) return;

  // If receipt already generated, just re-send it
  if (donation.receiptPdfUrl) {
    const filename = `HRCI-80G-Receipt-${donationId.slice(-8).toUpperCase()}.pdf`;
    await sendDocumentMessage(waPhone, donation.receiptPdfUrl, filename, `Your 80G Donation Receipt`);
    return;
  }

  const org = await (prisma as any).orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null);
  if (!org) {
    // No org settings yet, just send a text confirmation
    await sendTextMessage(waPhone,
      `✅ *Donation Confirmed!*\n\n` +
      `Amount: ₹${(donation.amount || 0).toLocaleString('en-IN')}\n` +
      `Receipt No: DN-${donationId.slice(-8).toUpperCase()}\n\n` +
      `Your 80G receipt will be sent shortly.\n— *Human Rights Council of India*`,
    );
    return;
  }

  const appOrigin = BASE_URL; // https://app.humanrightscouncilforindia.org
  const receiptNo   = `DN-${donationId.slice(-8).toUpperCase()}`;
  const receiptDate = new Date(donation.createdAt).toLocaleDateString('en-IN');
  const donorName   = donation.donorName || 'HRCI Donor';
  const amountFmt   = (donation.amount || 0).toLocaleString('en-IN');
  const htmlUrl     = `${appOrigin}/donations/receipt/${donationId}/html`;

  const qrDataUrl = await QRCode.toDataURL(htmlUrl).catch(() => undefined);

  const pdfBuffer = await generateDonationReceiptPdf({
    orgName: org.orgName,
    addressLine1: org.addressLine1,
    addressLine2: org.addressLine2,
    city: org.city,
    state: org.state,
    pincode: org.pincode,
    country: org.country,
    pan: org.pan,
    eightyGNumber: org.eightyGNumber,
    eightyGValidFrom: org.eightyGValidFrom,
    eightyGValidTo: org.eightyGValidTo,
    authorizedSignatoryName: org.authorizedSignatoryName,
    authorizedSignatoryTitle: org.authorizedSignatoryTitle,
    hrciLogoUrl: `${appOrigin}/api/v1/org/settings/logo`,
    stampRoundUrl: `${appOrigin}/api/v1/org/settings/stamp`,
  }, {
    receiptNo,
    receiptDate,
    donorName,
    donorAddress: donation.donorAddress || '',
    donorPan: donation.donorPan || undefined,
    amount: amountFmt,
    mode: donation.providerPaymentId ? 'UPI/Card/Net Banking' : 'Online',
    purpose: 'Donation',
    qrDataUrl,
  });

  // Upload PDF to R2
  const r2Key = `donations/receipts/${donationId}.pdf`;
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    CacheControl: 'public, max-age=31536000',
  }));
  const pdfUrl = getPublicUrl(r2Key);

  // Persist receipt URL
  await (prisma as any).donation.update({
    where: { id: donationId },
    data: { receiptPdfUrl: pdfUrl, receiptHtmlUrl: htmlUrl, receiptGeneratedAt: new Date() },
  }).catch(() => null);

  // Send via WhatsApp
  const filename = `HRCI-80G-Receipt-${receiptNo}.pdf`;
  await sendTextMessage(waPhone,
    `✅ *Donation Confirmed! Thank you!*\n\n` +
    `📋 *Receipt No:* ${receiptNo}\n` +
    `💰 *Amount:* ₹${amountFmt}\n` +
    `📅 *Date:* ${receiptDate}\n\n` +
    `Your *80G tax exemption receipt* is attached below.\n` +
    `_This receipt is valid for tax deduction under Section 80G of the Income Tax Act._\n\n` +
    `— *Human Rights Council of India*`,
  );
  await sendDocumentMessage(waPhone, pdfUrl, filename, `80G Donation Receipt – ${receiptNo}`);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Router
───────────────────────────────────────────────────────────────────────────── */
const router = Router();
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'khabarx_wa_verify_2025';

/* GET /whatsapp/webhook */
router.get('/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified ✓');
    return res.status(200).send(challenge);
  }
  console.warn('[WhatsApp] Webhook verification failed');
  return res.status(403).json({ error: 'Verification failed' });
});

/* POST /whatsapp/webhook */
router.post('/webhook', async (req: Request, res: Response) => {
  res.status(200).send('EVENT_RECEIVED');
  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value    = change.value;
        const contacts = value?.contacts ?? [];
        const messages = value?.messages ?? [];
        for (const msg of messages) {
          const from  = msg.from;
          const msgId = msg.id;
          await markAsRead(msgId).catch(() => null);
          console.log(`[WhatsApp] Incoming msg from ${from}, type=${msg.type}`);
          if (msg.type === 'text') {
            const text = (msg.text?.body ?? '').trim().toLowerCase();
            await handleMessage(from, text, contacts);
          } else if (msg.type === 'interactive') {
            const btnId  = msg.interactive?.button_reply?.id  ?? '';
            const listId = msg.interactive?.list_reply?.id    ?? '';
            await handleButtonOrList(from, btnId || listId, contacts);
          } else {
            await sendTextMessage(from, 'I only understand text messages right now. Type *help* to see what I can do.').catch(() => null);
          }
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook processing error:', err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   Core bot message handler
───────────────────────────────────────────────────────────────────────────── */
async function handleMessage(from: string, text: string, contacts: any[]): Promise<void> {
  const waName = contacts[0]?.profile?.name ?? 'there';

  // Active session takes priority
  const session = getSession(from);
  if (session) { await handleSessionStep(from, text, session); return; }

  if (['hi', 'hello', 'నమస్కారం', 'khabarx', 'hrci', 'helo', 'hey'].includes(text)) {
    const idCardInfo = await lookupIdCardByPhone(from);
    if (idCardInfo) {
      await sendIdCard(from, idCardInfo.cardNumber, idCardInfo.fullName || waName);
    } else {
      await startLeadCapture(from);
    }
    return;
  }

  if (text === 'idcard' || text === 'id card' || text === 'id') {
    const idCardInfo = await lookupIdCardByPhone(from);
    if (idCardInfo) {
      await sendIdCard(from, idCardInfo.cardNumber, idCardInfo.fullName || waName);
    } else {
      await sendTextMessage(from, `❌ *ID Card not found* for your number.\n\nTo join *Human Rights Council of India*:\nhttps://app.humanrightscouncilforindia.org/join\nCall: +91 89061 89999`);
    }
    return;
  }

  if (text === 'join' || text === 'join hrci') { await startLeadCapture(from); return; }

  if (text === 'news') {
    await sendTextMessage(from, `📰 *Today's Top Headlines*\n\nVisit: https://app.humanrightscouncilforindia.org\n\n— *Human Rights Council of India*`);
    return;
  }

  if (text === 'donate' || text === 'donation') {
    await sendDonationMenu(from);
    return;
  }

  if (text === 'support') {
    await sendTextMessage(from, `📞 *Human Rights Council of India*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org\nWebsite: https://app.humanrightscouncilforindia.org`);
    return;
  }

  if (text === 'help') {
    await sendTextMessage(from,
      `*Human Rights Council of India Bot*\n\n` +
      `• *hi* — Welcome menu\n` +
      `• *idcard* — Get your HRCI ID card PDF\n` +
      `• *join* — Join HRCI membership\n` +
      `• *donate* — Donate to HRCI\n` +
      `• *news* — Latest headlines\n` +
      `• *support* — Contact support\n` +
      `• *help* — Show this menu`,
    );
    return;
  }

  await sendTextMessage(from, `I didn't understand that 😊\n\nType *hi* to start or *help* for all commands.\n\n— *Human Rights Council of India*`);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Donation menu — show active events with images & quick selection
───────────────────────────────────────────────────────────────────────────── */
async function sendDonationMenu(from: string): Promise<void> {
  const events = await getActiveDonationEvents();

  if (!events.length) {
    // No active events → use/create a default General Donation event
    const defEv = await ensureDefaultDonationEvent();
    events.push({ id: defEv.id, title: defEv.title, description: null, coverImageUrl: null, presets: defEv.presets });
  }

  // Send cover image of first event
  const featured = events[0];
  if (featured.coverImageUrl) {
    await sendImageMessage(from, featured.coverImageUrl,
      `💝 *${featured.title}*\n${featured.description ? featured.description.slice(0, 120) : 'Support HRCI\'s mission'}`,
    ).catch(() => null);
  }

  if (events.length === 1) {
    // Only 1 event — go straight to amount selection
    await sendDonationAmounts(from, featured.id, featured.title, featured.presets ?? []);
    return;
  }

  // Multiple events — show list selection
  await sendListMessage(
    from,
    '💝 Donate to HRCI',
    'Choose a cause you want to support:',
    'Choose Cause',
    [{
      title: 'Active Campaigns',
      rows: events.map(ev => ({
        id: `don_evt_${ev.id}`,
        title: ev.title.slice(0, 24),
        description: ev.description ? ev.description.slice(0, 72) : undefined,
      })),
    }],
    'Secure payments via Razorpay',
  );
}

/** Show amount buttons for a specific donation event */
async function sendDonationAmounts(
  from: string,
  eventId: string,
  eventTitle: string,
  presets: number[],
): Promise<void> {
  // Pick up to 3 preset amounts (use event presets or fall back to defaults)
  const amounts = (presets && presets.length > 0)
    ? presets.slice(0, 3)
    : [500, 1000, 2000];

  const fmtAmt = (n: number) => n >= 1000 ? `₹${n / 1000}K` : `₹${n}`;

  await sendButtonMessage(
    from,
    `💳 *One-time Donation*\n📌 ${eventTitle}\n\nSelect amount (one-time):`,
    amounts.map(amt => ({
      id: `don_amt_${amt}_once_${eventId}`,
      title: `${fmtAmt(amt)} Once`,
    })),
  );

  // Second message: recurring + custom options
  const recurringAmounts = amounts.slice(0, 2);
  await sendButtonMessage(
    from,
    `🔄 *Monthly Recurring Donation*\n📌 ${eventTitle}\n\nOr set up auto-monthly:`,
    [
      ...recurringAmounts.map(amt => ({
        id: `don_amt_${amt}_rec_${eventId}`,
        title: `${fmtAmt(amt)}/month`,
      })),
      { id: `don_custom_once_${eventId}`, title: '✏️ Custom Amount' },
    ],
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Button / list reply handler
───────────────────────────────────────────────────────────────────────────── */
async function handleButtonOrList(from: string, replyId: string, contacts: any[]): Promise<void> {
  const session = getSession(from);

  // If in ASK_POST step, the button ID is the designation name
  if (session?.step === 'ASK_POST') { await finishLeadCapture(from, session, replyId); return; }

  // ── Donation event selection ─────────────────────────────────────────────
  if (replyId.startsWith('don_evt_')) {
    const eventId = replyId.replace('don_evt_', '');
    const ev = await (prisma as any).donationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, description: true, coverImageUrl: true, presets: true },
    }).catch(() => null);
    if (!ev) { await sendTextMessage(from, `Sorry, this campaign is no longer available. Type *donate* to see current campaigns.`); return; }
    if (ev.coverImageUrl) {
      await sendImageMessage(from, ev.coverImageUrl, `📌 *${ev.title}*`).catch(() => null);
    }
    await sendDonationAmounts(from, ev.id, ev.title, ev.presets ?? []);
    return;
  }

  // ── Donation amount selected (once or recurring) ─────────────────────────
  // Format: don_amt_{amount}_{once|rec}_{eventId}
  if (replyId.startsWith('don_amt_')) {
    const parts = replyId.replace('don_amt_', '').split('_');
    // parts: [amount, type, ...eventIdParts]
    const amount  = parseInt(parts[0], 10);
    const type    = parts[1] === 'rec' ? 'recurring' : 'once';
    const eventId = parts.slice(2).join('_');
    await handleDonationPayment(from, eventId, amount, type as 'once' | 'recurring');
    return;
  }

  // ── Payment verify: user taps after paying ─────────────────────────────
  // Format: don_verify_{donationId}
  if (replyId.startsWith('don_verify_')) {
    const donationId = replyId.replace('don_verify_', '');
    await handleDonationVerify(from, donationId);
    return;
  }

  // ── Custom donation amount ───────────────────────────────────────────────
  // Format: don_custom_{once|rec}_{eventId}
  if (replyId.startsWith('don_custom_')) {
    const parts = replyId.replace('don_custom_', '').split('_');
    const type    = parts[0] === 'rec' ? 'recurring' : 'once';
    const eventId = parts.slice(1).join('_');
    // Fetch event title
    const ev = await (prisma as any).donationEvent.findUnique({
      where: { id: eventId }, select: { id: true, title: true, presets: true },
    }).catch(() => null);
    setSession(from, 'DONATE_CUSTOM_AMOUNT', {
      donationEventId: eventId,
      donationEventTitle: ev?.title || 'Donation',
      donationPresets: ev?.presets ?? [],
      donationCustomType: type as 'once' | 'recurring',
    });
    await sendTextMessage(from,
      `✏️ *Custom ${type === 'recurring' ? 'Monthly' : 'One-time'} Donation*\n` +
      `📌 ${ev?.title || 'HRCI Campaign'}\n\n` +
      `Please enter the amount in ₹ (numbers only):\n_Example: 300 or 1500_`,
    );
    return;
  }

  switch (replyId) {
    case 'btn_member_yes': {
      const idCardInfo = await lookupIdCardByPhone(from);
      if (idCardInfo) {
        await sendIdCard(from, idCardInfo.cardNumber, contacts[0]?.profile?.name || 'Member');
      } else {
        await sendTextMessage(from, `We couldn't find your membership in *Human Rights Council of India*.\n\nRegister at:\nhttps://app.humanrightscouncilforindia.org/join\n\nOr call: +91 89061 89999`);
      }
      break;
    }
    case 'btn_member_join': await startLeadCapture(from); break;
    case 'btn_news':
      await sendTextMessage(from, `📰 *Today's Top Headlines*\n\nVisit: https://app.humanrightscouncilforindia.org\n\n— *Human Rights Council of India*`);
      break;
    case 'btn_support':
      await sendTextMessage(from, `📞 *Human Rights Council of India*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org\nWebsite: https://app.humanrightscouncilforindia.org`);
      break;
    case 'btn_donate':
    case 'btn_donate_info':
      await sendDonationMenu(from);
      break;
    case 'btn_donate_once': {
      // Ask for a custom amount directly (one-time)
      const defEv2 = await ensureDefaultDonationEvent();
      await sendDonationAmounts(from, defEv2.id, defEv2.title, defEv2.presets);
      break;
    }
    case 'btn_donate_recurring': {
      const defEv3 = await ensureDefaultDonationEvent();
      await sendDonationAmounts(from, defEv3.id, defEv3.title, defEv3.presets);
      break;
    }
    default:
      await sendTextMessage(from, `Type *help* for available commands.`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Donation payment: create Razorpay link and send to user
───────────────────────────────────────────────────────────────────────────── */
async function handleDonationPayment(
  from: string,
  eventId: string,
  amount: number,
  type: 'once' | 'recurring',
): Promise<void> {
  const ev = await (prisma as any).donationEvent.findUnique({
    where: { id: eventId }, select: { id: true, title: true },
  }).catch(() => null);
  const eventTitle = ev?.title || 'HRCI Donation';

  await sendTextMessage(from,
    `⏳ *Processing payment request...*\n📌 ${eventTitle}\n💰 ₹${amount.toLocaleString('en-IN')} (${type === 'recurring' ? 'Monthly' : 'One-time'})\n\nPlease wait a moment...`,
  ).catch(() => null);

  try {
    if (type === 'recurring') {
      const { url: paymentUrl, donationId } = await createDonationSubscriptionLink({
        amountPaise: amount * 100,
        eventTitle,
        eventId,
        phone: from,
      });
      await sendTextMessage(from,
        `✅ *Monthly Donation Set Up*\n\n` +
        `📌 *Campaign:* ${eventTitle}\n` +
        `💰 *Amount:* ₹${amount.toLocaleString('en-IN')}/month\n\n` +
        `🔗 *Click to complete your monthly donation:*\n${paymentUrl}\n\n` +
        `After payment, auto-debit will be set up for every month.\n` +
        `You can cancel anytime by contacting us.\n\n` +
        `_Powered by Razorpay · UPI / Card / Net Banking · 100% Secure_\n\n` +
        `📩 Your *80G tax receipt* will be sent here automatically once payment is confirmed.`,
      );
    } else {
      const { url: paymentUrl, donationId } = await createDonationPaymentLink({
        amountPaise: amount * 100,
        eventTitle,
        eventId,
        phone: from,
      });
      await sendTextMessage(from,
        `💳 *Donation Payment Link Ready*\n\n` +
        `📌 *Campaign:* ${eventTitle}\n` +
        `💰 *Amount:* ₹${amount.toLocaleString('en-IN')}\n\n` +
        `👇 *Tap the link below to pay securely:*\n${paymentUrl}\n\n` +
        `_Powered by Razorpay · UPI / Card / Net Banking · 100% Secure_`,
      );
      // Show verify button after payment link
      await sendButtonMessage(from,
        `📩 After completing payment, tap the button below to receive your *80G tax receipt* here on WhatsApp.`,
        [{ id: `don_verify_${donationId}`, title: '✅ Get Receipt' }],
      );
    }
    console.log(`[WhatsApp Bot] Donation link created for ${from}: ₹${amount} ${type} | event=${eventId}`);
  } catch (err: any) {
    console.error('[WhatsApp Bot] Razorpay link creation failed:', err?.message);
    await sendTextMessage(from,
      `⚠️ *Could not create payment link right now.*\n\n` +
      `📌 *${eventTitle}*\n💰 ₹${amount.toLocaleString('en-IN')}\n\n` +
      `Please donate at:\nhttps://app.humanrightscouncilforindia.org/donate\n\n` +
      `Or call: +91 89061 89999`,
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Verify payment and send 80G receipt (user-triggered fallback)
───────────────────────────────────────────────────────────────────────────── */
async function handleDonationVerify(from: string, donationId: string): Promise<void> {
  await sendTextMessage(from, `🔍 *Checking your payment status...*\nPlease wait a moment.`).catch(() => null);

  const donation = await (prisma as any).donation.findUnique({
    where: { id: donationId },
    select: { id: true, status: true, providerOrderId: true, amount: true, donorName: true, donorPan: true, donorAddress: true, providerPaymentId: true, receiptPdfUrl: true, createdAt: true },
  }).catch(() => null);

  if (!donation) {
    await sendTextMessage(from, `❌ Could not find your donation record. Please contact support: +91 89061 89999`);
    return;
  }

  // Already paid
  if (donation.status === 'SUCCESS') {
    if (donation.receiptPdfUrl) {
      await sendTextMessage(from, `✅ *Payment already confirmed!*\n\nSending your 80G receipt now...`);
      const filename = `HRCI-80G-Receipt-DN-${donationId.slice(-8).toUpperCase()}.pdf`;
      await sendDocumentMessage(from, donation.receiptPdfUrl, filename, `80G Donation Receipt`).catch(() =>
        sendTextMessage(from, `📥 Download your receipt: ${donation.receiptPdfUrl}`)
      );
    } else {
      // Generate receipt now
      await sendTextMessage(from, `✅ *Payment confirmed! Generating your 80G receipt...*`);
      await generateAndSendDonationReceipt(donationId, from).catch((e) => {
        console.error('[WhatsApp] Receipt gen failed:', e?.message);
        sendTextMessage(from, `⚠️ Receipt generation failed. Please contact +91 89061 89999 with Receipt No: DN-${donationId.slice(-8).toUpperCase()}`);
      });
    }
    return;
  }

  // Check Razorpay if we have a payment link ID
  if (donation.providerOrderId && razorpayEnabled()) {
    try {
      const pl: any = await getRazorpayPaymentLink(donation.providerOrderId);
      if (String(pl?.status).toLowerCase() === 'paid') {
        // Mark SUCCESS in DB
        await (prisma as any).donation.update({
          where: { id: donationId },
          data: { status: 'SUCCESS', providerPaymentId: pl?.payments?.[0]?.payment_id || null },
        }).catch(() => null);
        // Increment event collected amount
        if (donation.amount) {
          const d = await (prisma as any).donation.findUnique({ where: { id: donationId }, select: { eventId: true } });
          if (d?.eventId) {
            await (prisma as any).donationEvent.update({ where: { id: d.eventId }, data: { collectedAmount: { increment: donation.amount } } }).catch(() => null);
          }
        }
        await sendTextMessage(from, `✅ *Payment confirmed! Generating your 80G receipt...*`);
        await generateAndSendDonationReceipt(donationId, from).catch((e) => {
          console.error('[WhatsApp] Receipt gen failed:', e?.message);
          sendTextMessage(from, `⚠️ Receipt generation failed. Please contact +91 89061 89999 with Receipt No: DN-${donationId.slice(-8).toUpperCase()}`);
        });
        return;
      }
    } catch (e: any) {
      console.warn('[WhatsApp] Razorpay status check failed:', e?.message);
    }
  }

  // Payment not yet confirmed
  await sendButtonMessage(from,
    `⏳ *Payment not confirmed yet.*\n\nIf you've completed the payment, please wait a few minutes and try again.\n\nAmount: ₹${(donation.amount || 0).toLocaleString('en-IN')}`,
    [
      { id: `don_verify_${donationId}`, title: '🔄 Check Again' },
      { id: 'btn_support', title: '📞 Contact Support' },
    ],
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Multi-step Lead Capture session
───────────────────────────────────────────────────────────────────────────── */
async function startLeadCapture(from: string): Promise<void> {
  setSession(from, 'ASK_NAME');
  await sendTextMessage(from, `🤝 *Join Human Rights Council of India*\n\nGreat! We'd love to have you as a member.\n\nPlease share your *full name*:`);
}

async function handleSessionStep(from: string, text: string, session: BotSession): Promise<void> {
  if (['cancel', 'stop', 'quit', 'exit'].includes(text)) {
    clearSession(from);
    await sendTextMessage(from, `Registration paused. Type *hi* any time to restart.`);
    return;
  }

  // ── Custom donation amount entry ─────────────────────────────────────────
  if (session.step === 'DONATE_CUSTOM_AMOUNT') {
    const raw    = text.replace(/[^0-9]/g, '');
    const amount = parseInt(raw, 10);
    if (!amount || amount < 10 || amount > 1_000_000) {
      await sendTextMessage(from, `Please enter a valid amount between ₹10 and ₹10,00,000 (numbers only):`);
      return;
    }
    clearSession(from);
    await handleDonationPayment(
      from,
      session.donationEventId || '',
      amount,
      session.donationCustomType || 'once',
    );
    return;
  }

  // ── Lead capture steps ───────────────────────────────────────────────────
  if (session.step === 'ASK_NAME') {
    const fullName = text.trim();
    if (fullName.length < 2) { await sendTextMessage(from, `Please enter your full name (at least 2 characters):`); return; }
    setSession(from, 'ASK_AREA', { fullName });
    await sendTextMessage(from, `Nice to meet you, *${fullName}*! 👋\n\nWhat is your *area / mandal / district*?\n(Example: Vijayawada, Nellore, Hyderabad...)`);
    return;
  }

  if (session.step === 'ASK_AREA') {
    const area = text.trim();
    if (area.length < 2) { await sendTextMessage(from, `Please enter your area name:`); return; }
    setSession(from, 'ASK_POST', { fullName: session.fullName, area });
    const designations = await getTopDesignations();
    await sendButtonMessage(from,
      `Got it! 📍 Area: *${area}*\n\nWhich *HRCI post* are you interested in?`,
      designations.slice(0, 3).map(d => ({ id: d, title: d.length > 20 ? d.slice(0, 20) : d })),
    );
    return;
  }
}

async function finishLeadCapture(from: string, session: BotSession, postName: string): Promise<void> {
  const fullName = session.fullName || 'Unknown';
  const area     = session.area    || 'Unknown';
  clearSession(from);

  const seats    = await checkSeatAvailability(postName);
  const seatsMsg = seats === -1 ? '' : seats === 0
    ? '\n\n⚠️ Seats for this post are currently *limited*.'
    : `\n\n✅ Available seats: *${seats}*`;

  try {
    const lead = await saveWaBotLead({ phone: from, fullName, area, postInterested: postName, seatsAvailable: seats });
    sendTextMessage(ADMIN_PHONE,
      `🔔 *New HRCI Lead*\n\nName: *${fullName}*\nPhone: *+${from}*\nArea: *${area}*\nPost: *${postName}*\nSeats: ${seats === -1 ? 'N/A' : seats}\nLeadID: ${lead?.id || '-'}`,
    ).catch(err => console.warn('[WhatsApp] Admin notify failed:', err?.message));
    console.log(`[WhatsApp Bot] Lead saved: ${fullName} | ${area} | ${postName} | seats=${seats}`);
  } catch (err) {
    console.error('[WhatsApp Bot] Failed to save lead:', err);
  }

  await sendTextMessage(from,
    `✅ *Thank you, ${fullName}!*\n\n` +
    `Your interest in the *${postName}* post from *${area}* has been registered with *Human Rights Council of India*.${seatsMsg}\n\n` +
    `📞 Our team will contact you soon on your number.\n\n` +
    `🌐 www.humanrightscouncilforindia.org`,
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Shared: send ID card PDF helper
   Generates PDF → uploads to R2 for stable CDN URL → sends via WhatsApp
───────────────────────────────────────────────────────────────────────────── */
async function sendIdCard(from: string, cardNumber: string, memberName: string): Promise<void> {
  await sendTextMessage(
    from,
    `🪪 *Human Rights Council of India*\n\nHello *${memberName}*!\nYour ID Card No: *${cardNumber}*\n\n⏳ Generating your ID card PDF, please wait...`,
  ).catch(() => null);

  const filename = `HRCI-ID-Card-${cardNumber}.pdf`;
  let pdfUrl = `${BASE_URL}/api/v1/hrci/idcard/${encodeURIComponent(cardNumber)}/pdf`;

  try {
    pdfUrl = await generateAndCacheIdCardPdf(cardNumber);
    console.log(`[WhatsApp Bot] ID card PDF cached at: ${pdfUrl}`);
  } catch (err: any) {
    console.warn('[WhatsApp Bot] PDF upload to R2 failed, using direct URL:', err?.message);
  }

  await sendDocumentMessage(from, pdfUrl, filename, `HRCI Member ID Card — ${cardNumber}`)
    .catch(async (err) => {
      console.warn('[WhatsApp] Document send failed, falling back to link:', err?.message);
      await sendTextMessage(from, `📥 *Download your ID Card PDF:*\n${pdfUrl}`).catch(() => null);
    });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Admin API — Bot Leads
───────────────────────────────────────────────────────────────────────────── */

/** GET /whatsapp/leads — list bot leads */
router.get('/leads', requireAuth, requireHrcAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const skip   = parseInt(String(req.query.skip || '0'), 10);
    const take   = Math.min(parseInt(String(req.query.take || '50'), 10), 200);
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      (prisma as any).waBotLead.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      (prisma as any).waBotLead.count({ where }),
    ]);
    return res.json({ success: true, total, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LEADS_LIST_FAILED', message: e?.message });
  }
});

/** PATCH /whatsapp/leads/:id — update lead status */
router.patch('/leads/:id', requireAuth, requireHrcAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
    }
    const lead = await (prisma as any).waBotLead.update({
      where: { id },
      data: { ...(status ? { status } : {}) },
    });
    return res.json({ success: true, data: lead });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'LEAD_UPDATE_FAILED', message: e?.message });
  }
});

export default router;
