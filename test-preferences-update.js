// Test preferences update API with proper JSON formatting
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';

async function testPreferencesUpdate() {
  console.log('=== Testing Preferences Update API ===\n');

  // Test cases with valid JSON
  const testCases = [
    {
      name: 'Update User with Device (Push Token)',
      data: {
        userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
        deviceId: 'abcd-efgh-1234',
        pushToken: 'ExponentPushToken[NEW_TOKEN_12345_UPDATED]',
        deviceModel: 'iPhone 15 Pro Max',
        forceUpdate: true
      }
    },
    {
      name: 'Update User Location',
      data: {
        userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
        deviceId: 'abcd-efgh-1234',
        location: {
          latitude: 17.4400,
          longitude: 78.3489,
          accuracyMeters: 5.2,
          placeName: 'Gachibowli, Hyderabad',
          address: 'HITEC City, Gachibowli, Hyderabad, Telangana 500081',
          source: 'GPS'
        }
      }
    },
    {
      name: 'Update Language Preference',
      data: {
        userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
        languageId: 'cmfwhfgn10007ug60s4k7jfyf' // English language ID
      }
    },
    {
      name: 'Complete Update (All Fields)',
      data: {
        userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
        deviceId: 'abcd-efgh-1234',
        pushToken: 'ExponentPushToken[COMPLETE_UPDATE_TOKEN_67890]',
        deviceModel: 'Samsung Galaxy S24 Ultra',
        location: {
          latitude: 17.3850,
          longitude: 78.4867,
          accuracyMeters: 8.5,
          placeId: 'ChIJL_P_CXMEDTkRw0ZdG-0GVvw',
          placeName: 'Jubilee Hills, Hyderabad',
          address: 'Jubilee Hills, Hyderabad, Telangana 500033',
          source: 'GPS'
        },
        languageId: 'cmfwhfgqd0009ug60lc7rab6n', // Telugu
        forceUpdate: true
      }
    }
  ];

  for (const testCase of testCases) {
    console.log(`--- ${testCase.name} ---`);
    
    try {
      const response = await axios.post(`${BASE_URL}/preferences/update`, testCase.data, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data.success) {
        console.log('✅ Update successful');
        console.log('User:', response.data.data.user);
        console.log('Device:', response.data.data.device);
        console.log('Updates Applied:', response.data.data.updates);
        
        // Check if push token is properly stored (hasPushToken should be true)
        if (testCase.data.pushToken) {
          console.log(`Push Token Status: ${response.data.data.device.hasPushToken ? '✅ Stored' : '❌ Not Stored'}`);
        }
      } else {
        console.log('❌ Update failed:', response.data.message);
      }

    } catch (error) {
      if (error.response) {
        console.log(`❌ HTTP ${error.response.status}:`, error.response.data);
        
        // Show specific validation errors
        if (error.response.data.message && error.response.data.message.includes('JSON')) {
          console.log('JSON Error Details:', error.response.data.message);
        }
      } else {
        console.log(`❌ Request failed:`, error.message);
      }
    }
    
    console.log(''); // Empty line
  }

  // Test the GET endpoint after updates
  console.log('--- Verification: GET Preferences After Updates ---');
  try {
    const getResponse = await axios.get(`${BASE_URL}/preferences?userId=cmfwmoj8x0001mt1w9g3mvqsz`);
    
    if (getResponse.data.success) {
      console.log('✅ GET request successful');
      console.log('User Info:', getResponse.data.data.user);
      console.log('Device Info:', getResponse.data.data.device);
      console.log('User Location:', getResponse.data.data.userLocation ? 'Available' : 'Not set');
      
      // Show push token status clearly
      if (getResponse.data.data.device) {
        console.log(`\n🔔 PUSH TOKEN STATUS:`);
        console.log(`   Has Push Token: ${getResponse.data.data.device.hasPushToken}`);
        console.log(`   Device Model: ${getResponse.data.data.device.deviceModel}`);
        console.log(`   Device ID: ${getResponse.data.data.device.deviceId}`);
      }
    }
  } catch (error) {
    console.log('❌ GET verification failed:', error.response?.data || error.message);
  }
}

// Check server status first
async function checkServer() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    console.log('✅ Server is running\n');
    return true;
  } catch (error) {
    try {
      // Try swagger endpoint as fallback
      await axios.get('http://localhost:3001/api/docs', { timeout: 3000 });
      console.log('✅ Server is running (detected via docs)\n');
      return true;
    } catch (e) {
      console.log('❌ Server not responding');
      console.log('   Please ensure server is running: npm start\n');
      return false;
    }
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await testPreferencesUpdate();
  }
}

main().catch(console.error);