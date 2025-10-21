# Debugging Browser Automation

## Overview

Several methods to see what the browser is doing during development and debugging.

## Method 1: Non-Headless Mode (Recommended for Development)

The easiest way - just watch the browser window!

### Basic Non-Headless Session

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "width": 1920,
    "height": 1080
  }'
```

**What you'll see:**
- ✅ Browser window opens on your screen
- ✅ Watch all navigation and interactions in real-time
- ✅ See exactly what the automation is doing

**Perfect for:**
- Local development
- Debugging navigation issues
- Manual CAPTCHA solving
- Understanding page behavior

## Method 2: Slow Motion Mode

Slow down browser operations to see what's happening.

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 250
  }'
```

**Parameters:**
- `slowMo: 100` - Slight delay (100ms between operations)
- `slowMo: 250` - Medium delay (good for watching)
- `slowMo: 500` - Slow delay (very easy to follow)
- `slowMo: 1000` - Very slow (1 second between operations)

**Example with slow motion:**
```bash
# Create slow session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 500
  }' | jq -r '.sessionId')

# Watch it navigate slowly
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# Watch it type slowly
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "puppeteer"}'
```

## Method 3: DevTools Auto-Open

Open Chrome DevTools automatically for debugging.

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "devtools": true
  }'
```

**What you get:**
- ✅ Chrome DevTools opens automatically
- ✅ Console tab shows JavaScript errors
- ✅ Network tab shows all requests
- ✅ Elements tab for DOM inspection
- ✅ Sources tab for debugging scripts

**Perfect for:**
- Debugging JavaScript execution
- Inspecting network requests
- Checking console errors
- DOM inspection

## Method 4: Combined Debugging Setup

Best setup for comprehensive debugging:

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 250,
    "devtools": true,
    "width": 1920,
    "height": 1080
  }'
```

**Features:**
- ✅ Visible browser window
- ✅ Slowed down operations (250ms)
- ✅ DevTools open automatically
- ✅ Full HD viewport

## Method 5: Screenshots at Each Step

Take screenshots to debug visually:

```bash
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": true}' | jq -r '.sessionId')

# Navigate
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# Screenshot 1
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": false}' \
  --output step1.png

# Type
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test"}'

# Screenshot 2
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": false}' \
  --output step2.png

# Click
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'

# Screenshot 3
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": false}' \
  --output step3.png
```

## Method 6: Console Logging

Add console logging to see what's happening:

```bash
# Execute script to log page info
curl -X POST http://localhost:3000/api/session/$SESSION_ID/execute \
  -H "Content-Type: application/json" \
  -d '{
    "script": "console.log(\"Title:\", document.title); console.log(\"URL:\", window.location.href); return {title: document.title, url: window.location.href}"
  }'
```

## Method 7: Page Content Inspection

Get HTML content to debug:

```bash
# Get full HTML
curl -X POST http://localhost:3000/api/session/$SESSION_ID/content \
  -H "Content-Type: application/json" \
  -d '{}' > page.html

# Open in browser to inspect
open page.html  # macOS
# or
xdg-open page.html  # Linux
```

## Method 8: Network Request Monitoring

Use DevTools to monitor network requests:

```bash
# Create session with DevTools
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "devtools": true
  }' | jq -r '.sessionId')

# Navigate - watch Network tab in DevTools
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'
```

**In DevTools Network tab you'll see:**
- All HTTP requests
- Request/response headers
- Response status codes
- Request timing
- Request payload

## Debugging Workflows

### Workflow 1: Debug Navigation Issues

```bash
# 1. Create visible session with DevTools
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "devtools": true,
    "slowMo": 250
  }' | jq -r '.sessionId')

# 2. Navigate and watch
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Check console for errors in DevTools
# 4. Check Network tab for failed requests
# 5. Take screenshot if needed
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": true}' \
  --output debug.png
```

### Workflow 2: Debug Element Selection

