import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;

async function upsertCell(code: string, name: string) {
  const existing = await prisma.cell.findFirst({ where: { OR: [ { code }, { name } ] } });
  if (existing) return existing;
  return await prisma.cell.create({ data: { code, name, description: name, isActive: true } });
}

async function upsertDesignation(code: string, name: string) {
  const existing = await prisma.designation.findFirst({ where: { OR: [ { code }, { name } ] } });
  if (existing) return existing;
  return await prisma.designation.create({ data: { code, name, defaultCapacity: 0, idCardFee: 0, validityDays: 365, orderRank: 0 } });
}

async function upsertPrice(args: { designationId: string; cellId: string; level: string; fee: number; currency?: string; priority?: number; validityDays?: number; }) {
  const { designationId, cellId, level, fee, currency = 'INR', priority = 5, validityDays = undefined } = args;
  const existing = await prisma.designationPrice.findFirst({ where: { designationId, cellId, level } });
  if (existing) {
    await prisma.designationPrice.update({ where: { id: existing.id }, data: { fee, currency, priority, validityDays: validityDays ?? existing.validityDays } });
    return { action: 'updated', id: existing.id };
  }
  const created = await prisma.designationPrice.create({ data: { designationId, cellId, level, fee, currency, priority, validityDays: validityDays ?? null } });
  return { action: 'created', id: created.id };
}

async function main() {
  const desigCode = process.env.DESIGNATION_CODE || 'PRESIDENT';
  const desigName = process.env.DESIGNATION_NAME || 'President';

  console.log(`[seed:designationPrices] Using designation ${desigCode}`);

  const [general, women, youth] = await Promise.all([
    upsertCell('GENERAL_BODY', 'General Body'),
    upsertCell('WOMEN_WING', 'Women Wing'),
    upsertCell('YOUTH_WING', 'Youth Wing')
  ]);
  const desig = await upsertDesignation(desigCode, desigName);

  const rows = [
    // General Body across levels
    { cellId: general.id, level: 'NATIONAL', fee: 2000 },
    { cellId: general.id, level: 'ZONE',     fee: 1800 },
    { cellId: general.id, level: 'STATE',    fee: 1500 },
    { cellId: general.id, level: 'DISTRICT', fee: 1200 },
    { cellId: general.id, level: 'MANDAL',   fee: 900  },
    // Women Wing
    { cellId: women.id,   level: 'NATIONAL', fee: 1000 },
    { cellId: women.id,   level: 'ZONE',     fee:  900 },
    { cellId: women.id,   level: 'STATE',    fee:  800 },
    { cellId: women.id,   level: 'DISTRICT', fee:  700 },
    { cellId: women.id,   level: 'MANDAL',   fee:  600 },
    // Youth Wing
    { cellId: youth.id,   level: 'NATIONAL', fee:  500 },
    { cellId: youth.id,   level: 'ZONE',     fee:  450 },
    { cellId: youth.id,   level: 'STATE',    fee:  400 },
    { cellId: youth.id,   level: 'DISTRICT', fee:  350 },
    { cellId: youth.id,   level: 'MANDAL',   fee:  300 }
  ];

  let created = 0, updated = 0;
  for (const r of rows) {
    const res = await upsertPrice({ designationId: desig.id, cellId: r.cellId, level: r.level, fee: r.fee, priority: 10 });
    if (res.action === 'created') created++; else updated++;
  }

  console.log(`[seed:designationPrices] Done. created=${created} updated=${updated}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await (prisma as any).$disconnect(); });
