import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

function shouldRun() {
  const v = String(process.env.SEED_ON_START || '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function getTimeoutMs() {
  const ms = Number(process.env.SEED_TIMEOUT_MS || 120000);
  return Number.isFinite(ms) && ms > 0 ? ms : 120000;
}

function failFatal() {
  const v = String(process.env.SEED_FAIL_FATAL || '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

type SeedRunner = 'script' | 'npm';

function getRunner(): SeedRunner {
  const v = String(process.env.SEED_RUNNER || 'script').trim().toLowerCase();
  return v === 'npm' ? 'npm' : 'script';
}

function isTs(file: string) { return file.endsWith('.ts') || file.endsWith('.tsx'); }
function isJs(file: string) { return file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs'); }

function toDistScriptPath(scriptPath: string) {
  // Map scripts/foo.ts -> dist/scripts/foo.js
  const normalized = scriptPath.replace(/^\.\//, '');
  const jsName = normalized.replace(/\.tsx?$/, '.js');
  const distPath = path.join(process.cwd(), 'dist', jsName);
  return distPath;
}

export async function runSeedsIfEnabled(): Promise<{ ran: boolean; ok: boolean; output?: string; error?: string; details?: any }>
{
  if (!shouldRun()) return { ran: false, ok: true };

  const isWin = process.platform === 'win32';
  const timeout = getTimeoutMs();
  const runner = getRunner();

  try {
    if (runner === 'npm') {
      const scriptName = String(process.env.SEED_NPM_SCRIPT || '').trim();
      if (!scriptName) throw new Error('SEED_NPM_SCRIPT not set');
      const npmCmd = isWin ? 'npm.cmd' : 'npm';
      console.log(`[seed] Running npm script: ${scriptName}`);
      const { stdout, stderr } = await execFileAsync(npmCmd, ['run', scriptName], { timeout, windowsHide: true });
      if (stderr && stderr.trim()) console.warn('[seed] stderr:', stderr.trim());
      console.log('[seed] done');
      return { ran: true, ok: true, output: stdout, details: { runner: 'npm', scriptName } };
    }

    // runner === 'script'
    const scriptPath = String(process.env.SEED_SCRIPT || '').trim() || 'scripts/seed.js';
    let execCmd = process.execPath; // node
    let execArgs: string[] = [];
    let tried: any[] = [];

    // Attempt running compiled JS under dist
    if (isTs(scriptPath) || scriptPath.startsWith('scripts/')) {
      const distPath = toDistScriptPath(scriptPath);
      tried.push({ attempt: 'dist-js', path: distPath });
      if (fs.existsSync(distPath)) {
        execArgs = [distPath];
        console.log(`[seed] Running node ${distPath}`);
        const { stdout, stderr } = await execFileAsync(execCmd, execArgs, { timeout, windowsHide: true });
        if (stderr && stderr.trim()) console.warn('[seed] stderr:', stderr.trim());
        console.log('[seed] done');
        return { ran: true, ok: true, output: stdout, details: { runner: 'script', path: distPath } };
      }
    }

    // If a direct JS path is provided, try it as-is
    if (isJs(scriptPath) && fs.existsSync(scriptPath)) {
      tried.push({ attempt: 'direct-js', path: scriptPath });
      execArgs = [scriptPath];
      console.log(`[seed] Running node ${scriptPath}`);
      const { stdout, stderr } = await execFileAsync(execCmd, execArgs, { timeout, windowsHide: true });
      if (stderr && stderr.trim()) console.warn('[seed] stderr:', stderr.trim());
      console.log('[seed] done');
      return { ran: true, ok: true, output: stdout, details: { runner: 'script', path: scriptPath } };
    }

    // If TS path provided and dist not found, fallback to ts-node
    if (isTs(scriptPath)) {
      try {
        const tsNode = isWin ? 'npx.cmd' : 'npx';
        console.log(`[seed] Fallback: ${tsNode} ts-node ${scriptPath}`);
        const { stdout, stderr } = await execFileAsync(tsNode, ['ts-node', scriptPath], { timeout, windowsHide: true });
        if (stderr && stderr.trim()) console.warn('[seed] stderr:', stderr.trim());
        console.log('[seed] done');
        return { ran: true, ok: true, output: stdout, details: { runner: 'ts-node', path: scriptPath } };
      } catch (e: any) {
        tried.push({ attempt: 'ts-node', path: scriptPath, error: e?.message });
        throw e;
      }
    }

    throw new Error(`Seed script not found or not executable. Tried: ${JSON.stringify(tried)}`);
  } catch (e: any) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    console.error('[seed] failed:', msg);
    if (failFatal()) throw new Error(`Seed failed: ${msg}`);
    return { ran: true, ok: false, error: msg };
  }
}