```bash
# 1. Create session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "devtools": true}' | jq -r '.sessionId')

# 2. Navigate
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Test selector in DevTools Console
# Type in Console: document.querySelector('textarea[name="q"]')

# 4. Or use execute to test
curl -X POST http://localhost:3000/api/session/$SESSION_ID/execute \
  -H "Content-Type: application/json" \
  -d '{
    "script": "return document.querySelector(\"textarea[name=\\\"q\\\"]\") !== null"
  }'
```

### Workflow 3: Debug Form Submission

```bash
# Create slow-motion session to watch form submission
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 500,
    "devtools": true
  }' | jq -r '.sessionId')

# Navigate
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# Screenshot before
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{}' --output before.png

# Type (watch it happen slowly)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test query"}'

# Screenshot after typing
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{}' --output after-type.png

# Click submit (watch it happen)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'

# Screenshot final result
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{}' --output result.png
```

## Debugging Tips

### 1. Start with Non-Headless
Always debug with `headless: false` first to see what's happening.

### 2. Use Slow Motion
Add `slowMo: 250` to slow down operations and catch issues.

### 3. Check DevTools Console
Look for JavaScript errors that might break automation.

### 4. Verify Selectors
Use DevTools to test selectors before using them in automation.

### 5. Take Screenshots
Screenshot before and after each operation to see state changes.

### 6. Check Network Tab
Verify all requests are completing successfully.

### 7. Test Manually First
Try the workflow manually in the browser to understand expected behavior.

## Common Issues & Solutions

### Issue: Can't See Browser Window

**Cause:** Running in headless mode or on headless server

**Solution:**
```bash
# Make sure headless is false
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false}'
```

### Issue: Operations Too Fast to See

**Cause:** No slow motion

**Solution:**
```bash
# Add slowMo
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "slowMo": 500}'
```

### Issue: Need to Debug JavaScript

**Cause:** DevTools not open

**Solution:**
```bash
# Enable DevTools
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "devtools": true}'
```

### Issue: Can't Find Element

**Solution:**
```bash
# Test selector in DevTools Console
document.querySelector('your-selector')

# Or use execute endpoint
curl -X POST http://localhost:3000/api/session/$SESSION_ID/execute \
  -H "Content-Type: application/json" \
  -d '{
    "script": "return document.querySelector(\"your-selector\") !== null"
  }'
```

## Environment Variables for Debugging

Add to `.env` for development:

```bash
# .env
NODE_ENV=development
DEBUG=true
HEADLESS=false
SLOW_MO=250
DEVTOOLS=true
```

Then modify session creation to use these defaults in development.

## Quick Reference

| Method | Use Case | Command |
|--------|----------|---------|
| Non-Headless | See browser window | `"headless": false` |
| Slow Motion | Slow down operations | `"slowMo": 250` |
| DevTools | Debug JavaScript | `"devtools": true` |
| Screenshots | Visual debugging | `/screenshot` endpoint |
| Console Logging | Log inspection | `/execute` with console.log |
| Content Inspection | HTML debugging | `/content` endpoint |

## Best Debugging Setup

For comprehensive debugging, use this configuration:

```json
{
  "headless": false,
  "slowMo": 250,
  "devtools": true,
  "width": 1920,
  "height": 1080
}
```

This gives you:
- ✅ Visible browser window
- ✅ Slowed operations (easy to follow)
- ✅ DevTools for inspection
- ✅ Full HD viewport

## Remote Debugging (Advanced)

If running on a remote server, you can use Chrome Remote Debugging:

```bash
# Add to browser args
--remote-debugging-port=9222
```

Then access DevTools from your local machine:
```
http://server-ip:9222
```

## Summary

**For Local Development:**
1. Use `headless: false` - See the browser
2. Add `slowMo: 250` - Watch operations
3. Enable `devtools: true` - Debug JavaScript
4. Take screenshots - Visual confirmation

**For Production:**
1. Use `headless: true` - No GUI needed
2. Take screenshots - Debug issues
3. Use `/execute` - Get page state
4. Check logs - Server-side debugging

Happy debugging! 🐛🔍
