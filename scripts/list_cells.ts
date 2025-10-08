import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p: any = prisma;

async function main() {
  const rows = await p.cell.findMany({ orderBy: { name: 'asc' } });
  console.log(rows.map((r: any) => ({ name: r.name, code: r.code, active: r.isActive })));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
