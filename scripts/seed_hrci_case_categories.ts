import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const db: any = prisma; // allow access to newly added delegates immediately after generate

type Cat = { code: string; name: string; parentCode?: string | null; children?: Cat[] };

function flatten(categories: Cat[], parentCode?: string | null): Cat[] {
  const out: Cat[] = [];
  for (const c of categories) {
    out.push({ code: c.code, name: c.name, parentCode: parentCode || null });
    if (c.children && c.children.length) out.push(...flatten(c.children, c.code));
  }
  return out;
}

async function main() {
  let tree: Cat[] | null = null;
  try {
    const cfg = path.join(process.cwd(), 'config', 'hrci.case.categories.json');
    if (fs.existsSync(cfg)) {
      tree = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (!Array.isArray(tree)) throw new Error('categories root must be an array');
    }
  } catch (e) {
    console.warn('[seed_hrci_case_categories] failed to read config, using defaults:', (e as any)?.message);
  }
  if (!tree) {
    tree = [
      { code: 'HUMAN_RIGHTS_VIOLATION', name: 'Human Rights Violation', children: [
        { code: 'POLICE_BRUTALITY', name: 'Police Brutality' },
        { code: 'DISCRIMINATION', name: 'Discrimination' },
        { code: 'UNLAWFUL_DETENTION', name: 'Unlawful Detention' }
      ]},
      { code: 'CIVIL_ISSUES', name: 'Civil Issues', children: [
        { code: 'LAND_DISPUTE', name: 'Land / Property Dispute' },
        { code: 'DOMESTIC_ABUSE', name: 'Domestic Abuse' },
        { code: 'LABOUR_RIGHTS', name: 'Labour Rights' }
      ]},
      { code: 'LEGAL_AID', name: 'Legal Aid', children: [
        { code: 'ADVICE', name: 'Advice / Counseling' },
        { code: 'DRAFTING', name: 'Drafting Support' }
      ]}
    ];
  }

  const flat = flatten(tree);
  // Upsert parents first (raw SQL to avoid client delegate drift)
  const parents = flat.filter(c => !c.parentCode);
  const children = flat.filter(c => !!c.parentCode);
  for (const item of parents) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HrcCaseCategory" ("id","code","name","isActive","createdAt","updatedAt")
       VALUES ($1,$2,$3,true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name", "isActive"=true, "updatedAt"=CURRENT_TIMESTAMP`,
      item.code, item.code, item.name
    );
  }
  // Now children (need parent id)
  for (const c of children) {
    const parentRows: any = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "HrcCaseCategory" WHERE "code"=$1 LIMIT 1`, c.parentCode!
    );
    const parentId = Array.isArray(parentRows) && parentRows[0]?.id ? String(parentRows[0].id) : null;
    if (!parentId) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HrcCaseCategory" ("id","code","name","parentId","isActive","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name", "parentId"=EXCLUDED."parentId", "isActive"=true, "updatedAt"=CURRENT_TIMESTAMP`,
      c.code, c.code, c.name, parentId
    );
  }
  console.log(`[seed_hrci_case_categories] upserted ${flat.length} categories.`);
}

main().catch(e => { console.error('[seed_hrci_case_categories] error:', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
