/**
 * WhatsApp Cloud API Webhook
 *
 * GET  /whatsapp/webhook  — Meta webhook verification (challenge-response)
 * POST /whatsapp/webhook  — Incoming messages / status updates
 *
 * Callback URL to paste in Meta App Dashboard → WhatsApp → Configuration:
 *   https://app.humanrightscouncilforindia.org/api/v1/whatsapp/webhook
 *
 * Verify Token (paste in dashboard):
 *   khabarx_wa_verify_2025   (set via WHATSAPP_WEBHOOK_VERIFY_TOKEN in .env)
 */

import { Router, Request, Response } from 'express';
import { sendTextMessage, sendButtonMessage, sendDocumentMessage, markAsRead } from '../../lib/whatsapp';
import prisma from '../../lib/prisma';
import { normalizeMobileNumber } from '../../lib/mobileNumber';

const BASE_URL = process.env.PROD_BASE_URL?.replace('/api/v1', '') || 'https://app.humanrightscouncilforindia.org';

/**
 * Lookup member ID card by incoming WhatsApp phone (E.164 without +, e.g. 919502337775).
 * Returns cardNumber string or null if not found.
 */
async function lookupIdCardByPhone(waPhone: string): Promise<{ cardNumber: string; fullName: string | null } | null> {
  try {
    const norm = normalizeMobileNumber(waPhone); // → 10-digit e.g. 9502337775
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

    return {
      cardNumber: membership.idCard.cardNumber,
      fullName: membership.idCard.fullName || null,
    };
  } catch {
    return null;
  }
}

const router = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'khabarx_wa_verify_2025';

/* ──────────────────────────────────────────────────────────────────────────
   GET /whatsapp/webhook
   Meta sends a one-time GET to verify the callback URL.
   We must echo back hub.challenge if hub.verify_token matches.
─────────────────────────────────────────────────────────────────────────── */
router.get('/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified ✓');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp] Webhook verification failed — bad token or mode');
  return res.status(403).json({ error: 'Verification failed' });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /whatsapp/webhook
   Handles incoming messages and delivery status updates.
