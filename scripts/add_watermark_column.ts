/**
 * Ensures the IdCardSetting table has a watermarkLogoUrl column and optionally
 * sets a default value if the active setting does not have one.
 * Safe to run multiple times (idempotent) and will not drop or modify existing data.
 *
 * Usage (PowerShell):
 *   $Env:DATABASE_URL='<your prod url>'
 *   npx ts-node scripts/add_watermark_column.ts --default=https://yourcdn/watermark.png
 */
import 'dotenv-flow/config';
import '../src/config/env'; // normalize DATABASE_URL if ENV_TYPE provided
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function ensureWatermarkColumn(defaultUrl?: string) {
  // 1. Check column existence using information_schema
  const exists = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_name='IdCardSetting' AND column_name='watermarkLogoUrl'"
  );

  if (!exists.length) {
    console.log('[watermark] Column missing. Adding watermarkLogoUrl TEXT ...');
    try {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "IdCardSetting" ADD COLUMN "watermarkLogoUrl" TEXT'
      );
      console.log('[watermark] Column added.');
    } catch (e: any) {
      console.error('[watermark] Failed to add column:', e?.message || e);
      throw e;
    }
  } else {
    console.log('[watermark] Column already exists.');
  }

  // 2. Fetch active setting
  const active = await (prisma as any).idCardSetting.findFirst({ where: { isActive: true } }).catch(() => null);
  if (!active) {
    console.log('[watermark] No active IdCardSetting row found; nothing to update.');
    return;
  }

  // 3. Populate if empty & default supplied
  if (defaultUrl && !active.watermarkLogoUrl) {
    console.log('[watermark] Updating active setting with default watermark URL');
    await (prisma as any).idCardSetting.update({
      where: { id: active.id },
      data: { watermarkLogoUrl: defaultUrl }
    });
    console.log('[watermark] Updated.');
  } else if (!active.watermarkLogoUrl) {
    console.log('[watermark] Active setting has empty watermarkLogoUrl and no --default provided. Skipping update.');
  } else {
    console.log('[watermark] Active setting already has watermarkLogoUrl:', active.watermarkLogoUrl);
  }
}

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL not set. Set $Env:DATABASE_URL before running.');
      process.exit(1);
    }
    const argDefault = process.argv.find(a => a.startsWith('--default='));
    const defUrl = argDefault ? argDefault.split('=')[1] : undefined;
    console.log('[watermark] Using DATABASE_URL prefix:', String(process.env.DATABASE_URL).slice(0, 60) + '...');
    await ensureWatermarkColumn(defUrl);
  } catch (e) {
    console.error('[watermark] Fatal error:', (e as any)?.message || e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
