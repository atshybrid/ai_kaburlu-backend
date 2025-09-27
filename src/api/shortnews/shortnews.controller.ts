import { Request, Response } from 'express';
// Use shared Prisma instance (avoid multiple clients & connection churn)
import prisma from '../../lib/prisma';
import { transliterate } from 'transliteration';
import type { Language } from '@prisma/client';
import { buildNewsArticleJsonLd } from '../../lib/seo';
import { getCanonicalDomain, buildCanonicalUrl } from '../../lib/domains';

import { aiEnabledFor } from '../../lib/aiConfig';
import { getPrompt, renderPrompt } from '../../lib/prompts';
import { aiGenerateText } from '../../lib/aiProvider';
import { generateAiShortNewsFromPrompt } from './shortnews.ai';
import { sendToTopic } from '../../lib/fcm'; // retained for any legacy topic sends
import { sendShortNewsApprovedNotification } from './shortnews.notifications';
import { translateAndSaveCategoryInBackground } from '../categories/categories.service';

// AI article generation (SHORTNEWS_AI_ARTICLE) - helper only, no DB write
export const aiGenerateShortNewsArticle = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { rawText } = req.body || {};
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ success: false, error: 'rawText is required' });
    }
    const wordCount = rawText.trim().split(/\s+/).length;
    if (wordCount > 500) {
      return res.status(400).json({ success: false, error: 'rawText must be 500 words or less' });
    }
    const languageId = (req.user as any).languageId;
    if (!languageId) return res.status(400).json({ success: false, error: 'User language not set' });
  const lang = await prisma.language.findUnique({ where: { id: languageId } });
    const languageCode = lang?.code || 'en';
    const tpl = await getPrompt('SHORTNEWS_AI_ARTICLE' as any);
    const prompt = renderPrompt(tpl, { languageCode, content: rawText });
    const draft = await generateAiShortNewsFromPrompt(rawText, prompt, (p) => aiGenerateText({ prompt: p, purpose: 'shortnews_ai_article' }), { minWords: 58, maxWords: 60, maxAttempts: 3 });
    let suggestedCategoryName = draft.suggestedCategoryName;
    if (!suggestedCategoryName) suggestedCategoryName = 'Community';
    // Optional: attempt to map suggested category to existing category id (case-insensitive match on base or translation name)
    let matchedCategory: { id: string; name: string } | null = null;
  let createdCategory = false;
  let categoryTranslationId: string | null = null;
  let localizedCategoryName: string | null = null;
    try {
  const baseCats = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
      const lower = suggestedCategoryName.toLowerCase();
      matchedCategory = baseCats.find(c => c.name.toLowerCase() === lower) || null;
      if (!matchedCategory) {
        // try translations in this language (by language code)
  const translations = await prisma.categoryTranslation.findMany({ where: { language: languageCode as any }, select: { categoryId: true, name: true } });
        const matchT = translations.find(t => t.name.toLowerCase() === lower);
        if (matchT) {
          const cat = baseCats.find(c => c.id === matchT.categoryId);
          if (cat) matchedCategory = cat;
        }
      }
      // If still not matched, create a new category and its translation for this language
      if (!matchedCategory) {
        const baseSlugRaw = transliterate(suggestedCategoryName)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'category';
        let slug = baseSlugRaw;
        const existingSlugs = new Set(baseCats.map(c => c.slug));
        let attempt = 1;
        while (existingSlugs.has(slug) && attempt < 50) {
          slug = `${baseSlugRaw}-${attempt++}`;
        }
  const newCat = await prisma.category.create({
          data: { name: suggestedCategoryName, slug },
          select: { id: true, name: true }
        });
        matchedCategory = newCat;
        createdCategory = true;
        // Upsert translation for this language code
  const tr = await prisma.categoryTranslation.upsert({
          where: { categoryId_language: { categoryId: newCat.id, language: languageCode as any } },
          update: { name: suggestedCategoryName },
          create: { categoryId: newCat.id, language: languageCode as any, name: suggestedCategoryName },
          select: { id: true }
        });
        categoryTranslationId = tr.id;
        localizedCategoryName = suggestedCategoryName;
        // Fire-and-forget background translation for all languages (don't await)
        translateAndSaveCategoryInBackground(newCat.id, suggestedCategoryName).catch(()=>{});
      } else {
        // Ensure a translation exists for this language; upsert with suggested name (does not change base name)
  const tr = await prisma.categoryTranslation.upsert({
          where: { categoryId_language: { categoryId: matchedCategory.id, language: languageCode as any } },
          update: { name: suggestedCategoryName },
          create: { categoryId: matchedCategory.id, language: languageCode as any, name: suggestedCategoryName },
          select: { id: true }
        });
        categoryTranslationId = tr.id;
        localizedCategoryName = suggestedCategoryName;
      }
    } catch {}
    return res.json({
      success: true,
      data: {
        title: draft.title,
        content: draft.content,
        languageCode,
        suggestedCategoryName,
        suggestedCategoryId: matchedCategory?.id || null,
        matchedCategoryName: matchedCategory?.name || null,
        createdCategory,
        categoryTranslationId,
        languageCategoryId: categoryTranslationId,
        localizedCategoryName,
        attempts: draft.attempts,
        fallback: draft.fallbackUsed,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to generate AI article' });
  }
};

// AI rewrite helper (SHORTNEWS_REWRITE)
export const aiRewriteShortNews = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { rawText, title } = req.body || {};
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ success: false, error: 'rawText is required' });
    }
    // Determine language from user principal
    const languageId = (req.user as any).languageId;
    if (!languageId) return res.status(400).json({ success: false, error: 'User language not set' });
  const lang = await prisma.language.findUnique({ where: { id: languageId } });
    const languageCode = lang?.code || 'en';
    const tpl = await getPrompt('SHORTNEWS_REWRITE' as any);
    const prompt = renderPrompt(tpl, { languageCode, title: title || '', content: rawText });
  const aiJson = await aiGenerateText({ prompt, purpose: 'rewrite' });
    if (!aiJson) return res.status(500).json({ success: false, error: 'AI rewrite failed' });
    let parsed: any;
    try {
      const cleaned = aiJson.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ success: false, error: 'AI returned invalid JSON' });
    }
    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.content !== 'string') {
      return res.status(500).json({ success: false, error: 'AI output malformed' });
    }
    // Enforce limits after AI output
    const wordCount = parsed.content.trim().split(/\s+/).length;
  // Enforce new 50 char limit (was 35 previously)
  if (parsed.title.length > 50) parsed.title = parsed.title.slice(0, 50).trim();
    if (wordCount > 60) {
      const trimmedWords = parsed.content.trim().split(/\s+/).slice(0, 60);
      parsed.content = trimmedWords.join(' ');
    }
    return res.json({ success: true, data: { title: parsed.title, content: parsed.content, languageCode } });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to rewrite short news' });
  }
};

