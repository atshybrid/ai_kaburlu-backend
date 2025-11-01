require('dotenv-flow').config({ silent: true });
// Minimal env normalization like src/config/env
const envType = String(process.env.ENV_TYPE || process.env.NODE_ENV || 'development').toLowerCase();
const isProd = envType === 'prod' || envType === 'production';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = isProd
    ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
}
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const id = process.argv[2];
    if (!id) {
      console.error('Usage: node scripts/check_membership.js <membershipId>');
      process.exit(1);
    }
    console.log('DB URL prefix:', String(process.env.DATABASE_URL || '').slice(0, 40) + '...');
    const m = await p.membership.findUnique({
      where: { id },
      include: { designation: true, cell: true, payments: true }
    });
    if (!m) {
      console.log('membership not found');
      process.exit(2);
    }
    const paid = (m.payments || []).filter(x => x.status === 'SUCCESS').reduce((s, x) => s + (x.amount || 0), 0);
    console.log(JSON.stringify({ id: m.id, userId: m.userId, level: m.level, status: m.status, cell: m.cell && { id: m.cell.id, name: m.cell.name }, designation: m.designation && { id: m.designation.id, code: m.designation.code, name: m.designation.name }, paid }, null, 2));
  } catch (e) {
    console.error('Error:', e && (e.stack || e.message || e));
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
})();
