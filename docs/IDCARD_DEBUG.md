# ID Card rendering: debug and image inlining

This guide helps you diagnose server‑only missing logos/addresses and enable robust image inlining for reliable PDF/HTML output.

## Env flags

- PDF_DEBUG=1
  - Enables Puppeteer page console + network logs. You’ll see:
    - [PDF][image-response] …
    - [PDF][inline-summary] inlined images: N
    - [IDCARD][setting] … (active/fallback IdCardSetting snapshot)
- PDF_DEBUG_VERBOSE=1
  - Adds verbose image response logs.
- PDF_INLINE_IMAGES=1
  - Server pre‑inlines critical images (logos, stamp, sign, photo, watermark) into data URLs for:
    - Poppins/Attached (front/back)
    - CR80 (front/back) – added parity
  - Puppeteer also has a page‑level inliner as a safety net.
- DF_DEBUG=1
  - Convenience bridge on Render: DF_DEBUG automatically turns on PDF_DEBUG and PDF_DEBUG_VERBOSE.
- PUBLIC_IDCARD_BASE_URL
  - Public verification base used to build QR scan URLs (defaults to https://humanrightscouncilforindia.org/idcard).

## Quick verify

1) HTML preview with debug overlay
- /hrci/idcard/{cardNumber}/html?design=cr80&debug=1
- /hrci/idcard/{cardNumber}/html?debug=1  (Poppins/Attached)
  - Left‑top green panel shows card data and setting asset URLs.

2) PDF generation
- /hrci/idcard/{cardNumber}/pdf?design=cr80
- /hrci/idcard/{cardNumber}/pdf  (Poppins/Attached)
  - Check server logs for:
    - [PDF][inline-summary] inlined images: <num>
    - [IDCARD][CR80][inline] { logo, secondLogo, stamp, sign, photo, watermark }

3) Settings snapshot (admin)
- GET /hrci/idcard/settings  (requires admin)
  - Ensure frontLogoUrl, secondLogoUrl, authorSignUrl, hrciStampUrl, watermarkLogoUrl, addresses and contacts are populated.

## Troubleshooting

- Logos/addresses missing only on server
  - Enable PDF_DEBUG=1 (or DF_DEBUG=1 on Render) and repeat the PDF request.
  - If [PDF][image-response][error] for your URLs: make them absolute (https://...) or ensure the relative paths resolve on the server (e.g., /uploads/... served by this API). The code normalizes /... to your server origin.
  - Turn on PDF_INLINE_IMAGES=1 to embed assets directly and avoid network fetches during render.

- No active IdCardSetting
  - The renderer now falls back to any available settings row to avoid undefined fields.

- Watermark not set
  - Set watermarkLogoUrl in IdCardSetting. You can also override per request:
    - ?watermark=https://example.com/wm.png on both /html and /pdf endpoints.

## Notes

- QR is generated as inline SVG and scales safely.
- Placeholders (SVG) are used if an asset URL is empty to avoid broken icons.
- For Render, it’s often enough to set:
  - DF_DEBUG=1
  - PDF_INLINE_IMAGES=1

