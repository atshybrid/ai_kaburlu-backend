/*
  Daily Postgres backup (non-destructive).

  - Uses pg_dump (must be available in PATH)
  - Writes gzip-compressed .sql.gz files into BACKUP_DIR (default: ./backups)
  - Rotates backups older than BACKUP_RETENTION_DAYS (default: 7)

  Env:
    DATABASE_URL               (required)
    BACKUP_DIR                 (optional)
    BACKUP_RETENTION_DAYS      (optional, default 7)
    BACKUP_PREFIX              (optional, default "db")

  Usage:
    node scripts/backup_db.js
*/

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');

// Load .env / .env.local etc for scripts
require('dotenv-flow').config({ silent: true });

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rotateBackups(dir, prefix, retentionDays) {
  const now = Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix + '_')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  return removed;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 1;
    return;
  }

  const backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
  const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 7));
  const prefix = process.env.BACKUP_PREFIX || 'db';

  ensureDir(backupDir);

  const outName = `${prefix}_${timestamp()}.sql.gz`;
  const outPath = path.join(backupDir, outName);

  console.log(`[backup] Starting pg_dump -> ${outPath}`);

  // Stream pg_dump output and gzip it to disk.
  const dump = spawn('pg_dump', [
    `--dbname=${databaseUrl}`,
    '--no-owner',
    '--no-privileges',
    '--format=plain',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  dump.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const gzip = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(outPath);

  dump.stdout.pipe(gzip).pipe(out);

  await new Promise((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`pg_dump exited with code ${code}. ${stderr || ''}`.trim()));
    });
  }).catch((e) => {
    try { fs.unlinkSync(outPath); } catch {}
    throw e;
  });

  const removed = rotateBackups(backupDir, prefix, retentionDays);
  console.log(`[backup] Done. Rotated ${removed} old backup(s).`);
}

main().catch((e) => {
  console.error('[backup] FAILED:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
