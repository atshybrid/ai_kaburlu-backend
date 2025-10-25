import { Router } from 'express';
import prisma from '../../lib/prisma';
import { requireAuth, requireHrcAdmin } from '../middlewares/authz';

/**
 * @swagger
 * tags:
 *   name: HRCI Admin
 *   description: Admin-only HRCI Geography management
 */
const router = Router();

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

export default router;
