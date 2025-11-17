# App Links Backend Requirements

## Overview
This document outlines exactly what the backend must provide so "Read:" links always open in-app and detail fetch never 404s, plus optional enhancements for robust client behavior.

## Must-Have: App Links Configuration

### Domain File Requirements
- **Host Location**: `/.well-known/assetlinks.json` on `https://app.hrcitodaynews.in`
- **Content**: JSON array with BOTH fingerprints for complete coverage:
  ```json
  [
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.amoghnya.khabarx",
        "sha256_cert_fingerprints": [
          "FA:C6:17:…:3B:9C",  // debug keystore
          "14:BB:6E:…:5A:AB"   // release keystore
        ]
      }
    }
  ]
  ```
- **Package Match**: Must exactly match `com.amoghnya.khabarx`
- **Multi-Domain**: If also using `app.humanrightscouncilforindia.org`, host separate assetlinks.json there with same fingerprints

### Link Format (Choose ONE)
1. **Preferred**: `https://app.hrcitodaynews.in/article/<canonicalId>`
2. **Acceptable**: `https://app.hrcitodaynews.in/te/short/<slug>?id=<canonicalId>`
3. **Legacy Support**: If keeping `…-233603` suffixes, provide resolution mechanism

## API Requirements

### 1. Article Detail API (Contract)
**Endpoint**: `GET /api/v1/articles/<id>`
**Input**: Canonical article ID (string like `cmhhgbf4y000kip1eict2ucyy`)
**Response Fields**:
```typescript
{
  id: string;
  title: string;
  body: string;
  image?: string;
  images?: string[];
  videoUrl?: string;
  author: {
    id: string;
    fullName: string;  // or 'name'
    profilePhotoUrl?: string;  // or 'avatar'
    roleName?: string;
    placeName?: string;
  };
  category?: string;
  createdAt: string;
  likes?: number;
  dislikes?: number;
  comments?: number;
  canonicalUrl: string;  // HTTPS on app.hrcitodaynews.in
  metaTitle?: string;
  metaDescription?: string;
}
```

### 2. Resolve API (Recommended)
**Purpose**: Convert any public URL/slug into canonical article ID

**Option A - URL Resolution**:
```
GET /api/v1/articles/resolve?url=<encoded article url>
Response: { "id": "cmhhgbf4y000kip1eict2ucyy" }
```

**Option B - Slug Resolution**:
```
GET /api/v1/articles/by-slug?lang=te&slug=prcuuruloo-vrd-...-233603
Response: { "id": "cmhhgbf4y000kip1eict2ucyy" }
```

**Option C - External ID Resolution**:
```
GET /api/v1/articles/by-external-id?externalId=233603
Response: { "id": "cmhhgbf4y000kip1eict2ucyy" }
```

## Implementation Examples

### Share Support Integration
The existing share support module already provides:
- `GET /api/articles/{id}` - canonical article JSON
- `/:lang/short/:slug-:id` - shareable HTML pages
- `/.well-known/assetlinks.json` - Android App Links verification

### Example Resolve Implementation
```typescript
// In existing share-support.ts or new resolver
export async function resolveArticleUrl(url: string): Promise<{ id: string } | null> {
  try {
    // Parse different URL patterns
    const patterns = [
      /\/article\/([a-zA-Z0-9]+)$/,
      /\/([a-z]{2})\/short\/.*?-([a-zA-Z0-9]+)$/,
      /[?&]id=([a-zA-Z0-9]+)/,
      /-(\d+)$/  // Legacy numeric suffix
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const idOrNumber = match[1] || match[2];
        
        // If it's a canonical ID, return directly
        if (idOrNumber.length > 10 && /[a-zA-Z]/.test(idOrNumber)) {
          return { id: idOrNumber };
        }
        
        // If numeric, resolve to canonical ID
        if (/^\d+$/.test(idOrNumber)) {
          const article = await prisma.shortNews.findFirst({
            where: { 
              OR: [
                { id: parseInt(idOrNumber) },
                { slug: { endsWith: `-${idOrNumber}` } }
              ]
            },
            select: { id: true }
          });
          return article ? { id: article.id } : null;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('URL resolution failed:', error);
    return null;
  }
}
```

### Route Integration
```typescript
// Add to existing routes
app.get('/api/v1/articles/resolve', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter required' });
  }
  
  const resolved = await resolveArticleUrl(url);
  if (!resolved) {
    return res.status(404).json({ error: 'Article not found' });
  }
  
  res.json(resolved);
});
```

## Web Page Metadata (Optional Enhancement)

### JSON-LD Integration
Add to article HTML pages:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "{{title}}",
  "image": "{{image}}",
  "datePublished": "{{createdAt}}",
  "author": {
    "@type": "Person",
    "name": "{{author.fullName}}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "{{publisherName}}"
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "{{canonicalUrl}}"
  }
}
</script>
```

### Machine-Readable ID Reference
```html
<meta name="app:article:id" content="{{canonicalId}}" />
<meta name="app:deep-link" content="app://article/{{canonicalId}}" />
```

## Domain Strategy Clarification

### Single Domain Approach (Recommended)
- Use `app.hrcitodaynews.in` for ALL "Read:" links
- Host assetlinks.json with both debug/release fingerprints
- Consistent user experience

### Multi-Domain Support
- If using multiple domains, each needs its own assetlinks.json
- Android verifies per-domain, not globally
- Ensure canonical URLs always use the primary domain

## Client Integration Plan

### With Resolve API
1. Extract URL from deep link
2. Call `resolve?url=...` to get canonical ID
3. Fetch article detail with canonical ID
4. Fallback to WebView if resolution fails

### Without Resolve API
1. Parse URL patterns client-side
2. Extract canonical ID or numeric suffix
3. Try detail fetch with extracted ID
4. Fallback to WebView for unparseable URLs

## Testing Checklist

### App Links Verification
- [ ] Verify `https://app.hrcitodaynews.in/.well-known/assetlinks.json` accessible
- [ ] Confirm both debug and release fingerprints present
- [ ] Package name exactly matches `com.amoghnya.khabarx`
- [ ] Test deep links via `adb shell am start -a android.intent.action.VIEW -d "..."`

### API Endpoints
- [ ] Article detail returns all required fields
- [ ] Canonical URLs use correct domain
- [ ] Resolve API handles various URL formats (if implemented)
- [ ] 404 handling for non-existent articles

### Link Format
- [ ] All shared "Read:" links use chosen format consistently
- [ ] Links open in-app when app installed
- [ ] Links fall back to web browser when app not installed

## Next Steps

1. **Choose link format** from the three options above
2. **Implement resolve API** (recommended) or document exact parsing rules
3. **Update assetlinks.json** with both keystore fingerprints
4. **Test end-to-end flow** with debug build
5. **Deploy and verify** with release build

This ensures seamless app link functionality and eliminates 404 errors for shared content.