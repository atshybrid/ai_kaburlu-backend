// Ensures dependencies are installed before building (useful on CI/Render when install step is skipped)
const fs = require('fs');
const { execSync } = require('child_process');

try {
  if (!fs.existsSync('node_modules')) {
    console.log('[ensureInstall] node_modules missing; running npm ci...');
    execSync('npm ci', { stdio: 'inherit' });
  } else {
    console.log('[ensureInstall] node_modules present');
  }
} catch (e) {
  console.error('[ensureInstall] Failed to install dependencies:', e && e.message);
  process.exit(1);
}
