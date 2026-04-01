import { Request, Response } from 'express';
import { PrismaClient, PolicyType } from '@prisma/client';

const prisma = new PrismaClient();

export const getPublicPolicy = async (req: Request, res: Response) => {
  try {
    const { type } = req.params as { type: keyof typeof PolicyType };
    const t = String(type || '').toUpperCase();
    if (!['TERMS','PRIVACY'].includes(t)) return res.status(400).json({ success: false, error: 'Invalid policy type' });
    const item = await prisma.policy.findFirst({
      where: { type: t as PolicyType, isPublished: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!item) return res.status(404).json({ success: false, error: 'Policy not found' });
    return res.json({ success: true, data: item });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to fetch policy' });
  }
};

// Admin: list all versions
export const listPolicies = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.policy.findMany({ orderBy: { updatedAt: 'desc' } });
    return res.json({ success: true, data: items });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to list policies' });
  }
};

// Admin: upsert policy version
export const upsertPolicy = async (req: Request, res: Response) => {
  try {
    const { type, version, title, content, isPublished } = req.body || {};
    const t = String(type || '').toUpperCase();
    if (!['TERMS','PRIVACY'].includes(t)) return res.status(400).json({ success: false, error: 'Invalid type' });
    if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });
    const created = await prisma.policy.create({
      data: { type: t as PolicyType, version: version || '1.0.0', title, content, isPublished: Boolean(isPublished ?? true) },
    });
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Failed to upsert policy' });
  }
};
