import { PrismaClient, PolicyType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const termsContent = `
# Terms & Conditions

Effective: 2025-12-01

1. Acceptance
Using the Kaburlu app or services constitutes acceptance of these terms.

2. Eligibility
You must comply with local laws and be at least the minimum age permitted by your jurisdiction.

3. User Content
You retain ownership of content you submit. You grant Kaburlu a license to host and display your content. Do not submit illegal, harmful, or infringing content.

4. Location & Media
If you enable location, we may collect coordinates to geo-tag content. Media uploads are user-selected.

5. Accounts & Security
Keep credentials secure. MPIN is stored hashed server-side. We may restrict accounts for misuse.

6. Changes
We may update these terms. Continued use after changes indicates acceptance.
`;

  const privacyContent = `
# Privacy Policy

Effective: 2025-12-01

What We Collect
- Mobile number, language preference, optional location (with consent), media you upload, push token, device info.

How We Use Data
- To provide core functionality, personalize language, deliver notifications, and moderate content.

Sharing
- With our backend services, notification delivery providers, and CDN for media.

Security
- HTTPS in transit, restricted access server-side, hashed MPIN.

Your Choices
- You can opt out of location, change notification preferences, and request account deletion.

Contact
- privacy@kaburlu.media
`;

  await prisma.policy.create({ data: { type: PolicyType.TERMS, version: '1.0.0', title: 'Kaburlu Terms & Conditions', content: termsContent, isPublished: true } });
  await prisma.policy.create({ data: { type: PolicyType.PRIVACY, version: '1.0.0', title: 'Kaburlu Privacy Policy', content: privacyContent, isPublished: true } });
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
