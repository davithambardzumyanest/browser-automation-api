# Stealth Mode - Anti-Detection Features

## Overview

The browser API is configured with advanced stealth techniques to bypass bot detection systems used by Google, Cloudflare, and other websites that block headless browsers.

## Why Stealth Mode?

Many websites (especially Google) detect and block automated browsers by checking for:
- `navigator.webdriver` property
- Missing Chrome runtime objects
- Headless browser user agents
- Automation-specific browser flags
- Missing browser plugins
- Unusual HTTP headers

## Implemented Stealth Features

### 1. **WebDriver Property Hiding**
```javascript
Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
});
```
Hides the fact that the browser is controlled by automation.

### 2. **Chrome Runtime Object**
```javascript
window.chrome = {
    runtime: {},
};
```
Adds the Chrome-specific object that real Chrome browsers have.

### 3. **User Agent Spoofing**
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```
Mimics a real Chrome browser on Windows 10.

### 4. **Realistic HTTP Headers**
```javascript
{
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
}
```

### 5. **Plugin Simulation**
```javascript
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
});
```
Simulates browser plugins to appear more realistic.

### 6. **Language Settings**
```javascript
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
});
```

### 7. **Automation Flags Disabled**
```
--disable-blink-features=AutomationControlled
--disable-features=IsolateOrigins,site-per-process
```

## Browser Launch Arguments

```javascript
const STEALTH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];
```

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

1. **Browser Launch**: Browser starts with stealth arguments
2. **Page Creation**: Each new page gets stealth configuration applied
3. **Script Injection**: Anti-detection scripts run before page loads
4. **Header Spoofing**: Realistic headers sent with every request
5. **Behavior Mimicking**: Acts like a real user browser

## Implementation

All stealth features are automatically applied when you use any API endpoint. The `createStealthPage()` function ensures every page is configured properly:

```javascript
const createStealthPage = async () => {
    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();
    await setupStealthPage(page);  // Applies all stealth features
    return page;
};
```

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
