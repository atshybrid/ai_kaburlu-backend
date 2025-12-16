/*
  Lists potential duplicate user accounts by *normalized* mobile number.

  Usage:
    node scripts/check_mobile_duplicates.js

  Requires DATABASE_URL to point at your Postgres DB.
*/

const { PrismaClient } = require('@prisma/client');

// Load .env / .env.local etc for scripts (same as app runtime)
require('dotenv-flow').config({ silent: true });

const prisma = new PrismaClient();

function normalizeMobileNumber(input) {
  const digits = String(input || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length > 10) return digits.slice(-10);
  if (digits.startsWith('0') && digits.length > 10) return digits.slice(-10);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

(async () => {
  const users = await prisma.user.findMany({
    select: { id: true, mobileNumber: true, email: true, createdAt: true },
    where: { mobileNumber: { not: null } },
  });

  const groups = new Map();
  for (const u of users) {
    const norm = normalizeMobileNumber(u.mobileNumber);
    if (!norm) continue;
    const arr = groups.get(norm) || [];
    arr.push(u);
    groups.set(norm, arr);
  }

  const duplicates = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (duplicates.length === 0) {
    console.log('No duplicate normalized mobile numbers found.');
    return;
  }

  console.log(`Found ${duplicates.length} duplicate normalized mobile numbers:`);
  for (const [norm, arr] of duplicates) {
    console.log(`\nMobile: ${norm}`);
    for (const u of arr.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))) {
      console.log(`  - userId=${u.id} mobile=${u.mobileNumber} email=${u.email || ''} createdAt=${u.createdAt.toISOString()}`);
    }
  }
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
