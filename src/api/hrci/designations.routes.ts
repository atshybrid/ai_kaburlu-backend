import { Router } from 'express';
import prisma from '../../lib/prisma';
import multer from 'multer';
import csvParser from 'csv-parser';
import passport from 'passport';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: HRCI Geography & Organization APIs
 */

/**
 * @swagger
 * /hrci/designations:
 *   get:
 *     tags: [HRCI]
 *     summary: List designations
 *     description: Public endpoint to list designation templates.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Case-insensitive search by name or code
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           minimum: 1
 *           maximum: 200
 *     responses:
 *       200:
 *         description: Designations
 */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } }
      ];
    }
    const rows = await (prisma as any).designation.findMany({
      where,
      take: limit,
      orderBy: [{ orderRank: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, defaultCapacity: true, idCardFee: true, validityDays: true, orderRank: true }
    });
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Failed to list designations', message: e?.message });
  }
});

function isAdmin(user: any): boolean {
  const name = String(user?.role?.name || '').toUpperCase();
  return ['SUPERADMIN','SUPER_ADMIN','LANGUAGE_ADMIN','ADMIN','HRCI_ADMIN'].includes(name);
}

function requireAdmin(req: any, res: any, next: any) {
  if (isAdmin(req.user)) return next();
  return res.status(403).json({ success: false, error: 'Forbidden' });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * @swagger
 * /hrci/designations/{designationId}/prices/upload:
 *   post:
 *     tags: [HRCI]
 *     summary: Bulk upload fees for a designation by Cell + Level (+ optional geo) via CSV
 *     description: >-
 *       Admin-only. CSV must have columns: cell, level, fee.
 *       Optional: zone, hrcStateId, hrcDistrictId, hrcMandalId, validityDays, currency, priority.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: designationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Designation id or code
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
 *           encoding:
 *             file:
 *               contentType: text/csv
 *     responses:
 *       200:
 *         description: Upload summary
 */
router.post(
  '/:designationId/prices/upload',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  upload.single('file'),
  async (req: any, res) => {
    try {
      const { designationId } = req.params;
      if (!req.file) return res.status(400).json({ success: false, error: 'FILE_REQUIRED' });

      // Resolve designation by id or code
      const designation = await (prisma as any).designation.findFirst({
        where: { OR: [ { id: String(designationId) }, { code: String(designationId) } ] },
        select: { id: true }
      });
      if (!designation) return res.status(404).json({ success: false, error: 'DESIGNATION_NOT_FOUND' });

      const rows: any[] = [];
      // Parse CSV from buffer
      await new Promise<void>((resolve, reject) => {
        const stream = csvParser();
        stream.on('data', (row: any) => rows.push(row));
        stream.on('end', () => resolve());
        stream.on('error', (err: any) => reject(err));
        stream.write(req.file.buffer);
        stream.end();
      });

      const normalize = (v: any) => (v == null ? undefined : String(v).trim());
      const toInt = (v: any) => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) ? Math.round(n) : undefined;
      };
      const toUpper = (v: any) => normalize(v)?.toUpperCase();

      let created = 0, updated = 0, errors: any[] = [];

      await (prisma as any).$transaction(async (tx: any) => {
        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i];
          try {
            const cellRef = normalize(raw.cell) || normalize(raw.Cell) || normalize(raw.cellName) || normalize(raw.cell_code);
            const level = toUpper(raw.level) || toUpper(raw.Level);
            const fee = toInt(raw.fee) ?? toInt(raw.Fee);
            if (!cellRef || !level || fee == null) {
              errors.push({ row: i + 1, error: 'MISSING_REQUIRED', details: { cell: cellRef, level, fee } });
              continue;
            }

            // Map cell by id/code/name
            const cell = await tx.cell.findFirst({ where: { OR: [ { id: cellRef }, { code: cellRef }, { name: cellRef } ] } });
            if (!cell) {
              errors.push({ row: i + 1, error: 'CELL_NOT_FOUND', details: { cell: cellRef } });
              continue;
            }

            const zone = toUpper(raw.zone) || undefined;
            const hrcStateId = normalize(raw.hrcStateId);
            const hrcDistrictId = normalize(raw.hrcDistrictId);
            const hrcMandalId = normalize(raw.hrcMandalId);
            const validityDays = toInt(raw.validityDays);
            const priority = toInt(raw.priority) ?? 0;
            const currency = normalize(raw.currency) || 'INR';

            // Find existing price row for exact scope
            const existing = await tx.designationPrice.findFirst({
              where: {
                designationId: designation.id,
                cellId: cell.id,
                level: level as any,
                zone: zone as any,
                hrcStateId: hrcStateId || null,
                hrcDistrictId: hrcDistrictId || null,
                hrcMandalId: hrcMandalId || null
              }
            });

            if (existing) {
              await tx.designationPrice.update({
                where: { id: existing.id },
                data: { fee, validityDays: validityDays ?? existing.validityDays, currency, priority }
              });
              updated++;
            } else {
              await tx.designationPrice.create({
                data: {
                  designationId: designation.id,
                  cellId: cell.id,
                  level: level as any,
                  zone: zone as any,
                  hrcStateId: hrcStateId || null,
                  hrcDistrictId: hrcDistrictId || null,
                  hrcMandalId: hrcMandalId || null,
                  fee,
                  validityDays: validityDays ?? null,
                  currency,
                  priority: priority ?? 0
                }
              });
              created++;
            }
          } catch (e: any) {
            errors.push({ row: i + 1, error: 'ROW_FAILED', message: e?.message });
          }
        }
      });

      return res.json({ success: true, data: { rows: rows.length, created, updated, errors } });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: e?.message });
    }
  }
);

