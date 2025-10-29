/*
  Dev-only demo seed: sample HRCI members level-wise for testing the public members API.
  Safety:
  - Loads dotenv-flow and src/config/env to resolve ENV_TYPE.
  - Aborts if production (ENV_TYPE=prod or NODE_ENV=production) unless FORCE_DEMO_SEED=1.
  - Idempotent via upserts/unique lookups; reruns are safe.

  Run:
  - Build: npm run build
  - Execute: node dist/scripts/seed_members_demo.js

  Optional env:
  - DEMO_SEED_COUNTRY: default "India"
  - DEMO_SEED_STATE: default "Andhra Pradesh"
  - DEMO_SEED_DISTRICT: default "Anantapur"
  - DEMO_SEED_MANDAL: default "Dharmavaram"
*/

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient, MembershipStatus, MembershipPaymentStatus, OrgLevel, HrcZone } from '@prisma/client';

const prisma = new PrismaClient();

function isProd() {
  const v = String(process.env.ENV_TYPE || process.env.NODE_ENV || '').toLowerCase();
  return v === 'prod' || v === 'production';
}

function title(s: string) { console.log(`\n==== ${s} ====`); }

async function ensureLanguage(code = 'en', name = 'English') {
  return prisma.language.upsert({
    where: { code },
    update: { name, nativeName: name, direction: 'ltr' },
    create: { code, name, nativeName: name, direction: 'ltr' }
  });
}

async function ensureRole(name: string, permissions: any = []) {
  return prisma.role.upsert({
    where: { name },
    update: { permissions },
    create: { name, permissions }
  });
}

async function ensureCell(name: string, code?: string) {
  return prisma.cell.upsert({
    where: { name },
    update: { code },
    create: { name, code }
  });
}

async function ensureDesignation(code: string, name: string) {
  return prisma.designation.upsert({
    where: { code },
    update: { name },
    create: { code, name, defaultCapacity: 10, idCardFee: 0, validityDays: 365 }
  });
}

async function ensureHrcCountry(name: string, code?: string) {
  return prisma.hrcCountry.upsert({
    where: { name },
    update: { code },
    create: { name, code }
  });
}

async function ensureHrcState(name: string, zone: HrcZone, countryId: string, code?: string) {
  return prisma.hrcState.upsert({
    where: { name },
    update: { zone, countryId, code },
    create: { name, zone, countryId, code }
  });
}

async function ensureHrcDistrict(stateId: string, name: string) {
  // @@unique([stateId, name]) => unique alias stateId_name
  const existing = await prisma.hrcDistrict.findUnique({ where: { stateId_name: { stateId, name } } });
  if (existing) return existing;
  return prisma.hrcDistrict.create({ data: { stateId, name } });
}

async function ensureHrcMandal(districtId: string, name: string) {
  // @@unique([districtId, name]) => unique alias districtId_name
  const existing = await prisma.hrcMandal.findUnique({ where: { districtId_name: { districtId, name } } });
  if (existing) return existing;
  return prisma.hrcMandal.create({ data: { districtId, name } });
}

async function ensureUser(mobile: string, fullName: string, roleId: string, languageId: string) {
  // mobileNumber unique
  const existing = await prisma.user.findUnique({ where: { mobileNumber: mobile } });
  if (existing) {
    // ensure profile name at least
    await prisma.userProfile.upsert({
      where: { userId: existing.id },
      update: { fullName },
      create: { userId: existing.id, fullName }
    });
    return existing;
  }
  const user = await prisma.user.create({
    data: {
      mobileNumber: mobile,
      roleId,
      languageId,
      status: 'ACTIVE'
    }
  });
  await prisma.userProfile.create({ data: { userId: user.id, fullName } });
  return user;
}

