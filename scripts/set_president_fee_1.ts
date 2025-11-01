require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;

async function resolveDesignation() {
  let d = await prisma.designation.findFirst({ where: { OR: [ { code: 'PRESIDENT' }, { name: 'President' } ] } });
  if (!d) {
    d = await prisma.designation.create({ data: { code: 'PRESIDENT', name: 'President', defaultCapacity: 1, idCardFee: 1, validityDays: 365, orderRank: 1 } });
  }
  return d;
}

async function resolveCell(nameOrCode: string) {
  const c = await prisma.cell.findFirst({ where: { OR: [ { code: nameOrCode }, { name: nameOrCode } ] } });
  return c;
}

async function upsertPrice(designationId: string, cellId: string) {
  const where: any = { designationId, cellId, level: 'NATIONAL', zone: null, hrcCountryId: null, hrcStateId: null, hrcDistrictId: null, hrcMandalId: null };
  const existing = await prisma.designationPrice.findFirst({ where });
  if (existing) {
    await prisma.designationPrice.update({ where: { id: existing.id }, data: { fee: 1, currency: 'INR', priority: Math.max( existing.priority || 0, 100) } });
    return { action: 'updated', id: existing.id };
  }
  const row = await prisma.designationPrice.create({ data: { ...where, fee: 1, currency: 'INR', priority: 100 } });
  return { action: 'created', id: row.id };
}

async function main() {
  const desig = await resolveDesignation();
  const cellsWanted = ['GENERAL_BODY', 'General Body', 'WOMEN_WING', 'Women Wing', 'Women Port'];
  const tried = new Set<string>();
  let touched = 0; let notFound: string[] = [];
  for (const key of cellsWanted) {
    // avoid trying duplicate alias (e.g., code then name resolved to same id)
    if (tried.has(key)) continue; tried.add(key);
    const c = await resolveCell(key);
    if (!c) { notFound.push(key); continue; }
    const res = await upsertPrice(desig.id, c.id);
    console.log(`[president:fee] ${key} -> ${res.action}`);
    touched++;
  }
  console.log(`[president:fee] done. designation=${desig.code} touched=${touched} notFound=${JSON.stringify(notFound)}`);
}

main().catch((e)=>{ console.error(e); process.exit(1); }).finally(async()=>{ await prisma.$disconnect(); });
