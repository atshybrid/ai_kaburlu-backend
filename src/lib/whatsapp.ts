/**
 * WhatsApp Cloud API helper
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';
const API_VERSION     = process.env.WHATSAPP_API_VERSION || 'v22.0';
const BASE_URL        = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

/**
 * Send a plain text reply to a WhatsApp user.
 */
export async function sendTextMessage(to: string, body: string): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp sendTextMessage failed [${res.status}]: ${err}`);
  }
}

/**
 * Send an interactive button message.
 */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp sendButtonMessage failed [${res.status}]: ${err}`);
  }
}

/**
 * Mark an incoming message as read so the user sees the ✓✓ tick.
 */
export async function markAsRead(messageId: string): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Send the "Finalize account set-up" template message (otpnewkhabharx).
 *
 * Template variables:
 *   {{1}} = recipient's name (or phone number if name is unknown)
 *
 * Template must be approved in Meta Business Manager before use.
 * Run: npx ts-node scripts/create-wa-account-template.ts  to submit it.
 */
export async function sendAccountSetupMessage(to: string, name: string): Promise<void> {
  const templateName = process.env.WHATSAPP_ACCOUNT_SETUP_TEMPLATE || 'otpnewkhabharx';

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: name },
          ],
        },
      ],
    },
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp sendAccountSetupMessage failed [${res.status}]: ${err}`);
  }
}
