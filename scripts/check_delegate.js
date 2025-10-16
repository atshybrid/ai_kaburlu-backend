const prisma = require('../dist/src/lib/prisma').default;
(async () => {
  try {
    console.log('orgSetting delegate:', !!prisma.orgSetting);
    console.log('donationEventImage delegate:', !!prisma.donationEventImage);
    if (prisma.donationEventImage) {
      const c = await prisma.donationEventImage.count();
      console.log('donationEventImage.count ok:', c);
    }
  } catch (e) {
    console.error('error:', e && (e.stack || e.message || e));
  } finally {
    await prisma.$disconnect();
  }
})();
