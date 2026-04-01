import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// Assumes existing DB tables: "PrivacyPolicy" and "TermsAndConditions"

export const getPublicPrivacy = async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt" FROM "PrivacyPolicy" WHERE is_published = true ORDER BY updated_at DESC LIMIT 1');
    if (!rows.length) return res.status(404).json({ success: false, error: 'Privacy policy not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to fetch privacy policy' });
  }
};

export const getPublicTerms = async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt" FROM "TermsAndConditions" WHERE is_published = true ORDER BY updated_at DESC LIMIT 1');
    if (!rows.length) return res.status(404).json({ success: false, error: 'Terms & conditions not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to fetch terms' });
  }
};

// Admin list all
export const listPrivacy = async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt" FROM "PrivacyPolicy" ORDER BY updated_at DESC');
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to list privacy policies' });
  }
};

export const listTerms = async (_req: Request, res: Response) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt" FROM "TermsAndConditions" ORDER BY updated_at DESC');
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to list terms' });
  }
};

// Admin create new version (immutable create)
export const createPrivacy = async (req: Request, res: Response) => {
  try {
    const { title, content, version, isPublished } = req.body || {};
    if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });
    const rows: any[] = await prisma.$queryRawUnsafe(
      'INSERT INTO "PrivacyPolicy" (id, title, version, content, is_published) VALUES (gen_random_uuid(), $1, COALESCE($2, \"1.0.0\"), $3, COALESCE($4, true)) RETURNING id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt"',
      title, version, content, Boolean(isPublished ?? true)
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Failed to create privacy policy' });
  }
};

export const createTerms = async (req: Request, res: Response) => {
  try {
    const { title, content, version, isPublished } = req.body || {};
    if (!title || !content) return res.status(400).json({ success: false, error: 'title and content required' });
    const rows: any[] = await prisma.$queryRawUnsafe(
      'INSERT INTO "TermsAndConditions" (id, title, version, content, is_published) VALUES (gen_random_uuid(), $1, COALESCE($2, \"1.0.0\"), $3, COALESCE($4, true)) RETURNING id, title, version, content, is_published AS "isPublished", updated_at AS "updatedAt", created_at AS "createdAt"',
      title, version, content, Boolean(isPublished ?? true)
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Failed to create terms' });
  }
};
