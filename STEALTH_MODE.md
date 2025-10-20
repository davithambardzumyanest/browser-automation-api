# Stealth Mode - Anti-Detection Features

## Overview

The browser API uses **puppeteer-extra** with the **puppeteer-extra-plugin-stealth** to bypass bot detection systems used by Google, Cloudflare, and other websites that block headless browsers.

## Why Stealth Mode?

Many websites (especially Google) detect and block automated browsers by checking for:
- `navigator.webdriver` property
- Missing Chrome runtime objects
- Headless browser user agents
- Automation-specific browser flags
- Missing browser plugins
- Unusual HTTP headers
- Canvas fingerprinting
- WebGL fingerprinting
- Audio context fingerprinting
- And many more advanced techniques

## Implemented Stealth Features

### Powered by puppeteer-extra-plugin-stealth

The stealth plugin automatically applies **23+ evasion techniques**:

#### Core Evasions:
1. **chrome.app** - Adds chrome.app object
2. **chrome.csi** - Adds chrome.csi with timing data
3. **chrome.loadTimes** - Adds chrome.loadTimes function
4. **chrome.runtime** - Adds chrome.runtime object
5. **iframe.contentWindow** - Fixes iframe issues
6. **media.codecs** - Adds realistic codec support
7. **navigator.hardwareConcurrency** - Sets CPU cores
8. **navigator.languages** - Sets language preferences
9. **navigator.permissions** - Handles permission queries
10. **navigator.plugins** - Adds realistic plugins
11. **navigator.vendor** - Sets to "Google Inc."
12. **navigator.webdriver** - Returns `false`
13. **sourceurl** - Removes sourceURL from error stacks
14. **user-agent-override** - Sets realistic user agent
15. **webgl.vendor** - Sets WebGL vendor info
16. **window.outerdimensions** - Sets realistic window size

#### Advanced Fingerprinting Protection:
17. **canvas.fingerprinting** - Prevents canvas detection
18. **webgl.fingerprinting** - Prevents WebGL detection  
19. **audio.fingerprinting** - Prevents audio detection
20. **font.fingerprinting** - Prevents font enumeration
21. **screen.fingerprinting** - Randomizes screen data
22. **timezone** - Handles timezone spoofing
23. **hairline.fix** - Fixes hairline rendering

### Implementation

```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin (automatically applies all evasions)
puppeteer.use(StealthPlugin());

// Launch browser
const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

The stealth plugin handles everything automatically - no manual configuration needed!

## Tested Sites

✅ **Google Search** - Works perfectly
✅ **Google Forms** - Can fill and submit
✅ **YouTube** - Can navigate and interact
✅ **Most standard websites** - Full compatibility

## Usage Examples

### Google Search Automation
```bash
# Type in Google search box
curl -X POST http://localhost:3000/api/type \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "textarea[name=\"q\"]",
    "text": "puppeteer automation"
  }'
```

### Extract Google Search Results
```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=nodejs",
    "script": "return Array.from(document.querySelectorAll(\"h3\")).map(h => h.textContent)"
  }'
```

### Click Google Search Button
```bash
curl -X POST http://localhost:3000/api/click-selector \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "input[name=\"btnK\"]"
  }'
```

## How It Works

1. **Plugin Registration**: `puppeteer.use(StealthPlugin())` registers the stealth plugin
2. **Browser Launch**: Browser starts with optimized arguments
3. **Automatic Evasions**: Plugin automatically applies all 23+ evasions to every page
4. **Page Creation**: Each new page is automatically stealthed
5. **Zero Configuration**: No manual setup required

## Implementation

All stealth features are automatically applied when you use any API endpoint:

```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Register stealth plugin once at startup
puppeteer.use(StealthPlugin());

// All pages created will automatically have stealth features
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage(); // Automatically stealthed!
```

The stealth plugin handles everything - no need for manual `evaluateOnNewDocument` calls or custom configurations!

## Timeout & Performance Optimizations

### Google-Specific Optimizations

Google pages can be slow to load due to dynamic content. The API now uses:

- **Increased Timeout**: 90 seconds (default) instead of 60 seconds
- **Flexible Wait Strategy**: Uses `domcontentloaded` instead of `networkidle2`
- **Fallback Mechanism**: Tries multiple wait strategies if one fails
- **Dynamic Content Wait**: Adds 2-second delay for JavaScript to render

### Custom Timeout

You can specify custom timeout for any endpoint:

```json
{
  "url": "https://www.google.com",
  "timeout": 120000
}
```

## Limitations

While stealth mode significantly improves bot detection bypass, some advanced detection systems may still identify automation:

- **CAPTCHA**: Some sites may still show CAPTCHAs
- **Rate Limiting**: Excessive requests may trigger blocks
- **Advanced Fingerprinting**: Very sophisticated systems may detect patterns
- **IP-based Blocking**: Use proxies if needed for IP rotation
- **Slow Pages**: Some Google pages may still timeout - increase timeout parameter if needed

## Best Practices

1. **Add Delays**: Use realistic delays between actions
2. **Randomize Timing**: Vary typing speed and click timing
3. **Respect Robots.txt**: Follow website policies
4. **Use Proxies**: For high-volume scraping
5. **Handle CAPTCHAs**: Implement CAPTCHA solving if needed
6. **Monitor Responses**: Check for detection and adjust

## Advanced Configuration

If you need even more stealth, consider:

- Installing `puppeteer-extra-plugin-stealth` package
- Using residential proxies
- Implementing mouse movement simulation
- Adding random scrolling behavior
- Varying viewport sizes

## Troubleshooting

### Still Getting Blocked?

1. Check if the site uses CAPTCHA
2. Verify user agent is up to date
3. Add random delays between requests
4. Use different IP addresses
5. Check browser console for errors

### Detection Test

Test if your browser is detected:
```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bot.sannysoft.com",
    "script": "return document.body.innerText"
  }'
```

## References

- [Puppeteer Stealth Plugin](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [Bot Detection Techniques](https://bot.sannysoft.com/)
- [Puppeteer Documentation](https://pptr.dev/)

## Summary

The stealth mode implementation makes this API suitable for:
- ✅ Web scraping Google and protected sites
- ✅ Automated testing on bot-protected sites
- ✅ Form filling and submission
- ✅ Data extraction from modern websites
- ✅ Screenshot capture of any site

All endpoints automatically use stealth mode - no additional configuration needed!