// Optional AI SEO generation using centralized prompts and provider abstraction
async function generateSeoWithAI(
  title: string,
  content: string,
  languageCode: string,
  imageUrls: string[] = []
): Promise<{ metaTitle: string; metaDescription: string; tags: string[]; altTexts?: Record<string, string> } | null> {
  try {
    if (!aiEnabledFor('seo')) return null;
    const tpl = await getPrompt('SEO_GENERATION');
    const prompt = renderPrompt(tpl, {
      languageCode,
      title,
      content: content.slice(0, 1000),
      images: imageUrls,
    });
    const text = await aiGenerateText({ prompt, purpose: 'seo' });
    if (!text) return null;
    const jsonText = text.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed.metaTitle === 'string' && typeof parsed.metaDescription === 'string' && Array.isArray(parsed.tags)) {
      return {
        metaTitle: parsed.metaTitle,
        metaDescription: parsed.metaDescription,
        tags: parsed.tags.slice(0, 10).map((t: any) => String(t)),
        altTexts: parsed.altTexts && typeof parsed.altTexts === 'object' ? parsed.altTexts : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// (Legacy note) previously a local PrismaClient was created here; refactored to shared instance.

// (Legacy inline notification logic removed; using sendShortNewsApprovedNotification helper)

export const createShortNews = async (req: Request, res: Response) => {
  try {
  const { title, content, mediaUrls, latitude, longitude, address, categoryId, tags,
    accuracyMeters, provider, timestampUtc, placeId, placeName, source } = req.body;
    if (!req.user || typeof req.user !== 'object' || !('id' in req.user)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!content || !categoryId || !title) {
      return res.status(400).json({ success: false, error: 'title, content and categoryId are required.' });
    }
    // Enforce location: latitude and longitude are mandatory for short news
    const latNum = typeof latitude === 'string' ? Number(latitude) : latitude;
    const lonNum = typeof longitude === 'string' ? Number(longitude) : longitude;
    if (
      latNum === undefined || lonNum === undefined ||
      latNum === null || lonNum === null ||
      Number.isNaN(Number(latNum)) || Number.isNaN(Number(lonNum)) ||
      Number(latNum) < -90 || Number(latNum) > 90 ||
      Number(lonNum) < -180 || Number(lonNum) > 180
    ) {
      return res.status(400).json({ success: false, error: 'latitude and longitude are required and must be valid coordinates.' });
    }
    if (content.trim().split(/\s+/).length > 60) {
      return res.status(400).json({ success: false, error: 'Content must be 60 words or less.' });
    }
    // Validate tags array early (optional)
    if (tags && !Array.isArray(tags)) {
      return res.status(400).json({ success: false, error: 'tags must be an array if provided' });
    }
    if (Array.isArray(tags) && tags.some(t => typeof t !== 'string')) {
      return res.status(400).json({ success: false, error: 'All tag values must be strings' });
    }
    const authorId = (req.user as { id: string }).id;
    const languageId = (req.user as { languageId?: string }).languageId;
    if (!languageId) {
      return res.status(400).json({ success: false, error: 'User language is not set' });
    }

    // Validate related rows early for clearer errors
    // Quick migration / connectivity sanity probe (detect missing columns/tables early)
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
    } catch (e: any) {
      console.error('DB connectivity issue', e);
      return res.status(500).json({ success: false, error: 'Database unavailable' });
    }

    const [userRow, categoryRow] = await Promise.all([
      prisma.user.findUnique({ where: { id: authorId }, select: { id: true, languageId: true, role: { select: { name: true } } } }),
      prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } })
    ]).catch(err => {
      console.error('Preload (user/category) failed, possible migration mismatch', err);
      return [null, null] as any;
    });
    if (!userRow) {
      return res.status(400).json({ success: false, error: 'Invalid author (user not found)' });
    }
    if (!categoryRow) {
      return res.status(400).json({ success: false, error: 'Invalid categoryId (category not found)' });
    }
    // If author is a CITIZEN_REPORTER, ensure category has a translation entry in the user's language.
    if (userRow?.role?.name === 'CITIZEN_REPORTER') {
      const lang = await prisma.language.findUnique({ where: { id: languageId }, select: { code: true } });
      const langCode = lang?.code;
      if (!langCode) {
        return res.status(400).json({ success: false, error: 'User language code not found' });
      }
      const catTr = await prisma.categoryTranslation.findUnique({
        where: { categoryId_language: { categoryId, language: langCode as any } },
        select: { id: true }
      });
      if (!catTr) {
        return res.status(400).json({ success: false, error: 'Selected category is not available in your language', details: { categoryId, language: langCode } });
      }
    }
  // Slug: always auto-generate from title (ignore client-provided slug)
  const slugSource = String(title);
  // Create ASCII slug using transliteration (no Unicode in slug)
    const transliteratedSlug = transliterate(slugSource)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const slug = `${transliteratedSlug}-${Date.now().toString().slice(-6)}`;
    // AI SEO enrichment (stub, replace with real AI call)
    const initialSeo = {
      metaTitle: title,
      metaDescription: content.slice(0, 150),
      tags: Array.isArray(tags) ? tags : [],
    };
    const titleToSave = title;

    // Lookup language details for response and for SEO
    const lang: Language | null = await prisma.language.findUnique({ where: { id: languageId } });
    const languageCode = lang?.code || 'en';

    // Optional AI SEO enrichment
  const imageCandidates: string[] = Array.isArray(mediaUrls) ? mediaUrls.filter((u: string) => /\.(webp|png|jpe?g|gif|avif)$/i.test(u)) : [];
  const videoCandidates: string[] = Array.isArray(mediaUrls) ? mediaUrls.filter((u: string) => /\.(webm|mp4|mov|ogg)$/i.test(u)) : [];

  const aiSeo = await generateSeoWithAI(titleToSave, content, languageCode, imageCandidates);
    const combinedTags = Array.from(new Set([...(Array.isArray(tags) ? tags : []), ...((aiSeo?.tags ?? []) as string[])]));
    const finalSeo = aiSeo ?? {
      metaTitle: titleToSave,
      metaDescription: content.slice(0, 160),
      tags: combinedTags,
      altTexts: imageCandidates.reduce((acc: Record<string,string>, url) => { acc[url] = titleToSave; return acc; }, {}),
    };

    // AI moderation stub: flag plagiarism/sensitive content and decide status
    let aiRemark: string | undefined;
    let aiPlagiarism: any = null;
    let aiSensitive: any = null;
    let initialStatus: string = 'PENDING';
    try {
      const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
      if (apiKey) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const modPrompt = `Content moderation for news. Analyze the text below for plagiarism likelihood and sensitive content (violence, hate, adult, personal data). Provide STRICT JSON with keys: plagiarismScore (0-1), sensitiveFlags (string[]), decision ('ALLOW'|'REVIEW'|'BLOCK'), remark (short in ${languageCode}). Text: ${content.slice(0, 2000)}`;
        const modRes = await model.generateContent(modPrompt);
        const text = (modRes?.response?.text && modRes.response.text()) || '';
        const jsonText = text.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
        const parsed = JSON.parse(jsonText);
        aiPlagiarism = { score: parsed?.plagiarismScore ?? null };
        aiSensitive = { flags: Array.isArray(parsed?.sensitiveFlags) ? parsed.sensitiveFlags : [] };
        if (parsed?.decision === 'BLOCK') {
          initialStatus = 'REJECTED';
          aiRemark = parsed?.remark || 'Blocked by AI';
        } else if (parsed?.decision === 'REVIEW') {
          initialStatus = 'DESK_PENDING';
          aiRemark = parsed?.remark || 'Needs desk review';
        } else {
          initialStatus = 'AI_APPROVED';
        }
      } else {
        initialStatus = 'DESK_PENDING';
      }
    } catch {
      initialStatus = 'DESK_PENDING';
    }

    // Moderation via centralized prompt/provider if enabled (overrides previous initialStatus if available)
    try {
      if (aiEnabledFor('moderation')) {
        const tpl = await getPrompt('MODERATION');
        const prompt = renderPrompt(tpl, { languageCode, content: content.slice(0, 2000) });
        const out = await aiGenerateText({ prompt, purpose: 'moderation' });
        if (out) {
          const jsonText = out.trim().replace(/^```(json)?/i, '').replace(/```$/,'').trim();
          const parsed = JSON.parse(jsonText);
          aiPlagiarism = { score: parsed?.plagiarismScore ?? null };
          aiSensitive = { flags: Array.isArray(parsed?.sensitiveFlags) ? parsed.sensitiveFlags : [] };
          const decision = String(parsed?.decision || 'REVIEW').toUpperCase();
          aiRemark = typeof parsed?.remark === 'string' ? parsed.remark : undefined;
          if (decision === 'ALLOW') initialStatus = 'AI_APPROVED';
          else if (decision === 'BLOCK') initialStatus = 'REJECTED';
          else initialStatus = 'DESK_PENDING';
        }
      }
    } catch {
      // ignore moderation failure, keep prior initialStatus
    }

    // Build canonical URL and JSON-LD for SEO
    const canonicalUrl = buildCanonicalUrl(languageCode, slug, 'short');
    const jsonLd = buildNewsArticleJsonLd({
      headline: titleToSave,
      description: finalSeo.metaDescription,
      canonicalUrl,
      imageUrls: imageCandidates.slice(0, 5),
      languageCode,
      datePublished: new Date(),
      dateModified: new Date(),
      authorName: undefined,
      publisherName: process.env.SEO_PUBLISHER_NAME,
      publisherLogoUrl: process.env.SEO_PUBLISHER_LOGO,
      videoUrl: videoCandidates[0],
      videoThumbnailUrl: imageCandidates[0],
    });

    // Pre-validate numeric / date fields to avoid generic Prisma data errors (e.g., P2009)
    let accuracyMetersValue: number | null = null;
    if (accuracyMeters !== undefined) {
      if (accuracyMeters === null || accuracyMeters === '') {
        accuracyMetersValue = null;
      } else {
        const accNum = Number(accuracyMeters);
        if (!Number.isFinite(accNum) || accNum < 0) {
          return res.status(400).json({ success: false, error: 'accuracyMeters must be a positive number' });
        }
        accuracyMetersValue = accNum;
      }
    }
    let timestampUtcValue: Date | null = null;
    if (timestampUtc !== undefined) {
      if (!timestampUtc) {
        timestampUtcValue = null;
      } else {
        const d = new Date(timestampUtc);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, error: 'timestampUtc must be a valid ISO date-time string' });
        }
        timestampUtcValue = d;
      }
    }

    let shortNews;
    const debug = (req.query.debug === '1' || req.headers['x-debug'] === '1');
    try {
      shortNews = await prisma.shortNews.create({
        data: {
          title: titleToSave,
          slug,
          content,
          authorId,
          categoryId,
          tags: combinedTags,
          seo: { ...finalSeo, jsonLd },
          mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
          latitude: Number(latNum),
          longitude: Number(lonNum),
          address: address || null,
          accuracyMeters: accuracyMetersValue,
          provider: provider || null,
          timestampUtc: timestampUtcValue,
          placeId: placeId || null,
          placeName: placeName || null,
          source: source || null,
          language: languageId,
          status: initialStatus,
          aiRemark,
          aiPlagiarism,
          aiSensitive,
        },
      });
    } catch (err: any) {
      // Prisma error diagnostics
      const code = err?.code;
      if (code === 'P2003') {
        console.error('P2003 foreign key failure creating ShortNews', { categoryId, authorId, meta: err?.meta });
        const devInfo = (process.env.NODE_ENV !== 'production' || debug) ? { prismaCode: code, meta: err?.meta } : {};
        return res.status(400).json({ success: false, error: 'Foreign key constraint failed (check categoryId / authorId)', ...devInfo });
      }
      if (code === 'P2002') {
        console.error('P2002 unique constraint (slug) collision', { slug, meta: err?.meta });
        const devInfo = (process.env.NODE_ENV !== 'production' || debug) ? { prismaCode: code, meta: err?.meta } : {};
        return res.status(400).json({ success: false, error: 'Unique constraint failed (slug collision)', ...devInfo });
      }
      if (code === 'P2009') {
        console.error('P2009 invalid data error creating ShortNews', { message: err?.message, meta: err?.meta });
        const devInfo = (process.env.NODE_ENV !== 'production' || debug) ? { prismaCode: code, meta: err?.meta, message: err?.message } : {};
        return res.status(400).json({ success: false, error: 'Invalid data for one or more fields (P2009)', ...devInfo });
      }
      console.error('shortNews.create error', err);
      const devInfo = (process.env.NODE_ENV !== 'production' || debug) ? { prismaCode: code, message: err?.message, meta: err?.meta } : {};
      return res.status(400).json({ success: false, error: 'Failed to submit short news (create error)', ...devInfo });
    }
    // If AI directly approved, trigger notification (idempotent)
    if (initialStatus === 'AI_APPROVED') {
      await sendShortNewsApprovedNotification(shortNews.id);
    }
    res.status(201).json({
      success: true,
      data: {
        ...shortNews,
        transliteratedSlug,
        languageId,
        languageName: lang?.name ?? null,
        languageCode: lang?.code ?? null,
        languageInfo: lang ? { id: lang.id, code: lang.code, name: lang.name, nativeName: lang.nativeName } : null,
        canonicalUrl,
        seo: shortNews.seo,
      },
    });
  } catch (error: any) {
    console.error('createShortNews unexpected error', error);
    res.status(400).json({ success: false, error: 'Failed to submit short news (unexpected)' });
  }
};

