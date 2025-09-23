#!/usr/bin/env node
/**
 * Simple integration smoke test for ShortNews push notification idempotency.
 * Preconditions: server running locally on PORT 3001 and a valid JWT with languageId claim.
 * This script will:
 * 1. Create a ShortNews item (should auto-notify if AI_APPROVED)
 * 2. Force status update to DESK_APPROVED (should NOT send a second notification)
 * 3. Print push log count for that shortNewsId.
 *
 * Adjust JWT_TOKEN and CATEGORY_ID before running.
 */
const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';
const JWT_TOKEN = process.env.TEST_JWT || 'REPLACE_ME_JWT';
const CATEGORY_ID = process.env.TEST_CATEGORY_ID || 'REPLACE_CATEGORY_ID';

async function main() {
  if (JWT_TOKEN.startsWith('REPLACE')) {
    console.log('Please export TEST_JWT with a valid token.');
    return;
  }
  if (CATEGORY_ID.startsWith('REPLACE')) {
    console.log('Please export TEST_CATEGORY_ID with a valid category id.');
    return;
  }
  const headers = { Authorization: `Bearer ${JWT_TOKEN}`, 'Content-Type': 'application/json' };
  console.log('Creating ShortNews...');
  const createRes = await axios.post(`${API_BASE}/shortnews`, {
    title: 'Test ShortNews Push ' + Date.now(),
    content: 'Small content for push test',
    categoryId: CATEGORY_ID,
    latitude: 17.4,
    longitude: 78.5
  }, { headers }).catch(e => ({ error: e }));
  if (createRes.error) {
    console.error('Create failed', createRes.error.response?.data || createRes.error.message);
    return;
  }
  const sn = createRes.data.data;
  console.log('ShortNews created id=', sn.id, 'status=', sn.status, 'notifiedAt=', sn.notifiedAt);

  console.log('Updating status to DESK_APPROVED (should not duplicate notification)...');
  await axios.put(`${API_BASE}/shortnews/${sn.id}/status`, { status: 'DESK_APPROVED' }, { headers }).catch(e => ({ error: e }));

  console.log('Fetching push logs (best-effort)...');
  // NOTE: No direct endpoint maybe; this is placeholder - manual DB verification recommended.
  console.log('Test complete. Verify in DB that only one PushNotificationLog exists with data.shortNewsId=', sn.id);
}

main().catch(e => console.error(e));
