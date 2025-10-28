/**
 * Full mandal seeding for Andhra Pradesh & Telangana.
 * Reads unified CSV files with columns: state,district,mandal
 * Files:
 *   data/mandals_telangana_full.csv
 *   data/mandals_andhra_pradesh_full.csv
 * Environment flags:
 *   DRY_RUN=1        -> Only report counts, no DB writes
 *   STRICT=1         -> Throw error if district not found (instead of warning)
 *   CREATE_DISTRICT=1 -> If district missing, create it (uses state's zone inferred)
 */
require('dotenv-flow').config();
import '../src/config/env';
import { createReadStream } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import csv from 'csv-parser';

const prisma = new PrismaClient();
const p: any = prisma;

interface MandalRow { state: string; district: string; mandal: string }

const FILES = [
  'data/mandals_telangana_full.csv',
  'data/mandals_andhra_pradesh_full.csv'
];

const DRY_RUN = process.env.DRY_RUN === '1';
const STRICT = process.env.STRICT === '1';
const CREATE_DISTRICT = process.env.CREATE_DISTRICT === '1';
const EXPECT_AP = process.env.EXPECT_AP ? Number(process.env.EXPECT_AP) : undefined;
const EXPECT_TG = process.env.EXPECT_TG ? Number(process.env.EXPECT_TG) : undefined;

async function loadCsv(file: string): Promise<MandalRow[]> {
  const rows: MandalRow[] = [];
  return new Promise((resolve, reject) => {
    createReadStream(path.resolve(file))
      .pipe(csv({ skipComments: true }))
      .on('data', (r: any) => {
        if (!r.state || !r.district || !r.mandal) return;
        const state = String(r.state).trim();
        if (state.startsWith('#')) return; // skip comment lines
        rows.push({
          state,
          district: String(r.district).trim(),
            mandal: String(r.mandal).trim()
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  console.log('Full mandal seeding start. DRY_RUN=%s STRICT=%s CREATE_DISTRICT=%s EXPECT_AP=%s EXPECT_TG=%s', DRY_RUN, STRICT, CREATE_DISTRICT, EXPECT_AP, EXPECT_TG);

  let all: MandalRow[] = [];
  for (const f of FILES) {
    const part = await loadCsv(f);
    console.log(`Loaded ${part.length} rows from ${f}`);
    all = all.concat(part);
  }

  if (!all.length) { console.log('No rows found. Exiting.'); return; }

  // Group by state -> district -> mandal
  const grouped: Record<string, Record<string, Set<string>>> = {};
  for (const row of all) {
    grouped[row.state] ||= {};
    grouped[row.state][row.district] ||= new Set();
    grouped[row.state][row.district].add(row.mandal);
  }

  let inserted = 0, skipped = 0, districtsCreated = 0;

  for (const [stateName, districts] of Object.entries(grouped)) {
    const state = await p.hrcState.findFirst({ where: { name: stateName } });
    if (!state) { console.warn('State missing, skipping entirely:', stateName); continue; }

    for (const [districtName, mandalSet] of Object.entries(districts)) {
      let district = await p.hrcDistrict.findFirst({ where: { stateId: state.id, name: districtName } });
      if (!district) {
        if (CREATE_DISTRICT) {
          if (DRY_RUN) {
            console.log(`[DRY] Would create district ${districtName} in state ${stateName}`);
            districtsCreated++;
          } else {
            district = await p.hrcDistrict.create({ data: { name: districtName, stateId: state.id } });
            districtsCreated++;
            console.log(`Created district ${districtName} in state ${stateName}`);
          }
        } else if (STRICT) {
          throw new Error(`District not found (STRICT): ${districtName} (state=${stateName})`);
        } else {
          console.warn('District not found, skipping (non-strict):', districtName, 'state=', stateName);
          continue;
        }
      }
      if (!district) continue; // in DRY strict create path

      for (const mandalName of mandalSet) {
        const exists = await p.hrcMandal.findFirst({ where: { districtId: district.id, name: mandalName } });
        if (exists) { skipped++; continue; }
        if (DRY_RUN) {
          console.log(`[DRY] Would insert mandal ${mandalName} (district=${districtName})`);
          inserted++;
        } else {
          await p.hrcMandal.create({ data: { name: mandalName, districtId: district.id } });
          inserted++;
        }
      }
    }
  }

  // Post validation if expectations provided
  if (!DRY_RUN && (EXPECT_AP || EXPECT_TG)) {
    const counts = await p.$queryRawUnsafe(`
      SELECT s.name as state, COUNT(m.id)::int as mandals
      FROM "HrcState" s
      JOIN "HrcDistrict" d ON d."stateId" = s.id
      LEFT JOIN "HrcMandal" m ON m."districtId" = d.id
      WHERE s.name IN ('Andhra Pradesh','Telangana')
      GROUP BY s.name;
    `);
    const map: Record<string, number> = {};
    for (const r of counts as any[]) map[r.state] = r.mandals;
    if (EXPECT_AP) {
      if (map['Andhra Pradesh'] !== EXPECT_AP) console.warn(`EXPECT_AP mismatch: have ${map['Andhra Pradesh']} expected ${EXPECT_AP}`); else console.log(`EXPECT_AP matched (${EXPECT_AP})`);
    }
    if (EXPECT_TG) {
      if (map['Telangana'] !== EXPECT_TG) console.warn(`EXPECT_TG mismatch: have ${map['Telangana']} expected ${EXPECT_TG}`); else console.log(`EXPECT_TG matched (${EXPECT_TG})`);
    }
  }
  console.log('Full mandal seeding complete.', { inserted, skipped, districtsCreated, dryRun: DRY_RUN });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
