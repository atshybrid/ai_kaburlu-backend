// share-support.ts
// Minimal, self-contained share + deep link support for KhabarX

import type { Express, Request, Response } from 'express';
import prisma from './prisma';

// Update these for your environment
const DOMAIN = process.env.SHARE_DOMAIN || 'https://app.hrcitodaynews.in'; // must be public https
const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || 'com.amoghnya.khabarx';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=' + PACKAGE_NAME;
// Replace with your RELEASE keystore SHA-256 fingerprint
// Fingerprints: allow multiple (debug + release) via ANDROID_SHA256_FINGERPRINTS or comma-separated single env
const ANDROID_SHA256_SINGLE = process.env.ANDROID_SHA256_FINGERPRINT || 'YOUR_RELEASE_KEY_SHA256';
const ANDROID_SHA256_MULTI = process.env.ANDROID_SHA256_FINGERPRINTS || ANDROID_SHA256_SINGLE;
const ANDROID_FINGERPRINTS = ANDROID_SHA256_MULTI.split(/\s*,\s*/).filter(Boolean);

export function registerShareSupport(app: Express) {
  // 1) Android App Links verification
  app.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
    res.type('application/json').send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: ANDROID_FINGERPRINTS.length ? ANDROID_FINGERPRINTS : ['YOUR_RELEASE_KEY_SHA256'],
        },
      },
    ]);
  });

  // 2) Canonical article JSON (fields the app expects)
  // GET /api/articles/:id
  app.get('/api/articles/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      // Try to find as ShortNews first
      const shortNews = await prisma.shortNews.findUnique({
        where: { id },
        include: {
          author: {
            include: {
              profile: true,
              role: true,
            },
          },
          category: true,
        },
      });

      if (!shortNews) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }

      // Get language info
      let language = null;
      if (shortNews.language) {
        language = await prisma.language.findUnique({ 
          where: { id: shortNews.language as string } 
        });
      }

      const slug = shortNews.slug || slugify(shortNews.title);
      const languageCode = language?.code || 'te';
      const canonicalUrl = `${DOMAIN}/${languageCode}/short/${slug}-${id}`;

      // Extract primary image from mediaUrls
      const mediaUrls = Array.isArray(shortNews.mediaUrls) ? shortNews.mediaUrls : [];
      const primaryImage = mediaUrls.find(url => 
        /\.(webp|png|jpe?g|gif|avif)$/i.test(url)
      ) || '';

      res.json({
        id,
        title: shortNews.title,
        summary: shortNews.content.slice(0, 200), // Use content as summary
        body: shortNews.content,
        image: primaryImage, // must be public
        canonicalUrl,      // required by the app
        category: shortNews.category?.name ?? 'General',
        createdAt: shortNews.createdAt.toISOString(),
        author: {
          fullName: shortNews.author?.profile?.fullName ?? shortNews.author?.email ?? shortNews.author?.mobileNumber ?? '',
          roleName: shortNews.author?.role?.name ?? '',
          profilePhotoUrl: shortNews.author?.profile?.profilePhotoUrl ?? '',
          address: shortNews.address ?? '',
        },
        // Optional if you later pre-render a share card:
        // shareImageUrl: `${CDN_BASE}/share/${id}.jpg`,
      });
    } catch (error) {
      console.error('Error fetching article:', error);
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // 3) Canonical article page with SEO + app-open fallback
  // GET /:lang/short/:slug-:id
  app.get('/:lang/short/:slug-:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const lang = String(req.params.lang);
      
      const shortNews = await prisma.shortNews.findUnique({
        where: { id },
        include: {
          author: {
            include: {
              profile: true,
              role: true,
            },
          },
          category: true,
        },
      });

      if (!shortNews) {
        return res.status(404).send('Not found');
      }

      const title = shortNews.title || 'News';
      const desc = shortNews.content.slice(0, 200);
      
      // Extract primary image from mediaUrls
      const mediaUrls = Array.isArray(shortNews.mediaUrls) ? shortNews.mediaUrls : [];
      const hero = mediaUrls.find(url => 
        /\.(webp|png|jpe?g|gif|avif)$/i.test(url)
      ) || `${DOMAIN}/assets/default-news-image.jpg`; // fallback image
      
      const deep = `khabarx://article/${id}`; // custom scheme for fallback

      res.type('html').send(`<!doctype html>
<html lang="${esc(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <!-- SEO / Social -->
  <meta property="og:type" content="article"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(desc)}"/>
  <meta property="og:image" content="${hero}"/>
  <meta property="og:url" content="${DOMAIN}/${lang}/short/${shortNews.slug || slugify(title)}-${id}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(desc)}"/>
  <meta name="twitter:image" content="${hero}"/>
  <!-- If App Links verification passed, Android opens app directly on tap.
       Script below is a safety net: try deep link, else Play Store. -->
  <script>
    (function(){
      var opened = false;
      var t = setTimeout(function(){ if(!opened) location.href='${PLAY_STORE_URL}'; }, 1200);
      // Kick deep link
      var a = document.createElement('a'); a.href='${deep}'; a.style.display='none';
      document.body.appendChild(a); a.click();
      document.addEventListener('visibilitychange', function(){
        if (document.hidden) { opened = true; clearTimeout(t); }
      });
    })();
  </script>
  <style>
    body{font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:20px;background:#f5f5f5;}
    .container{max-width:600px;margin:0 auto;background:white;padding:20px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
    img{max-width:100%;height:auto;border-radius:8px;margin:16px 0;}
    .meta{color:#666;margin-top:16px;font-size:14px;}
    .author{display:flex;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid #eee;}
    .author-photo{width:40px;height:40px;border-radius:50%;margin-right:12px;background:#ddd;}
    .author-info{flex:1;}
    .author-name{font-weight:500;margin:0;}
    .author-role{color:#666;font-size:12px;margin:2px 0 0 0;}
    .actions{margin-top:24px;text-align:center;}
    .btn{display:inline-block;padding:12px 24px;margin:0 8px;background:#007bff;color:white;text-decoration:none;border-radius:6px;font-weight:500;}
    .btn:hover{background:#0056b3;}
    .btn-secondary{background:#6c757d;}
    .btn-secondary:hover{background:#545b62;}
  </style>
</head>
<body>
  <div class="container">
    <h1>${esc(title)}</h1>
    ${desc ? `<p>${esc(desc)}</p>` : ''}
    ${hero && hero !== `${DOMAIN}/assets/default-news-image.jpg` ? `<img alt="News image" src="${hero}"/>` : ''}
    
    ${shortNews.author ? `
    <div class="author">
      ${shortNews.author.profile?.profilePhotoUrl ? 
        `<img class="author-photo" src="${shortNews.author.profile.profilePhotoUrl}" alt="Author"/>` : 
        `<div class="author-photo"></div>`
      }
      <div class="author-info">
        <p class="author-name">${esc(shortNews.author.profile?.fullName || shortNews.author.email || shortNews.author.mobileNumber || 'Anonymous')}</p>
        <p class="author-role">${esc(shortNews.author.role?.name || '')}</p>
      </div>
    </div>` : ''}
    
    <p class="meta">
      Published ${shortNews.createdAt.toLocaleDateString()} 
      ${shortNews.category ? `in ${esc(shortNews.category.name)}` : ''}
    </p>
    
    <div class="actions">
      <a href="${deep}" class="btn">Open in App</a>
      <a href="${PLAY_STORE_URL}" class="btn btn-secondary">Get App</a>
    </div>
  </div>
</body>
</html>`);
    } catch (error) {
      console.error('Error rendering share page:', error);
      res.status(500).send('Internal server error');
    }
  });

  // 4) Optional: short link that 301-redirects to canonical
  // GET /s/:code -> 301 /:lang/short/:slug-:id
  app.get('/s/:code', async (req: Request, res: Response) => {
    try {
      const code = String(req.params.code);
      
      // Try to find shortNews by id (treat code as id for now)
      const shortNews = await prisma.shortNews.findUnique({
        where: { id: code },
        select: { id: true, title: true, slug: true, language: true },
      });

      if (!shortNews) {
        return res.status(404).send('Short link not found');
      }

      // Get language code
      let languageCode = 'te'; // default
      if (shortNews.language) {
        const language = await prisma.language.findUnique({ 
          where: { id: shortNews.language as string },
          select: { code: true }
        });
        languageCode = language?.code || 'te';
      }

      const slug = shortNews.slug || slugify(shortNews.title);
      res.redirect(301, `/${languageCode}/short/${slug}-${shortNews.id}`);
    } catch (error) {
      console.error('Error resolving short link:', error);
      res.status(500).send('Internal server error');
    }
  });

  // 5) Caching headers (recommended)
  // HTML short TTL
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.match(/\/\w+\/short\//)) {
      res.set('Cache-Control', 'public, max-age=30'); // 30s
    }
    next();
  });
}

function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'news';
}

function esc(s = ''): string {
  return s.replace(/[&<>\"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]!));
}

// Helper: resolve an arbitrary article URL/slug into canonical ID
async function resolveArticleUrl(url: string): Promise<{ id: string } | null> {
  try {
    const patterns: RegExp[] = [
      /\/article\/([a-zA-Z0-9]+)$/,
      /\/([a-z]{2})\/short\/[^?]*?-([a-zA-Z0-9]+)$/,
      /[?&]id=([a-zA-Z0-9]+)/,
      /-(\d+)$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const captured = match[1] || match[2];
        if (!captured) continue;
        // If looks like canonical ID (alphanumeric length > 10 with letters)
        if (/^[a-zA-Z0-9]{12,}$/.test(captured) && /[a-z]/i.test(captured)) {
          return { id: captured };
        }
        // Numeric external id, map via slug suffix
        if (/^\d+$/.test(captured)) {
          const found = await prisma.shortNews.findFirst({
            where: { slug: { endsWith: `-${captured}` } },
            select: { id: true },
          });
          if (found) return { id: found.id };
        }
      }
    }
    return null;
  } catch (e) {
    console.error('resolveArticleUrl failure', e);
    return null;
  }
}