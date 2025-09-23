import prisma from '../../lib/prisma';
import { sendToTokensEnhanced, sendToTopic } from '../../lib/fcm';
import { buildCanonicalUrl } from '../../lib/domains';

/**
 * Best-practice idempotent ShortNews notification sender.
 * Strategy:
 * 1. Load ShortNews with language & early exit if not in APPROVED states.
 * 2. Idempotency via notifiedAt field + PushNotificationLog existing check.
 * 3. Collect device tokens for same language; if large fanout, you can pivot to topics only.
 * 4. Send push (tokens first for granular analytics) + optional topics for subscription fanout.
 * 5. Mark notifiedAt.
 */
export async function sendShortNewsApprovedNotification(
  shortNewsId: string,
  { useTopics = true, force = false, dryRun = false }: { useTopics?: boolean; force?: boolean; dryRun?: boolean } = {}
) {
  const sn = await prisma.shortNews.findUnique({ where: { id: shortNewsId }, include: { } });
  if (!sn) return { skipped: true, reason: 'not-found' };
  const approved = sn.status === 'AI_APPROVED' || sn.status === 'DESK_APPROVED';
  if (!approved) return { skipped: true, reason: 'status' };
  if ((sn as any).notifiedAt && !force) return { skipped: true, reason: 'already-notified' };

  // Existing log? (best-effort JSON path filter may not work on all providers; fallback manual comparison if needed)
  if (!force) {
    const existing = await prisma.pushNotificationLog.findFirst({
      where: {
        sourceAction: 'shortnews-approve',
        data: { path: ['shortNewsId'], equals: sn.id } as any
      }
    }).catch(() => null);
    if (existing) {
      if (!(sn as any).notifiedAt) {
        await prisma.shortNews.update({ where: { id: sn.id }, data: { notifiedAt: new Date() } as any });
      }
      return { skipped: true, reason: 'log-exists' };
    }
  }

  // Resolve language code via string stored in language field (schema uses String not relation id to Language model name)
  let languageCode = 'en';
  if (sn.language) {
    const lang = await prisma.language.findUnique({ where: { id: sn.language } });
    if (lang?.code) languageCode = lang.code;
  }
  const canonicalUrl = buildCanonicalUrl(languageCode, sn.slug || sn.id, 'short');
  const mediaUrls: string[] = Array.isArray((sn as any).mediaUrls) ? (sn as any).mediaUrls : [];
  const image = mediaUrls.find(u => /(webp|png|jpe?g|gif|avif)$/i.test(u));
  const body = (sn.content || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  // Collect tokens for same language (device.languageId -> matches Language.id) if available
  const langRow = await prisma.language.findFirst({ where: { code: languageCode } });
  let tokens: string[] = [];
  if (langRow) {
    const devices = await prisma.device.findMany({
      where: { pushToken: { not: null }, languageId: langRow.id },
      select: { pushToken: true }
    });
    tokens = devices.map(d => d.pushToken!).filter(Boolean);
  }

  const payload = {
    title: sn.title,
    body,
    image,
    data: {
      type: 'SHORTNEWS',
      shortNewsId: sn.id,
      languageCode,
      url: canonicalUrl,
      categoryId: (sn as any).categoryId || ''
    }
  };

  if (dryRun) {
    return { dryRun: true, wouldSendTo: tokens, payload, topics: useTopics ? {
      language: `news-lang-${languageCode.toLowerCase()}`,
      category: (sn as any).categoryId ? `news-cat-${String((sn as any).categoryId).toLowerCase()}` : null
    } : undefined };
  }

  // Send to tokens (enhanced logging) if any
  let tokenResult: any = undefined;
  if (tokens.length) {
    tokenResult = await sendToTokensEnhanced(tokens, payload, {
      sourceController: 'shortnews-service',
      sourceAction: 'shortnews-approve'
    });
  }

  let topicResults: any = undefined;
  if (useTopics) {
    try {
      const langTopic = languageCode && `news-lang-${languageCode.toLowerCase()}`;
      const catTopic = (sn as any).categoryId && `news-cat-${String((sn as any).categoryId).toLowerCase()}`;
      const promises: Promise<any>[] = [];
      if (langTopic) promises.push(sendToTopic(langTopic, payload));
      if (catTopic) promises.push(sendToTopic(catTopic, payload));
      topicResults = await Promise.all(promises);
    } catch (e) {
      console.warn('Topic send failed (non-fatal):', e);
    }
  }

  if (!(sn as any).notifiedAt || force) {
    await prisma.shortNews.update({ where: { id: sn.id }, data: { notifiedAt: new Date() } as any });
  }
  return { sent: true, tokens: tokens.length, tokenResult, topicResults };
}
