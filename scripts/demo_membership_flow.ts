import { PrismaClient, OrgLevel, MembershipStatus, MembershipPaymentStatus, IdCardStatus } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

/*
 Demo logic:
 1. Pick a designation (e.g., PRESIDENT) & cell (General Body) at MANDAL level.
 2. Ensure capacity not exceeded (count ACTIVE + pending for that seatSequence criteria) before creating.
 3. If fee > 0 -> create membership with PENDING_PAYMENT & payment record; then simulate payment success -> issue card.
*/

const CELL_CODE = 'GENERAL_BODY'; // We stored code in cell table earlier? If not, use name match.
const DESIGNATION_CODE = 'PRESIDENT';

async function findCellId() {
  const cell = await p.cell.findFirst({ where: { OR: [ { code: CELL_CODE }, { name: 'General Body' } ] } });
  if (!cell) throw new Error('Cell not found');
  return cell.id;
}

async function findDesignation() {
  const d = await p.designation.findUnique({ where: { code: DESIGNATION_CODE } });
  if (!d) throw new Error('Designation not found');
  return d;
}

async function main() {
  console.log('Demo membership join flow start');
  const cellId = await findCellId();
  const designation = await findDesignation();
  const userId = 'demo-user-1'; // placeholder

  // For this prototype we scope only by level (MANDAL) with a fixed mandal example ID null (no geo seeded yet for membership).
  // Real implementation will pass actual hrcMandalId etc.
  const level = OrgLevel.MANDAL;

  // Count existing occupied seats for this combination.
  const existingCount = await p.membership.count({
    where: {
      cellId,
      designationId: designation.id,
      level,
      hrcMandalId: null, // adjust when linking to a real mandal
      status: { in: [MembershipStatus.PENDING_PAYMENT, MembershipStatus.PENDING_APPROVAL, MembershipStatus.ACTIVE] }
    }
  });

  if (existingCount >= designation.defaultCapacity) {
    console.log('No seats available');
    return;
  }

  const requiresPayment = designation.idCardFee > 0;
  let membership = await p.membership.create({
    data: {
      userId,
      cellId,
      designationId: designation.id,
      level,
      hrcMandalId: null,
  status: requiresPayment ? MembershipStatus.PENDING_PAYMENT : MembershipStatus.PENDING_APPROVAL,
  paymentStatus: requiresPayment ? MembershipPaymentStatus.PENDING : MembershipPaymentStatus.NOT_REQUIRED,
      seatSequence: existingCount + 1,
      lockedAt: new Date()
    }
  });

  console.log('Created membership', membership.id, 'status', membership.status);

  if (requiresPayment) {
    // Simulate payment success
    await p.membershipPayment.create({
      data: { membershipId: membership.id, amount: designation.idCardFee, status: MembershipPaymentStatus.SUCCESS }
    });
    membership = await p.membership.update({
      where: { id: membership.id },
      data: { paymentStatus: MembershipPaymentStatus.SUCCESS }
    });
  } else {
    console.log('No payment required; waiting for admin approval simulation');
  }

  // Auto-issue ID card if payment succeeded or (no payment & approval simulated)
  if (membership.paymentStatus === MembershipPaymentStatus.SUCCESS || (!requiresPayment && membership.status === MembershipStatus.PENDING_APPROVAL)) {
    // For zero-payment flow we'd normally wait for admin to approve—here we simulate that approval instantly.
    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + designation.validityDays * 86400000);
    membership = await p.membership.update({
      where: { id: membership.id },
  data: { status: MembershipStatus.ACTIVE, activatedAt, expiresAt, idCardStatus: IdCardStatus.GENERATED }
    });
    await p.iDCard.create({
      data: { membershipId: membership.id, cardNumber: 'CARD-' + membership.id.slice(0,8), issuedAt: activatedAt, expiresAt }
    });
    console.log('ID Card generated for membership', membership.id);
  }

  console.log('Final membership state:', await p.membership.findUnique({ where: { id: membership.id }, include: { idCard: true, payments: true } }));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
