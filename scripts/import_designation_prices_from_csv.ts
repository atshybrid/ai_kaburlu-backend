import { createReadStream } from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;

function mapLevel(level: string): string | undefined {
  const v = (level || '').trim().toUpperCase();
  if (v.startsWith('NATIONAL')) return 'NATIONAL';
  if (v.includes('ZONE')) return 'ZONE';
  if (v === 'STATE') return 'STATE';
  if (v === 'DISTRICT') return 'DISTRICT';
  if (v === 'MANDAL') return 'MANDAL';
  return undefined;
}

function mapZone(zoneName: string): string | undefined {
  const z = (zoneName || '').trim().toUpperCase();
  if (z.startsWith('SOUTH')) return 'SOUTH';
  if (z.startsWith('NORTH')) return 'NORTH';
  if (z.startsWith('EAST')) return 'EAST';
  if (z.startsWith('WEST')) return 'WEST';
  if (z.startsWith('CENTRAL')) return 'CENTRAL';
  return undefined;
}

function normalizeCell(name: string): { code: string; name: string } {
  const n = (name || '').trim();
  const up = n.toUpperCase();
  if (up.includes('GENERAL')) return { code: 'GENERAL_BODY', name: 'General Body' };
  if (up.includes('WOMEN')) return { code: 'WOMEN_WING', name: 'Women Wing' };
  if (up.includes('YOUTH')) return { code: 'YOUTH_WING', name: 'Youth Wing' };
  return { code: up.replace(/\s+/g,'_'), name: n };
}

function codeFromName(name: string): string {
  return (name || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
}

async function upsertCellByName(name: string) {
  const { code } = normalizeCell(name);
  const existing = await prisma.cell.findFirst({ where: { OR: [ { code }, { name } ] } });
  if (existing) return existing;
  return await prisma.cell.create({ data: { code, name, description: name, isActive: true } });
}

async function upsertDesignationByName(name: string) {
  const code = codeFromName(name);
  const existing = await prisma.designation.findFirst({ where: { OR: [ { code }, { name } ] } });
  if (existing) return existing;
  return await prisma.designation.create({ data: { code, name, defaultCapacity: 0, idCardFee: 0, validityDays: 365, orderRank: 0 } });
}

async function upsertPrice(designationId: string, cellId: string, level: string, zone: string | undefined, fee: number, validityDays?: number) {
  const where: any = { designationId, cellId, level, zone: zone || null, hrcStateId: null, hrcDistrictId: null, hrcMandalId: null };
  const existing = await prisma.designationPrice.findFirst({ where });
  if (existing) {
    await prisma.designationPrice.update({ where: { id: existing.id }, data: { fee, validityDays: validityDays ?? existing.validityDays, currency: 'INR', priority: 10 } });
    return 'updated';
  }
  await prisma.designationPrice.create({ data: { ...where, fee, validityDays: validityDays ?? null, currency: 'INR', priority: 10 } });
  return 'created';
}

async function run(filePath: string) {
  const rows: any[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath).pipe(csv()).on('data', (row) => rows.push(row)).on('end', resolve).on('error', reject);
  });

  let created = 0, updated = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const level = mapLevel(r['Zone name']) || mapLevel(r['Level']) || undefined; // csv uses Zone name for level headings like "South Zone" or "National"
      const zone = mapZone(r['Zone name']);
      const cellName = r['Cell name'];
      const desigName = r['Designation name'];
      const feeRaw = r['ID Card Amount'];
      const validityRaw = r['Validity ID card in days'];
      if (!cellName || !desigName || !feeRaw) { skipped++; continue; }
      const fee = Number(String(feeRaw).trim());
      const validityDays = validityRaw ? Number(String(validityRaw).trim()) : undefined;
      if (!Number.isFinite(fee)) { skipped++; continue; }

      const cell = await upsertCellByName(cellName);
      const desig = await upsertDesignationByName(desigName);
      const lvl = level || 'NATIONAL';
      const res = await upsertPrice(desig.id, cell.id, lvl, zone, Math.round(fee), validityDays);
      if (res === 'created') created++; else updated++;
    } catch (e) {
      skipped++;
    }
  }
  console.log(`[import:designationPrices] rows=${rows.length} created=${created} updated=${updated} skipped=${skipped}`);
}

const defaultFile = path.join(__dirname, 'data', 'hrci_fees.csv');
const file = process.argv[2] || defaultFile;
run(file).catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await (prisma as any).$disconnect(); });
