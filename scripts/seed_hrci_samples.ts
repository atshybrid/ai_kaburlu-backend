import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateNextIdCardNumber } from '../src/lib/idCardNumber';

const prisma = new PrismaClient();
const p: any = prisma; // cast for newly added delegates like HRCI tables

async function ensureIdCardSetting() {
  // Ensure at least one active setting exists for public views
  const active = await (p.idCardSetting?.findFirst?.({ where: { isActive: true } }).catch(() => null)) || null;
  if (active) return active;
  const created = await (p.idCardSetting?.create?.({
    data: {
      name: 'default',
      isActive: true,
      primaryColor: '#0d6efd',
      secondaryColor: '#6c757d',
      frontH1: 'Human Rights & Civil Initiatives',
      frontH2: 'Identity Card',
      frontFooterText: 'This card remains property of HRCI and must be returned upon request.',
      registerDetails: 'Registered under Societies Act. Valid for 12 months from issue date.',
      qrLandingBaseUrl: undefined
    }
  }).catch(() => null));
  if (created) {
    // Deactivate others just in case
    try { await p.idCardSetting.updateMany({ where: { id: { not: created.id } }, data: { isActive: false } }); } catch {}
  }
  return created;
}

async function ensureHrcGeo() {
  // Minimal India + Telangana + Hyderabad + Ameerpet (idempotent)
  if (!p.hrcCountry) return null; // delegate may not exist if prisma not generated
  const country = await p.hrcCountry.upsert({ where: { code: 'IN' }, update: { name: 'India' }, create: { name: 'India', code: 'IN' } });
  const state = await p.hrcState.upsert({ where: { name: 'Telangana' }, update: { code: 'TG', zone: 'SOUTH', countryId: country.id }, create: { name: 'Telangana', code: 'TG', zone: 'SOUTH', countryId: country.id } });
  const district = await p.hrcDistrict.upsert({ where: { stateId_name: { stateId: state.id, name: 'Hyderabad' } }, update: {}, create: { name: 'Hyderabad', stateId: state.id } });
  const mandal = await p.hrcMandal.upsert({ where: { districtId_name: { districtId: district.id, name: 'Ameerpet' } }, update: {}, create: { name: 'Ameerpet', districtId: district.id } });
  return { country, state, district, mandal };
}

async function ensureCells() {
  const cells = [
    { name: 'General Body', code: 'GENERAL_BODY', description: 'Primary/general membership body', isActive: true },
    { name: 'Women Wing', code: 'WOMEN_WING', description: 'Women focused organizational wing', isActive: true },
    { name: 'Youth Wing', code: 'YOUTH_WING', description: 'Youth engagement wing', isActive: true }
  ];
  const created: any[] = [];
  for (const c of cells) {
    const row = await p.cell.upsert({ where: { name: c.name }, update: { code: c.code, description: c.description, isActive: c.isActive }, create: c });
    created.push(row);
  }
  return created;
}

async function ensureDesignations() {
  const RAW = [
    { name: 'President', code: 'PRESIDENT', parent: null, capacity: 1, fee: 0, validity: 365, rank: 1 },
    { name: 'General Secretary', code: 'GENERAL_SECRETARY', parent: 'PRESIDENT', capacity: 4, fee: 0, validity: 365, rank: 3 },
    { name: 'Legal Secretary', code: 'LEGAL_SECRETARY', parent: 'GENERAL_SECRETARY', capacity: 4, fee: 0, validity: 365, rank: 7 },
  ];
  const codeToId: Record<string, string> = {};
  for (const d of RAW) {
    const row = await p.designation.upsert({
      where: { code: d.code },
      update: { name: d.name, defaultCapacity: d.capacity, idCardFee: d.fee, validityDays: d.validity, orderRank: d.rank },
      create: { name: d.name, code: d.code, defaultCapacity: d.capacity, idCardFee: d.fee, validityDays: d.validity, orderRank: d.rank }
    });
    codeToId[d.code] = row.id;
  }
  for (const d of RAW) {
    if (d.parent) {
      await p.designation.update({ where: { code: d.code }, data: { parentId: codeToId[d.parent] } });
    }
  }
  return codeToId;
}

async function ensureTestUser() {
  const mobile = '9999000001';
  const lang = await prisma.language.findFirst();
  const role = await prisma.role.findFirst();
  if (!lang || !role) throw new Error('Missing base Language/Role. Run base seed first.');
  const mpinHash = await bcrypt.hash('1234', 10);
  const user = await prisma.user.upsert({
    where: { mobileNumber: mobile },
    update: { mpin: null as any, mpinHash, roleId: role.id, languageId: lang.id, status: 'ACTIVE' },
    create: { mobileNumber: mobile, mpin: null as any, mpinHash, roleId: role.id, languageId: lang.id, status: 'ACTIVE' }
  });
  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: { fullName: 'Test Member', profilePhotoUrl: 'https://via.placeholder.com/200x200.png?text=HRCI' },
    create: { userId: user.id, fullName: 'Test Member', profilePhotoUrl: 'https://via.placeholder.com/200x200.png?text=HRCI' }
  });
  return user;
}

