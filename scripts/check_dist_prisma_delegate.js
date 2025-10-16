const prisma = require('../dist/src/lib/prisma').default;
(async () => {
  console.log('typeof prisma:', typeof prisma);
  console.log('has orgSetting:', !!prisma.orgSetting);
  try {
    const s = await prisma.orgSetting.findFirst({});
    console.log('findFirst worked; null?', !s);
  } catch (e) {
    console.error('error calling orgSetting.findFirst', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();