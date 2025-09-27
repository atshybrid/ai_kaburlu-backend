const axios = require('axios');

// Test configuration
const API_BASE = 'http://localhost:3001';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbWZyNzlxNXQwMDRvdWd6MHl6MzF2dnhoIiwicm9sZSI6IlNVUEVSX0FETUlOIiwicGVybWlzc2lvbnMiOlsiY3JlYXRlIiwicmVhZCIsInVwZGF0ZSIsImRlbGV0ZSIsImFwcHJvdmUiLCJyZWplY3QiXSwiaWF0IjoxNzU4NTY5NjYzLCJleHAiOjE3NTg2NTYwNjN9.PFLGDnCpJF5-j9vGFek4UkzgZAxcmTwuGb6e1dRZwRE';

async function testPushNotification() {
  console.log('🧪 Testing Push Notification API\n');
  
  try {
    // Test the Firebase configuration endpoint first
    console.log('1️⃣  Testing Firebase Configuration...');
    const configResponse = await axios.get(`${API_BASE}/api/v1/notifications/config/test`, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Firebase Configuration Response:');
    console.log(JSON.stringify(configResponse.data, null, 2));
    
    // Test the push notification endpoint
    console.log('\n2️⃣  Testing Push Notification...');
    const pushResponse = await axios.post(`${API_BASE}/api/v1/notifications/test-token`, {
      token: 'ExponentPushToken[by-0aKNgQQfAWZHSlwliki]',
      title: 'Test Notification',
      body: 'This is a test from the enhanced system',
      data: { testKey: 'testValue' }
    }, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Push Notification Response:');
    console.log(JSON.stringify(pushResponse.data, null, 2));
    
    if (pushResponse.data.successCount > 0) {
      console.log('\n🎉 SUCCESS: Push notification sent successfully!');
    } else {
      console.log('\n⚠️  WARNING: Push notification failed or had errors');
      if (pushResponse.data.errors) {
        console.log('Errors:', pushResponse.data.errors);
      }
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    if (error.response) {
      console.log('Response status:', error.response.status);
      console.log('Response data:', error.response.data);
    }
  }
}

// Wait a bit for server to start, then run test
setTimeout(() => {
  testPushNotification();
}, 2000);

console.log('Waiting for server to start...');