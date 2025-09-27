const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixUserDeviceAssociation() {
  console.log('=== User Device Association Debug ===\n');

  const userId = 'cmfwmoj8x0001mt1w9g3mvqsz';

  try {
    // 1. Check user details
    console.log('1. User Details:');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        language: true,
        devices: true
      }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`   ID: ${user.id}`);
    console.log(`   Mobile: ${user.mobileNumber}`);
    console.log(`   Role: ${user.role.name}`);
    console.log(`   Language: ${user.language.name} (${user.language.code})`);
    console.log(`   Devices: ${user.devices.length}`);

    if (user.devices.length > 0) {
      user.devices.forEach((device, i) => {
        console.log(`     ${i+1}. ${device.deviceId} - ${device.deviceModel} - Token: ${device.pushToken ? 'Yes' : 'No'}`);
      });
    }

    // 2. Check if this user's device exists but isn't linked
    console.log('\n2. Looking for unlinked devices with Expo token:');
    const deviceWithExpoToken = await prisma.device.findFirst({
      where: {
        pushToken: {
          contains: 'ExponentPushToken'
        }
      },
      include: {
        user: {
          select: {
            id: true,
            mobileNumber: true
          }
        }
      }
    });

    if (deviceWithExpoToken) {
      console.log(`   Found device: ${deviceWithExpoToken.deviceId}`);
      console.log(`   Model: ${deviceWithExpoToken.deviceModel}`);
      console.log(`   Token: ${deviceWithExpoToken.pushToken.substring(0, 30)}...`);
      console.log(`   Current User: ${deviceWithExpoToken.user?.mobileNumber || 'None'}`);

      if (deviceWithExpoToken.userId !== userId) {
        console.log('\n3. Linking device to user...');
        
        const updated = await prisma.device.update({
          where: { id: deviceWithExpoToken.id },
          data: { userId: userId }
        });

        console.log(`✅ Device ${deviceWithExpoToken.deviceId} linked to user ${user.mobileNumber}`);
      } else {
        console.log('✅ Device already linked to this user');
      }
    } else {
      console.log('❌ No device with Expo token found');
      
      // Create a test device for this user
      console.log('\n3. Creating test device with push token...');
      const testDevice = await prisma.device.create({
        data: {
          deviceId: `test-device-${Date.now()}`,
          deviceModel: 'Test Phone',
          pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
          userId: userId
        }
      });
      
      console.log(`✅ Created test device: ${testDevice.deviceId}`);
    }

    // 4. Verify the association worked
    console.log('\n4. Verification - User devices after update:');
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        devices: {
          select: {
            deviceId: true,
            deviceModel: true,
            pushToken: true
          }
        }
      }
    });

    if (updatedUser.devices.length > 0) {
      updatedUser.devices.forEach((device, i) => {
        console.log(`   ${i+1}. ${device.deviceId}`);
        console.log(`      Model: ${device.deviceModel}`);
        console.log(`      Has Token: ${device.pushToken ? 'Yes' : 'No'}`);
        if (device.pushToken) {
          console.log(`      Token Preview: ${device.pushToken.substring(0, 30)}...`);
        }
      });
    } else {
      console.log('   No devices found');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixUserDeviceAssociation().catch(console.error);