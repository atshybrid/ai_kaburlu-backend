const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ensurePrivacyEn() {
  const existingActive = await prisma.privacyPolicy.findFirst({ where: { language: 'en', isActive: true } });
  if (existingActive) return false;
  await prisma.privacyPolicy.create({
    data: {
      title: 'Kaburlu - Privacy Policy',
      content: '<p>We value your privacy. This is a default privacy policy for English (en).</p>',
      version: '1.0',
      isActive: true,
      language: 'en',
      effectiveAt: new Date(),
    }
  });
  return true;
}

async function ensureTermsEn() {
  const existingActive = await prisma.termsAndConditions.findFirst({ where: { language: 'en', isActive: true } });
  if (existingActive) return false;
  await prisma.termsAndConditions.create({
    data: {
      title: 'Kaburlu - Terms & Conditions',
      content: '<p>These are the default Terms & Conditions for English (en).</p>',
      version: '1.0',
      isActive: true,
      language: 'en',
      effectiveAt: new Date(),
    }
  });
  return true;
}

async function main() {
  const createdPrivacy = await ensurePrivacyEn();
  const createdTerms = await ensureTermsEn();
  console.log(`[seed:legal] privacy(en) ${createdPrivacy ? 'CREATED' : 'exists'}`);
  console.log(`[seed:legal] terms(en) ${createdTerms ? 'CREATED' : 'exists'}`);
}

main()
  .catch((e) => { console.error('[seed:legal] error', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
