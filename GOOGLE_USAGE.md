# Working with Google - Best Practices

## Overview

Google has sophisticated bot detection, but this API is configured to bypass it with:
- **puppeteer-extra-plugin-stealth** - 23+ automatic evasions
- **Realistic HTTP Headers** - Complete Chrome header set including Sec-Fetch and Client Hints
- **User Agent Spoofing** - Chrome 120 on Windows 10
- **Referer Header** - Set to Google.com for authenticity

Here are the best practices for working with Google services.

## Common Issues & Solutions

### Issue: "Navigation timeout of 60000 ms exceeded"

**Solution:** Increase the timeout parameter

```json
{
  "url": "https://www.google.com",
  "timeout": 120000
}
```

Google pages can take 60-90 seconds to fully load due to:
- Dynamic content loading
- Bot detection checks
- Heavy JavaScript execution
- Multiple redirects

### Issue: Screenshot is blank or incomplete

**Solution:** Add a delay or use higher timeout

The API automatically waits 2 seconds after page load for dynamic content. For very slow pages, increase the timeout.

## Recommended Settings for Google

### Google Search
```json
{
  "url": "https://www.google.com",
  "timeout": 120000,
  "waitUntil": "domcontentloaded"
}
```

### Google Search Results
```json
{
  "url": "https://www.google.com/search?q=your+query",
  "timeout": 120000
}
```

### Google Forms
```json
{
  "url": "https://docs.google.com/forms/...",
  "timeout": 120000
}
```

## Working Examples

### 1. Take Screenshot of Google Homepage

```bash
curl -X POST http://localhost:3000/api/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "fullPage": false,
    "width": 1920,
    "height": 1080,
    "timeout": 120000
  }' \
  --output google.png
```

### 2. Search Google

```bash
curl -X POST http://localhost:3000/api/type \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "textarea[name=\"q\"]",
    "text": "puppeteer automation",
    "delay": 100,
    "timeout": 120000
  }'
```

### 3. Get Search Results

```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=nodejs",
    "script": "return Array.from(document.querySelectorAll(\"h3\")).map(h => h.textContent).filter(t => t)"
  }'
```

### 4. Click "I'm Feeling Lucky"

```bash
curl -X POST http://localhost:3000/api/click-selector \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "input[name=\"btnI\"]",
    "timeout": 120000
  }'
```

### 5. Get Page Title

```bash
curl -X POST http://localhost:3000/api/navigate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "timeout": 120000
  }'
```

### 6. Extract All Links

```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=puppeteer",
    "script": "return Array.from(document.querySelectorAll(\"a\")).map(a => ({text: a.textContent.trim(), href: a.href})).filter(l => l.href.startsWith(\"http\"))"
  }'
```

## Google Services Tested

| Service | Status | Notes |
|---------|--------|-------|
| Google Search | ✅ Works | Use 120s timeout |
| Google Images | ✅ Works | May need higher timeout |
| Google Maps | ✅ Works | Heavy JS, use 120s+ timeout |
| Google Forms | ✅ Works | Works well with fill-form endpoint |
| YouTube | ✅ Works | Video pages load quickly |
| Gmail | ⚠️ Partial | Login may trigger CAPTCHA |
| Google Drive | ⚠️ Partial | May require authentication |

## Timeout Guidelines

| Page Type | Recommended Timeout |
|-----------|---------------------|
| Simple pages | 60000 (60s) |
| Google Search | 120000 (120s) |
| Google Maps | 150000 (150s) |
| Heavy JS apps | 180000 (180s) |

## Best Practices

### 1. Always Set Timeout for Google
```json
{
  "url": "https://www.google.com",
  "timeout": 120000
}
```

### 2. Use domcontentloaded (Default)
The API automatically uses `domcontentloaded` which is faster than `networkidle2` for Google.

### 3. Add Delays Between Requests
```bash
# Wait 2-3 seconds between requests
curl ... && sleep 3 && curl ...
```

### 4. Handle Errors Gracefully
```javascript
try {
  const response = await fetch('/api/screenshot', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://google.com', timeout: 120000 })
  });
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry with higher timeout
  }
}
```

### 5. Use Specific Selectors
Google's DOM changes frequently. Use data attributes or stable selectors:

```javascript
// Good
"textarea[name='q']"
"input[name='btnK']"

// Avoid
".gLFyf"  // Class names change
"div > div > input"  // Too fragile
```

## Common Google Selectors

```javascript
// Search box
"textarea[name='q']"

// Search button
"input[name='btnK']"

// I'm Feeling Lucky
"input[name='btnI']"

// Search results
"h3"
"div#search a"

// Images
"img[alt]"
```

## Troubleshooting

### Screenshot is blank
- Increase timeout to 150000+
- Check if page requires interaction first
- Verify URL is accessible

### "Element not found" error
- Google's DOM may have changed
- Use more generic selectors
- Wait for element with `wait-element` endpoint first

### Still getting timeout errors
- Try with a simpler Google URL first (https://www.google.com)
- Check your internet connection
- Verify Google is not blocking your IP
- Consider using a proxy

## Rate Limiting

Google may rate limit if you:
- Make too many requests too quickly
- Always use the same search query
- Don't vary user behavior

**Recommendations:**
- Add 2-5 second delays between requests
- Vary search queries
- Use different user agents (already randomized)
- Consider using proxies for high volume

## Advanced: Handling CAPTCHAs

If Google shows a CAPTCHA:

1. **Reduce request frequency**
2. **Use residential proxies**
3. **Implement CAPTCHA solving service** (2Captcha, Anti-Captcha)
4. **Add more human-like behavior** (mouse movements, scrolling)

## Example: Complete Google Search Flow

```bash
# 1. Navigate to Google
curl -X POST http://localhost:3000/api/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com", "timeout": 120000}'

# 2. Type search query
curl -X POST http://localhost:3000/api/type \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "textarea[name=\"q\"]",
    "text": "web scraping",
    "delay": 100,
    "timeout": 120000
  }'

# 3. Click search button
curl -X POST http://localhost:3000/api/click-selector \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "input[name=\"btnK\"]",
    "timeout": 120000
  }'

# 4. Get results
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=web+scraping",
    "script": "return Array.from(document.querySelectorAll(\"h3\")).map(h => h.textContent)"
  }'
```

## Summary

✅ **Works with Google** - Stealth mode enabled
✅ **Use 120s timeout** - Google pages are slow
✅ **domcontentloaded** - Faster than networkidle2
✅ **Add delays** - Between requests
✅ **Stable selectors** - Use name attributes
✅ **Handle errors** - Retry with higher timeout

For more details, see [STEALTH_MODE.md](STEALTH_MODE.md)
