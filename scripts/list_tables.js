const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const q = `select table_name from information_schema.tables where table_schema = current_schema() and (table_name ilike '%donation%' or table_name ilike 'orgsetting' or table_name ilike 'paymentintent') order by table_name;`;
    const rows = await p.$queryRawUnsafe(q);
    console.log(rows);
  } catch (e) {
    console.error('Error listing tables:', e.message);
  } finally {
    await p.$disconnect();
  }
})();
