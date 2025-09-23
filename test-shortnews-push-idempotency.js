#!/usr/bin/env node
/**
 * Idempotency test for ShortNews push notifications.
 * Requires server running with env ENABLE_INTERNAL_TEST_ROUTES=1 and a valid JWT.
 * Steps:
 * 1. Create ShortNews (AI_APPROVED path may trigger notification) -> capture initial log count
 * 2. Call /shortnews/:id/notify (no force) -> expect no increment
 * 3. Call /shortnews/:id/notify?force=1 -> expect increment by +1
 * 4. Dry-run -> expect no increment and dryRun=true
 * Exits non-zero on assertion failure.
 */
const axios = require('axios');

const API = process.env.API_BASE || 'http://localhost:3001/api/v1';
const TOKEN = process.env.TEST_JWT;
const CATEGORY_ID = process.env.TEST_CATEGORY_ID; // Must exist

if (!TOKEN) {
  console.error('Missing TEST_JWT env var');
  process.exit(1);
}
if (!CATEGORY_ID) {
  console.error('Missing TEST_CATEGORY_ID env var');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function getLogCount(id) {
  const r = await axios.get(`${API}/internal/push-logs/shortnews/${id}`, { headers }).catch(e => ({ error: e }));
  if (r.error) throw new Error('Failed to fetch logs: ' + (r.error.response?.data?.error || r.error.message));
  return r.data.count;
}

async function main() {
  console.log('Creating ShortNews...');
  const createRes = await axios.post(`${API}/shortnews`, {
    title: 'Idem Test ' + Date.now(),
    content: 'Content small for idem test',
    categoryId: CATEGORY_ID,
    latitude: 17.4,
    longitude: 78.5
  }, { headers }).catch(e => ({ error: e }));
  if (createRes.error) {
    console.error('Create failed:', createRes.error.response?.data || createRes.error.message);
    process.exit(1);
  }
  const sn = createRes.data.data;
  const id = sn.id;
  console.log('ShortNews created', id, 'status=', sn.status);

  let c1 = await getLogCount(id).catch(()=>0);
  console.log('Initial log count:', c1);

  console.log('Notify without force (should not increase)');
  await axios.post(`${API}/shortnews/${id}/notify`, {}, { headers }).catch(e => ({ error: e }));
  let c2 = await getLogCount(id).catch(()=>0);
  if (c2 !== c1) {
    console.error('Idempotency failed: count changed after non-force notify', { before: c1, after: c2 });
    process.exit(1);
  }
  console.log('Idempotent OK (no change)');

  console.log('Notify with force=1 (should increase by 1)');
  await axios.post(`${API}/shortnews/${id}/notify?force=1`, {}, { headers }).catch(e => ({ error: e }));
  let c3 = await getLogCount(id).catch(()=>0);
  if (c3 !== c2 + 1) {
    console.error('Force resend failed: expected increment by 1', { before: c2, after: c3 });
    process.exit(1);
  }
  console.log('Force resend OK (increment observed)');

  console.log('Dry-run (should not change)');
  await axios.post(`${API}/shortnews/${id}/notify?dryRun=1`, {}, { headers }).catch(e => ({ error: e }));
  let c4 = await getLogCount(id).catch(()=>0);
  if (c4 !== c3) {
    console.error('Dry-run changed log count unexpectedly', { before: c3, after: c4 });
    process.exit(1);
  }
  console.log('Dry-run OK');

  console.log('All idempotency checks passed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
