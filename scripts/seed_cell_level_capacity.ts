/**
 * SIMPLE SEED: National + Zone aggregate capacities only.
 * This script is intended for the "simple" capacity strategy where only
 * broad caps (NATIONAL and ZONE) are enforced and lower geographic levels
 * rely purely on designation.defaultCapacity.
 * For full hierarchical seeding use: seed_all_level_capacities.ts
 */
import { PrismaClient } from '@prisma/client'; // expects prisma.cellLevelCapacity delegate

const prisma = new PrismaClient();

// Configuration: base capacities (adjust as needed)
const baseLevelDefaults: Record<string, number> = {
  NATIONAL: 72,
  ZONE: 40,       // example per cell per zone total
  STATE: 120,      // example per state scope
  DISTRICT: 80,    // example per district scope
  MANDAL: 50       // example per mandal scope
};

// Zones to seed for ZONE level
const zones = ['NORTH','SOUTH','EAST','WEST','CENTRAL'];

async function main() {
  const cells = await prisma.cell.findMany();
  console.log(`Found ${cells.length} cells.`);
  for (const cell of cells) {
    // NATIONAL (no zone / geo ids)
    await upsertCap(cell.id, 'NATIONAL', baseLevelDefaults.NATIONAL);

    // ZONE (one per zone)
    for (const z of zones) {
      await upsertCap(cell.id, 'ZONE', baseLevelDefaults.ZONE, { zone: z });
    }

    // STATE / DISTRICT / MANDAL capacities are contextual and depend on geography.
    // If you want blanket caps across all states/districts/mandals, you typically
    // would materialize them once you know specific hrcStateId/hrcDistrictId/hrcMandalId.
    // Placeholder: skip automatic seeding for these granular levels to avoid huge explosion.
  }
  console.log('Seeding complete.');
}

async function upsertCap(cellId: string, level: string, capacity: number, extra?: { zone?: string; hrcStateId?: string; hrcDistrictId?: string; hrcMandalId?: string }) {
  const whereKey = {
    cellId_level_zone_hrcStateId_hrcDistrictId_hrcMandalId: {
      cellId,
      level: level as any,
      zone: extra?.zone ?? null,
      hrcStateId: extra?.hrcStateId ?? null,
      hrcDistrictId: extra?.hrcDistrictId ?? null,
      hrcMandalId: extra?.hrcMandalId ?? null
    }
  } as any;
  const existing = await prisma.cellLevelCapacity.findUnique({ where: whereKey });
  if (existing) {
    if (existing.capacity !== capacity) {
      await prisma.cellLevelCapacity.update({ where: { id: existing.id }, data: { capacity } });
      console.log(`Updated cap cell=${cellId} level=${level} z=${extra?.zone || '-'} -> ${capacity}`);
    }
  } else {
  await prisma.cellLevelCapacity.create({ data: { cellId, level: level as any, capacity, zone: (extra?.zone as any) ?? null, hrcStateId: extra?.hrcStateId ?? null, hrcDistrictId: extra?.hrcDistrictId ?? null, hrcMandalId: extra?.hrcMandalId ?? null } });
    console.log(`Created cap cell=${cellId} level=${level} z=${extra?.zone || '-'} = ${capacity}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
