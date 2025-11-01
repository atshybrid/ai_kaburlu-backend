// Directly update a membership's designation/cell/level/location in the database.
// WARNING: This bypasses capacity, pricing, and payment logic. Use with caution.
// Usage (PowerShell):
//   node scripts/direct_update_membership.js --membershipId=<id> --designationId=<id> --cellId=<id> --level=ZONE --zone=SOUTH
//   node scripts/direct_update_membership.js --membershipId=<id> --designationId=<id> --cellId=<id> --level=STATE --hrcStateId=<id>

try { require('dotenv-flow').config(); } catch {}
// Minimal env normalization like src/config/env
const envType = String(process.env.ENV_TYPE || process.env.NODE_ENV || 'development').toLowerCase();
const isProd = envType === 'prod' || envType === 'production';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = isProd
    ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseArgs() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        const k = a.slice(2, eq);
        const v = a.slice(eq + 1);
        out[k] = v;
      } else {
        const k = a.slice(2);
        const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        out[k] = v;
      }
    }
  }
  return out;
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

(async () => {
  const args = parseArgs();
  const { membershipId, designationId, cellId, level, zone, hrcCountryId, hrcStateId, hrcDistrictId, hrcMandalId } = args;
  if (!membershipId) die('membershipId is required');
  if (!designationId) die('designationId is required');
  // cellId/level/location are optional; if omitted, preserve existing membership values

  console.log('DB URL prefix:', String(process.env.DATABASE_URL || '').slice(0, 50) + '...');
  console.log('Applying direct update (bypassing capacity checks)...');

  const result = await prisma.$transaction(async (tx) => {
    const m = await tx.membership.findUnique({ where: { id: String(membershipId) } });
    if (!m) die('Membership not found');
    // Resolve target cell/level/geo from args or existing membership
    const targetCellId = String(cellId || m.cellId);
    const cell = await tx.cell.findUnique({ where: { id: targetCellId } });
    if (!cell) die('Cell not found by cellId');
    const desig = await tx.designation.findUnique({ where: { id: String(designationId) } });
    if (!desig) die('Designation not found by designationId');

    const lvl = String(level || m.level).toUpperCase();
    const targetZone = lvl === 'ZONE' ? (zone ?? m.zone ?? null) : null;
    const targetCountryId = lvl === 'NATIONAL' ? (hrcCountryId ?? m.hrcCountryId ?? null) : null;
    const targetStateId = lvl === 'STATE' ? (hrcStateId ?? m.hrcStateId ?? null) : null;
    const targetDistrictId = lvl === 'DISTRICT' ? (hrcDistrictId ?? m.hrcDistrictId ?? null) : null;
    const targetMandalId = lvl === 'MANDAL' ? (hrcMandalId ?? m.hrcMandalId ?? null) : null;

    // Build target bucket (exclude current membership for seatSequence computation)
    const whereBase = {
      cellId: cell.id,
      designationId: desig.id,
      level: lvl,
      status: { in: ['PENDING_PAYMENT','PENDING_APPROVAL','ACTIVE'] },
      NOT: { id: m.id }
    };
    if (lvl === 'ZONE') whereBase['zone'] = targetZone;
    if (lvl === 'NATIONAL') whereBase['hrcCountryId'] = targetCountryId;
    if (lvl === 'STATE') whereBase['hrcStateId'] = targetStateId;
    if (lvl === 'DISTRICT') whereBase['hrcDistrictId'] = targetDistrictId;
    if (lvl === 'MANDAL') whereBase['hrcMandalId'] = targetMandalId;

    const agg = await tx.membership.aggregate({ where: whereBase, _max: { seatSequence: true } });
    const nextSeat = (agg._max.seatSequence || 0) + 1;

    const updated = await tx.membership.update({
      where: { id: m.id },
      data: {
        cellId: cell.id,
        designationId: desig.id,
        level: lvl,
        zone: targetZone,
        hrcCountryId: targetCountryId,
        hrcStateId: targetStateId,
        hrcDistrictId: targetDistrictId,
        hrcMandalId: targetMandalId,
        seatSequence: nextSeat,
        // Keep existing status/paymentStatus untouched in direct mode
        lockedAt: new Date()
      }
    });
    return { updated, seatSequence: nextSeat };
  }, { timeout: 15000 });

  console.log('Updated membership:', {
    id: result.updated.id,
    cellId: result.updated.cellId,
    designationId: result.updated.designationId,
    level: result.updated.level,
    zone: result.updated.zone,
    hrcStateId: result.updated.hrcStateId,
    hrcDistrictId: result.updated.hrcDistrictId,
    hrcMandalId: result.updated.hrcMandalId,
    seatSequence: result.seatSequence,
    status: result.updated.status,
    paymentStatus: result.updated.paymentStatus
  });
})()
.catch((e) => {
  console.error('Direct update failed:', e && (e.message || e));
  process.exit(1);
})
.finally(async () => {
  await prisma.$disconnect();
});
