import { PrismaClient } from '@prisma/client';

export async function generateNextIdCardNumber(prisma: PrismaClient, at: Date = new Date()): Promise<string> {
  const yy = String(at.getFullYear()).slice(-2);
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const yymm = `${yy}${mm}`;
  const prefix = `hrci-${yymm}-`;
  // Find last existing card for this month by lexicographic order
  const last = await prisma.iDCard.findFirst({
    where: { cardNumber: { startsWith: prefix } as any },
    orderBy: { cardNumber: 'desc' }
  }).catch(() => null as any);
  let next = 1;
  if (last && last.cardNumber && String(last.cardNumber).startsWith(prefix)) {
    const tail = String(last.cardNumber).slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n)) next = n + 1;
  }
  const seq = String(next).padStart(5, '0');
  return `${prefix}${seq}`;
}
