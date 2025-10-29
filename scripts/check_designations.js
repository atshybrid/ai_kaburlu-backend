// Check counts for Designation and DesignationPrice
require('dotenv-flow').config();
// Normalize DATABASE_URL via ENV_TYPE mapping (avoid TS import)
const envType = String(process.env.ENV_TYPE || process.env.NODE_ENV || 'development').toLowerCase();
const isProd = envType === 'prod' || envType === 'production';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = isProd
    ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const [designations, prices, cells] = await Promise.all([
      prisma.designation.count(),
      prisma.designationPrice.count(),
      prisma.cell.count(),
    ]);
    console.log(JSON.stringify({ designations, prices, cells, envType: process.env.ENV_TYPE || process.env.NODE_ENV }, null, 2));
  } catch (e) {
    console.error('[check_designations] failed:', e.message || e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
