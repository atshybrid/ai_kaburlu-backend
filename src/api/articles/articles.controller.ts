import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { buildCanonicalUrl } from '../../lib/domains';
import { sendToTokensEnhanced } from '../../lib/fcm-enhanced';

// Paginated article fetch for swipe UI
export const getPaginatedArticleController = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 1;
    const cursor = req.query.cursor as string | undefined;
    const articles = await prisma.article.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'asc' },
      include: { language: true },
    });
    const nextId = articles.length === limit ? articles[articles.length - 1].id : null;
    const articlesOut = articles.map((a) => {
      const langCode = (a as any).language?.code || 'en';
      const cj: any = (a as any).contentJson || {};
      const slugOrId = cj?.slug || a.id;
      const canonicalUrl = buildCanonicalUrl(langCode, slugOrId, 'article');
      return { ...a, canonicalUrl };
    });
    res.json({ articles: articlesOut, nextId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch articles.' });
  }
};

// Single article fetch
export const getSingleArticleController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const article = await prisma.article.findUnique({ where: { id }, include: { language: true } });
    if (!article) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    const langCode = (article as any).language?.code || 'en';
    const cj: any = (article as any).contentJson || {};
    const slugOrId = cj?.slug || article.id;
    const canonicalUrl = buildCanonicalUrl(langCode, slugOrId, 'article');
    res.json({ ...article, canonicalUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch article.' });
  }
};

import { validate } from 'class-validator';
import { CreateArticleDto } from './articles.dto';
import { createArticle, publishArticle } from './articles.service';
import { aiGenerateSEO } from './articles.service';
import { sendToTopic, sendToUser } from '../../lib/fcm';


export const createArticleController = async (req: Request, res: Response) => {
  try {
    // Only accept required fields for short news
      const { categoryId, title, content } = req.body;
      if (!categoryId || !title || !content) {
        return res.status(400).json({ error: 'categoryId, title, and content are required.' });
    }
    if (content.split(' ').length > 60) {
      return res.status(400).json({ error: 'Content must be 60 words or less.' });
    }
    // @ts-ignore - req.user is populated by Passport (see jwt.strategy.ts returns full user)
    const authorId: string | undefined = (req as any).user?.id;
    if (!authorId) {
      return res.status(401).json({ error: 'Authentication error: User ID not found.' });
    }
  // Determine author's languageId from token (preferred) or DB
  const tokenLanguageId: string | undefined = (req as any).user?.languageId;
  const author = await prisma.user.findUnique({ where: { id: authorId }, include: { language: true } });
  const languageId = tokenLanguageId || author?.languageId || null;
    // Create the article
    const article = await prisma.article.create({
      data: {
        title,
        content,
        authorId,
        categories: { connect: [{ id: categoryId }] },
        type: 'citizen',
        contentJson: {}, // Will be updated after AI enrichment
      },
    });
    // AI enrichment for SEO metadata and tags
    let seoMeta: { seoTitle: string; seoDescription: string; seoKeywords: string[] };
    try {
      seoMeta = await aiGenerateSEO({ title });
    } catch (err) {
      // Fallback if AI fails
      seoMeta = {
        seoTitle: title,
        seoDescription: content,
        seoKeywords: [],
      };
    }
    // Update article with SEO metadata
    await prisma.article.update({
      where: { id: article.id },
      data: {
        contentJson: {
          seoTitle: seoMeta.seoTitle || title,
          seoDescription: seoMeta.seoDescription || content,
          seoKeywords: seoMeta.seoKeywords || [],
        },
      },
    });

    // Build canonical URL and topics
  const user = author; // already fetched with language
  const languageCode = author?.language?.code || 'en';
  const canonicalUrl = buildCanonicalUrl(languageCode, article.id, 'article');

    // Send notification to language topic and category topic (best-effort)
    const titleText = seoMeta.seoTitle || title;
    const bodyText = (seoMeta.seoDescription || content).slice(0, 120);
    const dataPayload = { type: 'article', articleId: article.id, url: canonicalUrl } as Record<string, string>;
    try {
      if (languageCode) {
        await sendToTopic(`news-lang-${languageCode.toLowerCase()}`,
          { title: titleText, body: bodyText, data: dataPayload }
        );
      }
      if (categoryId) {
        await sendToTopic(`news-cat-${String(categoryId).toLowerCase()}`,
          { title: titleText, body: bodyText, data: dataPayload }
        );
      }
    } catch (e) {
      console.warn('FCM send failed (non-fatal):', e);
    }
  // Reload article for response
  const articleOut = await prisma.article.findUnique({ where: { id: article.id } });
  res.status(201).json({
    ...articleOut,
    language: author?.language ? { id: author.language.id, code: author.language.code, name: author.language.name } : null,
    contentJson: {
          seoTitle: seoMeta.seoTitle || title,
          seoDescription: seoMeta.seoDescription || content,
          seoKeywords: seoMeta.seoKeywords || [],
        },
    canonicalUrl,
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(400).json({ error: 'Category does not exist.' });
    }
    console.error('Error creating short news:', error);
    res.status(500).json({ error: 'Failed to create short news article.' });
  }
};

// Publish (or re-trigger notification if not sent) for an article
export const publishArticleController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Basic auth guard (ensure route is secured via middleware in routes file)
    // @ts-ignore
    if (!(req as any).user) return res.status(401).json({ error: 'Unauthorized' });

    const updated = await publishArticle(id, { notify: true });
    return res.json({ success: true, article: updated });
  } catch (error: any) {
    if (error.message === 'Article not found') return res.status(404).json({ error: 'Article not found' });
    console.error('Publish article error:', error);
    return res.status(500).json({ error: 'Failed to publish article' });
  }
};

