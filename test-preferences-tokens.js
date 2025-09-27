// Test preferences API and check token visibility
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';

async function testPreferencesAPI() {
  console.log('=== Preferences API Token Visibility Test ===\n');

  try {
    // Test data from database debug
    const testCases = [
      {
        name: 'Registered User with Real Expo Token',
        type: 'userId',
        id: 'clmnqhvze0000lxf0kmxs0b6g', // Need to get actual user ID
        deviceId: 'abcd-efgh-1234'
      },
      {
        name: 'Guest Device with Debug Token',
        type: 'deviceId',
        id: 'dev-guest-demo'
      },
      {
        name: 'Seeded User Device',
        type: 'deviceId', 
        id: 'dev-8282868389'
      }
    ];

    for (const testCase of testCases) {
      console.log(`--- Testing: ${testCase.name} ---`);
      
      try {
        const params = {};
        params[testCase.type] = testCase.id;
        if (testCase.deviceId) {
          params.deviceId = testCase.deviceId;
        }

        const response = await axios.get(`${BASE_URL}/preferences`, {
          params,
          timeout: 5000
        });

        if (response.data.success) {
          const data = response.data.data;
          
          console.log(`✅ API Response successful`);
          console.log(`User ID: ${data.user.id}`);
          console.log(`User Role: ${data.user.role} (Guest: ${data.user.isGuest})`);
          console.log(`Language: ${data.user.languageCode} (${data.user.languageName})`);
          
          if (data.device) {
            console.log(`Device ID: ${data.device.deviceId}`);
            console.log(`Device Model: ${data.device.deviceModel}`);
            console.log(`Has Push Token: ${data.device.hasPushToken}`);
            
            // This should NOT show the actual token for security
            console.log(`Push Token Shown in API: ${JSON.stringify(data).includes('pushToken') ? 'YES - SECURITY ISSUE!' : 'NO (Correct)'}`);
            
            if (data.device.location) {
              console.log(`Location: ${data.device.location.latitude}, ${data.device.location.longitude}`);
              console.log(`Location Name: ${data.device.location.placeName || 'Not set'}`);
            } else {
              console.log(`Location: Not set`);
            }
          } else {
            console.log(`❌ No device data returned`);
          }

          if (data.userLocation) {
            console.log(`User Location: ${data.userLocation.latitude}, ${data.userLocation.longitude}`);
          }
          
        } else {
          console.log(`❌ API returned error: ${response.data.message}`);
        }
        
      } catch (error) {
        if (error.response) {
          console.log(`❌ HTTP ${error.response.status}: ${error.response.data.message || error.response.data.error}`);
        } else {
          console.log(`❌ Request failed: ${error.message}`);
        }
      }
      
      console.log(''); // Empty line between tests
    }

    // Test updating preferences with a token
    console.log('--- Testing Preferences Update with Token ---');
    try {
      const updateData = {
        deviceId: 'dev-guest-demo',
        pushToken: 'ExponentPushToken[XXXXXXXXXXXXXXXXXXXXXX]',
        deviceModel: 'Test Phone Updated',
        forceUpdate: true
      };

      const updateResponse = await axios.post(`${BASE_URL}/preferences/update`, updateData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (updateResponse.data.success) {
        console.log('✅ Update successful');
        console.log(`Updates Applied:`, updateResponse.data.data.updates);
        console.log(`Has Push Token After Update: ${updateResponse.data.data.device.hasPushToken}`);
        
        // Check if token is exposed in update response (it shouldn't be)
        console.log(`Token Exposed in Update Response: ${JSON.stringify(updateResponse.data).includes('ExponentPushToken') ? 'YES - SECURITY ISSUE!' : 'NO (Correct)'}`);
      }
    } catch (error) {
      console.log(`❌ Update failed: ${error.response?.data?.message || error.message}`);
    }

  } catch (error) {
    console.error('Test suite failed:', error.message);
  }
}

// Check if server is running first
async function checkServerStatus() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    console.log('✅ Server is running\n');
    return true;
  } catch (error) {
    console.log('❌ Server not running or not responding');
    console.log('   Please start the server with: npm start\n');
    return false;
  }
}

async function main() {
  const serverRunning = await checkServerStatus();
  if (serverRunning) {
    await testPreferencesAPI();
  }
}

main().catch(console.error);