export default router;
/**
 * @swagger
 * /hrci/designations/{designationId}/prices:
 *   get:
 *     tags: [HRCI]
 *     summary: List designation prices (admin)
 *     description: Retrieve override prices for a designation filtered by cell/level/geo.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: designationId
 *         required: true
 *         schema: { type: string }
 *         description: Designation id or code
 *       - in: query
 *         name: cell
 *         schema: { type: string }
 *         description: Cell id, code, or name
 *       - in: query
 *         name: level
 *         schema: { type: string, enum: [NATIONAL, ZONE, STATE, DISTRICT, MANDAL] }
 *       - in: query
 *         name: zone
 *         schema: { type: string, enum: [NORTH, SOUTH, EAST, WEST, CENTRAL] }
 *       - in: query
 *         name: hrcStateId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcDistrictId
 *         schema: { type: string }
 *       - in: query
 *         name: hrcMandalId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  '/:designationId/prices',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  async (req: any, res) => {
    try {
      const { designationId } = req.params;
      const d = await (prisma as any).designation.findFirst({ where: { OR: [ { id: designationId }, { code: designationId } ] }, select: { id: true, name: true, code: true } });
      if (!d) return res.status(404).json({ success: false, error: 'DESIGNATION_NOT_FOUND' });

      const { cell, level, zone, hrcStateId, hrcDistrictId, hrcMandalId } = req.query || {};
      let cellId: string | undefined;
      if (cell) {
        const c = await (prisma as any).cell.findFirst({ where: { OR: [ { id: String(cell) }, { code: String(cell) }, { name: String(cell) } ] } });
        if (!c) return res.status(400).json({ success: false, error: 'CELL_NOT_FOUND' });
        cellId = c.id;
      }
      const where: any = {
        designationId: d.id,
        ...(cellId ? { cellId } : {}),
        ...(level ? { level: String(level).toUpperCase() } : {}),
        ...(zone ? { zone: String(zone).toUpperCase() } : {}),
        ...(hrcStateId ? { hrcStateId: String(hrcStateId) } : {}),
        ...(hrcDistrictId ? { hrcDistrictId: String(hrcDistrictId) } : {}),
        ...(hrcMandalId ? { hrcMandalId: String(hrcMandalId) } : {})
      };
      const rows = await (prisma as any).designationPrice.findMany({
        where,
        orderBy: [ { priority: 'desc' }, { updatedAt: 'desc' } ],
        include: { cell: { select: { id: true, code: true, name: true } } }
      });
      return res.json({ success: true, designation: d, count: rows.length, data: rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: 'LIST_FAILED', message: e?.message });
    }
  }
);
