import prisma from '../src/lib/prisma';

async function ensureEvent(title: string) {
  const existing = await (prisma as any).donationEvent.findFirst({ where: { title } });
  if (existing) return existing;
  return (prisma as any).donationEvent.create({ data: { title, status: 'ACTIVE', presets: [100, 500, 1000], allowCustom: true } });
}

async function main() {
  const e1 = await ensureEvent('General Donation');
  const e2 = await ensureEvent('Medical Aid Drive');
  console.log('Events ready:', e1.id, e2.id);

  // Seed a couple of successful donations for e1
  const d1 = await (prisma as any).donation.create({ data: { eventId: e1.id, amount: 500, donorName: 'Test Donor 1', donorEmail: 'donor1@example.com', isAnonymous: false, status: 'SUCCESS' } });
  const d2 = await (prisma as any).donation.create({ data: { eventId: e1.id, amount: 1200, donorName: 'Anonymous', isAnonymous: true, status: 'SUCCESS' } });
  console.log('Seeded donations:', d1.id, d2.id);
  await (prisma as any).donationEvent.update({ where: { id: e1.id }, data: { collectedAmount: { increment: 1700 } } });
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
