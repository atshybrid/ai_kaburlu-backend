require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

// Configuration: two member designations with flat fees across all cells/levels
// Updated per request: Student fee 100 with 1,000,000 seats; Volunteer fee 500 with 100,000 seats
const MEMBER_DESIGNATIONS = [
  { name: 'Volunteer', code: 'VOLUNTEER', fee: 500, validityDays: 365, seats: 100_000 },
  { name: 'Student',   code: 'STUDENT',   fee: 100, validityDays: 365, seats: 1_000_000 },
];

const ORG_LEVELS = ['NATIONAL','ZONE','STATE','DISTRICT','MANDAL'];

async function upsertDesignation(d: { name: string; code: string; fee: number; validityDays: number; seats: number }) {
  const row = await p.designation.upsert({
    where: { code: d.code },
    update: { name: d.name, idCardFee: d.fee, validityDays: d.validityDays, defaultCapacity: d.seats, orderRank: 1000 },
    create: { code: d.code, name: d.name, idCardFee: d.fee, validityDays: d.validityDays, defaultCapacity: d.seats, orderRank: 1000 }
  });
  return row;
}

async function upsertPrice(designationId: string, cellId: string, level: string, fee: number) {
  const existing = await p.designationPrice.findFirst({ where: { designationId, cellId, level } });
  if (existing) {
    await p.designationPrice.update({ where: { id: existing.id }, data: { fee, currency: 'INR', priority: 10 } });
    return { action: 'updated', id: existing.id };
  }
  const created = await p.designationPrice.create({ data: { designationId, cellId, level, fee, currency: 'INR', priority: 10 } });
  return { action: 'created', id: created.id };
}

async function main() {
  console.log('[seed:member-designations] Start');
  const cells = await p.cell.findMany({ select: { id: true, name: true, code: true } });
  if (cells.length === 0) throw new Error('No cells found. Seed cells first.');

  // Ensure PRESIDENT exists; create minimal if missing
  const president = await p.designation.upsert({
    where: { code: 'PRESIDENT' },
    update: {},
    create: { code: 'PRESIDENT', name: 'President', defaultCapacity: 1, idCardFee: 100, validityDays: 365, orderRank: 1 }
  });

  for (const cfg of MEMBER_DESIGNATIONS) {
    const desig = await upsertDesignation(cfg);
    // Link parent as PRESIDENT when not already set
    if (!desig.parentId || desig.parentId !== president.id) {
      await p.designation.update({ where: { id: desig.id }, data: { parentId: president.id } });
    }
    let created = 0, updated = 0;
    for (const cell of cells) {
      for (const lvl of ORG_LEVELS) {
        const res = await upsertPrice(desig.id, cell.id, lvl, cfg.fee);
        if (res.action === 'created') created++; else updated++;
      }
    }
    console.log(`[seed:member-designations] ${cfg.code}: prices created=${created} updated=${updated}`);
  }

  console.log('[seed:member-designations] Done');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
