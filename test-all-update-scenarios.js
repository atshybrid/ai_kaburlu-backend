// Comprehensive Preferences Update API Test - All Scenarios
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/v1';

async function testAllUpdateScenarios() {
  console.log('=== Comprehensive Preferences Update Test ===\n');

  const testScenarios = [
    {
      category: '📱 USER ID BASED UPDATES',
      tests: [
        {
          name: 'Update ONLY Push Token (User ID)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            pushToken: 'ExponentPushToken[ONLY_TOKEN_UPDATE_123]'
          }
        },
        {
          name: 'Update ONLY Location (User ID)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            location: {
              latitude: 17.4000,
              longitude: 78.4500,
              placeName: 'Kondapur, Hyderabad',
              address: 'Kondapur, Hyderabad, Telangana 500084',
              source: 'GPS'
            }
          }
        },
        {
          name: 'Update ONLY Language (User ID)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            languageId: 'cmfwhfgn10007ug60s4k7jfyf' // Try English
          }
        },
        {
          name: 'Update Push Token + Location (User ID)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            pushToken: 'ExponentPushToken[TOKEN_LOCATION_COMBO_456]',
            location: {
              latitude: 17.4200,
              longitude: 78.4700,
              placeName: 'Madhapur, Hyderabad',
              address: 'Madhapur, Hyderabad, Telangana 500081',
              source: 'GPS'
            }
          }
        },
        {
          name: 'Update ALL Fields (User ID)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            pushToken: 'ExponentPushToken[ALL_FIELDS_UPDATE_789]',
            deviceModel: 'iPhone 16 Pro',
            location: {
              latitude: 17.3900,
              longitude: 78.4600,
              accuracyMeters: 3.2,
              placeName: 'Banjara Hills, Hyderabad',
              address: 'Banjara Hills, Hyderabad, Telangana 500034',
              source: 'GPS'
            },
            languageId: 'cmfwhfgqd0009ug60lc7rab6n', // Telugu
            forceUpdate: true
          }
        }
      ]
    },
    {
      category: '🔧 DEVICE ID BASED UPDATES',
      tests: [
        {
          name: 'Update ONLY Push Token (Device ID)',
          data: {
            deviceId: 'abcd-efgh-1234',
            pushToken: 'ExponentPushToken[DEVICE_ONLY_TOKEN_ABC]'
          }
        },
        {
          name: 'Update ONLY Location (Device ID)',
          data: {
            deviceId: 'abcd-efgh-1234',
            location: {
              latitude: 17.4100,
              longitude: 78.4800,
              placeName: 'Gachibowli, Hyderabad',
              address: 'Gachibowli, Hyderabad, Telangana 500032',
              source: 'GPS'
            }
          }
        },
        {
          name: 'Update Device Model Only (Device ID)',
          data: {
            deviceId: 'abcd-efgh-1234',
            deviceModel: 'Samsung Galaxy S25 Ultra'
          }
        },
        {
          name: 'Update Push Token + Device Model (Device ID)',
          data: {
            deviceId: 'abcd-efgh-1234',
            pushToken: 'ExponentPushToken[DEVICE_MODEL_COMBO_XYZ]',
            deviceModel: 'Google Pixel 9 Pro'
          }
        }
      ]
    },
    {
      category: '🔄 MIXED ID SCENARIOS',
      tests: [
        {
          name: 'Update with Both User ID + Device ID',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            deviceId: 'abcd-efgh-1234',
            pushToken: 'ExponentPushToken[MIXED_IDS_UPDATE_999]',
            deviceModel: 'OnePlus 12 Pro',
            location: {
              latitude: 17.3700,
              longitude: 78.4400,
              placeName: 'Jubilee Hills, Hyderabad',
              address: 'Jubilee Hills, Hyderabad, Telangana 500033',
              source: 'GPS'
            }
          }
        }
      ]
    },
    {
      category: '🚀 FORCE UPDATE SCENARIOS',
      tests: [
        {
          name: 'Force Update Same Values',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            pushToken: 'ExponentPushToken[FORCE_SAME_TOKEN]',
            forceUpdate: true
          }
        },
        {
          name: 'No Force Update (Same Values)',
          data: {
            userId: 'cmfwmoj8x0001mt1w9g3mvqsz',
            pushToken: 'ExponentPushToken[FORCE_SAME_TOKEN]',
            forceUpdate: false
          }
        }
      ]
    }
  ];

  for (const scenario of testScenarios) {
    console.log(`\n${scenario.category}`);
    console.log('='.repeat(scenario.category.length));

    for (const test of scenario.tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const response = await axios.post(`${BASE_URL}/preferences/update`, test.data, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        if (response.data.success) {
          console.log('✅ Update successful');
          
          // Show what was updated
          const updates = response.data.data.updates;
          const changes = Object.entries(updates)
            .filter(([key, value]) => value === true)
            .map(([key]) => key);
          
          if (changes.length > 0) {
            console.log(`   Changed: ${changes.join(', ')}`);
          } else {
            console.log('   No changes applied (values same as before)');
          }
          
          // Show current status
          console.log(`   Push Token: ${response.data.data.device.hasPushToken ? '✅' : '❌'}`);
          console.log(`   Device Model: ${response.data.data.device.deviceModel}`);
          console.log(`   Language: ${response.data.data.user.languageCode} (${response.data.data.user.languageName})`);
          
          if (response.data.data.device.location) {
            console.log(`   Location: ${response.data.data.device.location.placeName || 'Unknown place'}`);
          }
          
        } else {
          console.log('❌ Update failed:', response.data.message);
        }

      } catch (error) {
        if (error.response) {
          console.log(`❌ HTTP ${error.response.status}:`, error.response.data.message || error.response.data.error);
        } else {
          console.log(`❌ Request failed:`, error.message);
        }
      }
    }
  }

  // Final verification
  console.log('\n🔍 FINAL VERIFICATION');
  console.log('='.repeat(20));
  
  try {
    const finalCheck = await axios.get(`${BASE_URL}/preferences?userId=cmfwmoj8x0001mt1w9g3mvqsz`);
    
    if (finalCheck.data.success) {
      const data = finalCheck.data.data;
      
      console.log('\n📊 Current State:');
      console.log(`   User: ${data.user.role} (${data.user.isGuest ? 'Guest' : 'Registered'})`);
      console.log(`   Language: ${data.user.languageCode} (${data.user.languageName})`);
      
      if (data.device) {
        console.log(`   Device: ${data.device.deviceModel}`);
        console.log(`   Push Token: ${data.device.hasPushToken ? '✅ Available' : '❌ Missing'}`);
        
        if (data.device.location) {
          console.log(`   Location: ${data.device.location.placeName}`);
          console.log(`   Coordinates: ${data.device.location.latitude}, ${data.device.location.longitude}`);
        }
      }
      
      if (data.userLocation) {
        console.log(`   User Location: ${data.userLocation.placeName} (Registered user location)`);
      }
    }
  } catch (error) {
    console.log('❌ Final verification failed:', error.response?.data || error.message);
  }
}

// Check server and run tests
async function main() {
  try {
    await axios.get('http://localhost:3001/api/docs', { timeout: 3000 });
    console.log('✅ Server is running\n');
    await testAllUpdateScenarios();
  } catch (error) {
    console.log('❌ Server not responding. Please start with: npm start\n');
  }
}

main().catch(console.error);