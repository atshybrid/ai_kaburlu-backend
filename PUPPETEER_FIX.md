# Puppeteer Chrome Fix for PDF Generation

## Issue
PDF generation was failing in production with error:
```
Could not find Chrome (ver. 141.0.7390.78). This can occur if either
1. you did not perform an installation before running the script
2. your cache path is incorrectly configured
```

## Solution Implemented

### 1. Puppeteer Configuration (`.puppeteerrc.cjs`)
- Added cache directory configuration
- Support for skipping download when system Chrome is available

### 2. Chrome Installation Script (`scripts/installChrome.js`)
- Automatically installs Chrome during build process
- Handles production environment detection
- Provides fallback for system Chrome detection

### 3. Package.json Updates
- `postinstall` now includes Chrome installation
- Added separate `postinstall:chrome` script for manual runs

### 4. Production Environment Files
- `apt.txt`: Installs Chrome via system package manager on Render
- `render.yaml`: Configures environment variables and build process

### 5. Runtime Chrome Detection
Updated both ID card and appointment letter PDF generation to:
- Try multiple Chrome executable paths
- Use improved browser launch arguments for containerized environments
- Handle missing Chrome gracefully

## Environment Variables

Set these in your production environment:

```bash
# Required for Render deployment
GOOGLE_CHROME_BIN=/usr/bin/google-chrome-stable
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Optional: Skip Puppeteer's Chrome download if using system Chrome
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Optional: Override Chrome executable path
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

## Deployment Steps

### For Render:
1. Add `apt.txt` to project root (already added)
2. Set environment variables in Render dashboard
3. Deploy - Chrome will be installed via apt and Puppeteer

### For Other Platforms:
1. Ensure Chrome/Chromium is available via package manager
2. Set `GOOGLE_CHROME_BIN` to Chrome executable path
3. Run `npm install` (will install Puppeteer's Chrome as fallback)

## Testing
After deployment, test PDF generation with:
```bash
curl -X POST "https://your-domain.com/api/v1/hrci/idcard/pdf" \
  -H "Content-Type: application/json" \
  -d '{"cardNumber": "test-card", "side": "both", "design": "poppins"}'
```

## Troubleshooting

### If PDFs still fail:
1. Check Chrome installation: `which google-chrome-stable`
2. Verify environment variables are set
3. Check logs for Chrome path detection
4. Try setting `PUPPETEER_EXECUTABLE_PATH` explicitly

### Memory issues:
Add these Chrome args if running out of memory:
- `--memory-pressure-off`
- `--max_old_space_size=2048`