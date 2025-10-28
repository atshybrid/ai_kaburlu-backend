import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type MigrateMode = 'deploy' | 'push';

function shouldRun(): boolean {
  const v = String(process.env.PRISMA_MIGRATE_ON_START || '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function getMode(): MigrateMode {
  const raw = String(process.env.PRISMA_MIGRATE_MODE || '').trim().toLowerCase();
  return raw === 'push' ? 'push' : 'deploy';
}

function getTimeoutMs(): number {
  const ms = Number(process.env.PRISMA_MIGRATE_TIMEOUT_MS || 60000);
  return Number.isFinite(ms) && ms > 0 ? ms : 60000;
}

function failFatal(): boolean {
  const v = String(process.env.PRISMA_MIGRATE_FAIL_FATAL || '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function acceptDataLoss(): boolean {
  const v = String(process.env.PRISMA_MIGRATE_ACCEPT_DATA_LOSS || '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Optionally run Prisma schema sync on startup using CLI.
 * - deploy: `npx prisma migrate deploy` (recommended for production with migrations)
 * - push:   `npx prisma db push`      (useful for dev when no migrations are maintained)
 * Controlled by env:
 *   PRISMA_MIGRATE_ON_START=1|0 (default 0)
 *   PRISMA_MIGRATE_MODE=deploy|push (default deploy)
 *   PRISMA_MIGRATE_TIMEOUT_MS=60000
 *   PRISMA_MIGRATE_FAIL_FATAL=1|0 (default 0; if 1, throws on failure)
 */
export async function runPrismaMigrationsIfEnabled(): Promise<{ ran: boolean; ok: boolean; mode?: MigrateMode; output?: string; error?: string; fatal?: boolean }>
{
  if (!shouldRun()) {
    return { ran: false, ok: true };
  }

  const mode = getMode();
  const timeout = getTimeoutMs();

  const args = mode === 'push'
    ? ['prisma', 'db', 'push', ...(acceptDataLoss() ? ['--accept-data-loss'] : [])]
    : ['prisma', 'migrate', 'deploy'];
  const isWin = process.platform === 'win32';
  const npxCmd = isWin ? 'npx.cmd' : 'npx';

  try {
    console.log(`[prisma-migrate] Running: ${npxCmd} ${args.join(' ')} (timeout=${timeout}ms)`);
    const { stdout, stderr } = await execFileAsync(npxCmd, args, { timeout, windowsHide: true });
    if (stderr && stderr.trim()) {
      console.warn('[prisma-migrate] stderr:', stderr.trim());
    }
    console.log('[prisma-migrate] done');
    return { ran: true, ok: true, mode, output: stdout };
  } catch (e: any) {
    // Fallback: try running Prisma CLI JS directly via node
    try {
      const cli = require.resolve('prisma/build/index.js');
      const args2 = mode === 'push'
        ? ['db', 'push', ...(acceptDataLoss() ? ['--accept-data-loss'] : [])]
        : ['migrate', 'deploy'];
      console.log(`[prisma-migrate] Fallback: node ${cli} ${args2.join(' ')} (timeout=${timeout}ms)`);
      const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args2], { timeout, windowsHide: true });
      if (stderr && stderr.trim()) {
        console.warn('[prisma-migrate] stderr:', stderr.trim());
      }
      console.log('[prisma-migrate] done');
      return { ran: true, ok: true, mode, output: stdout };
    } catch (e2: any) {
      const message = e2?.stderr || e2?.stdout || e2?.message || String(e2);
      console.error('[prisma-migrate] failed:', message);
      if (failFatal()) {
        throw new Error(`Prisma migrate (${mode}) failed: ${message}`);
      }
      return { ran: true, ok: false, mode, error: message };
    }
  }
}
