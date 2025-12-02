import { Router } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

/**
 * @swagger
 * tags:
 *   name: HRCI Admin
 *   description: Admin-only HRCI Geography management
 */
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth, requireHrcAdmin);

// District CRUD
/**
 * @swagger
 * /hrci/geo/admin/districts:
 *   post:
 *     tags: [HRCI Admin]
 *     summary: Create district
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stateId: { type: string }
 *               name: { type: string }
 *     responses:
 *       200: { description: Created }
 */
router.post('/districts', async (req, res) => {
  try {
    const { stateId, name } = req.body;
    if (!stateId || !name) return res.status(400).json({ success: false, error: 'stateId and name are required' });
    const d = await (prisma as any).hrcDistrict.create({ data: { stateId, name: String(name).trim() } });
    return res.json({ success: true, data: d });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'CREATE_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/geo/admin/districts/{id}:
 *   put:
 *     tags: [HRCI Admin]
 *     summary: Rename district
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { name: { type: string } } }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/districts/:id', async (req, res) => {
  try {
    const { id } = req.params; const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const d = await (prisma as any).hrcDistrict.update({ where: { id }, data: { name: String(name).trim() } });
    return res.json({ success: true, data: d });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'UPDATE_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/geo/admin/districts/{id}:
 *   delete:
 *     tags: [HRCI Admin]
 *     summary: Delete district
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/districts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await (prisma as any).hrcDistrict.delete({ where: { id } });
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'DELETE_FAILED', message: e?.message }); }
});

// Mandal CRUD
/**
 * @swagger
 * /hrci/geo/admin/mandals:
 *   post:
 *     tags: [HRCI Admin]
 *     summary: Create mandal
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { districtId: { type: string }, name: { type: string } } }
 *     responses:
 *       200: { description: Created }
 */
router.post('/mandals', async (req, res) => {
  try {
    const { districtId, name } = req.body;
    if (!districtId || !name) return res.status(400).json({ success: false, error: 'districtId and name are required' });
    const m = await (prisma as any).hrcMandal.create({ data: { districtId, name: String(name).trim() } });
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'CREATE_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/geo/admin/mandals/{id}:
 *   put:
 *     tags: [HRCI Admin]
 *     summary: Rename mandal
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { name: { type: string } } }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/mandals/:id', async (req, res) => {
  try {
    const { id } = req.params; const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const m = await (prisma as any).hrcMandal.update({ where: { id }, data: { name: String(name).trim() } });
    return res.json({ success: true, data: m });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'UPDATE_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/geo/admin/mandals/{id}:
 *   delete:
 *     tags: [HRCI Admin]
 *     summary: Delete mandal
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/mandals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await (prisma as any).hrcMandal.delete({ where: { id } });
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'DELETE_FAILED', message: e?.message }); }
});

// CSV-like bulk upload (JSON body for simplicity)
// Body: { rows: [ { districtId?: string, districtName?: string, stateId?: string, mandalName: string } ], createMissingDistrict?: boolean }
/**
 * @swagger
 * /hrci/geo/admin/mandals/upload:
 *   post:
 *     tags: [HRCI Admin]
 *     summary: Bulk upload mandals (JSON)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { rows: { type: array, items: { type: object } }, createMissingDistrict: { type: boolean } } }
 *     responses:
 *       200: { description: Upload result }
 */
router.post('/mandals/upload', async (req, res) => {
  try {
    const { rows, createMissingDistrict } = req.body as any;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: 'rows required' });
    let created = 0; let skipped = 0; let districtsCreated = 0;
    for (const r of rows) {
      const mandalName: string = String(r.mandalName || r.mandal || '').trim();
      if (!mandalName) { skipped++; continue; }
      let districtId: string | undefined = r.districtId;
      if (!districtId && r.districtName && r.stateId) {
        const d = await (prisma as any).hrcDistrict.findFirst({ where: { stateId: r.stateId, name: String(r.districtName).trim() } });
        if (d) districtId = d.id; else if (createMissingDistrict) {
          const nd = await (prisma as any).hrcDistrict.create({ data: { stateId: r.stateId, name: String(r.districtName).trim() } });
          districtId = nd.id; districtsCreated++;
        }
      }
      if (!districtId) { skipped++; continue; }
      const exists = await (prisma as any).hrcMandal.findFirst({ where: { districtId, name: mandalName } });
      if (exists) { skipped++; continue; }
      await (prisma as any).hrcMandal.create({ data: { districtId, name: mandalName } });
      created++;
    }
    return res.json({ success: true, created, skipped, districtsCreated });
  } catch (e: any) { return res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: e?.message }); }
});

/**
 * @swagger
 * /hrci/geo/admin/districts/upload:
 *   post:
 *     tags: [HRCI Admin]
 *     summary: Bulk upload districts (CSV)
 *     description: |
 *       Upload a CSV with columns: `stateId` and `name` (district name).
 *       Optionally, you can use `stateCode` instead of `stateId`, and `district` or `districtName` instead of `name`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dryRun
 *         schema: { type: boolean, default: false }
 *         description: If true, validates and reports without writing to DB
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
 *         description: Upload result
 *       400:
 *         description: No file uploaded or invalid CSV
 */
router.post('/districts/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded (field name: file)' });
    const dryRun = String(req.query.dryRun || 'false') === 'true';

    const rows: any[] = [];
    // CSV parse from memory buffer
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

    let created = 0, skipped = 0;
    const errors: any[] = [];
    for (const r of rows) {
      try {
        // Normalize headers case-insensitively
        const keys = Object.keys(r).reduce<Record<string, any>>((acc, k) => { acc[k.toLowerCase()] = r[k]; return acc; }, {});
        const stateId = (keys['stateid'] || '').toString().trim();
        const stateCode = (keys['statecode'] || '').toString().trim();
        const name = (keys['name'] || keys['district'] || keys['districtname'] || '').toString().trim();
        if (!name || (!stateId && !stateCode)) { skipped++; continue; }

        let resolvedStateId = stateId;
        if (!resolvedStateId && stateCode) {
          const st = await (prisma as any).hrcState.findFirst({ where: { code: stateCode }, select: { id: true } });
          if (!st) { errors.push({ row: r, error: `STATE_NOT_FOUND: ${stateCode}` }); continue; }
          resolvedStateId = st.id;
        }

        const exists = await (prisma as any).hrcDistrict.findFirst({ where: { stateId: resolvedStateId, name } });
        if (exists) { skipped++; continue; }
        if (!dryRun) {
          await (prisma as any).hrcDistrict.create({ data: { stateId: resolvedStateId, name } });
        }
        created++;
      } catch (e: any) {
        errors.push({ row: r, error: e?.message });
      }
    }

    return res.json({ success: true, counts: { rows: rows.length, created, skipped }, errors });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: e?.message });
  }
});

/**
 * @swagger
 * /hrci/geo/admin/districts/sample-csv:
 *   get:
 *     tags: [HRCI Admin]
 *     summary: Download a sample CSV header for districts upload
 *     responses:
 *       200:
 *         description: CSV header file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/districts/sample-csv', (_req, res) => {
  const header = 'stateId,name\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="districts_sample.csv"');
  res.send(header);
});

export default router;
