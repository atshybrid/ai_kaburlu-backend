import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

const cells = [
  { name: 'General Body', code: 'GENERAL_BODY', description: 'Primary/general membership body', isActive: true },
  { name: 'Women Wing', code: 'WOMEN_WING', description: 'Women focused organizational wing', isActive: true },
  { name: 'Youth Wing', code: 'YOUTH_WING', description: 'Youth engagement wing', isActive: true }
];

async function main() {
  console.log('Seeding Cells...');
  if (!p.cell) throw new Error('Prisma client missing cell delegate. Run: npx prisma generate');

  for (const c of cells) {
    await p.cell.upsert({
      where: { name: c.name },
      update: { code: c.code, description: c.description, isActive: c.isActive },
      create: c
    });
  }
  console.log('Cells seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
