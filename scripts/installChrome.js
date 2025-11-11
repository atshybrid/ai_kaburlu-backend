#!/usr/bin/env node

/**
 * Chrome installer script for production deployments
 * Ensures Chrome/Chromium is available for Puppeteer
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up Chrome for Puppeteer...');

// Check if we're in a production environment
const isProduction = process.env.NODE_ENV === 'production';
const isRenderDeploy = process.env.RENDER === 'true';
const skipDownload = process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true';

if (skipDownload) {
  console.log('⏭️  Puppeteer Chrome download skipped (PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true)');
  return;
}

try {
  // First, try to install Chrome via Puppeteer
  console.log('📦 Installing Chrome via Puppeteer...');
  execSync('npx puppeteer browsers install chrome', { 
    stdio: 'inherit',
    timeout: 300000 // 5 minutes timeout
  });
  
  console.log('✅ Chrome installation completed successfully');
  
  // Verify Chrome is available
  const { execFileSync } = require('child_process');
  
  const chromePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Also check Puppeteer's cache
    path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome')
  ];
  
  let chromeFound = false;
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      console.log(`✅ Chrome found at: ${chromePath}`);
      chromeFound = true;
      break;
    }
  }
  
  if (!chromeFound) {
    console.log('⚠️  Chrome not found in common paths, but Puppeteer installation may have succeeded');
  }
  
  // Set environment variable for runtime
  if (isRenderDeploy && chromePaths.some(p => fs.existsSync(p))) {
    const foundPath = chromePaths.find(p => fs.existsSync(p));
    console.log(`🔗 Setting PUPPETEER_EXECUTABLE_PATH=${foundPath}`);
    // Note: This won't persist across process restarts, should be set in Render environment
  }
  
} catch (error) {
  console.error('❌ Error installing Chrome:', error.message);
  
  if (isProduction) {
    console.log('🚨 Production environment detected. Chrome installation failed.');
    console.log('💡 Consider setting PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true and installing Chrome via system packages.');
    console.log('💡 For Render, you can add a custom apt.txt file with: google-chrome-stable');
  }
  
  // Don't fail the build in production if Chrome install fails
  // The runtime will attempt to find system Chrome
  if (!isProduction) {
    process.exit(1);
  }
}