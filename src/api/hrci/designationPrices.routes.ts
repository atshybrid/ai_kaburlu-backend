import { Router } from 'express';
import multer from 'multer';
import prisma from '../../lib/prisma';
import csv from 'csv-parser';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type OrgLevel = 'NATIONAL'|'ZONE'|'STATE'|'DISTRICT'|'MANDAL';
type HrcZone = 'NORTH'|'SOUTH'|'EAST'|'WEST'|'CENTRAL'|undefined;

function norm(s: string) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }

// Simple normalized Levenshtein similarity in [0,1]
function similarity(a: string, b: string): number {
  const s = norm(a), t = norm(b);
  if (!s && !t) return 1;
  const m = s.length, n = t.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

function mapLevel(v?: string): OrgLevel | undefined {
  const s = (v || '').toUpperCase();
  if (s.startsWith('NATIONAL')) return 'NATIONAL';
  if (s.includes('ZONE')) return 'ZONE';
  if (s === 'STATE') return 'STATE';
  if (s === 'DISTRICT') return 'DISTRICT';
  if (s === 'MANDAL') return 'MANDAL';
  return undefined;
}

function mapZone(v?: string): HrcZone {
  const s = (v || '').toUpperCase();
  if (s.startsWith('SOUTH')) return 'SOUTH';
  if (s.startsWith('NORTH')) return 'NORTH';
  if (s.startsWith('EAST')) return 'EAST';
  if (s.startsWith('WEST')) return 'WEST';
  if (s.startsWith('CENTRAL')) return 'CENTRAL';
  return undefined;
}

function normalizeCell(name: string) {
  const n = (name || '').trim();
  const up = n.toUpperCase();
  if (up.includes('GENERAL')) return { code: 'GENERAL_BODY', name: 'General Body' };
  if (up.includes('WOMEN')) return { code: 'WOMEN_WING', name: 'Women Wing' };
  if (up.includes('YOUTH')) return { code: 'YOUTH_WING', name: 'Youth Wing' };
  return { code: up.replace(/\s+/g,'_'), name: n };
}

function codeFromName(name: string) { return (name || '').trim().toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,''); }

async function upsertCellByName(name: string) {
  const { code } = normalizeCell(name);
  const existing = await prisma.cell.findFirst({ where: { OR: [{ code }, { name }] } });
  if (existing) return existing;
  return await prisma.cell.create({ data: { code, name, description: name, isActive: true } });
}

async function upsertDesignationByName(name: string) {
  const code = codeFromName(name);
  const existing = await prisma.designation.findFirst({ where: { OR: [{ code }, { name }] } });
  if (existing) return existing;
  return await prisma.designation.create({ data: { code, name, defaultCapacity: 0, idCardFee: 0, validityDays: 365, orderRank: 0 } });
}

async function findFuzzyDesignation(name: string, threshold = 0.7) {
  const all = await prisma.designation.findMany({ select: { id: true, name: true, code: true } });
  let best = { score: 0, row: null as any };
  for (const row of all) {
    const score = Math.max(similarity(name, row.name as any), similarity(name, (row as any).code || ''));
    if (score > best.score) best = { score, row };
  }
  return best.score >= threshold ? best.row : null;
}

async function findFuzzyCell(name: string, threshold = 0.7) {
  const all = await prisma.cell.findMany({ select: { id: true, name: true, code: true } });
  let best = { score: 0, row: null as any };
  for (const row of all) {
    const score = Math.max(similarity(name, row.name as any), similarity(name, (row as any).code || ''));
    if (score > best.score) best = { score, row };
  }
  return best.score >= threshold ? best.row : null;
}

async function upsertPrice(designationId: string, cellId: string, level: OrgLevel, zone: HrcZone, fee: number, validityDays?: number, skipIfSame = true) {
  const where: any = { designationId, cellId, level, zone: zone || null, hrcStateId: null, hrcDistrictId: null, hrcMandalId: null };
  const existing = await prisma.designationPrice.findFirst({ where });
  if (existing) {
    const same = existing.fee === fee && (validityDays ?? null) === (existing.validityDays ?? null);
    if (skipIfSame && same) return { action: 'skipped', id: existing.id };
    await prisma.designationPrice.update({ where: { id: existing.id }, data: { fee, validityDays: validityDays ?? existing.validityDays, currency: 'INR', priority: 10 } });
    return { action: 'updated', id: existing.id };
  }
  const created = await prisma.designationPrice.create({ data: { ...where, fee, validityDays: validityDays ?? null, currency: 'INR', priority: 10 } });
  return { action: 'created', id: created.id };
}

