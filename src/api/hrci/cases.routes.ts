import { Router } from 'express';
import { requireAuth } from '../middlewares/authz';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
const db: any = prisma;

const router = Router();

// POST /hrci/cases - create case
router.post('/', requireAuth, async (_req, res) => {
  return res.status(501).json({ success: false, error: 'Not Implemented', message: 'Case creation pending implementation' });
});

// GET /hrci/cases - list cases (staff)
router.get('/', requireAuth, async (_req, res) => {
  return res.status(200).json({ success: true, data: [] });
});

// GET /hrci/cases/me - my cases
router.get('/me', requireAuth, async (_req, res) => {
  return res.status(200).json({ success: true, data: [] });
});

// GET /hrci/cases/categories - return categories from config file if present; else built-in list
router.get('/categories', async (_req, res) => {
  try {
    // Try DB first
    const rows: any[] = await db.hrcCaseCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, parentId: true }
    });
    if (rows.length > 0) {
      // Build tree
      const byId = new Map<string, { code: string; name: string; children: any[] }>(
        rows.map((r: any) => [r.id, { code: r.code, name: r.name, children: [] }])
      );
      const roots: any[] = [];
      for (const r of rows) {
        const node = byId.get(r.id)!;
        if (r.parentId && byId.has(r.parentId)) {
          const parent = byId.get(r.parentId)!;
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return res.json({ success: true, data: roots });
    }
  } catch (e: any) {
    // fallthrough to JSON
    console.warn('[cases.categories] DB fetch failed, fallback to JSON:', e?.message);
  }
  try {
    const cfg = path.join(process.cwd(), 'config', 'hrci.case.categories.json');
    if (fs.existsSync(cfg)) {
      const data = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      return res.json({ success: true, data });
    }
  } catch {}
  // Defaults fallback if nothing else
  const defaults = [
    { code: 'HUMAN_RIGHTS_VIOLATION', name: 'Human Rights Violation', children: [
      { code: 'POLICE_BRUTALITY', name: 'Police Brutality' },
      { code: 'DISCRIMINATION', name: 'Discrimination' },
      { code: 'UNLAWFUL_DETENTION', name: 'Unlawful Detention' }
    ]},
    { code: 'CIVIL_ISSUES', name: 'Civil Issues', children: [
      { code: 'LAND_DISPUTE', name: 'Land / Property Dispute' },
      { code: 'DOMESTIC_ABUSE', name: 'Domestic Abuse' },
      { code: 'LABOUR_RIGHTS', name: 'Labour Rights' }
    ]},
    { code: 'LEGAL_AID', name: 'Legal Aid', children: [
      { code: 'ADVICE', name: 'Advice / Counseling' },
      { code: 'DRAFTING', name: 'Drafting Support' }
    ]}
  ];
  return res.json({ success: true, data: defaults });
});

// GET /hrci/cases/:id - get case detail
router.get('/:id', requireAuth, async (_req, res) => {
  return res.status(404).json({ success: false, error: 'Not Found' });
});

// PATCH /hrci/cases/:id/assign - assign case
router.patch('/:id/assign', requireAuth, async (_req, res) => {
  return res.status(501).json({ success: false, error: 'Not Implemented' });
});

// PATCH /hrci/cases/:id/status - update status
router.patch('/:id/status', requireAuth, async (_req, res) => {
  return res.status(501).json({ success: false, error: 'Not Implemented' });
});

// POST /hrci/cases/:id/comments - add external comment
router.post('/:id/comments', requireAuth, async (_req, res) => {
  return res.status(201).json({ success: true });
});

// POST /hrci/cases/:id/comments/internal - add internal comment
router.post('/:id/comments/internal', requireAuth, async (_req, res) => {
  return res.status(201).json({ success: true });
});

// POST /hrci/cases/:id/attachments - upload attachment (placeholder, use Media upload + link later)
router.post('/:id/attachments', requireAuth, async (_req, res) => {
  return res.status(201).json({ success: true, data: {} });
});

// PATCH /hrci/cases/:id/legal - update legal fields
router.patch('/:id/legal', requireAuth, async (_req, res) => {
  return res.status(200).json({ success: true });
});

// GET /hrci/cases/:id/timeline - events
router.get('/:id/timeline', requireAuth, async (_req, res) => {
  return res.status(200).json({ success: true, data: [] });
});

export default router;
