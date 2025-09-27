const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugUserDevicesQuery() {
  console.log('=== Debug User Devices Query ===\n');

  const userId = 'cmfwmoj8x0001mt1w9g3mvqsz';

  try {
    // Test the exact query used in the update controller
    console.log('1. Query with devices: true');
    const userWithAllDevices = await prisma.user.findUnique({
      where: { id: userId },
      include: { 
        role: true,
        language: true,
        devices: true  // This should include all devices
      }
    });

    console.log('User found:', !!userWithAllDevices);
    console.log('Devices count:', userWithAllDevices?.devices?.length || 0);
    
    if (userWithAllDevices?.devices) {
      userWithAllDevices.devices.forEach((device, i) => {
        console.log(`Device ${i + 1}:`, {
          id: device.id,
          deviceId: device.deviceId,
          deviceModel: device.deviceModel,
          hasPushToken: !!device.pushToken,
          updatedAt: device.updatedAt
        });
      });
    }

    // Test sorting by updatedAt
    if (userWithAllDevices?.devices?.length > 0) {
      console.log('\n2. Sorted devices (most recent first):');
      const sorted = userWithAllDevices.devices.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      
      console.log('Most recent device:', {
        deviceId: sorted[0].deviceId,
        deviceModel: sorted[0].deviceModel,
        updatedAt: sorted[0].updatedAt
      });
    }

  } catch (error) {
    console.error('Query failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugUserDevicesQuery().catch(console.error);