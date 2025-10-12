/**
 * Quick demo script to exercise new membership endpoints.
 * Usage: ts-node scripts/demo_membership_api.ts (ensure server running on PORT or default 3000)
 */
// Using global fetch (Node 18+). No external node-fetch dependency required.

const base = `http://localhost:${process.env.PORT || 3000}/api/v1/memberships`;

async function run() {
  try {
    // Example availability query (adjust parameters as needed)
    const availabilityRes = await fetch(`${base}/availability?designationId=PRESIDENT&level=NATIONAL`);
    const availability = await availabilityRes.json();
    console.log('Availability response:', availability);

    // Example join attempt (adjust userId, designationId, level)
    const joinRes = await fetch(`${base}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-demo-1', designationId: 'PRESIDENT', level: 'NATIONAL' })
    });
    const join = await joinRes.json();
    console.log('Join response:', join);
  } catch (e: any) {
    console.error('Demo script failed:', e?.message);
  }
}

run();
