/**
 * Incremental mandal seeder for Telangana & Andhra Pradesh from CSV files.
 * Uses existing HrcState and HrcDistrict rows (must already be seeded by seed_hrci_locations.ts).
 * Adds any missing mandals listed in CSVs; does NOT delete anything.
 *
 * CSV structure (header required): district,mandal
 * Files:
 *   data/mandals_telangana.csv
 *   data/mandals_andhra_pradesh.csv
 */
import { createReadStream } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import csv from 'csv-parser';

const prisma = new PrismaClient();
const p: any = prisma;

interface Row { district: string; mandal: string }

async function loadCSV(file: string): Promise<Row[]> {
  const rows: Row[] = [];
  return new Promise((resolve, reject) => {
    createReadStream(file)
      .pipe(csv())
      .on('data', (d: any) => {
        if (d.district && d.mandal) {
          rows.push({ district: d.district.trim(), mandal: d.mandal.trim() });
        }
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function upsertMandalsForState(stateName: string, csvFile: string) {
  const fullPath = path.resolve(csvFile);
  console.log(`Processing ${stateName} from ${fullPath}`);
  const data = await loadCSV(fullPath);
  if (!data.length) { console.warn('No rows found in', csvFile); return; }

  const state = await p.hrcState.findFirst({ where: { name: stateName } });
  if (!state) { console.warn('State missing, skipping:', stateName); return; }

  // Group by district
  const byDistrict: Record<string, string[]> = {};
  for (const r of data) {
    byDistrict[r.district] = byDistrict[r.district] || [];
    byDistrict[r.district].push(r.mandal);
  }

  for (const [districtName, mandals] of Object.entries(byDistrict)) {
    const district = await p.hrcDistrict.findFirst({ where: { stateId: state.id, name: districtName } });
    if (!district) { console.warn(`District not found (state=${stateName}):`, districtName); continue; }

    for (const mandalName of mandals) {
      await p.hrcMandal.upsert({
        where: { districtId_name: { districtId: district.id, name: mandalName } },
        update: {},
        create: { name: mandalName, districtId: district.id }
      });
      console.log(`Upserted mandal ${mandalName} in district ${districtName}`);
    }
  }
}

async function main() {
  await upsertMandalsForState('Telangana', 'data/mandals_telangana.csv');
  await upsertMandalsForState('Andhra Pradesh', 'data/mandals_andhra_pradesh.csv');
  console.log('Mandal seeding complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
