import { Router } from 'express';
import prisma from '../../lib/prisma';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: HRCI Geography & Organization APIs
 */

/**
 * @swagger
 * /hrci/cells:
 *   get:
 *     tags: [HRCI]
 *     summary: List HRCI cells
 *     description: Public endpoint to list organization cells. Supports optional filters.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Case-insensitive search across name and code
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 200
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor id for pagination (use last id from previous page)
 *     responses:
 *       200:
 *         description: Cells
 */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const isActive = typeof req.query.isActive === 'string' ? /^true$/i.test(String(req.query.isActive)) : undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const cursor = (req.query.cursor as string) || undefined;

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } }
      ];
    }
    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    const rows = await (prisma as any).cell.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, description: true, isActive: true, createdAt: true }
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    return res.json({ success: true, count: rows.length, nextCursor, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: 'Failed to list cells', message: e?.message });
  }
});

export default router;
