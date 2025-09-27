const axios = require('axios');

async function testBasicEndpoints() {
  console.log('Testing basic endpoints...');
  
  try {
    // Test if server is responding
    const healthCheck = await axios.get('http://localhost:3001/api/v1/notifications');
    console.log('✅ Server is responding');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ Server is responding (401 expected due to auth)');
    } else {
      console.log('❌ Server not responding:', error.message);
      return;
    }
  }
  
  try {
    // Test Swagger docs
    const swagger = await axios.get('http://localhost:3001/api/docs');
    console.log('✅ Swagger documentation is accessible');
  } catch (error) {
    console.log('❌ Swagger docs not accessible:', error.message);
  }
  
  // Test enhanced notification system compilation
  try {
    const { isFirebaseReady } = require('./dist/lib/firebase');
    console.log('✅ Firebase module loaded successfully');
    console.log('   Firebase ready:', isFirebaseReady());
  } catch (error) {
    console.log('❌ Firebase module error:', error.message);
  }
  
  try {
    const { notificationQueue } = require('./dist/lib/notification-queue');
    const metrics = notificationQueue.getMetrics();
    console.log('✅ Notification queue system loaded successfully');
    console.log('   Queue metrics:', JSON.stringify(metrics, null, 2));
  } catch (error) {
    console.log('❌ Notification queue error:', error.message);
  }
}

testBasicEndpoints().catch(console.error);