// Update article status and trigger notifications for approvals
export const updateArticleStatusController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // @ts-ignore
    if (!(req as any).user) return res.status(401).json({ error: 'Unauthorized' });

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Valid statuses (adjust based on your schema)
    const validStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'DESK_APPROVED', 'AI_APPROVED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get current article
    const currentArticle = await prisma.article.findUnique({
      where: { id },
      include: {
        author: {
          include: { language: true }
        }
      }
    });

    if (!currentArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const previousStatus = currentArticle.status;

    // Update article status
    const updatedArticle = await prisma.article.update({
      where: { id },
      data: { status },
      include: {
        author: {
          include: { language: true }
        }
      }
    });

    // Trigger push notification only when status changes TO approved states
    const shouldNotify = (
      (status === 'DESK_APPROVED' || status === 'AI_APPROVED') &&
      previousStatus !== status &&
      !(currentArticle as any).notifiedAt // Don't send duplicate notifications
    );

    if (shouldNotify) {
      console.log(`[Articles] Triggering notification for article ${id} - status changed to ${status}`);
      
      try {
        // Get all devices with push tokens for notification
        const devices = await prisma.device.findMany({
          where: {
            pushToken: { not: null },
            // Optional: filter by language if needed
            // OR: [
            //   { user: { languageId: updatedArticle.author.languageId } },
            //   { userId: null, languageId: updatedArticle.author.languageId }
            // ]
          },
          select: { pushToken: true }
        });

        const tokens = devices.map(d => d.pushToken!).filter(Boolean);

        if (tokens.length > 0) {
          const languageCode = currentArticle.author.language?.code || 'en';
          const canonicalUrl = buildCanonicalUrl(languageCode, updatedArticle.id, 'article');
          
          // Prepare notification content
          const title = updatedArticle.title;
          const body = updatedArticle.content.slice(0, 120) + (updatedArticle.content.length > 120 ? '...' : '');
          
          const result = await sendToTokensEnhanced(tokens, {
            title,
            body,
            data: {
              type: 'article_approved',
              articleId: updatedArticle.id,
              status,
              url: canonicalUrl
            }
          }, {
            sourceController: 'articles-controller',
            sourceAction: 'status-approved',
            priority: 'high'
          });

          // Mark article as notified (cast to any to bypass TypeScript for custom field)
          await prisma.article.update({
            where: { id },
            data: { notifiedAt: new Date() } as any
          });

          console.log(`[Articles] Notification sent for article ${id}:`, {
            success: result.success,
            totalTargets: result.totalTargets,
            successCount: result.successCount,
            failureCount: result.failureCount
          });
        } else {
          console.warn(`[Articles] No push tokens available for notification - article ${id}`);
        }
      } catch (notificationError) {
        console.error(`[Articles] Failed to send notification for article ${id}:`, notificationError);
        // Don't fail the status update if notification fails
      }
    }

    res.json({
      success: true,
      article: updatedArticle,
      notificationSent: shouldNotify,
      previousStatus,
      newStatus: status
    });

  } catch (error: any) {
    console.error('Update article status error:', error);
    return res.status(500).json({ error: 'Failed to update article status' });
  }
};
