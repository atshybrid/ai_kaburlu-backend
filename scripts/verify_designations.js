// Load environment variables
try { require('dotenv-flow').config(); } catch {}
// Minimal DB URL resolver to mimic src/config/env behavior
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
  try {
    const ds = await p.designation.findMany({
      where: { code: { in: ['STUDENT', 'VOLUNTEER'] } },
      select: { code: true, name: true, defaultCapacity: true, idCardFee: true, validityDays: true }
    });
    console.log('designations', ds);
    const studentPrices = await p.designationPrice.findMany({
      where: { designation: { code: 'STUDENT' } },
      take: 5,
      select: { level: true, fee: true, currency: true }
    });
    console.log('sample STUDENT prices', studentPrices);
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
