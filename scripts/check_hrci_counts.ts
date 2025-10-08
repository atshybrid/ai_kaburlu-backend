import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma; // allow access even if types not regenerated in editor

async function main() {
  if (!p.hrcDistrict) {
    throw new Error('Prisma client missing hrcDistrict delegate. Run: npx prisma generate');
  }
  const apCount = await p.hrcDistrict.count({ where: { state: { code: 'AP' } } });
  const tgCount = await p.hrcDistrict.count({ where: { state: { code: 'TG' } } });
  const apNames = await p.hrcDistrict.findMany({ where: { state: { code: 'AP' } }, select: { name: true }, orderBy: { name: 'asc' } });
  console.log({ apDistricts: apCount, tgDistricts: tgCount, apNames: apNames.map((d: any) => d.name) });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