async function createMembershipsAllLevels(opts: { userId: string; cellId: string; designationId: string; geo: any; }) {
  const created: any[] = [];
  const now = new Date();

  // NATIONAL (country optional)
  created.push(await p.membership.upsert({
    where: { id: `demo-national-${opts.userId}` },
    update: {},
    create: {
      id: `demo-national-${opts.userId}`,
      userId: opts.userId,
      cellId: opts.cellId,
      designationId: opts.designationId,
      level: 'NATIONAL',
      hrcCountryId: opts.geo.country?.id,
      status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', idCardStatus: 'NOT_CREATED', activatedAt: now, seatSequence: 1
    }
  }));

  // ZONE
  created.push(await p.membership.upsert({
    where: { id: `demo-zone-${opts.userId}` },
    update: {},
    create: {
      id: `demo-zone-${opts.userId}`,
      userId: opts.userId,
      cellId: opts.cellId,
      designationId: opts.designationId,
      level: 'ZONE',
      zone: 'SOUTH',
      status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', idCardStatus: 'NOT_CREATED', activatedAt: now, seatSequence: 1
    }
  }));

  // STATE
  created.push(await p.membership.upsert({
    where: { id: `demo-state-${opts.userId}` },
    update: {},
    create: {
      id: `demo-state-${opts.userId}`,
      userId: opts.userId,
      cellId: opts.cellId,
      designationId: opts.designationId,
      level: 'STATE',
      hrcStateId: opts.geo.state?.id,
      status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', idCardStatus: 'NOT_CREATED', activatedAt: now, seatSequence: 1
    }
  }));

  // DISTRICT
  created.push(await p.membership.upsert({
    where: { id: `demo-district-${opts.userId}` },
    update: {},
    create: {
      id: `demo-district-${opts.userId}`,
      userId: opts.userId,
      cellId: opts.cellId,
      designationId: opts.designationId,
      level: 'DISTRICT',
      hrcDistrictId: opts.geo.district?.id,
      status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', idCardStatus: 'NOT_CREATED', activatedAt: now, seatSequence: 1
    }
  }));

  // MANDAL
  created.push(await p.membership.upsert({
    where: { id: `demo-mandal-${opts.userId}` },
    update: {},
    create: {
      id: `demo-mandal-${opts.userId}`,
      userId: opts.userId,
      cellId: opts.cellId,
      designationId: opts.designationId,
      level: 'MANDAL',
      hrcMandalId: opts.geo.mandal?.id,
      status: 'ACTIVE', paymentStatus: 'NOT_REQUIRED', idCardStatus: 'NOT_CREATED', activatedAt: now, seatSequence: 1
    }
  }));

  return created;
}

async function issueIdCardsForMemberships(memberships: any[], fullName: string, mobileNumber?: string) {
  const out: { membershipId: string; cardNumber: string }[] = [];
  for (const m of memberships) {
    // Skip if already has id card
    const existing = await p.iDCard.findUnique({ where: { membershipId: m.id } }).catch(() => null);
    if (existing) { out.push({ membershipId: m.id, cardNumber: existing.cardNumber }); continue; }
    const cardNumber = await generateNextIdCardNumber(prisma);
    const cell = await p.cell.findUnique({ where: { id: m.cellId } });
    const desig = await p.designation.findUnique({ where: { id: m.designationId } });
    const card = await p.iDCard.create({ data: {
      membershipId: m.id,
      cardNumber,
      expiresAt: new Date(Date.now() + 365*24*60*60*1000),
      fullName,
      mobileNumber: mobileNumber || undefined,
      cellName: cell?.name,
      designationName: desig?.name
    }});
    // Mark card status on membership
    try { await p.membership.update({ where: { id: m.id }, data: { idCardStatus: 'GENERATED' } }); } catch {}
    out.push({ membershipId: m.id, cardNumber: card.cardNumber });
  }
  return out;
}

async function main() {
  console.log('[seed-hrci-samples] starting...');
  await ensureIdCardSetting();
  const geo = await ensureHrcGeo();
  if (!geo) throw new Error('Prisma client outdated. Run: npx prisma generate');
  const cells = await ensureCells();
  const designations = await ensureDesignations();
  const user = await ensureTestUser();
  const cell = cells[0];
  const desigId = designations['PRESIDENT'] || Object.values(designations)[0];
  const memberships = await createMembershipsAllLevels({ userId: user.id, cellId: cell.id, designationId: desigId, geo });
  const ids = await issueIdCardsForMemberships(memberships, 'Test Member', user.mobileNumber || undefined);

  console.log('[seed-hrci-samples] created ID cards:');
  for (const i of ids) {
    console.log(`- membership=${i.membershipId} cardNumber=${i.cardNumber} -> GET /hrci/idcard/${i.cardNumber}`);
  }
  console.log('[seed-hrci-samples] done.');
}

main().catch(e => { console.error('[seed-hrci-samples:error]', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
