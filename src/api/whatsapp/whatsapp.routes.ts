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
import { sendTextMessage, sendButtonMessage, sendDocumentMessage, markAsRead } from '../../lib/whatsapp';
import prisma from '../../lib/prisma';
import { normalizeMobileNumber } from '../../lib/mobileNumber';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

const BASE_URL    = (process.env.PROD_BASE_URL || 'https://app.humanrightscouncilforindia.org/api/v1').replace('/api/v1', '');
const ADMIN_PHONE = process.env.WHATSAPP_SUPPORT_MOBILE || '918906189999';

/* ─────────────────────────────────────────────────────────────────────────────
   In-memory bot session store (10-min TTL per phone)
───────────────────────────────────────────────────────────────────────────── */
type BotStep = 'ASK_NAME' | 'ASK_AREA' | 'ASK_POST';

interface BotSession {
  step: BotStep;
  fullName?: string;
  area?: string;
  lastActivity: number;
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
      // Member → directly send ID card, no extra prompts
      await sendIdCard(from, idCardInfo.cardNumber, idCardInfo.fullName || waName);
    } else {
      // Not a member → directly start lead capture (ask for name)
      await startLeadCapture(from);
    }
    return;
  }

  if (text === 'idcard' || text === 'id card' || text === 'id') {
    const idCardInfo = await lookupIdCardByPhone(from);
    if (idCardInfo) {
      await sendIdCard(from, idCardInfo.cardNumber, idCardInfo.fullName || waName);
    } else {
      await sendTextMessage(from, `❌ *No ID card found* for your number.\n\nTo join HRCI: https://app.humanrightscouncilforindia.org/join\nCall: +91 89061 89999`);
    }
    return;
  }

  if (text === 'join' || text === 'join hrci') { await startLeadCapture(from); return; }

  if (text === 'news') {
    await sendTextMessage(from, `📰 *Today's Top Headlines*\n\nVisit: https://app.humanrightscouncilforindia.org`);
    return;
  }

  if (text === 'donate' || text === 'donation') {
    await sendButtonMessage(from, `💝 *Donate to HRCI*\n\nChoose donation type:`, [
      { id: 'btn_donate_once',      title: '💳 One-time Donation' },
      { id: 'btn_donate_recurring', title: '🔄 Monthly Recurring' },
      { id: 'btn_support',          title: '📞 Contact Us' },
    ]);
    return;
  }

  if (text === 'support') {
    await sendTextMessage(from, `📞 *HRCI Support*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org`);
    return;
  }

  if (text === 'help') {
    await sendTextMessage(from,
      `*HRCI / KhabarX Bot Commands*\n\n` +
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

  await sendTextMessage(from, `I didn't understand that 😊\n\nType *hi* to start or *help* for all commands.`);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Button / list reply handler
───────────────────────────────────────────────────────────────────────────── */
async function handleButtonOrList(from: string, replyId: string, contacts: any[]): Promise<void> {
  const session = getSession(from);

  // If in ASK_POST step, the button ID is the designation name
  if (session?.step === 'ASK_POST') { await finishLeadCapture(from, session, replyId); return; }

  switch (replyId) {
    case 'btn_member_yes': {
      const idCardInfo = await lookupIdCardByPhone(from);
      if (idCardInfo) {
        await sendIdCard(from, idCardInfo.cardNumber, contacts[0]?.profile?.name || 'Member');
      } else {
        await sendTextMessage(from, `We couldn't find your membership. Register at:\nhttps://app.humanrightscouncilforindia.org/join\n\nOr call: +91 89061 89999`);
      }
      break;
    }
    case 'btn_member_join': await startLeadCapture(from); break;
    case 'btn_news':
      await sendTextMessage(from, `📰 *Today's Top Headlines*\n\nVisit: https://app.humanrightscouncilforindia.org`);
      break;
    case 'btn_support':
      await sendTextMessage(from, `📞 *HRCI Support*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org`);
      break;
    case 'btn_donate':
    case 'btn_donate_info':
      await sendButtonMessage(from, `💝 *Donate to HRCI*\n\nChoose donation type:`, [
        { id: 'btn_donate_once',      title: '💳 One-time Donation' },
        { id: 'btn_donate_recurring', title: '🔄 Monthly Recurring' },
        { id: 'btn_support',          title: '📞 Contact Us' },
      ]);
      break;
    case 'btn_donate_once':
      await sendTextMessage(from, `💳 *One-time Donation*\n\nDonate here:\nhttps://app.humanrightscouncilforindia.org/donate\n\nFor help: +91 89061 89999`);
      break;
    case 'btn_donate_recurring':
      await sendTextMessage(from, `🔄 *Monthly Recurring Donation*\n\nSet up auto-debit:\nhttps://app.humanrightscouncilforindia.org/donate?type=recurring\n\nFor help: +91 89061 89999`);
      break;
    default:
      await sendTextMessage(from, `Type *help* for available commands.`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Multi-step Lead Capture session
───────────────────────────────────────────────────────────────────────────── */
async function startLeadCapture(from: string): Promise<void> {
  setSession(from, 'ASK_NAME');
  await sendTextMessage(from, `🤝 *Join HRCI*\n\nGreat! We'd love to have you.\n\nPlease share your *full name*:`);
}

async function handleSessionStep(from: string, text: string, session: BotSession): Promise<void> {
  if (['cancel', 'stop', 'quit', 'exit'].includes(text)) {
    clearSession(from);
    await sendTextMessage(from, `Registration paused. Type *hi* any time to restart.`);
    return;
  }

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
    // Notify admin
    sendTextMessage(ADMIN_PHONE,
      `🔔 *New HRCI Lead*\n\nName: *${fullName}*\nPhone: *+${from}*\nArea: *${area}*\nPost: *${postName}*\nSeats: ${seats === -1 ? 'N/A' : seats}\nLeadID: ${lead?.id || '-'}`,
    ).catch(err => console.warn('[WhatsApp] Admin notify failed:', err?.message));
    console.log(`[WhatsApp Bot] Lead saved: ${fullName} | ${area} | ${postName} | seats=${seats}`);
  } catch (err) {
    console.error('[WhatsApp Bot] Failed to save lead:', err);
  }

  await sendTextMessage(from,
    `✅ *Thank you, ${fullName}!*\n\n` +
    `Your interest in *${postName}* from *${area}* has been noted.${seatsMsg}\n\n` +
    `📞 The *HRCI team will contact you soon* on your number.\n\n` +
    `Learn more: https://app.humanrightscouncilforindia.org`,
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Shared: send ID card PDF helper
───────────────────────────────────────────────────────────────────────────── */
async function sendIdCard(from: string, cardNumber: string, memberName: string): Promise<void> {
  const pdfUrl   = `${BASE_URL}/api/v1/hrci/idcard/${encodeURIComponent(cardNumber)}/pdf`;
  const filename = `HRCI-ID-Card-${cardNumber}.pdf`;
  await sendTextMessage(from, `🪪 *HRCI ID Card*\n\nHello *${memberName}*!\nCard No: *${cardNumber}*`).catch(() => null);
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
