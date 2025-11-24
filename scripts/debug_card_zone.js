require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
const { PrismaClient } = require('@prisma/client');
// Derive DATABASE_URL if not present using ENV_TYPE switching logic
if (!process.env.DATABASE_URL) {
  const envType = (process.env.ENV_TYPE || 'dev').toLowerCase();
  if (envType === 'prod' && process.env.PROD_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
  } else if (process.env.DEV_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DEV_DATABASE_URL;
  }
}
(async () => {
  const prisma = new PrismaClient();
  try {
    const cardNumber = process.argv[2] || 'HRCI-2511-00019';
    const card = await prisma.iDCard.findFirst({ where: { cardNumber: { equals: cardNumber, mode: 'insensitive' } } });
    if (!card) { console.log('Card not found for', cardNumber); return; }
    console.log('Card:', { id: card.id, membershipId: card.membershipId, cardNumber: card.cardNumber });
    const membership = await prisma.membership.findUnique({ where: { id: card.membershipId } });
    if (!membership) { console.log('Membership not found'); return; }
    console.log('Membership:', {
      id: membership.id,
      level: membership.level,
      zone: membership.zone,
      hrcCountryId: membership.hrcCountryId,
      hrcStateId: membership.hrcStateId,
      hrcDistrictId: membership.hrcDistrictId,
      hrcMandalId: membership.hrcMandalId
    });
  } catch (e) {
    console.error('Error:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
})();
