require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma; // allow access even if types not regenerated in editor

async function main() {
  if (!p.hrcDistrict || !p.hrcState) {
    throw new Error('Prisma client missing hrc* delegates. Run: npx prisma generate');
  }
  const apCount = await p.hrcDistrict.count({ where: { state: { code: 'AP' } } });
  const tgCount = await p.hrcDistrict.count({ where: { state: { code: 'TG' } } });
  const apNames = await p.hrcDistrict.findMany({ where: { state: { code: 'AP' } }, select: { name: true }, orderBy: { name: 'asc' } });

  const totalStates = await p.hrcState.count({ where: { country: { code: 'IN' } } });
  const zones = ['NORTH','SOUTH','EAST','WEST','CENTRAL'];
  const zoneCounts: Record<string, number> = {};
  for (const z of zones) {
    zoneCounts[z] = await p.hrcState.count({ where: { zone: z } });
  }

  console.log({
    apDistricts: apCount,
    tgDistricts: tgCount,
    apNames: apNames.map((d: any) => d.name),
    totalStates,
    zoneCounts
  });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