export const getShortNewsJsonLd = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await prisma.shortNews.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ success: false, error: 'Not found' });
    const lang = await prisma.language.findUnique({ where: { id: item.language as any } });
    const languageCode = lang?.code || 'en';
    const canonicalUrl = buildCanonicalUrl(languageCode, item.slug || item.id, 'short');
    const imgs = (item.mediaUrls || []).filter((u: string) => /\.(webp|png|jpe?g|gif|avif)$/i.test(u));
    const vids = (item.mediaUrls || []).filter((u: string) => /\.(webm|mp4|mov|ogg)$/i.test(u));
    const jsonLd = buildNewsArticleJsonLd({
      headline: item.title,
      description: (item.seo as any)?.metaDescription || item.content?.slice(0, 160),
      canonicalUrl,
      imageUrls: imgs.slice(0, 5),
      languageCode,
      datePublished: item.createdAt,
      dateModified: item.updatedAt,
      videoUrl: vids[0],
      videoThumbnailUrl: imgs[0],
    });
    return res.json(jsonLd);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to build JSON-LD' });
  }
};

export const listShortNews = async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    if (!user?.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // inputs: limit and cursor (base64 JSON { id, date })
    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);
    const cursorRaw = (req.query.cursor as string) || '';
    let cursor: { id: string; date: string } | null = null;
    if (cursorRaw) {
      try {
        const decoded = Buffer.from(cursorRaw, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.date === 'string') {
          cursor = { id: parsed.id, date: parsed.date };
        }
      } catch (_) {
        // ignore bad cursor
      }
    }

    const languageId = user.languageId;
    const all = String(req.query.all || '').toLowerCase() === 'true';
    const where: any = all ? {} : { language: languageId };
    // Prefetch pool: optionally global when all=true; include author for ownership + future role-based filtering
    const seed = await prisma.shortNews.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            email: true,
            mobileNumber: true,
            role: { select: { name: true } },
            profile: { select: { fullName: true, profilePhotoUrl: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(limit * 10, 200),
    });
    const collection = seed;

    // apply cursor (items strictly after cursor in our desc ordering => older than cursor)
    const afterCursor = cursor
      ? collection.filter((item) => {
          const itemDate = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as any);
          const cursorDate = new Date(cursor!.date);
          return itemDate < cursorDate || (itemDate.getTime() === cursorDate.getTime() && item.id < cursor!.id);
        })
      : collection;

  // take next N and compute next cursor
  const slice = afterCursor.slice(0, limit);
  // enrich with language name and code
  const langIds = Array.from(new Set(slice.map((i) => i.language).filter((x): x is string => !!x)));
  const langs = await prisma.language.findMany({ where: { id: { in: langIds } } });
  const langMap = new Map(langs.map((l) => [l.id, l]));
  // fetch category translations and base names for categoryName
  const categoryIds = Array.from(new Set(slice.map((i: any) => i.categoryId).filter((x: any) => !!x)));
  const [catTranslations, cats] = await Promise.all([
    prisma.categoryTranslation.findMany({ where: { categoryId: { in: categoryIds }, language: languageId as any } }),
    prisma.category.findMany({ where: { id: { in: categoryIds } } }),
  ]);
  const catNameById = new Map<string, string>();
  for (const ct of catTranslations) catNameById.set(ct.categoryId, ct.name);
  for (const c of cats) if (!catNameById.has(c.id)) catNameById.set(c.id, c.name);
  // fetch authors' latest user location for placeName/address if available
  const authorIds = Array.from(new Set(slice.map((i: any) => i.authorId).filter((x: any) => !!x)));
  const authorLocs = await prisma.userLocation.findMany({ where: { userId: { in: authorIds } } });
  const authorLocByUser = new Map(authorLocs.map((l) => [l.userId, l]));
    // Pre-fetch read markers for current user (ShortNewsRead)
    let readSet: Set<string> = new Set();
    if (slice.length) {
      const readRows = await prisma.shortNewsRead.findMany({
        where: { userId: user.id, shortNewsId: { in: slice.map((i: any) => i.id) } },
        select: { shortNewsId: true },
      });
      readSet = new Set(readRows.map(r => r.shortNewsId));
    }

    const last = slice[slice.length - 1];
    const hasMore = afterCursor.length > limit;
    const nextCursor = last ? Buffer.from(JSON.stringify({ id: last.id, date: last.createdAt.toISOString() })).toString('base64') : null;

    const data = slice.map((i: any) => {
      const l = i.language ? langMap.get(i.language as any) : undefined;
      const categoryName = i.categoryId ? catNameById.get(i.categoryId) ?? null : null;
      const author = i.author as any;
  const authorName = author?.profile?.fullName || author?.email || author?.mobileNumber || null; // prefer fullName
      const loc = authorLocByUser.get(i.authorId) as any;
      const placeName = i.placeName ?? (loc as any)?.placeName ?? null;
      const address = i.address ?? (loc as any)?.address ?? null;
      const isOwner = i.authorId === user.id;
      const isRead = readSet.has(i.id);
      return {
        ...i,
        // Ensure mediaUrls always present as array
        mediaUrls: Array.isArray(i.mediaUrls) ? i.mediaUrls : [],
        languageId: i.language ?? null,
        languageName: l?.name ?? null,
        languageCode: l?.code ?? null,
        categoryName,
        // Backward compatibility: keep authorName at top level
        authorName,
        author: {
          id: author?.id || null,
            fullName: author?.profile?.fullName || null,
            profilePhotoUrl: author?.profile?.profilePhotoUrl || null,
            email: author?.email || null,
            mobileNumber: author?.mobileNumber || null,
            roleName: author?.role?.name || null,
            reporterType: author?.role?.name || null,
        },
        isOwner,
        isRead,
        placeName,
        address,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        accuracyMeters: i.accuracyMeters ?? null,
        provider: i.provider ?? null,
        timestampUtc: i.timestampUtc ?? null,
        placeId: i.placeId ?? null,
        source: i.source ?? null,
      } as any;
    });

    return res.status(200).json({
      success: true,
      pageInfo: { limit, nextCursor, hasMore },
      data,
    });
  } catch (error) {
    console.error('Failed to fetch short news:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch short news' });
  }
};