─────────────────────────────────────────────────────────────────────────── */
router.post('/webhook', async (req: Request, res: Response) => {
  // Always respond 200 immediately so Meta doesn't retry
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
          const from = msg.from; // sender's phone number (E.164 without +)
          const msgId = msg.id;

          // Mark as read
          await markAsRead(msgId).catch(() => null);

          if (msg.type === 'text') {
            const text = (msg.text?.body ?? '').trim().toLowerCase();
            await handleTextMessage(from, text, contacts);
          } else if (msg.type === 'interactive') {
            const replyId = msg.interactive?.button_reply?.id ?? '';
            await handleButtonReply(from, replyId);
          } else {
            // Unknown message type — send a polite fallback
            await sendTextMessage(
              from,
              'Sorry, I only understand text messages right now. Type *help* to see what I can do.',
            ).catch(() => null);
          }
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook processing error:', err);
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   Bot logic
─────────────────────────────────────────────────────────────────────────── */

async function handleTextMessage(
  from: string,
  text: string,
  contacts: any[],
): Promise<void> {
  const name = contacts[0]?.profile?.name ?? 'there';

  if (text === 'hi' || text === 'hello' || text === 'నమస్కారం' || text === 'khabarx' || text === 'hrci') {
    // Check if this user has an ID card
    const idCardInfo = await lookupIdCardByPhone(from);

    if (idCardInfo) {
      const { cardNumber, fullName } = idCardInfo;
      const memberName = fullName || name;
      const pdfUrl = `${BASE_URL}/api/v1/hrci/idcard/${encodeURIComponent(cardNumber)}/pdf`;
      const filename = `HRCI-ID-Card-${cardNumber}.pdf`;

      await sendTextMessage(
        from,
        `🪪 *HRCI ID Card*\n\nHello *${memberName}*! Your ID card is ready.\nCard No: *${cardNumber}*`,
      ).catch(() => null);

      await sendDocumentMessage(
        from,
        pdfUrl,
        filename,
        `HRCI Member ID Card — ${cardNumber}`,
      ).catch(async (err) => {
        // Fallback: send as link if document send fails
        console.warn('[WhatsApp] Document send failed, falling back to link:', err?.message);
        await sendTextMessage(
          from,
          `📥 *Download your ID Card PDF:*\n${pdfUrl}`,
        ).catch(() => null);
      });

      // Also show the main menu
      await sendButtonMessage(
        from,
        `What would you like to do next?`,
        [
          { id: 'btn_news',    title: '📰 Latest News' },
          { id: 'btn_join',    title: '🤝 Join HRCI' },
          { id: 'btn_support', title: '📞 Support' },
        ],
      ).catch(() => null);
    } else {
      await sendButtonMessage(
        from,
        `Hello ${name}! 👋 Welcome to *KhabarX*.\nWhat would you like to do?`,
        [
          { id: 'btn_news',    title: '📰 Latest News' },
          { id: 'btn_join',    title: '🤝 Join HRCI' },
          { id: 'btn_support', title: '📞 Support' },
        ],
      );
    }
    return;
  }

  if (text === 'help') {
    await sendTextMessage(
      from,
      `*KhabarX Bot Commands*\n\n` +
      `• *hi* — Start menu + your ID card\n` +
      `• *idcard* — Get your HRCI ID card PDF\n` +
      `• *news* — Latest headlines\n` +
      `• *join* — Join HRCI membership\n` +
      `• *support* — Contact support\n` +
      `• *help* — Show this menu`,
    );
    return;
  }

  if (text === 'news') {
    await sendTextMessage(
      from,
      `📰 *Today's Top Headlines*\n\nVisit our app for full stories:\nhttps://app.humanrightscouncilforindia.org`,
    );
    return;
  }

  if (text === 'idcard' || text === 'id card' || text === 'id') {
    const idCardInfo = await lookupIdCardByPhone(from);
    if (idCardInfo) {
      const { cardNumber, fullName } = idCardInfo;
      const memberName = fullName || 'Member';
      const pdfUrl = `${BASE_URL}/api/v1/hrci/idcard/${encodeURIComponent(cardNumber)}/pdf`;
      const filename = `HRCI-ID-Card-${cardNumber}.pdf`;

      await sendTextMessage(
        from,
        `🪪 *HRCI ID Card*\n\nHello *${memberName}*!\nCard No: *${cardNumber}*`,
      ).catch(() => null);

      await sendDocumentMessage(from, pdfUrl, filename, `HRCI Member ID Card — ${cardNumber}`)
        .catch(async (err) => {
          console.warn('[WhatsApp] Document send failed, falling back to link:', err?.message);
          await sendTextMessage(from, `📥 *Download your ID Card PDF:*\n${pdfUrl}`).catch(() => null);
        });
    } else {
      await sendTextMessage(
        from,
        `❌ *No ID card found* for your number.\n\nJoin HRCI at:\nhttps://app.humanrightscouncilforindia.org/join\n\nFor help call: +91 89061 89999`,
      );
    }
    return;
  }

  if (text === 'join') {
    await sendTextMessage(
      from,
      `🤝 *Join HRCI*\n\nRegister as a member here:\nhttps://app.humanrightscouncilforindia.org/join\n\nFor help call: +91 89061 89999`,
    );
    return;
  }

  if (text === 'support') {
    await sendTextMessage(
      from,
      `📞 *KhabarX Support*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org`,
    );
    return;
  }

  // Default fallback
  await sendTextMessage(
    from,
    `I didn't understand that. Type *help* to see available commands. 😊`,
  );
}

async function handleButtonReply(from: string, replyId: string): Promise<void> {
  switch (replyId) {
    case 'btn_news':
      await sendTextMessage(
        from,
        `📰 *Today's Top Headlines*\n\nVisit our app for full stories:\nhttps://app.humanrightscouncilforindia.org`,
      );
      break;

    case 'btn_join':
      await sendTextMessage(
        from,
        `🤝 *Join HRCI*\n\nRegister here:\nhttps://app.humanrightscouncilforindia.org/join\n\nCall: +91 89061 89999`,
      );
      break;

    case 'btn_support':
      await sendTextMessage(
        from,
        `📞 *Support*\n\nWhatsApp: +91 89061 89999\nEmail: support@humanrightscouncilforindia.org`,
      );
      break;

    default:
      await sendTextMessage(from, `Unknown option. Type *help* for a list of commands.`);
  }
}

export default router;
