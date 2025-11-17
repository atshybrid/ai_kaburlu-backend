import prisma from './prisma';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export interface WaitForPrismaOptions {
  attempts?: number; // total attempts
  delayMs?: number;  // delay between attempts
  verbose?: boolean; // log each failure
}

/**
 * Wait for the database to become reachable. Performs a lightweight raw SELECT 1
 * with retries. Resolves true if reachable within attempts, else false.
 */
export async function waitForPrisma(opts: WaitForPrismaOptions = {}): Promise<boolean> {
  const attempts = opts.attempts ?? Number(process.env.DB_WAIT_ATTEMPTS || 5);
  const delayMs = opts.delayMs ?? Number(process.env.DB_WAIT_DELAY_MS || 3000);
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return true;
    } catch (e: any) {
      if (opts.verbose) {
        console.warn(`[db-wait] attempt ${i}/${attempts} failed:`, e?.message || e);
      }
      if (i < attempts) await sleep(delayMs);
    }
  }
  return false;
}

/**
 * Ensure prisma connection is (re)established. If a connection error is detected,
 * try a disconnect + connect cycle before returning false.
 */
export async function ensurePrismaConnected(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return true; // connection OK
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("Can't reach database server") || msg.toLowerCase().includes('connection')) {
      try {
        await prisma.$disconnect().catch(() => {});
        await prisma.$connect();
        await prisma.$queryRawUnsafe('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}