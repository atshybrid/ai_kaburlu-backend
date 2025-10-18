// Quick check for seeded LEGAL_SECRETARY users and memberships
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const p = prisma;

(async () => {
  try {
    const memCount = await p.membership.count({ where: { status: 'ACTIVE', designation: { code: 'LEGAL_SECRETARY' } } });
    const mems = await p.membership.findMany({
      where: { status: 'ACTIVE', designation: { code: 'LEGAL_SECRETARY' } },
      take: 10,
      select: { userId: true, level: true, cellId: true }
    });
    const userIds = [...new Set(mems.map(m => m.userId))];
    const users = await p.user.findMany({ where: { id: { in: userIds } }, select: { id: true, mobileNumber: true, profile: { select: { fullName: true } } } });
    console.log(JSON.stringify({ legalSecretaryMemberships: memCount, sampleUsers: users }, null, 2));
  } catch (e) {
    console.error('check_legal_secretaries failed:', e.message || e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
