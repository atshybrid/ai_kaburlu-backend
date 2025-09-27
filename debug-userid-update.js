// Simple debug test for userId-only updates
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';

async function debugUserIdUpdate() {
  console.log('=== Debug User ID Update ===\n');

  const userId = 'cmfwmoj8x0001mt1w9g3mvqsz';

  // First check current user state
  console.log('1. Current user state:');
  try {
    const getUserResponse = await axios.get(`${BASE_URL}/preferences?userId=${userId}`);
    console.log('User:', getUserResponse.data.data.user);
    console.log('Device:', getUserResponse.data.data.device);
    console.log('User Location:', getUserResponse.data.data.userLocation ? 'Available' : 'Null');
  } catch (error) {
    console.log('❌ Get user failed:', error.response?.data);
  }

  // Test simple push token update
  console.log('\n2. Testing simple push token update:');
  try {
    const updateData = {
      userId: userId,
      pushToken: 'ExponentPushToken[DEBUG_TOKEN_SIMPLE]'
    };

    console.log('Request data:', JSON.stringify(updateData, null, 2));

    const updateResponse = await axios.post(`${BASE_URL}/preferences/update`, updateData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Update successful:', updateResponse.data);
  } catch (error) {
    console.log('❌ Update failed:', error.response?.data);
    
    if (error.response?.status === 500) {
      console.log('\nThis suggests the device resolution logic failed.');
      console.log('The user exists but the device lookup is not working properly.');
    }
  }

  // Test with explicit deviceId
  console.log('\n3. Testing with explicit deviceId:');
  try {
    const updateWithDeviceData = {
      userId: userId,
      deviceId: 'abcd-efgh-1234', // Known device ID
      pushToken: 'ExponentPushToken[DEBUG_TOKEN_WITH_DEVICE]'
    };

    const updateWithDeviceResponse = await axios.post(`${BASE_URL}/preferences/update`, updateWithDeviceData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Update with deviceId successful:', updateWithDeviceResponse.data.data.updates);
  } catch (error) {
    console.log('❌ Update with deviceId failed:', error.response?.data);
  }
}

debugUserIdUpdate().catch(console.error);