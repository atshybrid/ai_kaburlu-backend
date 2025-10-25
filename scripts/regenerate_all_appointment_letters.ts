import prisma from '../src/lib/prisma';
import { ensureAppointmentLetterForUser } from '../src/api/auth/auth.service';

async function main() {
  console.log('[regen] Scanning eligible memberships...');
  const memberships = await prisma.membership.findMany({
    where: { status: 'ACTIVE' },
    include: { idCard: true, kyc: true },
  });

  const eligible = memberships.filter((m: any) => {
    const idc = m.idCard;
    const kyc = m.kyc;
    const kycApproved = (kyc?.status || '').toUpperCase() === 'APPROVED';
    const idCardIssued = idc && idc.status === 'GENERATED';
    return kycApproved && idCardIssued;
  });

  const userIds = Array.from(new Set(eligible.map((m: any) => m.userId)));
  console.log(`[regen] Found ${userIds.length} eligible members`);

  let ok = 0, skip = 0, fail = 0;
  for (const [idx, userId] of userIds.entries()) {
    try {
      const url = await ensureAppointmentLetterForUser(userId, true);
      if (url) {
        ok++;
        console.log(`[${idx + 1}/${userIds.length}] regenerated -> ${url}`);
      } else {
        skip++;
        console.log(`[${idx + 1}/${userIds.length}] skipped (not eligible or unchanged)`);
      }
      // small delay to avoid overwhelming storage/CDN
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      fail++;
      console.error(`[${idx + 1}/${userIds.length}] FAILED for user ${userId}:`, e);
      await new Promise(r => setTimeout(r, 250));
    }
  }

  console.log(`[regen] Done. ok=${ok} skip=${skip} fail=${fail}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[regen] Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
