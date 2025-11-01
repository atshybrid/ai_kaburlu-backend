// Ensures dependencies are installed before building.
// On CI/Render we want a clean install (npm ci). On local dev, skip heavy reinstall to avoid Windows EPERM
// issues (e.g., unlinking Prisma engines while in use) and speed up builds.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fileExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

const cwd = process.cwd();
const nodeModules = path.join(cwd, 'node_modules');
const lockFile = fileExists(path.join(cwd, 'package-lock.json'))
  ? 'package-lock.json'
  : (fileExists(path.join(cwd, 'npm-shrinkwrap.json')) ? 'npm-shrinkwrap.json' : null);

const isCI = (
  process.env.CI === 'true' ||
  process.env.RENDER === 'true' ||
  !!process.env.GITHUB_ACTIONS ||
  !!process.env.BUILDKITE ||
  !!process.env.HEROKU
);
const forceCIInstall = process.env.FORCE_CI_INSTALL === '1' || process.env.FORCE_INSTALL === '1';

try {
  if (isCI || forceCIInstall) {
    console.log('[ensureInstall] CI/forced environment detected → running: npm ci');
    execSync('npm ci', { stdio: 'inherit' });
  } else if (!fileExists(nodeModules)) {
    console.log('[ensureInstall] node_modules missing → running: npm install');
    execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
  } else {
    console.log('[ensureInstall] Local dev detected and node_modules present → skipping install');
    if (lockFile) {
      console.log(`[ensureInstall] Using lockfile: ${lockFile}`);
    }
  }
} catch (e) {
  console.error('[ensureInstall] Failed to install dependencies:', e && e.message);
  process.exit(1);
}
