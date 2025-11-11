# Poppins Design PDF Generation Fixes

## Issues Identified and Fixed

### 1. **Missing Images (Logo, Stamp, Signature)**
**Problem:** Images were not showing because:
- Empty/null URLs were being passed as `'about:blank'` or empty strings
- No fallback handling for failed image loads
- Missing SVG placeholder function in the buildAttached scope

**Solution:**
- Added `svgPlaceholder()` function to generate fallback SVG images
- Used `normalizeUrl()` properly with fallback to SVG placeholders
- Added `onerror` handlers to all images with appropriate fallbacks
- Ensured all images (logo, stamp, signature) always have valid sources

### 2. **Missing Address Information on Back Card**
**Problem:** Office addresses were only shown if they existed in settings, leaving blank spaces.

**Solution:**
- Provided default fallback text for all address fields:
  - Head Office: "Head Office Address Not Available"
  - Regional Office: "Regional Office Address Not Available" 
  - Administration Office: "Administration Office Address Not Available"
- Always display all three address fields rather than conditional rendering

### 3. **Missing Contact Numbers**
**Problem:** Help line numbers were empty when no contact numbers were configured.

**Solution:**
- Added fallback contact number: `'+91-XXXX-XXXX-XX'` when no valid numbers exist

### 4. **Watermark Display Issues**
**Problem:** Watermark not showing when URLs were empty or invalid.

**Solution:**
- Improved watermark URL normalization
- Added default SVG watermark when no image is configured
- Used proper circle and text SVG as fallback

## Files Modified

### `src/api/hrci/idcard.routes.ts`
- **buildAttached() function**: Added SVG placeholder generation
- **Image handling**: Improved URL normalization with fallbacks
- **Address handling**: Always show address fields with fallback text
- **Error handling**: Added onerror handlers for all images

## Expected Results

After these fixes, the Poppins design PDF should show:

✅ **Front Card:**
- HRCI logo (left side) - always visible with fallback
- QR code - always visible with fallback
- Round stamp (bottom right) - always visible with fallback  
- Signature (bottom center) - always visible with fallback
- Member photo with fallback placeholder

✅ **Back Card:**
- HRCI logo (top right) - always visible with fallback
- QR code (top left) - always visible with fallback
- Watermark (center background) - always visible with fallback
- Office addresses - always shown with fallback text
- Contact numbers - always shown with fallback

## Testing

Test with this curl command:
```bash
curl -X 'POST' \
  'https://app.humanrightscouncilforindia.org/api/v1/hrci/idcard/pdf' \
  -H 'accept: application/pdf' \
  -H 'Content-Type: application/json' \
  -d '{
    "cardNumber": "hrci-2511-00003",
    "side": "both", 
    "design": "poppins"
  }'
```

The PDF should now display all elements properly even when settings have missing/empty image URLs.