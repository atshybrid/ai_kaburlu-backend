const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find hrcDistrict for Medchal Malkajgiri
  const district = await prisma.hrcDistrict.findFirst({
    where: { name: { contains: 'Medchal', mode: 'insensitive' } },
    select: { id: true, name: true }
  });
  console.log('District found:', district);

  if (!district) { console.log('District not found!'); return; }

  // Find General Secretary designation - get all matches
  const allDesigs = await prisma.designation.findMany({
    where: { name: { contains: 'General Secretary', mode: 'insensitive' } },
    select: { id: true, name: true, code: true }
  });
  console.log('All General Secretary designations:', allDesigs);
  const desig = allDesigs.find(d => d.name.toLowerCase() === 'general secretary') || allDesigs[0];
  console.log('Using designation:', desig);

  // Find all memberships for General Secretary at District level in Medchal Malkajgiri
  const memberships = await prisma.membership.findMany({
    where: {
      level: 'DISTRICT',
      hrcDistrictId: district.id,
      designationId: desig ? desig.id : undefined
    },
    include: {
      Designation: { select: { name: true, code: true } },
      Cell: { select: { name: true, code: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log('\n=== Memberships ===');
  memberships.forEach((m, i) => {
    console.log(`${i+1}. userId=${m.userId} | designation=${m.Designation?.name} | cell=${m.Cell?.name} | status=${m.status} | seatSeq=${m.seatSequence} | createdAt=${m.createdAt}`);
  });
  console.log('\nTotal:', memberships.length);

  // Get user details
  const userIds = memberships.map(m => m.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, mobileNumber: true, profile: { select: { fullName: true } } }
  });

  console.log('\n=== User Details ===');
  memberships.forEach((m, i) => {
    const user = users.find(u => u.id === m.userId);
    const name = user?.profile?.fullName || '(no name)';
    console.log(`${i+1}. [Seat ${m.seatSequence}] Name: ${name} | Mobile: ${user?.mobileNumber} | Status: ${m.status} | Created: ${m.createdAt.toLocaleDateString('en-IN')}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
