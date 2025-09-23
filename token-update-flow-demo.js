// Handle Push Token Updates for App Reinstall/Storage Clear Scenarios
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';

async function demonstrateTokenUpdateFlow() {
  console.log('=== Push Token Update Flow Demo ===\n');

  // SCENARIO 1: App reinstall - new FCM token generated
  console.log('📱 SCENARIO 1: App Reinstall/Clear Storage');
  console.log('- User deletes app or clears storage');
  console.log('- App generates NEW FCM token');
  console.log('- Old token in database becomes invalid\n');

  // SCENARIO 2: Guest user flow (first time)
  console.log('🆕 SCENARIO 2: Fresh Install - Guest User Created');
  try {
    const guestRegistration = {
      deviceId: `fresh-install-${Date.now()}`, // New device ID
      pushToken: 'ExponentPushToken[FRESH_INSTALL_TOKEN_ABC123]', // New token
      deviceModel: 'iPhone 15 Pro',
      location: {
        latitude: 17.3850,
        longitude: 78.4867,
        placeName: 'Hyderabad, India'
      }
    };

    console.log('Creating guest user with new token...');
    const guestResponse = await axios.post(`${BASE_URL}/preferences/update`, guestRegistration, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (guestResponse.data.success) {
      console.log('✅ Guest user created successfully');
      console.log(`   Device ID: ${guestResponse.data.data.device.deviceId}`);
      console.log(`   Has Push Token: ${guestResponse.data.data.device.hasPushToken}`);
    }
  } catch (error) {
    console.log('❌ Guest creation failed:', error.response?.data?.message);
  }

  console.log('\n🔄 SCENARIO 3: User Login - Replace Guest with Citizen Reporter');
  
  // When user logs in, you need to:
  // 1. Update user role from GUEST to CITIZEN_REPORTER
  // 2. Update push token to the NEW token (in case it changed)
  
  const existingUserId = 'cmfwmoj8x0001mt1w9g3mvqsz'; // Known citizen reporter
  const existingDeviceId = 'abcd-efgh-1234'; // Known device
  
  try {
    // Step 1: Update existing user with NEW token
    const tokenUpdateData = {
      userId: existingUserId,
      deviceId: existingDeviceId,
      pushToken: 'ExponentPushToken[NEW_TOKEN_AFTER_REINSTALL_XYZ789]', // NEW token from app
      deviceModel: 'iPhone 15 Pro Max', // Might be different device
      forceUpdate: true // Force update even if token looks similar
    };

    console.log('Updating citizen reporter with new token...');
    const updateResponse = await axios.post(`${BASE_URL}/preferences/update`, tokenUpdateData, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (updateResponse.data.success) {
      console.log('✅ Token updated successfully');
      console.log('   Updates applied:', updateResponse.data.data.updates);
      console.log(`   New token stored: ${updateResponse.data.data.device.hasPushToken}`);
    }
  } catch (error) {
    console.log('❌ Token update failed:', error.response?.data?.message);
  }

  console.log('\n🔍 SCENARIO 4: Verification - Check Token Status');
  try {
    const verifyResponse = await axios.get(`${BASE_URL}/preferences?userId=${existingUserId}`);
    
    if (verifyResponse.data.success) {
      const data = verifyResponse.data.data;
      console.log('✅ Current user state:');
      console.log(`   User Role: ${data.user.role}`);
      console.log(`   Device Model: ${data.device.deviceModel}`);
      console.log(`   Has Push Token: ${data.device.hasPushToken}`);
      console.log(`   Device ID: ${data.device.deviceId}`);
    }
  } catch (error) {
    console.log('❌ Verification failed:', error.response?.data?.message);
  }

  console.log('\n📋 BEST PRACTICES FOR YOUR APP:');
  console.log('1. Always call preferences/update after getting new FCM token');
  console.log('2. Use forceUpdate: true when user logs in after reinstall');
  console.log('3. Store deviceId locally to maintain device identity');
  console.log('4. Update token on every app launch if it changed');
  console.log('5. Handle both guest→citizen and citizen→citizen token updates');
}

// Run the demonstration
demonstrateTokenUpdateFlow().catch(console.error);