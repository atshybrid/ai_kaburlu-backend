/**
 * Submit the "otpnewkhabharx" WhatsApp message template to Meta for approval.
 *
 * Prerequisites:
 *   1. Set WHATSAPP_WABA_ID in your .env  (find it in Meta Business Manager →
 *      WhatsApp → API Setup → WhatsApp Business Account ID)
 *   2. WHATSAPP_ACCESS_TOKEN must be a System User token with
 *      "whatsapp_business_management" permission.
 *
 * Run once:
 *   npx ts-node scripts/create-wa-account-template.ts
 *
 * After running, the template status will be PENDING. Meta typically approves
 * utility templates within a few minutes. Once APPROVED you can send it via
 * sendAccountSetupMessage() in src/lib/whatsapp.ts.
 */

import * as dotenv from 'dotenv';
dotenv.config();

const WABA_ID      = process.env.WHATSAPP_WABA_ID || '';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const API_VERSION  = process.env.WHATSAPP_API_VERSION || 'v22.0';

if (!WABA_ID) {
  console.error('❌  WHATSAPP_WABA_ID is not set in .env');
  console.error('   Find it in Meta Business Manager → WhatsApp → API Setup');
  process.exit(1);
}

if (!ACCESS_TOKEN) {
  console.error('❌  WHATSAPP_ACCESS_TOKEN is not set in .env');
  process.exit(1);
}

const TEMPLATE = {
  name: 'otpnewkhabharx',
  language: 'en_US',
  category: 'UTILITY',
  components: [
    {
      type: 'HEADER',
      format: 'TEXT',
      text: 'Finalize account set-up',
    },
    {
      type: 'BODY',
      text: 'Hi {{1}},\n\nYour new account has been created successfully.\n\nPlease verify your email address to complete your profile.',
      example: {
        body_text: [['John']],
      },
    },
    {
      type: 'FOOTER',
      text: 'KhabarX — Human Rights Council for India',
    },
  ],
};

async function main() {
  const url = `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;

  console.log(`📤  Submitting template "${TEMPLATE.name}" to WABA ${WABA_ID} …`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(TEMPLATE),
  });

  const json: any = await res.json();

  if (!res.ok) {
    console.error('❌  Meta API error:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log('✅  Template submitted successfully!');
  console.log(`   Template ID : ${json.id}`);
  console.log(`   Status      : ${json.status}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Wait for Meta to approve the template (usually a few minutes).');
  console.log('  2. Check status in Meta Business Manager → WhatsApp → Message Templates.');
  console.log('  3. Once APPROVED, sendAccountSetupMessage() will work in production.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
