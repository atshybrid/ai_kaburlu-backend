import prisma from '../src/lib/prisma';

/**
 * Seeds a default HRCI admin user with provided mobile + mpin.
 * Mobile: 9118191991, MPIN: 1947
 * Assigns HRCI_ADMIN role (creates if missing) and sets a default language (first available or creates EN).
 */
async function main() {
  console.log('Seeding default HRCI admin user...');
  const mobileNumber = '9118191991';
  const mpin = '1947';

  // Ensure language
  let language = await (prisma as any).language.findFirst();
  if (!language) {
    language = await (prisma as any).language.create({ data: { name: 'English', code: 'en', nativeName: 'English', direction: 'ltr' } });
  }

  // Ensure role
  const permissions = {
    hrc: {
      teams: ['create','read','update'],
      volunteers: ['onboard','assign'],
      idcards: ['issue','renew','revoke'],
      payments: ['create','refund','read'],
      cases: ['create','read','update','assign','close'],
      donations: ['read']
    }
  };
  const role = await (prisma as any).role.upsert({
    where: { name: 'HRCI_ADMIN' },
    update: { permissions },
    create: { name: 'HRCI_ADMIN', permissions }
  });

  // Upsert user
  const user = await (prisma as any).user.upsert({
    where: { mobileNumber },
    update: { mpin, roleId: role.id, languageId: language.id, status: 'ACTIVE' },
    create: { mobileNumber, mpin, roleId: role.id, languageId: language.id, status: 'ACTIVE' }
  });

  console.log('Default HRCI admin user ready:', { userId: user.id, mobileNumber });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
