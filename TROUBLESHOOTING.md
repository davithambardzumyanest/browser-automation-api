# Troubleshooting Guide

## Navigation Timeout Issues

### Problem: "Navigation timeout of 120000 ms exceeded"

This happens when Google or other sites take too long to load.

### Solutions

#### 1. Use the Regular Screenshot Endpoint (Now Timeout-Tolerant)

The screenshot endpoint now handles timeouts gracefully:

```bash
curl -X POST http://localhost:3000/api/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "timeout": 120000
  }' \
  --output google.png
```

**What happens:**
- ✅ If page loads: Takes full screenshot
- ✅ If timeout occurs: Takes screenshot of whatever loaded
- ✅ Always returns an image (unless complete failure)

#### 2. Use the Debug Screenshot Endpoint

Get detailed information about what happened:

```bash
curl -X POST http://localhost:3000/api/debug-screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "timeout": 120000
  }'
```

**Response includes:**
```json
{
  "success": true,
  "debug": {
    "url": "https://www.google.com",
    "timestamp": "2025-10-20T15:33:00.000Z",
    "navigationSuccess": false,
    "navigationError": "Navigation timeout of 120000 ms exceeded",
    "pageTitle": "Google",
    "pageUrl": "https://www.google.com/",
    "screenshotTaken": true,
    "contentLoaded": false
  },
  "screenshot": "base64_encoded_image_data..."
}
```

**Benefits:**
- See exactly what went wrong
- Get the screenshot as base64
- Know if content loaded
- See page title and URL
- Understand timeout vs other errors

#### 3. Decode Base64 Screenshot

To save the debug screenshot:

```bash
# Get the response
curl -X POST http://localhost:3000/api/debug-screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}' > response.json

# Extract and decode screenshot (using jq)
cat response.json | jq -r '.screenshot' | base64 -d > screenshot.png
```

Or in Node.js:
```javascript
const response = await fetch('http://localhost:3000/api/debug-screenshot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://www.google.com' })
});

const data = await response.json();
const buffer = Buffer.from(data.screenshot, 'base64');
fs.writeFileSync('screenshot.png', buffer);

console.log('Debug info:', data.debug);
```

## Common Issues

### Issue: Blank Screenshot

**Possible causes:**
1. Page hasn't loaded yet
2. Page requires interaction
3. Content is dynamically loaded

**Solutions:**
- Increase timeout: `"timeout": 180000`
- Check debug info to see what loaded
- Use `wait-element` endpoint first to ensure content exists

### Issue: CAPTCHA Appears

**Cause:** Google detected automation

**Solutions:**
1. Add delays between requests
2. Vary your requests
3. Use residential proxies
4. Implement CAPTCHA solving service

### Issue: Empty Response

**Cause:** Missing or incorrect headers

**Solution:** Already fixed! The API now sends:
- Complete Chrome headers
- Sec-Fetch headers
- Client Hints
- Realistic User-Agent
- Referer header

### Issue: IP Blocked

**Cause:** Too many requests

**Solutions:**
1. Add delays: `await new Promise(r => setTimeout(r, 5000))`
2. Use different IPs/proxies
3. Reduce request frequency
4. Respect rate limits

## Debugging Workflow

### Step 1: Try Debug Screenshot
```bash
curl -X POST http://localhost:3000/api/debug-screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'
```

### Step 2: Check Debug Info
Look at the response:
- `navigationSuccess`: Did navigation complete?
- `navigationError`: What error occurred?
- `pageTitle`: What page loaded?
- `screenshotTaken`: Was screenshot captured?

### Step 3: Analyze Screenshot
Decode and view the base64 screenshot to see what actually loaded.

### Step 4: Adjust Strategy
Based on what you see:
- **Blank page**: Increase timeout or wait for specific element
- **CAPTCHA**: Add delays, use proxies
- **Wrong page**: Check URL and referer
- **Partial load**: Content loaded but timeout occurred (this is OK!)

## Error Messages Explained

### "Navigation timeout of X ms exceeded"
- **Meaning**: Page didn't finish loading in time
- **Action**: Screenshot still taken of partial content
- **Fix**: Increase timeout or use debug endpoint

### "Failed to take screenshot"
- **Meaning**: Complete failure, no page loaded
- **Action**: Check URL and network
- **Fix**: Verify URL is accessible

### "Protocol error: Target closed"
- **Meaning**: Browser/page crashed
- **Action**: Restart request
- **Fix**: Reduce concurrent requests

### "net::ERR_NAME_NOT_RESOLVED"
- **Meaning**: DNS lookup failed
- **Action**: Check URL spelling
- **Fix**: Verify domain exists

## Performance Tips

### 1. Use Appropriate Timeouts
```javascript
// Fast sites
{ "timeout": 30000 }

// Google, dynamic sites
{ "timeout": 120000 }

// Very slow sites
{ "timeout": 180000 }
```

### 2. Don't Wait for Full Load
Use `domcontentloaded` (default) instead of `networkidle2`:
```javascript
{ "waitUntil": "domcontentloaded" }  // Faster
```

### 3. Viewport-Only Screenshots
For faster screenshots:
```javascript
{ "fullPage": false }  // Only visible area
```

### 4. Lower Resolution
For smaller files:
```javascript
{ "width": 1280, "height": 720 }
```

## Testing Checklist

- [ ] Try with debug endpoint first
- [ ] Check if screenshot shows content
- [ ] Verify headers are being sent
- [ ] Test with different timeout values
- [ ] Check console logs for errors
- [ ] Try with simpler URL first (example.com)
- [ ] Verify Google.com works before complex pages

## Support

If issues persist:

1. **Check the screenshot** - Use debug endpoint
2. **Review logs** - Check server console output
3. **Test simple sites** - Verify basic functionality
4. **Increase timeout** - Google can be slow
5. **Check network** - Ensure connectivity

## Quick Reference

| Endpoint | Use Case | Returns |
|----------|----------|---------|
| `/api/screenshot` | Normal use | PNG image (even on timeout) |
| `/api/debug-screenshot` | Debugging | JSON with base64 image + debug info |
| `/api/navigate` | Just navigation | Page info (title, URL) |

## Example: Complete Debug Flow

```bash
# 1. Try debug screenshot
curl -X POST http://localhost:3000/api/debug-screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "timeout": 120000
  }' > debug.json

# 2. Check what happened
cat debug.json | jq '.debug'

# 3. Extract screenshot
cat debug.json | jq -r '.screenshot' | base64 -d > test.png

# 4. View screenshot
open test.png  # macOS
# or
xdg-open test.png  # Linux
```

The screenshot will show you exactly what Google returned, even if navigation timed out!
