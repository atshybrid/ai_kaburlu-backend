try { require('dotenv-flow').config(); } catch {}
const envType = (process.env.ENV_TYPE || process.env.NODE_ENV || 'development').toLowerCase();
const isProd = envType === 'prod' || envType === 'production';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = isProd ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL) : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
}
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const desig = await p.designation.findFirst({ where: { OR: [ { code: 'PRESIDENT' }, { name: 'President' } ] } });
    if (!desig) throw new Error('PRESIDENT designation not found');
    const cells = await p.cell.findMany({ where: { OR: [ { code: 'GENERAL_BODY' }, { name: 'General Body' }, { code: 'WOMEN_WING' }, { name: 'Women Port' } ] }, select: { id: true, name: true, code: true } });
    const cellMap = new Map(cells.map(c => [c.id, c]));
    const prices = await p.designationPrice.findMany({ where: { designationId: desig.id, level: 'NATIONAL', zone: null, hrcStateId: null, hrcDistrictId: null, hrcMandalId: null }, select: { id: true, cellId: true, fee: true, priority: true } });
    const filtered = prices.filter(pr => cellMap.has(pr.cellId));
    console.log('President NATIONAL prices for target cells:', filtered.map(pr => ({ cell: cellMap.get(pr.cellId), fee: pr.fee, priority: pr.priority })));
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
