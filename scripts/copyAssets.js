// Copy non-code assets (templates, etc.) into dist so runtime can resolve them
const fs = require('fs');
const path = require('path');

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

try {
  const projectRoot = path.join(__dirname, '..');
  const srcTemplates = path.join(projectRoot, 'src', 'templates');
  const distTemplates = path.join(projectRoot, 'dist', 'src', 'templates');
  copyDir(srcTemplates, distTemplates);
  console.log('[copy:assets] Copied templates to', path.relative(projectRoot, distTemplates));
} catch (e) {
  console.error('[copy:assets] Failed:', e && e.message);
  process.exit(1);
}
