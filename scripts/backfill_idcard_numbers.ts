import prisma from '../src/lib/prisma';
import { generateNextIdCardNumber } from '../src/lib/idCardNumber';

async function main() {
  // Regenerate numbers for cards missing the new pattern (one-by-one in issuedAt order)
  const cards = await prisma.iDCard.findMany({ orderBy: { issuedAt: 'asc' } });
  for (const c of cards) {
    if (!/^hrci-\d{4}-\d{5}$/i.test(c.cardNumber)) {
      const newNo = await generateNextIdCardNumber(prisma as any, c.issuedAt || c.createdAt);
      console.log(`Updating ${c.cardNumber} -> ${newNo}`);
      await prisma.iDCard.update({ where: { id: c.id }, data: { cardNumber: newNo } });
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
