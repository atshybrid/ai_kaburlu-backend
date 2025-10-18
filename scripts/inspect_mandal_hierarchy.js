// Usage: node scripts/inspect_mandal_hierarchy.js <mandalId>
const { PrismaClient } = require('@prisma/client');

async function main() {
  const [mandalId] = process.argv.slice(2);
  if (!mandalId) {
    console.error('Usage: node scripts/inspect_mandal_hierarchy.js <mandalId>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const mandal = await prisma.hrcMandal.findUnique({ where: { id: String(mandalId) }, select: { id: true, name: true, districtId: true } });
    if (!mandal) {
      console.log('Mandal not found');
      return;
    }
    const district = mandal.districtId ? await prisma.hrcDistrict.findUnique({ where: { id: mandal.districtId }, select: { id: true, name: true, stateId: true } }) : null;
    const state = district?.stateId ? await prisma.hrcState.findUnique({ where: { id: district.stateId }, select: { id: true, name: true, zone: true } }) : null;
    console.log({ mandal, district, state });
  } catch (e) {
    console.error('Error:', e?.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
