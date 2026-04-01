import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// Get short news with filters: read/unread, location, category (with pagination)
export const getFilteredShortNews = async (req: Request, res: Response) => {
  try {
    const { userId, read, categoryId, latitude, longitude, address } = req.query;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (categoryId) where.categoryId = categoryId;
    if (address) where.address = address;
    if (latitude && longitude) {
      where.latitude = Number(latitude);
      where.longitude = Number(longitude);
    }

    // Read/unread logic using ShortNewsRead join table
    if (read !== undefined && userId) {
      const readIds = await prisma.shortNewsRead.findMany({
        where: { userId: String(userId) },
        select: { shortNewsId: true },
      });
      const ids = readIds.map((r: { shortNewsId: string }) => r.shortNewsId);
      where.id = read === 'true' ? { in: ids } : { notIn: ids };
    }

    const [news, total] = await Promise.all([
      prisma.shortNews.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.shortNews.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    res.status(200).json({ news, total, page, limit, totalPages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch filtered short news' });
  }
};
