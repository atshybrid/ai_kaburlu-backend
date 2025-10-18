// Usage: node scripts/inspect_meeting_scope.js <meetingId> <userId>
const { PrismaClient } = require('@prisma/client');

async function main() {
  const [meetingId, userId] = process.argv.slice(2);
  if (!meetingId || !userId) {
    console.error('Usage: node scripts/inspect_meeting_scope.js <meetingId> <userId>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const m = await prisma.meeting.findUnique({ where: { id: String(meetingId) } });
    console.log('Meeting:', m ? {
      id: m.id, title: m.title, cellId: m.cellId, level: m.level, includeChildren: m.includeChildren,
      zone: m.zone, hrcCountryId: m.hrcCountryId, hrcStateId: m.hrcStateId, hrcDistrictId: m.hrcDistrictId, hrcMandalId: m.hrcMandalId
    } : null);
    const memberships = await prisma.membership.findMany({
      where: { userId: String(userId) },
      select: { id: true, status: true, cellId: true, level: true, zone: true, hrcCountryId: true, hrcStateId: true, hrcDistrictId: true, hrcMandalId: true }
    });
    console.log('User memberships:', memberships);
  } catch (e) {
    console.error('Error:', e?.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
