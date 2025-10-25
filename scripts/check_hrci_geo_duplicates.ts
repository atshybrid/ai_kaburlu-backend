import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/([\s\-]+)/)
    .map(part => (/^[\s\-]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
    .replace(/\s+/g, ' ') // collapse spaces
    .trim();
}

async function checkStates() {
  console.log('\n[HrcState] Duplicates by case-insensitive name:');
  const dupes: any[] = await p.$queryRawUnsafe(`
    SELECT lower(btrim(name)) AS key, array_agg(json_build_object('id', id, 'name', name, 'code', code)) AS rows,
           COUNT(*)::int AS c
    FROM "HrcState"
    GROUP BY lower(btrim(name))
    HAVING COUNT(*) > 1
    ORDER BY c DESC;
  `);
  if (!dupes.length) console.log('  None');
  else dupes.forEach((d: any) => console.log(`  key='${d.key}' -> count=${d.c} rows=${JSON.stringify(d.rows)}`));

  if (process.env.FIX_CAPS === '1') {
    console.log('[HrcState] Fixing capitalization to Title Case...');
    const rows: any[] = await p.hrcState.findMany({ select: { id: true, name: true } });
    let updated = 0;
    for (const r of rows) {
      const tc = titleCase(r.name);
      if (tc !== r.name) {
        try {
          await p.hrcState.update({ where: { id: r.id }, data: { name: tc } });
          updated++;
        } catch (e) {
          console.warn('  [WARN] Failed to update HrcState', r.id, r.name, '->', tc, e instanceof Error ? e.message : e);
        }
      }
    }
    console.log(`[HrcState] Capitalization updates: ${updated}`);
  }
}

async function checkDistricts() {
  console.log('\n[HrcDistrict] Duplicates by case-insensitive (stateId,name):');
  const dupes: any[] = await p.$queryRawUnsafe(`
    SELECT d."stateId", s.name as stateName, lower(btrim(d.name)) AS key,
           array_agg(json_build_object('id', d.id, 'name', d.name)) AS rows,
           COUNT(*)::int AS c
    FROM "HrcDistrict" d
    JOIN "HrcState" s ON s.id = d."stateId"
    GROUP BY d."stateId", s.name, lower(btrim(d.name))
    HAVING COUNT(*) > 1
    ORDER BY s.name, c DESC;
  `);
  if (!dupes.length) console.log('  None');
  else dupes.forEach((d: any) => console.log(`  state='${d.stateName}', key='${d.key}' -> count=${d.c} rows=${JSON.stringify(d.rows)}`));

  if (process.env.FIX_CAPS === '1') {
    console.log('[HrcDistrict] Fixing capitalization to Title Case...');
    const rows: any[] = await p.hrcDistrict.findMany({ select: { id: true, name: true } });
    let updated = 0;
    for (const r of rows) {
      const tc = titleCase(r.name);
      if (tc !== r.name) {
        try {
          await p.hrcDistrict.update({ where: { id: r.id }, data: { name: tc } });
          updated++;
        } catch (e) {
          console.warn('  [WARN] Failed to update HrcDistrict', r.id, r.name, '->', tc, e instanceof Error ? e.message : e);
        }
      }
    }
    console.log(`[HrcDistrict] Capitalization updates: ${updated}`);
  }
}

async function checkMandals() {
  console.log('\n[HrcMandal] Duplicates by case-insensitive (districtId,name):');
  const dupes: any[] = await p.$queryRawUnsafe(`
    SELECT m."districtId", d.name as districtName, s.name as stateName, lower(btrim(m.name)) AS key,
           array_agg(json_build_object('id', m.id, 'name', m.name)) AS rows,
           COUNT(*)::int AS c
    FROM "HrcMandal" m
    JOIN "HrcDistrict" d ON d.id = m."districtId"
    JOIN "HrcState" s ON s.id = d."stateId"
    GROUP BY m."districtId", d.name, s.name, lower(btrim(m.name))
    HAVING COUNT(*) > 1
    ORDER BY s.name, d.name, c DESC;
  `);
  if (!dupes.length) console.log('  None');
  else dupes.forEach((d: any) => console.log(`  state='${d.stateName}', district='${d.districtName}', key='${d.key}' -> count=${d.c} rows=${JSON.stringify(d.rows)}`));

  if (process.env.FIX_CAPS === '1') {
    console.log('[HrcMandal] Fixing capitalization to Title Case...');
    const rows: any[] = await p.hrcMandal.findMany({ select: { id: true, name: true } });
    let updated = 0;
    for (const r of rows) {
      const tc = titleCase(r.name);
      if (tc !== r.name) {
        try {
          await p.hrcMandal.update({ where: { id: r.id }, data: { name: tc } });
          updated++;
        } catch (e) {
          console.warn('  [WARN] Failed to update HrcMandal', r.id, r.name, '->', tc, e instanceof Error ? e.message : e);
        }
      }
    }
    console.log(`[HrcMandal] Capitalization updates: ${updated}`);
  }
}

async function main() {
  console.log('[check] HRCI geo duplicates (case-insensitive) and capitalization');
  await checkStates();
  await checkDistricts();
  await checkMandals();
  console.log('\n[check] Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