export const updateShortNewsStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, aiRemark } = req.body;
    const updated = await prisma.shortNews.update({
      where: { id },
      data: { status, aiRemark },
    });
    // Push notification (idempotent) on approval transitions
    const approvedStatuses = new Set(['AI_APPROVED', 'DESK_APPROVED']);
    if (approvedStatuses.has(String(status))) {
      await sendShortNewsApprovedNotification(updated.id);
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: 'Failed to update status' });
  }
};

// Update short news (author or desk/admin)
export const updateShortNews = async (req: Request, res: Response) => {
  try {
    if (!req.user || typeof req.user !== 'object' || !('id' in req.user)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const user = req.user as Express.User;
    const { id } = req.params;

    const existing = await prisma.shortNews.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    // Authorization: author can edit unless DESK_APPROVED; desk/admin can always edit
    const roleName = user?.role?.name || '';
    const isDesk = ['NEWS_DESK', 'NEWS_DESK_ADMIN', 'LANGUAGE_ADMIN', 'SUPERADMIN'].includes(roleName);
    const isAuthor = existing.authorId === user.id;
    if (!isDesk && !isAuthor) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!isDesk && existing.status === 'DESK_APPROVED') {
      return res.status(400).json({ success: false, error: 'Approved items can only be edited by desk/admin' });
    }

    const {
      title,
      content,
      categoryId,
      tags,
      mediaUrls,
      latitude,
      longitude,
      address,
      accuracyMeters,
      provider,
      timestampUtc,
      placeId,
      placeName,
      source,
    } = req.body || {};

    // Validate optional lat/lon if provided
    const hasLat = latitude !== undefined && latitude !== null && latitude !== '';
    const hasLon = longitude !== undefined && longitude !== null && longitude !== '';
    if (hasLat || hasLon) {
      const latNum = typeof latitude === 'string' ? Number(latitude) : latitude;
      const lonNum = typeof longitude === 'string' ? Number(longitude) : longitude;
      if (
        latNum === undefined || lonNum === undefined ||
        latNum === null || lonNum === null ||
        Number.isNaN(Number(latNum)) || Number.isNaN(Number(lonNum)) ||
        Number(latNum) < -90 || Number(latNum) > 90 ||
        Number(lonNum) < -180 || Number(lonNum) > 180
      ) {
        return res.status(400).json({ success: false, error: 'latitude and longitude must be valid coordinates.' });
      }
    }

    // Optional: keep slug unchanged on updates
    const data: any = {};
    if (typeof title === 'string' && title.trim()) data.title = title.trim();
    if (typeof content === 'string' && content.trim()) {
      if (content.trim().split(/\s+/).length > 60) {
        return res.status(400).json({ success: false, error: 'Content must be 60 words or less.' });
      }
      data.content = content.trim();
    }
    if (typeof categoryId === 'string' && categoryId.trim()) data.categoryId = categoryId.trim();
    if (Array.isArray(tags)) data.tags = tags.map((t: any) => String(t));
    if (Array.isArray(mediaUrls)) data.mediaUrls = mediaUrls.map((u: any) => String(u));
    if (hasLat) data.latitude = Number(latitude);
    if (hasLon) data.longitude = Number(longitude);
    if (address !== undefined) data.address = address || null;
    if (accuracyMeters !== undefined) data.accuracyMeters = accuracyMeters != null ? Number(accuracyMeters) : null;
    if (provider !== undefined) data.provider = provider || null;
    if (timestampUtc !== undefined) data.timestampUtc = timestampUtc ? new Date(timestampUtc) : null;
    if (placeId !== undefined) data.placeId = placeId || null;
    if (placeName !== undefined) data.placeName = placeName || null;
    if (source !== undefined) data.source = source || null;

    const updated = await prisma.shortNews.update({ where: { id }, data });
    return res.status(200).json({ success: true, data: updated });
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Failed to update short news' });
  }
};

