const fs = require('fs');

// Test Node.js fetch for watermark URL
fetch('https://pub-b13a983e33694dbd96cd42158ce2147b.r2.dev/hrci_watermark.svg')
  .then(r => { console.log('fetch status:', r.status, r.ok, 'content-type:', r.headers.get('content-type')); })
  .catch(e => { console.error('fetch error:', e.message, e.cause?.message); });

