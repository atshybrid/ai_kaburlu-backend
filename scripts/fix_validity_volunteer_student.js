// Ensure env vars are loaded and DATABASE_URL is mapped based on ENV_TYPE
try { require('dotenv-flow').config(); } catch {}
const envType = (process.env.ENV_TYPE || process.env.NODE_ENV || 'development').toLowerCase();
const isProd = envType === 'prod' || envType === 'production';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = isProd
    ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
}

const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  const p = prisma;
  const TARGET_CODES = ['VOLUNTEER', 'STUDENT'];
  const TARGET_DAYS = 730; // 2 years
  let changedDesignations = 0;
  let updatedCards = 0;
  try {
    console.log(`[fix] Using DB: ${String(process.env.DATABASE_URL).slice(0, 50)}...`);
    // 1) Update Designation.validityDays for the target codes
    const ds = await p.designation.findMany({ where: { code: { in: TARGET_CODES } }, select: { id: true, code: true, validityDays: true } });
    for (const d of ds) {
      if (Number(d.validityDays || 0) !== TARGET_DAYS) {
        await p.designation.update({ where: { id: d.id }, data: { validityDays: TARGET_DAYS } });
        changedDesignations++;
        console.log(`[fix] designation ${d.code}: validityDays ${d.validityDays} -> ${TARGET_DAYS}`);
      }
    }

    // 2) Update existing IDCards expiry for memberships of those designations
    // newExpiresAt = issuedAt + 730 days; only extend if current expiry is < new target
    const cards = await p.iDCard.findMany({
      where: { membership: { designation: { code: { in: TARGET_CODES } } } },
      include: { membership: { include: { designation: true } } }
    });
    for (const c of cards) {
      const issuedAt = c.issuedAt || c.createdAt || new Date();
      const target = new Date(issuedAt.getTime() + TARGET_DAYS * 24 * 60 * 60 * 1000);
      if (!c.expiresAt || c.expiresAt.getTime() < target.getTime()) {
        await p.iDCard.update({ where: { id: c.id }, data: { expiresAt: target } });
        updatedCards++;
      }
    }

    console.log(`[fix] Updated designations: ${changedDesignations}, adjusted ID cards: ${updatedCards}`);
  } catch (e) {
    console.error('[fix] error:', e && (e.message || e));
  } finally {
    await p.$disconnect();
  }
})();
