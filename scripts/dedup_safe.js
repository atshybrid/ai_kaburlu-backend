/**
 * dedup_safe.js — Safe duplicate finder and cleaner
 *
 * Checks:
 *   1. Duplicate Users (same normalized mobile → keep oldest active, reassign dependents)
 *   2. Duplicate Memberships (same user+seat, non-terminal → keep best, REVOKE rest)
 *   3. Orphaned PaymentIntents (PENDING > 45 min, same seat already has SUCCESS intent)
 *
 * Usage:
 *   node scripts/dedup_safe.js           ← dry-run (report only, NO changes)
 *   node scripts/dedup_safe.js --fix     ← actually apply cleanup
 *
 * Requires DATABASE_URL in .env / environment.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
require('dotenv-flow').config({ silent: true });

const IS_FIX = process.argv.includes('--fix');
const prisma = new PrismaClient();

// ─── helpers ────────────────────────────────────────────────────────────────

function normMobile(input) {
  const d = String(input || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('91') && d.length > 10) return d.slice(-10);
  if (d.startsWith('0') && d.length > 10) return d.slice(-10);
  return d.length > 10 ? d.slice(-10) : d;
}

const ROLE_PRIORITY = ['SUPER_ADMIN', 'HRCI_ADMIN', 'ADMIN', 'HRCI_MEMBER', 'MEMBER', 'CITIZEN_REPORTER', 'USER', 'GUEST'];
function rolePriority(name) {
  const i = ROLE_PRIORITY.indexOf(String(name || '').toUpperCase());
  return i === -1 ? 99 : i;
}

const STATUS_PRIORITY = ['ACTIVE', 'PENDING_APPROVAL', 'PENDING_PAYMENT', 'EXPIRED', 'REVOKED'];
function statusPriority(s) {
  const i = STATUS_PRIORITY.indexOf(String(s || ''));
  return i === -1 ? 99 : i;
}

function log(...args) { console.log(...args); }
function section(title) { log('\n' + '═'.repeat(60)); log(' ' + title); log('═'.repeat(60)); }

// ─── 1. Duplicate Users ──────────────────────────────────────────────────────

async function checkUserDuplicates() {
  section('1. DUPLICATE USERS (same normalized mobile)');

  const users = await prisma.user.findMany({
    where: { mobileNumber: { not: null } },
    select: { id: true, mobileNumber: true, status: true, roleId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleNameById = Object.fromEntries(roles.map(r => [r.id, r.name]));

  // Group by normalized mobile
  const groups = new Map();
  for (const u of users) {
    const key = normMobile(u.mobileNumber);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...u, roleName: roleNameById[u.roleId] || 'UNKNOWN' });
  }

  const dupes = [...groups.entries()].filter(([, arr]) => arr.length > 1);

  if (dupes.length === 0) {
    log('✓ No duplicate users found.');
    return [];
  }

  log(`⚠  Found ${dupes.length} mobile number(s) with multiple user accounts:\n`);

  const toDelete = []; // { keepId, deleteId, mobile }

  for (const [mobile, arr] of dupes) {
    // Sort: best role first, then oldest createdAt
    arr.sort((a, b) => {
      const rd = rolePriority(a.roleName) - rolePriority(b.roleName);
      if (rd !== 0) return rd;
      return a.createdAt - b.createdAt; // oldest = keep
    });

    const keep = arr[0];
    const remove = arr.slice(1);

    log(`  Mobile: ${mobile}`);
    log(`    KEEP   → userId=${keep.id}  role=${keep.roleName}  status=${keep.status}  createdAt=${keep.createdAt.toISOString()}`);
    for (const r of remove) {
      log(`    DELETE → userId=${r.id}  role=${r.roleName}  status=${r.status}  createdAt=${r.createdAt.toISOString()}`);
      toDelete.push({ keepId: keep.id, deleteId: r.id, mobile });
    }
  }

  if (!IS_FIX) {
    log(`\n  [DRY-RUN] Would merge/delete ${toDelete.length} duplicate user(s). Run with --fix to apply.`);
    return toDelete;
  }

  // --- Apply: reassign dependents then delete ---
  log(`\n  Applying ${toDelete.length} user merge(s)…`);
  for (const { keepId, deleteId, mobile } of toDelete) {
    log(`  Merging userId=${deleteId} → ${keepId} (mobile ${mobile})`);
    await prisma.$transaction(async (tx) => {
      const p = tx;
      // Reassign memberships
      await p.membership.updateMany({ where: { userId: deleteId }, data: { userId: keepId } }).catch(() => null);
      // Reassign user-profile (only if keepId has none yet)
      const keepProfile = await p.userProfile.findUnique({ where: { userId: keepId } }).catch(() => null);
      if (!keepProfile) {
        await p.userProfile.updateMany({ where: { userId: deleteId }, data: { userId: keepId } }).catch(() => null);
      } else {
        await p.userProfile.deleteMany({ where: { userId: deleteId } }).catch(() => null);
      }
      // Reassign devices
      await p.device.updateMany({ where: { userId: deleteId }, data: { userId: keepId } }).catch(() => null);
      // Null-out mobile on duplicate before delete (avoids unique constraint during delete)
      await p.user.update({ where: { id: deleteId }, data: { mobileNumber: `__deleted_${deleteId}` } }).catch(() => null);
      await p.user.delete({ where: { id: deleteId } }).catch(() => null);
    });
    log(`    ✓ Done.`);
  }

  return toDelete;
}

// ─── 2. Duplicate Memberships ────────────────────────────────────────────────

async function checkMembershipDuplicates() {
  section('2. DUPLICATE MEMBERSHIPS (same user + seat, non-terminal)');

  // Only look at non-terminal rows (duplicates that are both active/pending matter most)
  const rows = await prisma.membership.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL', 'PENDING_PAYMENT'] } },
    select: {
      id: true,
      userId: true,
      cellId: true,
      designationId: true,
      level: true,
      zone: true,
      hrcCountryId: true,
      hrcStateId: true,
      hrcDistrictId: true,
      hrcMandalId: true,
      status: true,
      seatSequence: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by user+seat-bucket
  const groups = new Map();
  for (const r of rows) {
    const key = [
      r.userId,
      r.cellId,
      r.designationId,
      r.level,
      r.zone || '',
      r.hrcCountryId || '',
      r.hrcStateId || '',
      r.hrcDistrictId || '',
      r.hrcMandalId || '',
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dupes = [...groups.entries()].filter(([, arr]) => arr.length > 1);

  if (dupes.length === 0) {
    log('✓ No duplicate memberships found.');
    return [];
  }

  log(`⚠  Found ${dupes.length} user+seat combination(s) with multiple active/pending memberships:\n`);

  const toRevoke = []; // membership ids to REVOKE

  for (const [key, arr] of dupes) {
    // Sort: best status first, then oldest createdAt
    arr.sort((a, b) => {
      const sd = statusPriority(a.status) - statusPriority(b.status);
      if (sd !== 0) return sd;
      return a.createdAt - b.createdAt;
    });

    const keep = arr[0];
    const revoke = arr.slice(1);

    log(`  Key: ${key}`);
    log(`    KEEP   → id=${keep.id}  status=${keep.status}  seat=${keep.seatSequence}  createdAt=${keep.createdAt.toISOString()}`);
    for (const r of revoke) {
      log(`    REVOKE → id=${r.id}  status=${r.status}  seat=${r.seatSequence}  createdAt=${r.createdAt.toISOString()}`);
      toRevoke.push(r);
    }
  }

  if (!IS_FIX) {
    log(`\n  [DRY-RUN] Would revoke ${toRevoke.length} duplicate membership(s). Run with --fix to apply.`);
    return toRevoke;
  }

  // --- Apply: REVOKE duplicates and bump seatSequence out of range ---
  log(`\n  Revoking ${toRevoke.length} duplicate membership(s)…`);
  for (const r of toRevoke) {
    await prisma.$transaction(async (tx) => {
      const p = tx;
      // Find max seatSequence in the bucket to bump above range
      const desig = await p.designation.findUnique({ where: { id: r.designationId }, select: { defaultCapacity: true } }).catch(() => null);
      const capacity = desig?.defaultCapacity || 0;
      const maxRow = await p.membership.aggregate({
        where: {
          cellId: r.cellId,
          designationId: r.designationId,
          level: r.level,
          zone: r.zone ?? null,
          hrcCountryId: r.hrcCountryId ?? null,
          hrcStateId: r.hrcStateId ?? null,
          hrcDistrictId: r.hrcDistrictId ?? null,
          hrcMandalId: r.hrcMandalId ?? null,
        },
        _max: { seatSequence: true },
      });
      const bumpedSeat = Math.max((maxRow._max.seatSequence || 0) + 1, capacity + 1, 1);
      await p.membership.update({
        where: { id: r.id },
        data: { status: 'REVOKED', revokedAt: new Date(), seatSequence: bumpedSeat, idCardStatus: 'REVOKED' },
      });
      await p.iDCard.updateMany({ where: { membershipId: r.id }, data: { status: 'REVOKED' } }).catch(() => null);
    });
    log(`    ✓ Revoked membershipId=${r.id}`);
  }

  return toRevoke;
}

// ─── 3. Orphaned PaymentIntents ───────────────────────────────────────────────

async function checkOrphanedIntents() {
  section('3. ORPHANED PAYMENT INTENTS (PENDING > 45 min, same seat already SUCCESS)');

  const cutoff = new Date(Date.now() - 45 * 60 * 1000);

  const stale = await (prisma).paymentIntent.findMany({
    where: {
      status: 'PENDING',
      membershipId: null,
      intentType: 'MEMBERSHIP',
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      cellCodeOrName: true,
      designationCode: true,
      level: true,
      zone: true,
      hrcCountryId: true,
      hrcStateId: true,
      hrcDistrictId: true,
      hrcMandalId: true,
      amount: true,
      createdAt: true,
      meta: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (stale.length === 0) {
    log('✓ No orphaned PENDING payment intents found.');
    return [];
  }

  // For each stale intent, check if a SUCCESS intent for same seat exists
  const toExpire = [];

  for (const intent of stale) {
    const successExists = await (prisma).paymentIntent.findFirst({
      where: {
        status: 'SUCCESS',
        cellCodeOrName: intent.cellCodeOrName,
        designationCode: intent.designationCode,
        level: intent.level,
        zone: intent.zone ?? null,
        hrcCountryId: intent.hrcCountryId ?? null,
        hrcStateId: intent.hrcStateId ?? null,
        hrcDistrictId: intent.hrcDistrictId ?? null,
        hrcMandalId: intent.hrcMandalId ?? null,
        id: { not: intent.id },
      },
    });

    if (successExists) {
      toExpire.push(intent);
      log(`  EXPIRE → intentId=${intent.id}  seat=${intent.level}/${intent.designationCode}  age=${Math.round((Date.now() - intent.createdAt) / 60000)}min`);
      log(`           (SUCCESS intent ${successExists.id} already exists for same seat)`);
    }
  }

  // Also find intents > 7 days old with no linked membership (abandoned, no SUCCESS peer)
  const veryStale = await (prisma).paymentIntent.findMany({
    where: {
      status: 'PENDING',
      membershipId: null,
      intentType: 'MEMBERSHIP',
      createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, createdAt: true, level: true, designationCode: true },
  });
  for (const intent of veryStale) {
    if (!toExpire.find(x => x.id === intent.id)) {
      toExpire.push(intent);
      log(`  EXPIRE → intentId=${intent.id}  seat=${intent.level}/${intent.designationCode}  age=${Math.round((Date.now() - intent.createdAt) / (24 * 60 * 60 * 1000))}days (abandoned, >7 days)`);
    }
  }

  if (toExpire.length === 0) {
    log('✓ No orphaned intents to expire.');
    return [];
  }

  log(`\n  Total intents to EXPIRE: ${toExpire.length}`);

  if (!IS_FIX) {
    log(`  [DRY-RUN] Would expire ${toExpire.length} intent(s). Run with --fix to apply.`);
    return toExpire;
  }

  const ids = toExpire.map(i => i.id);
  const { count } = await (prisma).paymentIntent.updateMany({
    where: { id: { in: ids } },
    data: { status: 'EXPIRED' },
  });
  log(`  ✓ Expired ${count} intent(s).`);

  return toExpire;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log('╔══════════════════════════════════════════════════════════╗');
  log(`║  dedup_safe.js  ${IS_FIX ? '⚡ FIX MODE  (changes WILL be applied) ' : '🔍 DRY-RUN  (no changes, report only)  '}║`);
  log('╚══════════════════════════════════════════════════════════╝');

  if (IS_FIX) {
    log('\n  ⚠  WARNING: This will modify the database.');
    log('     A manual DB backup before running --fix is strongly recommended.');
    log('     Sleeping 5 seconds — press Ctrl+C to cancel…\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  const userDupes   = await checkUserDuplicates();
  const memDupes    = await checkMembershipDuplicates();
  const intentDupes = await checkOrphanedIntents();

  section('SUMMARY');
  log(`  Duplicate users found   : ${IS_FIX ? `${userDupes.length} merged/deleted` : `${userDupes.length} (run --fix to merge)`}`);
  log(`  Duplicate memberships   : ${IS_FIX ? `${memDupes.length} revoked` : `${memDupes.length} (run --fix to revoke)`}`);
  log(`  Orphaned intents        : ${IS_FIX ? `${intentDupes.length} expired` : `${intentDupes.length} (run --fix to expire)`}`);

  if (!IS_FIX && (userDupes.length || memDupes.length || intentDupes.length)) {
    log('\n  Run:  node scripts/dedup_safe.js --fix  to apply cleanup.');
  } else if (IS_FIX) {
    log('\n  ✓ All cleanup applied successfully.');
  } else {
    log('\n  ✓ Database is clean.');
  }
  log('');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
