import prisma from '../src/lib/prisma';
import { hashMpin } from '../src/lib/mpin';

/**
 * One-time migration: hash any plaintext MPIN values.
 * Safe to run multiple times (skips already-bcrypt hashed values).
 */
async function main() {
  console.log('Hashing existing plaintext MPINs...');
  const batchSize = 100;
  let skip = 0;
  let updated = 0;
  while (true) {
    const users = await (prisma as any).user.findMany({ skip, take: batchSize, where: { mpin: { not: null } }, select: { id: true, mpin: true } });
    if (!users.length) break;
    for (const u of users) {
      if (u.mpin && !u.mpin.startsWith('$2')) {
        const hashed = await hashMpin(u.mpin);
        await (prisma as any).user.update({ where: { id: u.id }, data: { mpin: hashed } });
        updated++;
      }
    }
    skip += batchSize;
  }
  console.log(`Completed. Users updated: ${updated}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