/**
 * @swagger
 * /hrci/designation-prices:
 *   post:
 *     tags: [HRCI]
 *     summary: Upsert a single designation price (fuzzy + idempotent)
 *     description: |
 *       Creates or updates a DesignationPrice for a designation + cell + level (+ optional zone).
 *       Fuzzy matching (default 0.7) is used to find existing designations and cells.
 *       If an exact price exists with the same fee and validityDays, it is skipped.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [designationName, cellName, level, fee]
 *             properties:
 *               designationName:
 *                 type: string
 *                 example: General Secretary
 *               cellName:
 *                 type: string
 *                 example: Women Wing
 *               level:
 *                 type: string
 *                 enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL]
 *                 example: STATE
 *               zone:
 *                 type: string
 *                 enum: [NORTH, SOUTH, EAST, WEST, CENTRAL]
 *                 example: SOUTH
 *               fee:
 *                 type: number
 *                 example: 30000
 *               validityDays:
 *                 type: number
 *                 example: 730
 *               fuzzyThreshold:
 *                 type: number
 *                 example: 0.7
 *               createMissing:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Upsert result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     action: { type: string, enum: [created, updated, skipped] }
 *                     id: { type: string }
 *       400:
 *         description: Missing or invalid parameters
 *       500:
 *         description: Server error
 */
