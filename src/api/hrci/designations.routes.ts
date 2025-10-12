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

export default router;
