/**
 * Verification script for HRCI mandal counts.
 * Reports count per state (optionally filtered to AP & Telangana) and highlights differences.
 * Env Vars:
 *   ONLY_AP_TG=1       -> restrict output to Andhra Pradesh & Telangana
 *   EXPECT_AP=679      -> expected mandal count for Andhra Pradesh
 *   EXPECT_TG=612      -> expected mandal count for Telangana
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p: any = prisma;

const ONLY_AP_TG = process.env.ONLY_AP_TG === '1';
const EXPECT_AP = process.env.EXPECT_AP ? Number(process.env.EXPECT_AP) : undefined;
const EXPECT_TG = process.env.EXPECT_TG ? Number(process.env.EXPECT_TG) : undefined;

async function main() {
  const rows = await p.$queryRawUnsafe(`
    SELECT s.name as state, COUNT(m.id)::int as mandals
    FROM "HrcState" s
    JOIN "HrcDistrict" d ON d."stateId" = s.id
    LEFT JOIN "HrcMandal" m ON m."districtId" = d.id
    GROUP BY s.name
    ORDER BY mandals DESC, s.name;
  `);

  const focus = ONLY_AP_TG ? rows.filter((r: any) => r.state === 'Telangana' || r.state === 'Andhra Pradesh') : rows;

  console.table(focus);

  function check(label: string, expected?: number) {
    if (!expected) return;
    const row = focus.find((r: any) => r.state === label);
    if (!row) { console.log(`[WARN] State ${label} not found in result set`); return; }
    if (row.mandals === expected) {
      console.log(`[OK] ${label} mandals match expected ${expected}`);
    } else {
      console.log(`[MISMATCH] ${label}: have ${row.mandals}, expected ${expected} (delta=${row.mandals - expected})`);
    }
  }

  check('Andhra Pradesh', EXPECT_AP);
  check('Telangana', EXPECT_TG);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
