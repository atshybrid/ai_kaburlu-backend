import prisma from '../src/lib/prisma';

// Some environments show stale PrismaClient type declarations; cast to any for new HRCI delegates.
const p: any = prisma;

/**
 * HRCI Example Seed
 * Safe, idempotent upsert-style inserts for demonstration. Adjust IDs or lookups as needed.
 */
async function main() {
  console.log('Seeding HRCI example data...');

  // 1. Resolve an existing state / district / mandal (pick first available for demo)
  const state = await prisma.state.findFirst();
  if (!state) throw new Error('No State found. Run base seed first.');
  const district = await prisma.district.findFirst({ where: { stateId: state.id } });
  const mandal = await prisma.mandal.findFirst({ where: { districtId: district?.id } });

  // 2. Upsert Teams (State-level and Mandal-level)
  const stateTeam = await p.hrcTeam.upsert({
    where: { name: 'State Human Rights Cell' },
    update: {},
    create: { name: 'State Human Rights Cell', scopeLevel: 'STATE', stateId: state.id, description: 'Coordinates district issues.' }
  });
  const womenCell = await p.hrcTeam.upsert({
    where: { name: 'Mandal Women Cell' },
    update: {},
    create: { name: 'Mandal Women Cell', scopeLevel: 'MANDAL', mandalId: mandal?.id, description: 'Supports women related grievances.' }
  });

  // 3. Payment fee configs (global fallback + specific team override)
  const globalIdCardFee = await p.paymentFeeConfig.upsert({
    where: { id: 'demo-global-idcard-fee' },
    update: { amountMinor: 5000, renewalIntervalMonths: 12 },
    create: { id: 'demo-global-idcard-fee', purpose: 'ID_CARD_ISSUE', amountMinor: 5000, renewalIntervalMonths: 12 }
  });
  const womenCellFee = await p.paymentFeeConfig.upsert({
    where: { id: 'demo-womencell-idcard-fee' },
    update: { amountMinor: 4000, renewalIntervalMonths: 12 },
    create: { id: 'demo-womencell-idcard-fee', purpose: 'ID_CARD_ISSUE', amountMinor: 4000, teamId: womenCell.id, renewalIntervalMonths: 12 }
  });

  // 4. Pick an existing user to become a volunteer (if none, abort)
  const user = await prisma.user.findFirst({ where: { role: { name: { in: ['REPORTER','SUPER_ADMIN','LANGUAGE_ADMIN'] } } } });
  if (!user) throw new Error('No suitable user found to create volunteer');

  const volunteer = await p.hrcVolunteerProfile.upsert({
    where: { userId: user.id },
    update: { bio: 'Demo volunteer for HRCI', active: true },
    create: { userId: user.id, bio: 'Demo volunteer for HRCI', active: true }
  });

  // 5. Ensure membership in both teams (idempotent via composite unique)
  await p.hrcTeamMember.upsert({
    where: { teamId_volunteerId: { teamId: stateTeam.id, volunteerId: volunteer.id } },
    update: { membershipRole: 'COORDINATOR' },
    create: { teamId: stateTeam.id, volunteerId: volunteer.id, membershipRole: 'COORDINATOR' }
  });
  await p.hrcTeamMember.upsert({
    where: { teamId_volunteerId: { teamId: womenCell.id, volunteerId: volunteer.id } },
    update: { membershipRole: 'MEMBER' },
    create: { teamId: womenCell.id, volunteerId: volunteer.id, membershipRole: 'MEMBER' }
  });

  // 6. Simulate payment transaction (paid) for ID card issuance
  const paymentTxn = await p.paymentTransaction.upsert({
    where: { providerOrderId: 'demo-order-1' },
    update: { status: 'PAID', paidAt: new Date() },
    create: { purpose: 'ID_CARD_ISSUE', amountMinor: 4000, currency: 'INR', status: 'PAID', provider: 'RAZORPAY', providerOrderId: 'demo-order-1', providerPaymentId: 'pay_demo_1', paidAt: new Date() }
  });

  // 7. Issue ID card referencing transaction
  const idCard = await p.hrcIdCard.upsert({
    where: { id: 'demo-idcard-1' },
    update: {},
    create: { id: 'demo-idcard-1', volunteerId: volunteer.id, expiryDate: new Date(Date.now() + 1000*60*60*24*365), renewalIntervalMonths: 12, feeAmountMinor: 4000, paymentTxnId: paymentTxn.id, status: 'ACTIVE' }
  });

  // 8. Create a demo case (reported by volunteer) if reporter relation exists
  let caseRecord: any = null;
  if (await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'HrcCase'`) {
    caseRecord = await p.hrcCase.upsert({
      where: { referenceCode: 'CASE-DEMO-001' },
      update: {},
      create: { referenceCode: 'CASE-DEMO-001', title: 'Demo Grievance', description: 'Example case description', reporterId: volunteer.id, teamId: womenCell.id, priority: 'MEDIUM', status: 'NEW' }
    });
    // Add an initial case update (idempotent simplistic check)
    const existingUpdate = await p.hrcCaseUpdate.findFirst({ where: { caseId: caseRecord.id } });
    if (!existingUpdate) {
      await p.hrcCaseUpdate.create({ data: { caseId: caseRecord.id, note: 'Initial case created for demonstration', statusFrom: 'NEW', statusTo: 'UNDER_REVIEW' } });
      await p.hrcCase.update({ where: { id: caseRecord.id }, data: { status: 'UNDER_REVIEW' } });
    }
  }

  // 9. Donation example
  const donationTxn = await p.paymentTransaction.upsert({
    where: { providerOrderId: 'demo-donation-order-1' },
    update: { status: 'PAID', paidAt: new Date() },
    create: { purpose: 'DONATION', amountMinor: 25000, currency: 'INR', status: 'PAID', provider: 'RAZORPAY', providerOrderId: 'demo-donation-order-1', providerPaymentId: 'pay_demo_donation_1', paidAt: new Date(), meta: { note: 'Example donation' } }
  });

  const donation = await p.hrcDonation.upsert({
    where: { id: 'demo-donation-1' },
    update: {},
    create: { id: 'demo-donation-1', donorUserId: user.id, amountMinor: 25000, currency: 'INR', purpose: 'General Support', paymentTxnId: donationTxn.id, status: 'PAID' }
  });

  console.log('Seed complete:', { stateTeam: stateTeam.id, womenCell: womenCell.id, volunteer: volunteer.id, idCard: idCard.id, caseReference: caseRecord?.referenceCode, donation: donation.id });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
