// Sets all designations and designation prices validityDays to 730 and adjusts all ID cards expiry to issuedAt + 730 days.
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
  const TARGET_DAYS = 730;
  try {
    console.log(`[two-years] Using DB: ${String(process.env.DATABASE_URL).slice(0, 50)}...`);
    // 1) Update designation.validityDays
    const desigs = await p.designation.findMany({ select: { id: true, code: true, validityDays: true } });
    let changedDesigs = 0;
    for (const d of desigs) {
      if (Number(d.validityDays || 0) !== TARGET_DAYS) {
        await p.designation.update({ where: { id: d.id }, data: { validityDays: TARGET_DAYS } });
        changedDesigs++;
      }
    }
    console.log(`[two-years] designations updated: ${changedDesigs}`);

    // 2) Update designationPrice.validityDays (set to 730 if null or different)
    const prices = await p.designationPrice.findMany({ select: { id: true, validityDays: true } });
    let changedPrices = 0;
    for (const pr of prices) {
      if (Number(pr.validityDays || 0) !== TARGET_DAYS) {
        await p.designationPrice.update({ where: { id: pr.id }, data: { validityDays: TARGET_DAYS } });
        changedPrices++;
      }
    }
    console.log(`[two-years] designation prices updated: ${changedPrices}`);

    // 3) Update all IDCards expiry: expiresAt = issuedAt + 730 days (fallback to createdAt if no issuedAt)
    const batchSize = 200;
    let cursor = undefined;
    let processed = 0, adjusted = 0;
    for (;;) {
      const where = {};
      const cards = await p.iDCard.findMany({
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
        select: { id: true, issuedAt: true, createdAt: true, expiresAt: true }
      });
      if (!cards.length) break;
      for (const c of cards) {
        processed++;
        const issued = c.issuedAt || c.createdAt || new Date();
        const target = new Date(issued.getTime() + TARGET_DAYS * 24 * 60 * 60 * 1000);
        if (!c.expiresAt || Math.abs(c.expiresAt.getTime() - target.getTime()) > 1000) {
          await p.iDCard.update({ where: { id: c.id }, data: { expiresAt: target } });
          adjusted++;
        }
      }
      cursor = cards[cards.length - 1].id;
    }
    console.log(`[two-years] cards processed: ${processed}, adjusted: ${adjusted}`);
  } catch (e) {
    console.error('[two-years] error:', e && (e.message || e));
  } finally {
    await p.$disconnect();
  }
})();
