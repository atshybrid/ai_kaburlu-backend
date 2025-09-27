const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugPushTokens() {
  console.log('=== Push Token Debug Report ===\n');

  try {
    // 1. Count total devices
    const totalDevices = await prisma.device.count();
    console.log(`📱 Total devices in database: ${totalDevices}`);

    // 2. Count devices with push tokens
    const devicesWithTokens = await prisma.device.count({
      where: {
        pushToken: {
          not: null
        }
      }
    });
    console.log(`🔔 Devices with push tokens: ${devicesWithTokens}`);

    // 3. Show recent devices with tokens (last 10)
    console.log('\n--- Recent Devices with Push Tokens ---');
    const recentDevicesWithTokens = await prisma.device.findMany({
      where: {
        pushToken: {
          not: null
        }
      },
      select: {
        id: true,
        deviceId: true,
        deviceModel: true,
        pushToken: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            mobileNumber: true,
            role: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: 10
    });

    recentDevicesWithTokens.forEach((device, index) => {
      console.log(`\n${index + 1}. Device ID: ${device.deviceId}`);
      console.log(`   Model: ${device.deviceModel}`);
      console.log(`   Push Token: ${device.pushToken ? device.pushToken.substring(0, 30) + '...' : 'NULL'}`);
      console.log(`   User: ${device.user?.mobileNumber || 'No user'} (${device.user?.role?.name || 'No role'})`);
      console.log(`   Updated: ${device.updatedAt}`);
    });

    // 4. Show devices without tokens
    console.log('\n--- Recent Devices WITHOUT Push Tokens ---');
    const devicesWithoutTokens = await prisma.device.findMany({
      where: {
        OR: [
          { pushToken: null },
          { pushToken: '' }
        ]
      },
      select: {
        id: true,
        deviceId: true,
        deviceModel: true,
        createdAt: true,
        user: {
          select: {
            mobileNumber: true,
            role: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    devicesWithoutTokens.forEach((device, index) => {
      console.log(`\n${index + 1}. Device ID: ${device.deviceId}`);
      console.log(`   Model: ${device.deviceModel}`);
      console.log(`   User: ${device.user?.mobileNumber || 'No user'} (${device.user?.role?.name || 'No role'})`);
      console.log(`   Created: ${device.createdAt}`);
    });

    // 5. Check for test/debug tokens
    console.log('\n--- Test/Debug Tokens ---');
    const debugTokens = await prisma.device.findMany({
      where: {
        pushToken: {
          contains: 'debug'
        }
      },
      select: {
        deviceId: true,
        pushToken: true,
        user: {
          select: {
            mobileNumber: true
          }
        }
      }
    });

    if (debugTokens.length > 0) {
      debugTokens.forEach((device, index) => {
        console.log(`${index + 1}. ${device.deviceId}: ${device.pushToken}`);
      });
    } else {
      console.log('No debug/test tokens found');
    }

    // 6. Recent push notification logs
    console.log('\n--- Recent Push Notification Logs ---');
    const recentLogs = await prisma.pushNotificationLog.findMany({
      select: {
        id: true,
        deliveryType: true,
        status: true,
        title: true,
        successCount: true,
        failureCount: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    if (recentLogs.length > 0) {
      recentLogs.forEach((log, index) => {
        console.log(`\n${index + 1}. ID: ${log.id}`);
        console.log(`   Type: ${log.deliveryType}`);
        console.log(`   Status: ${log.status}`);
        console.log(`   Title: ${log.title}`);
        console.log(`   Success/Failure: ${log.successCount}/${log.failureCount}`);
        console.log(`   Created: ${log.createdAt}`);
      });
    } else {
      console.log('No push notification logs found');
    }

  } catch (error) {
    console.error('Error during debug:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the debug
debugPushTokens().catch(console.error);