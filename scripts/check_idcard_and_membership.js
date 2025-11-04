// Usage: node scripts/check_idcard_and_membership.js <idOrCardNumber>
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
  const p = new PrismaClient();
  const arg = process.argv[2];
  if (!arg) { console.error('Provide IDCard.id or IDCard.cardNumber'); process.exit(1); }
  try {
    let card = await p.iDCard.findFirst({ where: { id: arg }, include: { membership: { include: { designation: true, cell: true } } } });
    if (!card) {
      card = await p.iDCard.findFirst({ where: { cardNumber: { equals: arg, mode: 'insensitive' } }, include: { membership: { include: { designation: true, cell: true } } } });
    }
    if (!card) { console.log('Card not found for', arg); return; }
    const m = card.membership;
    // Compute availability to see effective validity
    const level = m.level;
    // mimic membershipService.getAvailability validityDays resolution using DB (no transaction)
    const prices = await p.designationPrice.findMany({ where: { designationId: m.designationId }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    const score = (c) => {
      let s = 0;
      if (c.cellId && c.cellId === m.cellId) s += 8;
      if (c.level && c.level === level) s += 4;
      if (c.zone && c.zone === m.zone) s += 2;
      if (c.hrcStateId && c.hrcStateId === m.hrcStateId) s += 2;
      if (c.hrcDistrictId && c.hrcDistrictId === m.hrcDistrictId) s += 2;
      if (c.hrcMandalId && c.hrcMandalId === m.hrcMandalId) s += 3;
      return s;
    };
    let best = null, bestScore = -1;
    for (const c of prices) { const s = score(c); if (s > bestScore) { best = c; bestScore = s; } }
    const designation = await p.designation.findUnique({ where: { id: m.designationId } });
    const avail = { validityDays: (best?.validityDays ?? designation?.validityDays ?? null), bestPrice: best, designation };
    console.log({
      card: { id: card.id, cardNumber: card.cardNumber, issuedAt: card.issuedAt, expiresAt: card.expiresAt },
      membership: { id: m.id, level, cellId: m.cellId, designationId: m.designationId, zone: m.zone, hrcStateId: m.hrcStateId, hrcDistrictId: m.hrcDistrictId, hrcMandalId: m.hrcMandalId },
      designation: { code: card.membership.designation.code, validityDays: card.membership.designation.validityDays },
      effectiveValidityDays: avail.validityDays,
    });
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
