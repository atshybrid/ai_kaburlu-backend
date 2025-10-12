// Cross-platform postbuild wrapper generator for Render compatibility
// Ensures `node dist/index.js` forwards to compiled ./src/index.js
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'dist');
const outFile = path.join(outDir, 'index.js');

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, "require('./src/index.js');\n", 'utf8');
  console.log('[postbuild] Wrote wrapper:', path.relative(process.cwd(), outFile));
} catch (e) {
  console.error('[postbuild] Failed to write wrapper:', e && e.message);
  process.exit(1);
}