// Single upsert endpoint
router.post('/designation-prices', async (req, res) => {
  try {
    const { designationName, cellName, level, zone, fee, validityDays, fuzzyThreshold = 0.7, createMissing = true } = req.body || {};
    if (!designationName || !cellName || !level || fee == null) return res.status(400).json({ success: false, error: 'Missing required fields' });
    const lvl = mapLevel(level) as OrgLevel;
    if (!lvl) return res.status(400).json({ success: false, error: 'Invalid level' });
    const z = mapZone(zone);
    let desig = await findFuzzyDesignation(designationName, Number(fuzzyThreshold));
    if (!desig && createMissing) desig = await upsertDesignationByName(designationName);
    if (!desig) return res.status(404).json({ success: false, error: 'Designation not found (fuzzy match failed)' });
    let cell = await findFuzzyCell(cellName, Number(fuzzyThreshold));
    if (!cell && createMissing) cell = await upsertCellByName(cellName);
    if (!cell) return res.status(404).json({ success: false, error: 'Cell not found (fuzzy match failed)' });
    const result = await upsertPrice(desig.id, cell.id, lvl, z, Number(fee), validityDays != null ? Number(validityDays) : undefined);
    return res.json({ success: true, data: { ...result, designationId: desig.id, cellId: cell.id } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Failed to upsert price', message: e?.message });
  }
});

/**
 * @swagger
 * /hrci/designation-prices/upload:
 *   post:
 *     tags: [HRCI]
 *     summary: Bulk upload designation prices (CSV or Excel)
 *     description: |
 *       Upload a CSV or Excel file to create/update designation prices with fuzzy matching and idempotent updates.
 *       Supported columns:
 *       - Zone name, Cell name, Designation name, Number of post available, Parent name, ID Card Amount, Validity ID card in days
 *     parameters:
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           default: 0.7
 *         description: Fuzzy match threshold [0..1]
 *       - in: query
 *         name: dryRun
 *         schema:
 *           type: boolean
 *           default: false
 *         description: If true, parse but do not write to DB
 *       - in: query
 *         name: skipIfSame
 *         schema:
 *           type: boolean
 *           default: true
 *         description: If true, skip updates when fee/validity unchanged
 *       - in: query
 *         name: createMissing
 *         schema:
 *           type: boolean
 *           default: true
 *         description: If true, auto-create missing cells/designations
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Bulk result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 counts:
 *                   type: object
 *                   properties:
 *                     rows: { type: number }
 *                     created: { type: number }
 *                     updated: { type: number }
 *                     skipped: { type: number }
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       row: { type: object }
 *                       error: { type: string }
 *       400:
 *         description: No file uploaded
 *       500:
 *         description: Server error
 */
// Bulk upload via CSV/Excel
router.post('/designation-prices/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded (field name: file)' });
    const threshold = req.query.threshold ? Number(req.query.threshold) : 0.7;
    const dryRun = String(req.query.dryRun || 'false') === 'true';
    const skipIfSame = String(req.query.skipIfSame || 'true') === 'true';
    const createMissing = String(req.query.createMissing || 'true') === 'true';

    const rows: any[] = [];
    const mime = req.file.mimetype || '';
    if (mime.includes('spreadsheetml') || req.file.originalname.toLowerCase().endsWith('.xlsx')) {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const first = wb.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(wb.Sheets[first]);
        rows.push(...data);
      } catch (err: any) {
        return res.status(400).json({ success: false, error: 'Excel upload requires optional dependency "xlsx". Please install it or upload CSV instead.' });
      }
    } else {
      // CSV parse from memory
      await new Promise<void>((resolve, reject) => {
        const readable = new (require('stream').Readable)();
        readable._read = () => {};
        readable.push(req.file!.buffer);
        readable.push(null);
        readable
          .pipe(csv({ skipComments: true }))
          .on('data', (r: any) => rows.push(r))
          .on('end', resolve)
          .on('error', reject);
      });
    }

    let created = 0, updated = 0, skipped = 0, errors: any[] = [];
    // Small cache for lookups
    const desigCache: Record<string, any> = {};
    const cellCache: Record<string, any> = {};
    for (const r of rows) {
      try {
        const level = mapLevel(r['Zone name'] || r['Level']) || 'NATIONAL';
        const zone = mapZone(r['Zone name']);
        const cellName = r['Cell name'] || r['Cell'] || r['Wing'] || '';
        const desigName = r['Designation name'] || r['Designation'] || '';
        const feeRaw = r['ID Card Amount'] || r['Fee'] || r['Amount'];
        const validityRaw = r['Validity ID card in days'] || r['ValidityDays'];
        if (!cellName || !desigName || feeRaw == null) { skipped++; continue; }

        // Resolve designation
        let desig = desigCache[desigName];
        if (!desig) {
          desig = await findFuzzyDesignation(desigName, threshold);
          if (!desig && createMissing) desig = await upsertDesignationByName(desigName);
          if (!desig) { skipped++; continue; }
          desigCache[desigName] = desig;
        }
        // Resolve cell
        let cell = cellCache[cellName];
        if (!cell) {
          cell = await findFuzzyCell(cellName, threshold);
          if (!cell && createMissing) cell = await upsertCellByName(cellName);
          if (!cell) { skipped++; continue; }
          cellCache[cellName] = cell;
        }

        const fee = Number(String(feeRaw).trim());
        const validityDays = validityRaw != null && String(validityRaw).trim() !== '' ? Number(String(validityRaw).trim()) : undefined;
        if (!Number.isFinite(fee)) { skipped++; continue; }

        if (dryRun) { skipped++; continue; }
        const result = await upsertPrice(desig.id, cell.id, level as OrgLevel, zone, Math.round(fee), validityDays, skipIfSame);
        if (result.action === 'created') created++; else if (result.action === 'updated') updated++; else skipped++;
      } catch (e: any) {
        errors.push({ row: r, error: e?.message });
      }
    }

    return res.json({ success: true, counts: { rows: rows.length, created, updated, skipped }, errors });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Bulk upload failed', message: e?.message });
  }
});

/**
 * @swagger
 * /hrci/designation-prices/sample-csv:
 *   get:
 *     tags: [HRCI]
 *     summary: Download a sample CSV header for bulk upload
 *     responses:
 *       200:
 *         description: CSV header file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
// Optional: provide a sample header row
router.get('/designation-prices/sample-csv', (_req, res) => {
  const header = 'Zone name,Cell name,Designation name,Number of post available,Parent name,ID Card Amount,Validity ID card in days\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="designation_prices_sample.csv"');
  res.send(header);
});

export default router;
