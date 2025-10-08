/**
 * Migration: Move any legacy plaintext or hashed MPINs from User.mpin to User.mpinHash and null out mpin.
 * Idempotent: re-running will skip users already migrated (mpinHash set OR mpin null).
 */
import prisma from '../src/lib/prisma';
import { hashMpin, isBcryptHash } from '../src/lib/mpin';

async function main() {
  console.log('Starting MPIN legacy migration -> mpinHash...');
  // Use any-casts to avoid transient type mismatch if generated client not refreshed yet
  const users = await (prisma.user as any).findMany({
    where: { mpin: { not: null } },
    select: { id: true, mpin: true, mpinHash: true }
  });

  if (!users.length) {
    console.log('No users require migration.');
    return;
  }
  let migrated = 0;
  for (const u of users) {
    if (u.mpinHash) continue; // already migrated
    const current = u.mpin as string | null;
    if (!current) continue;
    let hashed: string;
    if (isBcryptHash(current)) {
      hashed = current;
    } else {
      hashed = await hashMpin(current);
    }
    await (prisma.user as any).update({ where: { id: u.id }, data: { mpinHash: hashed, mpin: null } });
    migrated++;
  }
  console.log(`Migration complete. Migrated ${migrated} user(s).`);
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
