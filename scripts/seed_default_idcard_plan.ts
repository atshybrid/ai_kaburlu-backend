import prisma from '../src/lib/prisma';

async function main() {
  const planName = 'Annual Volunteer ID Card';
  const existing = await (prisma as any).hrcIdCardPlan.findFirst({ where: { planName } });
  if (existing) {
    console.log('Plan already exists:', existing.id);
    return;
  }
  const plan = await (prisma as any).hrcIdCardPlan.create({ data: {
    planName,
    amountMinor: 5000, // Rs 50.00
    currency: 'INR',
    renewalDays: 365,
    active: true
  }});
  console.log('Created default ID card plan', plan);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await (prisma as any).$disconnect(); });
