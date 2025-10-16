const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const keys = Object.keys(p).filter(k => k[0] !== k[0].toUpperCase());
  console.log('delegates count:', keys.length);
  console.log(keys.slice(0, 50));
  console.log('has orgSetting:', keys.includes('orgSetting'));
  await p.$disconnect();
})();