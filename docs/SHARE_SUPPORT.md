# Share Support & Deep Links

This module provides comprehensive share and deep link support for the KhabarX mobile app, enabling seamless sharing of news articles with automatic app opening and fallback to Play Store.

## Features

- **Android App Links**: Automatic app opening when users tap shared links
- **Deep Link Fallback**: Custom scheme fallback with Play Store redirect
- **SEO-Optimized Pages**: Rich social media previews with Open Graph meta tags
- **Short Links**: Optional short URL support for easier sharing
- **Canonical JSON API**: Structured data endpoint for mobile app consumption

## Setup

### 1. Environment Variables

Add these to your `.env` file:

```env
# Domain for canonical URLs and share links (must be public HTTPS)
SHARE_DOMAIN=https://app.hrcitodaynews.in
# Android app package name for deep links
ANDROID_PACKAGE_NAME=com.amoghnya.khabarx
# SHA-256 fingerprint of your release signing key
ANDROID_SHA256_FINGERPRINT=YOUR_RELEASE_KEY_SHA256
```

### 2. Get Your Release Key SHA-256 Fingerprint

```bash
# For release keystore
keytool -list -v -keystore your-release-key.keystore -alias your-key-alias

# Look for "SHA256:" under "Certificate fingerprints:"
# Example: SHA256: AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78
```

### 3. Domain Verification

Upload the generated `assetlinks.json` to your domain:
- File location: `https://yourdomain.com/.well-known/assetlinks.json`
- The module automatically serves this at `/.well-known/assetlinks.json`

### 4. Android App Configuration

Add to your `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- App Links intent filter -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="app.hrcitodaynews.in" />
</intent-filter>

<!-- Custom scheme fallback -->
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="khabarx" />
</intent-filter>
```

## API Endpoints

### 1. Android App Links Verification
```
GET /.well-known/assetlinks.json
```
Returns the asset links configuration for Android App Links verification.

### 2. Article JSON API
```
GET /api/articles/:id
```
Returns structured article data for mobile app consumption:

```json
{
  "id": "article-id",
  "title": "Article Title",
  "summary": "Article summary...",
  "body": "Full article content...",
  "image": "https://cdn.example.com/image.jpg",
  "canonicalUrl": "https://app.hrcitodaynews.in/te/short/article-slug-id",
  "category": "Politics",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "author": {
    "fullName": "Reporter Name",
    "roleName": "REPORTER",
    "profilePhotoUrl": "https://cdn.example.com/photo.jpg",
    "address": "Location"
  }
}
```

### 3. Shareable Article Page
```
GET /:lang/short/:slug-:id
```
Returns an SEO-optimized HTML page with:
- Open Graph meta tags for rich social previews
- Automatic deep link attempt
- Fallback to Play Store if app not installed

### 4. Short Links (Optional)
```
GET /s/:code
```
Redirects to the canonical article page. Currently treats the code as an article ID.

## URL Structure

### Canonical URLs
```
https://app.hrcitodaynews.in/te/short/article-slug-cmhakofmq005augzod2341qjn
https://app.hrcitodaynews.in/en/short/highway-repair-works-cmhakofmq005augzod2341qjn
```

### Short Links
```
https://app.hrcitodaynews.in/s/cmhakofmq005augzod2341qjn
```

### Deep Links
```
khabarx://article/cmhakofmq005augzod2341qjn
```

## Mobile App Integration

### Sharing from App
When users share an article, the app should use the canonical URL:

```javascript
const shareUrl = `${SHARE_DOMAIN}/${languageCode}/short/${article.slug}-${article.id}`;

// Share via native share sheet
Share.share({
  title: article.title,
  url: shareUrl
});
```

### Handling Incoming Links
Handle both App Links and deep links in your app:

```javascript
// React Navigation linking configuration
const linking = {
  prefixes: ['https://app.hrcitodaynews.in', 'khabarx://'],
  config: {
    screens: {
      ArticleDetail: {
        path: '/:lang/short/:slug-:id',
        parse: {
          id: (slug_id) => slug_id.split('-').pop(), // Extract ID from slug-id
        }
      },
      ArticleDetailDeep: 'article/:id'
    }
  }
};
```

## Flow Diagram

```
User taps shared link
        ↓
1. Android App Links verified?
   ↓ YES          ↓ NO
   App opens    Browser loads
                canonical page
                      ↓
                JavaScript tries
                deep link
                      ↓
                App installed?
                ↓ YES    ↓ NO
            App opens  Play Store
```

## Caching Strategy

- **Canonical pages**: 30 seconds (allows for quick content updates)
- **Asset links**: Cached by CDN (rarely changes)
- **Images**: Long-term caching recommended via CDN

## Testing

### Test App Links
```bash
# Test asset links verification
curl https://yourdomain.com/.well-known/assetlinks.json

# Test canonical page
curl https://yourdomain.com/te/short/test-article-id

# Test article JSON API
curl https://yourdomain.com/api/articles/article-id
```

### Test on Device
1. Share a link from messaging app to yourself
2. Tap the link - app should open directly
3. If app opens in browser first, check:
   - Domain verification in Google Search Console
   - Asset links JSON is accessible
   - Android manifest has correct intent filters

## Troubleshooting

### App Links Not Working
1. Verify asset links JSON is accessible
2. Check domain verification in Google Search Console
3. Ensure SHA-256 fingerprint matches your release key
4. Test with `adb shell am start -W -a android.intent.action.VIEW -d "https://yourdomain.com/te/short/test-id"`

### Images Not Loading
1. Ensure article images are publicly accessible (no auth required)
2. Check CORS headers for image domains
3. Verify image URLs are absolute, not relative

### Deep Links Failing
1. Check custom scheme in Android manifest
2. Test deep link: `adb shell am start -W -a android.intent.action.VIEW -d "khabarx://article/test-id"`
3. Verify app's link handling configuration

## Production Checklist

- [ ] Update `SHARE_DOMAIN` to production domain
- [ ] Set correct `ANDROID_PACKAGE_NAME`
- [ ] Replace `ANDROID_SHA256_FINGERPRINT` with release keystore fingerprint
- [ ] Verify domain in Google Search Console
- [ ] Test asset links JSON accessibility
- [ ] Test share flow end-to-end
- [ ] Configure CDN caching for canonical pages
- [ ] Set up monitoring for 404s on share URLs

## Security Considerations

- Asset links JSON contains your app's package name and signing certificate
- Canonical URLs are publicly accessible (no authentication required)
- Deep links should validate article IDs to prevent malicious usage
- Consider rate limiting on share endpoints

## Future Enhancements

- **Dynamic share images**: Generate custom OG images per article
- **Analytics tracking**: Track share link clicks and conversions
- **A/B testing**: Different sharing page layouts
- **Multiple deep link schemes**: Support for different app variants
- **Universal Links**: iOS support (requires similar setup)