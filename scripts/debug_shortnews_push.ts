require('dotenv-flow').config();
import '../src/config/env';
import { sendShortNewsApprovedNotification } from '../src/api/shortnews/shortnews.notifications';

async function main() {
  const id = process.argv[2] || process.env.SN_ID;
  const argv = process.argv.slice(3).map((a) => String(a).toLowerCase());
  const mode = (argv.find((a) => a === 'dry' || a === 'send') || process.env.MODE || 'dry').toLowerCase();
  const force = argv.includes('force') || argv.includes('--force') || argv.includes('resend') || ['1','true','yes','on'].includes(String(process.env.FORCE || '').toLowerCase());
  const useTopics = argv.includes('topics') || argv.includes('--topics') || ['1','true','yes','on'].includes(String(process.env.USE_TOPICS || '').toLowerCase());
  if (!id) {
    console.log('Usage: npx ts-node scripts/debug_shortnews_push.ts <shortNewsId> [dry|send] [force] [topics]');
    process.exit(1);
  }
  const dryRun = mode !== 'send';
  const res = await sendShortNewsApprovedNotification(String(id), { dryRun, force: dryRun ? true : force, useTopics });
  console.log('[shortnews:push]', JSON.stringify(res, null, 2));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
