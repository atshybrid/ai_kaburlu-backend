import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

// Base designation data (hierarchical). Parent code links.
// orderRank establishes display ordering.
// defaultCapacity & idCardFee/validityDays come from your specification.
// NOTE: Using normalized codes.
const RAW = [
  { name: 'President', code: 'PRESIDENT', parent: null, capacity: 1, fee: 100, validity: 365, rank: 1 },
  { name: 'Vice President', code: 'VICE_PRESIDENT', parent: 'PRESIDENT', capacity: 4, fee: 100, validity: 365, rank: 2 },
  { name: 'General Secretary', code: 'GENERAL_SECRETARY', parent: 'PRESIDENT', capacity: 4, fee: 100, validity: 365, rank: 3 },
  { name: 'Additional General Secretary', code: 'ADDI_GENERAL_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 4 },
  { name: 'Organizing Secretary', code: 'ORGANIZING_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 5 },
  { name: 'Program Secretary', code: 'PROGRAM_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 6 },
  { name: 'Legal Secretary', code: 'LEGAL_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 7 },
  { name: 'Welfare Secretary', code: 'WELFARE_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 8 },
  { name: 'Convenor', code: 'CONVENOR', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 9 },
  { name: 'Joint Convenor', code: 'JOINT_CONVENOR', parent: 'CONVENOR', capacity: 4, fee: 100, validity: 365, rank: 10 },
  { name: 'Joint Secretary', code: 'JOINT_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 11 },
  { name: 'Co-ordinator', code: 'COORDINATOR', parent: 'ORGANIZING_SECRETARY', capacity: 4, fee: 100, validity: 365, rank: 12 },
  { name: 'Spokes Person', code: 'SPOKES_PERSON', parent: 'PRESIDENT', capacity: 4, fee: 100, validity: 365, rank: 13 },
  { name: 'Executive Member', code: 'EXECUTIVE_MEMBER', parent: 'PRESIDENT', capacity: 23, fee: 100, validity: 365, rank: 14 }
];

async function main() {
  console.log('Seeding designations...');
  const existing = await p.designation.findMany({ select: { code: true } });
  const existingSet = new Set(existing.map((d: any) => d.code));

  // First pass: create or update all without parent linking (store ids for parent linking second pass)
  const codeToId: Record<string, string> = {};
  for (const d of RAW) {
    const row = await p.designation.upsert({
      where: { code: d.code },
      update: { name: d.name, defaultCapacity: d.capacity, idCardFee: d.fee, validityDays: d.validity, orderRank: d.rank },
      create: { name: d.name, code: d.code, defaultCapacity: d.capacity, idCardFee: d.fee, validityDays: d.validity, orderRank: d.rank }
    });
    codeToId[d.code] = row.id;
  }

  // Second pass: set parent references
  for (const d of RAW) {
    if (d.parent) {
      await p.designation.update({
        where: { code: d.code },
        data: { parentId: codeToId[d.parent] }
      });
    }
  }

  console.log('Designations seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
