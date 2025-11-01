require('dotenv-flow').config();
import '../src/config/env';
import { sendShortNewsApprovedNotification } from '../src/api/shortnews/shortnews.notifications';

async function main() {
  const id = process.argv[2] || process.env.SN_ID;
  const mode = (process.argv[3] || process.env.MODE || 'dry').toLowerCase();
  if (!id) {
    console.log('Usage: npx ts-node scripts/debug_shortnews_push.ts <shortNewsId> [dry|send]');
    process.exit(1);
  }
  const dryRun = mode !== 'send';
  const res = await sendShortNewsApprovedNotification(String(id), { dryRun, force: dryRun });
  console.log('[shortnews:push]', JSON.stringify(res, null, 2));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