// Public feed: DESK_APPROVED and AI_APPROVED items, requires languageId query param
export const listApprovedShortNews = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);
    const cursorRaw = (req.query.cursor as string) || '';
    const languageIdParam = (req.query.languageId as string) || '';
    // Optional language filter: if provided, validate exists; else show all languages
    let cursor: { id: string; date: string } | null = null;
    if (cursorRaw) {
      try {
        const decoded = Buffer.from(cursorRaw, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.date === 'string') {
          cursor = { id: parsed.id, date: parsed.date };
        }
      } catch {}
    }
    // Validate languageId if provided
    if (languageIdParam) {
      const langCheck = await prisma.language.findUnique({ where: { id: languageIdParam } });
      if (!langCheck) {
        return res.status(400).json({ success: false, error: 'Invalid languageId' });
      }
    }
    const where: any = { status: { in: ['DESK_APPROVED', 'AI_APPROVED'] } };
    if (languageIdParam) where.language = languageIdParam;

    // Optional geo filter: if both lat and lon provided, filter within ~30km radius
    const latStr = (req.query.latitude as string) || '';
    const lonStr = (req.query.longitude as string) || '';
    let centerLat: number | null = null;
    let centerLon: number | null = null;
    if (latStr && lonStr) {
      const latNum = Number(latStr);
      const lonNum = Number(lonStr);
      if (
        Number.isFinite(latNum) && Number.isFinite(lonNum) &&
        latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180
      ) {
        centerLat = latNum;
        centerLon = lonNum;
      } else {
        return res.status(400).json({ success: false, error: 'Invalid latitude/longitude' });
      }
    }
    const items = await prisma.shortNews.findMany({
      where,
      include: {
        author: { select: { id: true, email: true, mobileNumber: true, role: { select: { name: true } }, profile: { select: { fullName: true, profilePhotoUrl: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(limit * 10, 200),
    });
    // apply optional geo-radius filtering (first bounding box for speed, then precise haversine <= 30km)
    const R_KM = 6371; // Earth radius
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R_KM * c;
    };
    let geoFiltered = items;
    if (centerLat != null && centerLon != null) {
      const deltaLat = 30 / 111; // ~1 deg lat ~111km
      const latRad = toRad(centerLat);
      const cosLat = Math.max(0.000001, Math.cos(latRad));
      const deltaLon = 30 / (111 * cosLat);
      const minLat = centerLat - deltaLat;
      const maxLat = centerLat + deltaLat;
      const minLon = centerLon - deltaLon;
      const maxLon = centerLon + deltaLon;
      geoFiltered = items.filter((i: any) => {
        const lat = i.latitude;
        const lon = i.longitude;
        if (lat == null || lon == null) return false;
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return false;
        return haversineKm(centerLat!, centerLon!, lat, lon) <= 30;
      });
    }
    const filtered = cursor
      ? geoFiltered.filter((i) => {
          const d = i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as any);
          const cd = new Date(cursor!.date);
          return d < cd || (d.getTime() === cd.getTime() && i.id < cursor!.id);
        })
      : geoFiltered;
    const slice = filtered.slice(0, limit);
    const last = slice[slice.length - 1];
    const nextCursor = last ? Buffer.from(JSON.stringify({ id: last.id, date: last.createdAt.toISOString() })).toString('base64') : null;
    // attach language info
    const langIds = Array.from(new Set(slice.map((i) => i.language).filter((x): x is string => !!x)));
    const langs = await prisma.language.findMany({ where: { id: { in: langIds } } });
    const langMap = new Map(langs.map((l) => [l.id, l]));
    // category names (language-aware: use each item's language)
    const categoryIds = Array.from(new Set(slice.map((i: any) => i.categoryId).filter((x: any) => !!x)));
    const sliceLangIds = Array.from(new Set(slice.map((i: any) => i.language).filter((x: any) => !!x)));
    const [catTranslations, cats] = await Promise.all([
      prisma.categoryTranslation.findMany({ where: { categoryId: { in: categoryIds }, language: { in: sliceLangIds as any } } }),
      prisma.category.findMany({ where: { id: { in: categoryIds } } }),
    ]);
    const catNameById = new Map<string, string>();
    const catNameByCatLang = new Map<string, string>();
    for (const ct of catTranslations) {
      catNameById.set(ct.categoryId, ct.name);
      catNameByCatLang.set(`${ct.categoryId}:${ct.language}`, ct.name);
    }
    for (const c of cats) if (!catNameById.has(c.id)) catNameById.set(c.id, c.name);
    // author locations
    const authorIds = Array.from(new Set(slice.map((i: any) => i.authorId).filter((x: any) => !!x)));
    const authorLocs = await prisma.userLocation.findMany({ where: { userId: { in: authorIds } } });
    const authorLocByUser = new Map(authorLocs.map((l) => [l.userId, l]));
    // read markers if user context (optional auth bearer). We accept optional user on public feed.
  const user = (req as any).user as Express.User | undefined;
    let readSet: Set<string> = new Set();
    if (user && slice.length) {
      const readRows = await prisma.shortNewsRead.findMany({
        where: { userId: user.id, shortNewsId: { in: slice.map((s: any) => s.id) } },
        select: { shortNewsId: true },
      });
      readSet = new Set(readRows.map(r => r.shortNewsId));
    }
    const data = slice.map((i: any) => {
      const l = i.language ? langMap.get(i.language as any) : undefined;
  const categoryName = i.categoryId ? (catNameByCatLang.get(`${i.categoryId}:${i.language}`) ?? catNameById.get(i.categoryId) ?? null) : null;
  const author = i.author as any;
  const authorName = author?.profile?.fullName || author?.email || author?.mobileNumber || null;
      const loc = authorLocByUser.get(i.authorId) as any;
      const placeName = i.placeName ?? (loc as any)?.placeName ?? null;
      const address = i.address ?? (loc as any)?.address ?? null;
      // derive canonical url and primary media
      const languageCode = l?.code || 'en';
      const canonicalUrl = buildCanonicalUrl(languageCode, i.slug || i.id, 'short');
      const mediaUrls = Array.isArray(i.mediaUrls) ? i.mediaUrls : [];
      const imageUrls = mediaUrls.filter((u: string) => /\.(webp|png|jpe?g|gif|avif)$/i.test(u));
      const videoUrls = mediaUrls.filter((u: string) => /\.(webm|mp4|mov|ogg)$/i.test(u));
      const primaryImageUrl = imageUrls[0] || null;
      const primaryVideoUrl = videoUrls[0] || null;
      // ensure jsonLd exists (fallback build if missing)
      let jsonLd: any = (i.seo as any)?.jsonLd;
      if (!jsonLd) {
        jsonLd = buildNewsArticleJsonLd({
          headline: i.title,
          description: ((i.seo as any)?.metaDescription || i.content?.slice(0, 160)),
          canonicalUrl,
          imageUrls: imageUrls.slice(0, 5),
          languageCode,
          datePublished: i.createdAt,
          dateModified: i.updatedAt,
          videoUrl: primaryVideoUrl || undefined,
          videoThumbnailUrl: primaryImageUrl || undefined,
        });
      }
      const isOwner = user ? i.authorId === user.id : false;
      const isRead = user ? readSet.has(i.id) : false;
      return {
        ...i,
        // Ensure mediaUrls always present as array
        mediaUrls,
        primaryImageUrl,
        primaryVideoUrl,
        canonicalUrl,
        jsonLd,
        languageId: i.language ?? null,
        languageName: l?.name ?? null,
        languageCode: l?.code ?? null,
        categoryName,
        authorName,
        author: {
          id: author?.id || null,
          fullName: author?.profile?.fullName || null,
          profilePhotoUrl: author?.profile?.profilePhotoUrl || null,
          email: author?.email || null,
          mobileNumber: author?.mobileNumber || null,
          roleName: author?.role?.name || null,
          reporterType: author?.role?.name || null,
        },
        isOwner,
        isRead,
        placeName,
        address,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        accuracyMeters: i.accuracyMeters ?? null,
        provider: i.provider ?? null,
        timestampUtc: i.timestampUtc ?? null,
        placeId: i.placeId ?? null,
        source: i.source ?? null,
      } as any;
    });
    return res.json({ success: true, pageInfo: { limit, nextCursor, hasMore: filtered.length > limit }, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to fetch approved short news' });
  }
};

export const getApprovedShortNewsById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ShortNews ID is required' });
    }

    // Find the short news item - must be approved to be publicly accessible
    const item = await prisma.shortNews.findUnique({
      where: { id },
      include: {
        author: { 
          select: { 
            id: true, 
            email: true, 
            mobileNumber: true, 
            role: { select: { name: true } }, 
            profile: { select: { fullName: true, profilePhotoUrl: true } } 
          } 
        },
      },
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'ShortNews not found' });
    }

    // Only approved items are publicly accessible
    if (!['DESK_APPROVED', 'AI_APPROVED'].includes(item.status as string)) {
      return res.status(404).json({ success: false, error: 'ShortNews not found' });
    }

    // Get language info
    const lang = item.language ? await prisma.language.findUnique({ where: { id: item.language as any } }) : null;

    // Get category name (in the item's language if available)
    let categoryName: string | null = null;
    if (item.categoryId) {
      const catTranslation = await prisma.categoryTranslation.findUnique({
        where: { categoryId_language: { categoryId: item.categoryId, language: item.language as any } }
      });
      if (catTranslation) {
        categoryName = catTranslation.name;
      } else {
        // Fallback to category default name
        const cat = await prisma.category.findUnique({ where: { id: item.categoryId } });
        categoryName = cat?.name || null;
      }
    }

    // Get author location for place/address fallback
    let authorLoc: any = null;
    if (item.authorId) {
      authorLoc = await prisma.userLocation.findUnique({ where: { userId: item.authorId } });
    }

    // Check if requesting user has read this (optional auth)
    const user = (req as any).user as Express.User | undefined;
    let isRead = false;
    let isOwner = false;
    if (user) {
      isOwner = item.authorId === user.id;
      const readRecord = await prisma.shortNewsRead.findUnique({
        where: { userId_shortNewsId: { userId: user.id, shortNewsId: item.id } }
      });
      isRead = !!readRecord;
    }

    // Build enriched response (same format as public list)
    const author = item.author as any;
    const authorName = author?.profile?.fullName || author?.email || author?.mobileNumber || null;
    const placeName = item.placeName ?? authorLoc?.placeName ?? null;
    const address = item.address ?? authorLoc?.address ?? null;

    // Build canonical URL and media URLs
    const languageCode = lang?.code || 'en';
    const canonicalUrl = buildCanonicalUrl(languageCode, item.slug || item.id, 'short');
    const mediaUrls = Array.isArray(item.mediaUrls) ? item.mediaUrls : [];
    const imageUrls = mediaUrls.filter((u: string) => /\.(webp|png|jpe?g|gif|avif)$/i.test(u));
    const videoUrls = mediaUrls.filter((u: string) => /\.(webm|mp4|mov|ogg)$/i.test(u));
    const primaryImageUrl = imageUrls[0] || null;
    const primaryVideoUrl = videoUrls[0] || null;

    // Build JSON-LD (fallback if missing)
    let jsonLd: any = (item.seo as any)?.jsonLd;
    if (!jsonLd) {
      jsonLd = buildNewsArticleJsonLd({
        headline: item.title,
        description: ((item.seo as any)?.metaDescription || item.content?.slice(0, 160)),
        canonicalUrl,
        imageUrls: imageUrls.slice(0, 5),
        languageCode,
        datePublished: item.createdAt,
        dateModified: item.updatedAt,
        videoUrl: primaryVideoUrl || undefined,
        videoThumbnailUrl: primaryImageUrl || undefined,
      });
    }

    const data = {
      ...item,
      mediaUrls,
      primaryImageUrl,
      primaryVideoUrl,
      canonicalUrl,
      jsonLd,
      languageId: item.language ?? null,
      languageName: lang?.name ?? null,
      languageCode: lang?.code ?? null,
      categoryName,
      authorName,
      author: {
        id: author?.id || null,
        fullName: author?.profile?.fullName || null,
        profilePhotoUrl: author?.profile?.profilePhotoUrl || null,
        email: author?.email || null,
        mobileNumber: author?.mobileNumber || null,
        roleName: author?.role?.name || null,
        reporterType: author?.role?.name || null,
      },
      isOwner,
      isRead,
      placeName,
      address,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      accuracyMeters: item.accuracyMeters ?? null,
      provider: item.provider ?? null,
      timestampUtc: item.timestampUtc ?? null,
      placeId: item.placeId ?? null,
      source: item.source ?? null,
    };

    return res.json({ success: true, data });
  } catch (e) {
    console.error('Failed to fetch short news by ID:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch short news' });
  }
};

