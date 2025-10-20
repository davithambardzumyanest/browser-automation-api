# Changelog

## v2.0.0 - Puppeteer-Extra Integration (2025-10-20)

### 🎉 Major Update: Switched to puppeteer-extra with Stealth Plugin

#### Breaking Changes
- Migrated from vanilla Puppeteer to **puppeteer-extra**
- Integrated **puppeteer-extra-plugin-stealth** for superior bot detection bypass

#### New Features
- ✅ **23+ Automatic Evasion Techniques** - Comprehensive bot detection bypass
- ✅ **Canvas Fingerprinting Protection** - Prevents canvas-based detection
- ✅ **WebGL Fingerprinting Protection** - Prevents WebGL-based detection
- ✅ **Audio Context Protection** - Prevents audio fingerprinting
- ✅ **Font Fingerprinting Protection** - Prevents font enumeration
- ✅ **Screen Fingerprinting Protection** - Randomizes screen data
- ✅ **Zero Configuration** - Stealth features applied automatically

#### Improvements
- 🚀 **Better Google Compatibility** - Works seamlessly with Google Search, Forms, Maps
- 🚀 **Cloudflare Bypass** - Enhanced protection against Cloudflare detection
- 🚀 **Simplified Code** - Removed manual stealth configuration (handled by plugin)
- 🚀 **More Reliable** - Professional-grade evasion techniques

#### Technical Changes
- Removed manual `setupStealthPage()` function
- Removed custom `evaluateOnNewDocument` scripts
- Simplified browser launch arguments
- Plugin handles all anti-detection automatically

#### Dependencies Added
```json
{
  "puppeteer-extra": "^3.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2"
}
```

#### Migration Notes
All existing API endpoints work exactly the same - no changes needed to your API calls!

---

## v1.1.0 - Timeout & Performance Fixes (2025-10-20)

### Bug Fixes
- ✅ Fixed "Navigation timeout of 60000 ms exceeded" for Google
- ✅ Fixed "page.waitForTimeout is not a function" error

### Improvements
- Increased default timeout from 60s to 90s
- Changed wait strategy from `networkidle2` to `domcontentloaded`
- Added custom timeout parameter support
- Added 2-second wait for dynamic content rendering
- Created `wait()` helper function

---

## v1.0.0 - Initial Release (2025-10-20)

### Features
- 12 browser automation endpoints
- Manual stealth configuration
- Express.js best practices
- Security middleware (Helmet, CORS)
- Request logging (Morgan)
- Rate limiting support
- Environment configuration
- Health check endpoint
- Graceful shutdown handling
- Browser instance pooling

### Endpoints
1. `/api/screenshot` - Take screenshots
2. `/api/navigate` - Navigate to URLs
3. `/api/click-text` - Click by text content
4. `/api/click-selector` - Click by CSS selector
5. `/api/fill-form` - Fill form fields
6. `/api/content` - Get page content
7. `/api/execute-script` - Run custom JavaScript
8. `/api/wait-element` - Wait for elements
9. `/api/element-attributes` - Get element attributes
10. `/api/scroll` - Scroll pages
11. `/api/pdf` - Generate PDFs
12. `/api/type` - Type text with delays
