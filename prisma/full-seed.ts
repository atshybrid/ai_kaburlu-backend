// Convenience wrapper to run FULL_SEED without relying on PowerShell env syntax quirks
process.env.FULL_SEED = '1';
// Explicitly require TypeScript seed (avoid legacy seed.js)
require('./seed.ts');
