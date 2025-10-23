const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

(async () => {
  const prisma = new PrismaClient();
  try {
    const token = process.argv[2];
    if (!token) {
      console.error('Usage: node scripts/check_user.js <JWT>');
      process.exit(1);
    }
    const decoded = jwt.decode(token);
    console.log('decoded:', decoded);
    if (!decoded || !decoded.sub) {
      console.error('No sub in token');
      process.exit(2);
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.sub }, include: { role: true } });
    if (!user) {
      console.log('user not found for sub:', decoded.sub);
    } else {
      console.log('user:', { id: user.id, role: user.role && user.role.name });
    }
  } catch (e) {
    console.error('error:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
