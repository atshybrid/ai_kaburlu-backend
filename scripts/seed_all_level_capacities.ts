/**
 * ADVANCED SEED: Seeds capacities for ALL levels.
 * Use this ONLY if you truly need granular aggregate limits beyond designation capacities.
 * For most use cases, prefer the simpler script seed_cell_level_capacity.ts.
 *
 * Seed capacities for ALL levels:
 *  - NATIONAL (one per cell)
 *  - ZONE (one per cell per zone)
 *  - STATE (one per cell per state)
 *  - DISTRICT (one per cell per district)
 *  - MANDAL (one per cell per mandal)
 *
 * WARNING: This can create a very large number of rows.
 * Use environment variables to limit scope during testing:
 *   MAX_STATES=10 MAX_DISTRICTS=50 MAX_MANDALS=200
 *   FILTER_STATE_NAMES="Andhra Pradesh,Telangana" (comma separated exact names)
 *
 * Adjust base capacities below as needed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASE = {
  NATIONAL: 72,
  ZONE: 40,
  STATE: 120,
  DISTRICT: 80,
  MANDAL: 50,
};

const ZONES = ['NORTH','SOUTH','EAST','WEST','CENTRAL'];

interface LimitConfig { maxStates?: number; maxDistricts?: number; maxMandals?: number; stateFilter?: Set<string>; }

function loadLimits(): LimitConfig {
  const maxStates = process.env.MAX_STATES ? Number(process.env.MAX_STATES) : undefined;
  const maxDistricts = process.env.MAX_DISTRICTS ? Number(process.env.MAX_DISTRICTS) : undefined;
  const maxMandals = process.env.MAX_MANDALS ? Number(process.env.MAX_MANDALS) : undefined;
  const stateFilter = process.env.FILTER_STATE_NAMES ? new Set(process.env.FILTER_STATE_NAMES.split(',').map(s => s.trim())) : undefined;
  return { maxStates, maxDistricts, maxMandals, stateFilter };
}

async function main() {
  const limits = loadLimits();
  const cells = await prisma.cell.findMany();
  console.log(`Cells: ${cells.length}`);

  // Fetch hierarchical geo
  let states = await prisma.hrcState.findMany({ include: { districts: { include: { mandals: true } } } });
  if (limits.stateFilter) {
    states = states.filter(s => limits.stateFilter!.has(s.name));
  }
  if (limits.maxStates) states = states.slice(0, limits.maxStates);

  console.log(`States considered: ${states.length}`);

  for (const cell of cells) {
    // NATIONAL
    await upsert({ cellId: cell.id, level: 'NATIONAL', capacity: BASE.NATIONAL });

    // ZONES (derive zones from states to ensure relevance)
    const zonesInData = Array.from(new Set(states.map(s => s.zone)));
    for (const z of zonesInData) {
      await upsert({ cellId: cell.id, level: 'ZONE', zone: z, capacity: BASE.ZONE });
    }

    // STATE level
    for (const state of states) {
      await upsert({ cellId: cell.id, level: 'STATE', hrcStateId: state.id, capacity: BASE.STATE });
      if (limits.maxDistricts && state.districts.length > limits.maxDistricts) {
        state.districts = state.districts.slice(0, limits.maxDistricts);
      }
      // DISTRICT level
      for (const district of state.districts) {
        await upsert({ cellId: cell.id, level: 'DISTRICT', hrcStateId: state.id, hrcDistrictId: district.id, capacity: BASE.DISTRICT });
        if (limits.maxMandals && district.mandals.length > limits.maxMandals) {
          district.mandals = district.mandals.slice(0, limits.maxMandals);
        }
        // MANDAL level
        for (const mandal of district.mandals) {
          await upsert({ cellId: cell.id, level: 'MANDAL', hrcStateId: state.id, hrcDistrictId: district.id, hrcMandalId: mandal.id, capacity: BASE.MANDAL });
        }
      }
    }
  }

  console.log('Seeding all level capacities complete.');
}

async function upsert(args: { cellId: string; level: string; capacity: number; zone?: string; hrcStateId?: string; hrcDistrictId?: string; hrcMandalId?: string; }) {
  const { cellId, level, capacity, zone, hrcStateId, hrcDistrictId, hrcMandalId } = args;
  const whereKey = {
    cellId_level_zone_hrcStateId_hrcDistrictId_hrcMandalId: {
      cellId,
      level: level as any,
      zone: zone ?? null,
      hrcStateId: hrcStateId ?? null,
      hrcDistrictId: hrcDistrictId ?? null,
      hrcMandalId: hrcMandalId ?? null
    }
  } as any;
  const existing = await prisma.cellLevelCapacity.findUnique({ where: whereKey });
  if (existing) {
    if (existing.capacity !== capacity) {
      await prisma.cellLevelCapacity.update({ where: { id: existing.id }, data: { capacity } });
      console.log(`Updated cap cell=${cellId} level=${level} z=${zone||'-'} st=${hrcStateId?.slice(0,6)||'-'} d=${hrcDistrictId?.slice(0,6)||'-'} m=${hrcMandalId?.slice(0,6)||'-'} -> ${capacity}`);
    }
  } else {
    await prisma.cellLevelCapacity.create({ data: { cellId, level: level as any, capacity, zone: zone as any ?? null, hrcStateId: hrcStateId ?? null, hrcDistrictId: hrcDistrictId ?? null, hrcMandalId: hrcMandalId ?? null } });
    console.log(`Created cap cell=${cellId} level=${level} z=${zone||'-'} st=${hrcStateId?.slice(0,6)||'-'} d=${hrcDistrictId?.slice(0,6)||'-'} m=${hrcMandalId?.slice(0,6)||'-'} = ${capacity}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
