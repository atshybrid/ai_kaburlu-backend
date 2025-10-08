export type NewsArticleJsonLd = Record<string, any>;

function toAbsolute(url: string | undefined | null, base: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return base.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
}

export function buildNewsArticleJsonLd(params: {
  headline: string;
  description?: string;
  canonicalUrl: string;
  imageUrls?: string[];
  languageCode?: string;
  datePublished?: string | Date;
  dateModified?: string | Date;
  authorName?: string;
  publisherName?: string;
  publisherLogoUrl?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
}): NewsArticleJsonLd {
  const {
    headline,
    description,
    canonicalUrl,
    imageUrls = [],
    languageCode = 'en',
    datePublished,
    dateModified,
    authorName,
    publisherName,
    publisherLogoUrl = process.env.SEO_PUBLISHER_LOGO || '',
    videoUrl,
    videoThumbnailUrl,
  } = params;

  const article: any = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: String(headline).slice(0, 110),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    inLanguage: languageCode,
  };

  if (description) article.description = String(description).slice(0, 160);
  if (imageUrls.length) article.image = imageUrls;
  if (datePublished) article.datePublished = new Date(datePublished).toISOString();
  if (dateModified) article.dateModified = new Date(dateModified).toISOString();
  if (authorName) article.author = { '@type': 'Person', name: authorName };
  if (publisherName) {
    article.publisher = {
      '@type': 'Organization',
      name: publisherName,
      logo: publisherLogoUrl ? { '@type': 'ImageObject', url: publisherLogoUrl } : undefined,
    };
  }

  if (videoUrl) {
    article.video = {
      '@type': 'VideoObject',
      name: headline,
      description: description || headline,
      uploadDate: (datePublished ? new Date(datePublished) : new Date()).toISOString(),
      contentUrl: videoUrl,
      thumbnailUrl: videoThumbnailUrl || (imageUrls && imageUrls[0]) || undefined,
    };
  }

  return article;
}