// Moderation/status-wise listing: citizens see their own by status; desk/admin see language-wide by status
export const listShortNewsByStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    if (!user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const status = (req.query.status as string) || undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);
    const cursorRaw = (req.query.cursor as string) || '';
    let cursor: { id: string; date: string } | null = null;
    if (cursorRaw) {
      try {
        const decoded = Buffer.from(cursorRaw, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.date === 'string') {
          cursor = { id: parsed.id, date: parsed.date };
        }
      } catch {}
    }
    const roleName = user?.role?.name || '';
    const where: any = {};
    if (status) where.status = status;
    if (roleName === 'NEWS_DESK' || roleName === 'NEWS_DESK_ADMIN' || roleName === 'LANGUAGE_ADMIN' || roleName === 'SUPERADMIN') {
      where.language = user.languageId; // show items in their language
    } else {
      where.authorId = user.id; // citizens only their own
    }
    const items = await prisma.shortNews.findMany({
      where,
      include: { author: { select: { id: true, email: true, mobileNumber: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(limit * 2, 100),
    });
    const filtered = cursor
      ? items.filter((i) => {
          const d = i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as any);
          const cd = new Date(cursor!.date);
          return d < cd || (d.getTime() === cd.getTime() && i.id < cursor!.id);
        })
      : items;
    const slice = filtered.slice(0, limit);
    const last = slice[slice.length - 1];
    const nextCursor = last ? Buffer.from(JSON.stringify({ id: last.id, date: last.createdAt.toISOString() })).toString('base64') : null;
    const langIds = Array.from(new Set(slice.map((i) => i.language).filter((x): x is string => !!x)));
    const langs = await prisma.language.findMany({ where: { id: { in: langIds } } });
    const langMap = new Map(langs.map((l) => [l.id, l]));
    // categories and authors enrich
    const categoryIds = Array.from(new Set(slice.map((i: any) => i.categoryId).filter((x: any) => !!x)));
    const [catTranslations, cats] = await Promise.all([
      prisma.categoryTranslation.findMany({ where: { categoryId: { in: categoryIds }, language: user.languageId as any } }),
      prisma.category.findMany({ where: { id: { in: categoryIds } } }),
    ]);
    const catNameById = new Map<string, string>();
    for (const ct of catTranslations) catNameById.set(ct.categoryId, ct.name);
    for (const c of cats) if (!catNameById.has(c.id)) catNameById.set(c.id, c.name);
    const authorIds = Array.from(new Set(slice.map((i: any) => i.authorId).filter((x: any) => !!x)));
    const authorLocs = await prisma.userLocation.findMany({ where: { userId: { in: authorIds } } });
    const authorLocByUser = new Map(authorLocs.map((l) => [l.userId, l]));
    const data = slice.map((i: any) => {
      const l = i.language ? langMap.get(i.language as any) : undefined;
      const categoryName = i.categoryId ? catNameById.get(i.categoryId) ?? null : null;
      const author = i.author as any;
      const authorName = author?.email || author?.mobileNumber || null;
      const loc = authorLocByUser.get(i.authorId) as any;
      const placeName = i.placeName ?? (loc as any)?.placeName ?? null;
      const address = i.address ?? (loc as any)?.address ?? null;
      return {
        ...i,
        // Ensure mediaUrls always present as array
        mediaUrls: Array.isArray(i.mediaUrls) ? i.mediaUrls : [],
        languageId: i.language ?? null,
        languageName: l?.name ?? null,
        languageCode: l?.code ?? null,
        categoryName,
        authorName,
        placeName,
        address,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        accuracyMeters: i.accuracyMeters ?? null,
        provider: i.provider ?? null,
        timestampUtc: i.timestampUtc ?? null,
        placeId: i.placeId ?? null,
        source: i.source ?? null,
      } as any;
    });
    return res.json({ success: true, pageInfo: { limit, nextCursor, hasMore: filtered.length > limit }, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to fetch moderation list' });
  }
};

// Admin/Desk wide listing with optional filters and pagination
export const listAllShortNews = async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    if (!user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const roleName = (user?.role?.name || '').toUpperCase();
    const isSuper = roleName === 'SUPERADMIN' || roleName === 'SUPER_ADMIN';

    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);
    const cursorRaw = (req.query.cursor as string) || '';
    let cursor: { id: string; date: string } | null = null;
    if (cursorRaw) {
      try {
        const decoded = Buffer.from(cursorRaw, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.date === 'string') {
          cursor = { id: parsed.id, date: parsed.date };
        }
      } catch {}
    }

    const where: any = {};
    const qLanguageId = (req.query.languageId as string) || undefined;
    const qStatus = (req.query.status as string) || undefined;
    const qCategoryId = (req.query.categoryId as string) || undefined;
    if (qStatus) where.status = qStatus;
    if (qCategoryId) where.categoryId = qCategoryId;
    if (isSuper) {
      if (qLanguageId) where.language = qLanguageId;
    } else {
      // Non-super roles are scoped to their own language
      where.language = user.languageId as any;
    }

    const items = await prisma.shortNews.findMany({
      where,
      include: {
        author: {
          select: { id: true, email: true, mobileNumber: true, role: { select: { name: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(limit * 2, 100),
    });

    const filtered = cursor
      ? items.filter((i) => {
          const d = i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as any);
          const cd = new Date(cursor!.date);
          return d < cd || (d.getTime() === cd.getTime() && i.id < cursor!.id);
        })
      : items;

    const slice = filtered.slice(0, limit);
    const last = slice[slice.length - 1];
    const nextCursor = last ? Buffer.from(JSON.stringify({ id: last.id, date: last.createdAt.toISOString() })).toString('base64') : null;

    // Enrich language info
    const langIds = Array.from(new Set(slice.map((i) => i.language).filter((x): x is string => !!x)));
    const langs = await prisma.language.findMany({ where: { id: { in: langIds } } });
    const langMap = new Map(langs.map((l) => [l.id, l]));

    // Category names (language-aware best effort): prefer translation in each item's language, fallback to base name
    const categoryIds = Array.from(new Set(slice.map((i: any) => i.categoryId).filter((x: any) => !!x)));
    const sliceLangIds = Array.from(new Set(slice.map((i: any) => i.language).filter((x: any) => !!x)));
    const [catTranslations, cats] = await Promise.all([
      prisma.categoryTranslation.findMany({ where: { categoryId: { in: categoryIds }, language: { in: sliceLangIds as any } } }),
      prisma.category.findMany({ where: { id: { in: categoryIds } } }),
    ]);
    const catNameById = new Map<string, string>();
    const catNameByCatLang = new Map<string, string>();
    for (const ct of catTranslations) {
      catNameById.set(ct.categoryId, ct.name);
      catNameByCatLang.set(`${ct.categoryId}:${ct.language}`, ct.name);
    }
    for (const c of cats) if (!catNameById.has(c.id)) catNameById.set(c.id, c.name);

    // Author last known location for placeName/address
    const authorIds = Array.from(new Set(slice.map((i: any) => i.authorId).filter((x: any) => !!x)));
    const authorLocs = await prisma.userLocation.findMany({ where: { userId: { in: authorIds } } });
    const authorLocByUser = new Map(authorLocs.map((l) => [l.userId, l]));

    const data = slice.map((i: any) => {
      const l = i.language ? langMap.get(i.language as any) : undefined;
      const categoryName = i.categoryId ? (catNameByCatLang.get(`${i.categoryId}:${i.language}`) ?? catNameById.get(i.categoryId) ?? null) : null;
      const author = i.author as any;
      const authorName = author?.email || author?.mobileNumber || null;
      const loc = authorLocByUser.get(i.authorId) as any;
      const placeName = i.placeName ?? (loc as any)?.placeName ?? null;
      const address = i.address ?? (loc as any)?.address ?? null;
      // derive canonical url and primary media for convenience
      const languageCode = l?.code || 'en';
      const canonicalUrl = buildCanonicalUrl(languageCode, i.slug || i.id, 'short');
      const mediaUrls = Array.isArray(i.mediaUrls) ? i.mediaUrls : [];
      const imageUrls = mediaUrls.filter((u: string) => /\.(webp|png|jpe?g|gif|avif)$/i.test(u));
      const videoUrls = mediaUrls.filter((u: string) => /\.(webm|mp4|mov|ogg)$/i.test(u));
      const primaryImageUrl = imageUrls[0] || null;
      const primaryVideoUrl = videoUrls[0] || null;
      return {
        ...i,
        mediaUrls,
        primaryImageUrl,
        primaryVideoUrl,
        canonicalUrl,
        languageId: i.language ?? null,
        languageName: l?.name ?? null,
        languageCode: l?.code ?? null,
        categoryName,
        authorName,
        placeName,
        address,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        accuracyMeters: i.accuracyMeters ?? null,
        provider: i.provider ?? null,
        timestampUtc: i.timestampUtc ?? null,
        placeId: i.placeId ?? null,
        source: i.source ?? null,
      } as any;
    });

    return res.json({ success: true, pageInfo: { limit, nextCursor, hasMore: filtered.length > limit }, data });
  } catch (e) {
    console.error('Failed to fetch all short news:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch all short news' });
  }
};
