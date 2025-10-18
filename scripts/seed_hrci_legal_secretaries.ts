import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const p: any = prisma;

async function ensureBase() {
  // Roles
  const memberRole = await prisma.role.upsert({
    where: { name: 'MEMBER' },
    update: {},
    create: { name: 'MEMBER', permissions: ['member:read','profile:read','profile:update','user:self:read','user:self:update'] as any }
  });
  // Language
  const en = await prisma.language.upsert({
    where: { code: 'en' },
    update: { name: 'English', nativeName: 'English', direction: 'ltr', isDeleted: false },
    create: { name: 'English', code: 'en', nativeName: 'English', direction: 'ltr', isDeleted: false }
  });
  // Cells
  const cell = await p.cell.upsert({ where: { name: 'General Body' }, update: { code: 'GENERAL_BODY', isActive: true }, create: { name: 'General Body', code: 'GENERAL_BODY', isActive: true } });
  // HRCI GEO minimal (India -> Telangana)
  const country = await (p.hrcCountry?.upsert?.({ where: { code: 'IN' }, update: { name: 'India' }, create: { name: 'India', code: 'IN' } }).catch(() => null));
  const state = country ? await p.hrcState.upsert({ where: { name: 'Telangana' }, update: { code: 'TG', zone: 'SOUTH', countryId: country.id }, create: { name: 'Telangana', code: 'TG', zone: 'SOUTH', countryId: country.id } }) : null;
  // Designations: Ensure LEGAL_SECRETARY and ADDI_GENERAL_SECRETARY
  const addi = await p.designation.upsert({ where: { code: 'ADDI_GENERAL_SECRETARY' }, update: { name: 'Additional General Secretary', defaultCapacity: 4, idCardFee: 0, validityDays: 365, orderRank: 4 }, create: { name: 'Additional General Secretary', code: 'ADDI_GENERAL_SECRETARY', defaultCapacity: 4, idCardFee: 0, validityDays: 365, orderRank: 4 } });
  const legal = await p.designation.upsert({ where: { code: 'LEGAL_SECRETARY' }, update: { name: 'Legal Secretary', defaultCapacity: 10, idCardFee: 0, validityDays: 365, orderRank: 7 }, create: { name: 'Legal Secretary', code: 'LEGAL_SECRETARY', defaultCapacity: 10, idCardFee: 0, validityDays: 365, orderRank: 7 } });
  return { memberRole, en, cell, state, addi, legal };
}

async function upsertUser(mobile: string, fullName: string, roleId: string, languageId: string) {
  const mpinHash = await bcrypt.hash('1234', 10);
  const user = await prisma.user.upsert({
    where: { mobileNumber: mobile },
    update: { mpin: null as any, mpinHash, roleId, languageId, status: 'ACTIVE' },
    create: { mobileNumber: mobile, mpin: null as any, mpinHash, roleId, languageId, status: 'ACTIVE' }
  });
  await prisma.userProfile.upsert({ where: { userId: user.id }, update: { fullName }, create: { userId: user.id, fullName } });
  return user;
}

async function upsertStateMembership(userId: string, cellId: string, designationId: string, hrcStateId?: string) {
  const id = `seed-state-${userId}-${designationId}`;
  return p.membership.upsert({
    where: { id },
    update: {},
    create: {
      id,
      userId,
      cellId,
      designationId,
      level: 'STATE',
      hrcStateId: hrcStateId || null,
      status: 'ACTIVE',
      paymentStatus: 'NOT_REQUIRED',
      idCardStatus: 'NOT_CREATED',
      seatSequence: 1
    }
  });
}

async function main() {
  console.log('[seed:hrci-legal] starting');
  const base = await ensureBase();
  const addiUser = await upsertUser('9999001999', 'ADDI Gen Sec Tester', base.memberRole.id, base.en.id);
  await upsertStateMembership(addiUser.id, base.cell.id, base.addi.id, base.state?.id);

  const legal1 = await upsertUser('9999001001', 'Legal Secretary One', base.memberRole.id, base.en.id);
  const legal2 = await upsertUser('9999001002', 'Legal Secretary Two', base.memberRole.id, base.en.id);
  const legal3 = await upsertUser('9999001003', 'Legal Secretary Three', base.memberRole.id, base.en.id);

  await upsertStateMembership(legal1.id, base.cell.id, base.legal.id, base.state?.id);
  await upsertStateMembership(legal2.id, base.cell.id, base.legal.id, base.state?.id);
  await upsertStateMembership(legal3.id, base.cell.id, base.legal.id, base.state?.id);

  console.log('[seed:hrci-legal] done. Sample users:');
  console.log('- ADDI General Secretary: mobile=9999001999 mpin=1234');
  console.log('- LEGAL Secretary #1:    mobile=9999001001 mpin=1234');
  console.log('- LEGAL Secretary #2:    mobile=9999001002 mpin=1234');
  console.log('- LEGAL Secretary #3:    mobile=9999001003 mpin=1234');
}

main().catch((e) => { console.error('[seed:hrci-legal] error', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
