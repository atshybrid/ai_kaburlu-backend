// Ensures dependencies are installed before building (useful on CI/Render when install step is skipped)
const fs = require('fs');
const { execSync } = require('child_process');

try {
  // Always run npm ci in CI/Render to ensure new deps (like pdf-lib) are installed and lockfile is honored
  console.log('[ensureInstall] running npm ci to sync dependencies with lockfile...');
  execSync('npm ci', { stdio: 'inherit' });
} catch (e) {
  console.error('[ensureInstall] Failed to install dependencies:', e && e.message);
  process.exit(1);
}