async function ensureMembership(params: {
  userId: string;
  cellId: string;
  designationId: string;
  level: OrgLevel;
  zone?: HrcZone | null;
  hrcCountryId?: string | null;
  hrcStateId?: string | null;
  hrcDistrictId?: string | null;
  hrcMandalId?: string | null;
}) {
  const { userId, cellId, designationId, level, zone = null, hrcCountryId = null, hrcStateId = null, hrcDistrictId = null, hrcMandalId = null } = params;
  // Unique on [cellId, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId, seatSequence]
  // We'll look for an existing membership for this user+seat combo by a best-effort findMany and reuse it; else create with seatSequence=1
  const existing = await prisma.membership.findFirst({ where: { userId, cellId, designationId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } });
  if (existing) return existing;
  return prisma.membership.create({
    data: {
      userId,
      cellId,
      designationId,
      level,
      zone: zone || undefined,
      hrcCountryId: hrcCountryId || undefined,
      hrcStateId: hrcStateId || undefined,
      hrcDistrictId: hrcDistrictId || undefined,
      hrcMandalId: hrcMandalId || undefined,
      status: MembershipStatus.ACTIVE,
      paymentStatus: MembershipPaymentStatus.SUCCESS,
      seatSequence: 1,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000)
    }
  });
}

async function main() {
  if (isProd() && String(process.env.FORCE_DEMO_SEED || '0') !== '1') {
    console.error('Refusing to run demo seed in production. Set FORCE_DEMO_SEED=1 to override (not recommended).');
    return;
  }

  const COUNTRY = process.env.DEMO_SEED_COUNTRY || 'India';
  const STATE = process.env.DEMO_SEED_STATE || 'Andhra Pradesh';
  const DISTRICT = process.env.DEMO_SEED_DISTRICT || 'Anantapur';
  const MANDAL = process.env.DEMO_SEED_MANDAL || 'Dharmavaram';

  title('Base refs (language, role, cell, designation)');
  const lang = await ensureLanguage('en', 'English');
  const role = await ensureRole('MEMBER', { permissions: ['member:read'] });
  const cell = await ensureCell('General Body', 'GB');
  const prez = await ensureDesignation('PRESIDENT', 'President');
  const secy = await ensureDesignation('SECRETARY', 'Secretary');

  title('HRCI Geography');
  const country = await ensureHrcCountry(COUNTRY, 'IN');
  const state = await ensureHrcState(STATE, 'SOUTH' as HrcZone, country.id, 'AP');
  const district = await ensureHrcDistrict(state.id, DISTRICT);
  const mandal = await ensureHrcMandal(district.id, MANDAL);

  title('Users');
  const uNational = await ensureUser('9000000001', 'National Leader', role.id, lang.id);
  const uZone = await ensureUser('9000000002', 'South Zone Leader', role.id, lang.id);
  const uState = await ensureUser('9000000003', `${STATE} President`, role.id, lang.id);
  const uDistrict = await ensureUser('9000000004', `${DISTRICT} Secretary`, role.id, lang.id);
  const uMandal = await ensureUser('9000000005', `${MANDAL} Secretary`, role.id, lang.id);

  title('Memberships');
  await ensureMembership({ userId: uNational.id, cellId: cell.id, designationId: prez.id, level: OrgLevel.NATIONAL, hrcCountryId: country.id });
  await ensureMembership({ userId: uZone.id, cellId: cell.id, designationId: prez.id, level: OrgLevel.ZONE, zone: HrcZone.SOUTH });
  await ensureMembership({ userId: uState.id, cellId: cell.id, designationId: prez.id, level: OrgLevel.STATE, hrcStateId: state.id });
  await ensureMembership({ userId: uDistrict.id, cellId: cell.id, designationId: secy.id, level: OrgLevel.DISTRICT, hrcStateId: state.id, hrcDistrictId: district.id });
  await ensureMembership({ userId: uMandal.id, cellId: cell.id, designationId: secy.id, level: OrgLevel.MANDAL, hrcStateId: state.id, hrcDistrictId: district.id, hrcMandalId: mandal.id });

  console.log('\nSeed complete. Created/ensured sample members across NATIONAL, ZONE, STATE, DISTRICT, MANDAL levels.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
