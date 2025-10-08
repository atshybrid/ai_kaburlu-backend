// Fallback JS version so we don't rely on ts-node being available in PATH.
// Usage: npm run check:hrci:counts
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const p = prisma; // access delegates

(async () => {
  try {
    if (!p.hrcDistrict) {
      throw new Error('Prisma client missing hrcDistrict delegate. Run: npx prisma generate');
    }
    const apCount = await p.hrcDistrict.count({ where: { state: { code: 'AP' } } });
    const tgCount = await p.hrcDistrict.count({ where: { state: { code: 'TG' } } });
    const apNames = await p.hrcDistrict.findMany({ where: { state: { code: 'AP' } }, select: { name: true }, orderBy: { name: 'asc' } });
    console.log(JSON.stringify({ apDistricts: apCount, tgDistricts: tgCount, apNames: apNames.map(d => d.name) }, null, 2));
  } catch (e) {
    console.error('check_hrci_counts failed:', e.message || e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
