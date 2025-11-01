import 'dotenv-flow/config';
// Normalize env (sets DATABASE_URL from ENV_TYPE + DEV_/PROD_ vars) BEFORE importing prisma
import '../src/config/env';
import prisma from '../src/lib/prisma';
import { generateNextIdCardNumber } from '../src/lib/idCardNumber';
import { ensureAppointmentLetterForUser } from '../src/api/auth/auth.service';

async function main() {
  const membershipId = (process.argv[2] || process.env.MEMBERSHIP_ID || '').trim();
  const noReissue = String(process.env.NO_REISSUE || '').trim() === '1';
  if (!membershipId) {
    console.error('Usage: npx ts-node scripts/dev_issue_idcard_and_letter.ts <membershipId>');
    process.exit(1);
  }
  const m = await prisma.membership.findUnique({ where: { id: membershipId }, include: { designation: true, cell: true } });
  if (!m) {
    console.error('Membership not found:', membershipId);
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { id: m.userId }, include: { profile: { include: { profilePhotoMedia: true } } } as any });
  if (!user) {
    console.error('User not found for membership:', m.userId);
    process.exit(3);
  }

  if (!noReissue) {
    // Issue or reissue ID card without enforcing profile photo (DEV-ONLY helper)
    const cardNumber = await generateNextIdCardNumber(prisma as any);
    const validityDays = (m as any).designation?.validityDays || 365;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    const fullName = (user as any).profile?.fullName || undefined;
    const mobileNumber = (user as any).mobileNumber || undefined;
    const designationName = (m as any).designation?.name || undefined;
    const cellName = (m as any).cell?.name || undefined;

    const existing = await prisma.iDCard.findUnique({ where: { membershipId: m.id } }).catch(() => null);
    let card: any;
    if (existing) {
      card = await prisma.iDCard.update({
        where: { id: existing.id },
        data: {
          cardNumber,
          issuedAt: new Date(),
          expiresAt,
          status: 'GENERATED' as any,
          fullName,
          mobileNumber,
          designationName,
          cellName,
        } as any,
      });
    } else {
      card = await prisma.iDCard.create({
        data: {
          membershipId: m.id,
          cardNumber,
          expiresAt,
          status: 'GENERATED' as any,
          fullName,
          mobileNumber,
          designationName,
          cellName,
        } as any,
      });
    }
    try { await prisma.membership.update({ where: { id: m.id }, data: { idCardStatus: 'GENERATED' as any } }); } catch {}
    console.log('ID Card issued:', { membershipId: m.id, cardNumber: card.cardNumber, expiresAt: card.expiresAt });
  } else {
    console.log('NO_REISSUE=1 set: Skipping ID card issuance/reissue');
  }

  // Force-generate appointment letter (now allowed for ACTIVE + KYC APPROVED)
  const letterUrl = await ensureAppointmentLetterForUser(m.userId, true);
  console.log('Appointment letter URL:', letterUrl);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(10); });
