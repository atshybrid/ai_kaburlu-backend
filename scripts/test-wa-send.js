/**
 * Quick test: send a WhatsApp text message to a given number.
 * Usage: node scripts/test-wa-send.js 919502337775
 */
require('dotenv').config();

const to = process.argv[2] || '919502337775';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;
const API_VERSION     = process.env.WHATSAPP_API_VERSION || 'v22.0';
const URL             = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

const payload = {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'text',
  text: { preview_url: false, body: 'Hello! 👋 KhabarX WhatsApp bot is live. Reply *hi* to start.' }
};

(async () => {
  console.log(`Sending to ${to} via Phone Number ID ${PHONE_NUMBER_ID} ...`);
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  console.log('Status:', res.status);
  console.log(JSON.stringify(json, null, 2));
})();
