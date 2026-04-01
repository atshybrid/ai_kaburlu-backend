import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KARNATAKA_DISTRICTS_NEW: string[] = [
  // Add only new districts you want under HRC registry; duplicates are skipped per state
  'Bengaluru South',
  'Bengaluru North',
  'Bengaluru East',
  'Bengaluru West',
  'Devanahalli',
  'Kanakapura',
  'Channapatna',
  'Nelamangala',
  'Doddaballapura',
  'Anekal',
];

async function getStateByName(name: string) {
  const state = await prisma.state.findUnique({ where: { name } });
  if (!state) throw new Error(`State not found: ${name}`);
  return state;
}

async function ensureHrcDistrict(stateId: string, name: string) {
  const existing = await prisma.hrcDistrict.findFirst({ where: { name, stateId } });
  if (existing) return existing;
  return prisma.hrcDistrict.create({ data: { name, stateId } });
}

async function main() {
  const ka = await getStateByName('Karnataka');
  for (const name of KARNATAKA_DISTRICTS_NEW) {
    await ensureHrcDistrict(ka.id, name);
  }
  console.log('Seeded HRC Karnataka districts (new entries only).');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
