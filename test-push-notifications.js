#!/usr/bin/env node

/**
 * Test script for enhanced push notification system
 * 
 * This script tests:
 * 1. Firebase configuration validation
 * 2. Enhanced FCM service functionality  
 * 3. Notification queue system
 * 4. Analytics endpoints
 * 
 * Usage: node test-push-notifications.js [--skip-firebase] [--skip-queue] [--skip-analytics]
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api`;

// Test data
const TEST_USER_TOKEN = 'your-jwt-token-here'; // Replace with actual JWT token
const TEST_FCM_TOKEN = 'dummy-fcm-token-for-testing-purposes-this-is-a-long-token-that-meets-minimum-length-requirements-but-is-not-valid-for-actual-sending';
const TEST_NOTIFICATION = {
  title: 'Test Enhanced Notification',
  body: 'This is a test of the enhanced push notification system with comprehensive logging',
  data: {
    testId: 'enhanced-test-001',
    timestamp: new Date().toISOString(),
    source: 'test-script'
  }
};

// Helper function to make authenticated requests
async function makeRequest(method, endpoint, data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message,
      status: error.response?.status || 500
    };
  }
}

// Test Firebase configuration
async function testFirebaseConfig() {
  console.log('\n🔥 Testing Firebase Configuration...');
  
  const result = await makeRequest('GET', '/notifications/config/test');
  
  if (result.success) {
    console.log('✅ Firebase configuration test completed');
    console.log(`   Initialized: ${result.data.firebase.initialized}`);
    console.log(`   Project ID: ${result.data.firebase.projectId}`);
    console.log(`   Method: ${result.data.firebase.method}`);
    console.log(`   Messaging Available: ${result.data.firebase.messagingAvailable}`);
    
    if (result.data.firebase.errors.length > 0) {
      console.log('❌ Errors:');
      result.data.firebase.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    if (result.data.firebase.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      result.data.firebase.warnings.forEach(warning => console.log(`   - ${warning}`));
    }
    
    console.log('💡 Recommendations:');
    result.data.recommendations.forEach(rec => console.log(`   - ${rec}`));
    
    return result.data.firebase.initialized;
  } else {
    console.log(`❌ Firebase configuration test failed: ${result.error.message || result.error}`);
    return false;
  }
}

// Test enhanced notification sending
async function testEnhancedNotification() {
  console.log('\n📱 Testing Enhanced Notification Sending...');
  
  const testData = {
    tokens: [TEST_FCM_TOKEN],
    notification: TEST_NOTIFICATION,
    options: {
      priority: 'high',
      sourceController: 'test-script',
      sourceAction: 'enhanced-notification-test'
    }
  };
  
  const result = await makeRequest('POST', '/notifications/enhanced/tokens', testData);
  
  if (result.success) {
    console.log('✅ Enhanced notification test completed');
    console.log(`   Success: ${result.data.success}`);
    console.log(`   Log ID: ${result.data.logId}`);
    console.log(`   Success Count: ${result.data.successCount}`);
    console.log(`   Failure Count: ${result.data.failureCount}`);
    console.log(`   Total Targets: ${result.data.totalTargets}`);
    
    if (result.data.errors && result.data.errors.length > 0) {
      console.log('⚠️  Errors during sending:');
      result.data.errors.forEach(error => console.log(`   - ${error.error}`));
    }
    
    return result.data.logId;
  } else {
    console.log(`❌ Enhanced notification test failed: ${result.error.message || result.error}`);
    return null;
  }
}

// Test queue system
async function testQueueSystem() {
  console.log('\n🔄 Testing Notification Queue System...');
  
  // Generate test tokens
  const testTokens = Array.from({ length: 25 }, (_, i) => 
    `test-token-${i}-${Date.now()}-this-is-a-dummy-token-for-queue-testing-purposes-only-${Math.random().toString(36).substring(2)}`
  );
  
  const batchData = {
    tokens: testTokens,
    notification: {
      ...TEST_NOTIFICATION,
      title: 'Batch Test Notification',
      body: 'Testing the notification queue system with batch processing'
    },
    batchOptions: {
      batchSize: 10,
      batchDelay: 2000,
      priority: 'normal',
      maxRetries: 2
    }
  };
  
  // Create batch job
  const batchResult = await makeRequest('POST', '/notifications/queue/batch', batchData);
  
  if (batchResult.success) {
    console.log('✅ Batch job created successfully');
    console.log(`   Batch ID: ${batchResult.data.batchId}`);
    console.log(`   Total Jobs: ${batchResult.data.totalJobs}`);
    console.log(`   Total Targets: ${batchResult.data.totalTargets}`);
    
    const batchId = batchResult.data.batchId;
    const jobIds = batchResult.data.jobIds;
    
    // Wait a bit for processing
    console.log('   Waiting 5 seconds for processing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check batch status
    const statusResult = await makeRequest('GET', `/notifications/queue/batch/${batchId}`);
    
    if (statusResult.success) {
      console.log('✅ Batch status retrieved');
      console.log(`   Progress: ${statusResult.data.batch.progress}%`);
      console.log(`   Completed: ${statusResult.data.batch.completedJobs}`);
      console.log(`   Failed: ${statusResult.data.batch.failedJobs}`);
      console.log(`   Pending: ${statusResult.data.batch.pendingJobs}`);
      console.log(`   Processing: ${statusResult.data.batch.processingJobs}`);
    }
    
    // Check individual job status
    const jobResult = await makeRequest('GET', `/notifications/queue/status/${jobIds[0]}`);
    
    if (jobResult.success) {
      console.log('✅ Job status retrieved');
      console.log(`   Status: ${jobResult.data.job.status}`);
      console.log(`   Priority: ${jobResult.data.job.priority}`);
      console.log(`   Retry Count: ${jobResult.data.job.retryCount}`);
    }
    
    return batchId;
  } else {
    console.log(`❌ Queue system test failed: ${batchResult.error.message || batchResult.error}`);
    return null;
  }
}

// Test analytics endpoints
async function testAnalytics() {
  console.log('\n📊 Testing Analytics Endpoints...');
  
  // Get queue metrics
  const metricsResult = await makeRequest('GET', '/notifications/queue/metrics');
  
  if (metricsResult.success) {
    console.log('✅ Queue metrics retrieved');
    console.log(`   Total Jobs: ${metricsResult.data.metrics.totalJobs}`);
    console.log(`   Pending: ${metricsResult.data.metrics.pendingJobs}`);
    console.log(`   Processing: ${metricsResult.data.metrics.processingJobs}`);
    console.log(`   Completed: ${metricsResult.data.metrics.completedJobs}`);
    console.log(`   Failed: ${metricsResult.data.metrics.failedJobs}`);
    console.log(`   Avg Processing Time: ${metricsResult.data.metrics.averageProcessingTime}ms`);
    console.log(`   Throughput/min: ${metricsResult.data.metrics.throughputPerMinute}`);
  }
  
  // Get notification analytics (will likely be empty for fresh install)
  const analyticsResult = await makeRequest('GET', '/notifications/enhanced/analytics?period=day');
  
  if (analyticsResult.success) {
    console.log('✅ Notification analytics retrieved');
    console.log(`   Total Notifications: ${analyticsResult.data.analytics.totalNotifications}`);
    console.log(`   Delivery Rate: ${analyticsResult.data.analytics.deliveryRate}%`);
    console.log(`   Failure Rate: ${analyticsResult.data.analytics.failureRate}%`);
    console.log(`   Avg Delivery Time: ${analyticsResult.data.analytics.avgDeliveryTime}ms`);
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Enhanced Push Notification System Tests');
  console.log('='.repeat(60));
  
  const args = process.argv.slice(2);
  const skipFirebase = args.includes('--skip-firebase');
  const skipQueue = args.includes('--skip-queue');
  const skipAnalytics = args.includes('--skip-analytics');
  
  try {
    // Test Firebase configuration
    let firebaseReady = false;
    if (!skipFirebase) {
      firebaseReady = await testFirebaseConfig();
    }
    
    // Test enhanced notifications (only if Firebase is ready or skipped)
    if (firebaseReady || skipFirebase) {
      await testEnhancedNotification();
    } else {
      console.log('\n⚠️  Skipping enhanced notification test due to Firebase configuration issues');
    }
    
    // Test queue system
    if (!skipQueue) {
      await testQueueSystem();
    }
    
    // Test analytics
    if (!skipAnalytics) {
      await testAnalytics();
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Enhanced Push Notification System Tests Completed!');
    
    if (!firebaseReady && !skipFirebase) {
      console.log('\n⚠️  Firebase configuration needs attention for production use.');
      console.log('   Please check the Firebase configuration test results above.');
    }
    
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Handle missing JWT token
if (TEST_USER_TOKEN === 'your-jwt-token-here') {
  console.log('⚠️  WARNING: Using placeholder JWT token.');
  console.log('   Tests may fail with authentication errors.');
  console.log('   To get a real token:');
  console.log('   1. Use the login endpoint to get a JWT token');
  console.log('   2. Replace TEST_USER_TOKEN in this script');
  console.log('   3. Or run tests without authentication (if endpoints allow)');
  console.log('');
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});