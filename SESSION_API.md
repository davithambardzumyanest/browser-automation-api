# Session-Based Browser API

## Overview

The Session API allows you to create persistent browser sessions that you can control via API calls. Each session maintains its own browser instance, cookies, and state.

## Key Features

- ✅ **Persistent Sessions** - Keep browser instances alive between requests
- ✅ **Custom Headers** - Set different headers per session
- ✅ **Auto Cleanup** - Sessions automatically close after 10 minutes of inactivity
- ✅ **Multiple Sessions** - Run multiple browsers simultaneously
- ✅ **Cookie Persistence** - Optional persistent storage for cookies
- ✅ **Stealth Mode** - All sessions use puppeteer-extra-plugin-stealth
- ✅ **Session Management** - List, inspect, and close sessions

## How It Works

1. **Create Session** - Creates a new browser instance with custom configuration
2. **Use Session** - Perform operations using the session ID
3. **Auto Cleanup** - Session closes automatically after 10 minutes of inactivity
4. **Manual Close** - Close session manually when done

## Session Lifecycle

```
Create Session → Get Session ID → Use Session → Auto/Manual Close
     ↓                                ↓
  Browser Opens              Browser Stays Open
                                     ↓
                            10 min inactivity → Auto Close
```

## API Endpoints

### Session Management

#### 1. Create Session
```
POST /api/session/create
```

Creates a new browser session with custom configuration.

**Request Body:**
```json
{
  "headless": true,
  "width": 1920,
  "height": 1080,
  "userAgent": "Mozilla/5.0 ...",
  "headers": {
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/"
  },
  "locale": "en-US",
  "userDataDir": true
}
```

**Parameters:**
- `headless` (boolean, default: true) - Run browser in headless mode
- `width` (number, default: 1920) - Viewport width
- `height` (number, default: 1080) - Viewport height
- `userAgent` (string, optional) - Custom user agent
- `headers` (object, optional) - Custom HTTP headers
- `locale` (string, default: "en-US") - Browser locale
- `userDataDir` (boolean, optional) - Enable persistent cookie storage

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Session created successfully",
  "config": {
    "headless": true,
    "width": 1920,
    "height": 1080,
    "userAgent": "Mozilla/5.0 ...",
    "locale": "en-US"
  }
}
```

#### 2. List Sessions
```
GET /api/session/list
```

Lists all active sessions.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "sessions": [
    {
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "created": "2025-10-20T12:00:00.000Z",
      "lastUsed": "2025-10-20T12:05:00.000Z",
      "config": {
        "headless": true,
        "width": 1920,
        "height": 1080
      }
    }
  ]
}
```

#### 3. Get Session Info
```
GET /api/session/:sessionId
```

Gets information about a specific session.

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "created": "2025-10-20T12:00:00.000Z",
  "lastUsed": "2025-10-20T12:05:00.000Z",
  "config": {
    "headless": true,
    "width": 1920,
    "height": 1080
  }
}
```

#### 4. Close Session
```
DELETE /api/session/:sessionId
```

Closes a specific session and its browser instance.

**Response:**
```json
{
  "success": true,
  "message": "Session 550e8400-e29b-41d4-a716-446655440000 closed successfully"
}
```

#### 5. Close All Sessions
```
DELETE /api/session/
```

Closes all active sessions.

**Response:**
```json
{
  "success": true,
  "message": "Closed 3 session(s)",
  "count": 3
}
```

### Session Operations

#### 6. Navigate
```
POST /api/session/:sessionId/goto
```

Navigate to a URL in the session.

**Request Body:**
```json
{
  "url": "https://www.google.com",
  "waitUntil": "domcontentloaded",
  "timeout": 90000,
  "referer": "https://www.google.com/"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Google",
  "url": "https://www.google.com/"
}
```

#### 7. Take Screenshot
```
POST /api/session/:sessionId/screenshot
```

Take a screenshot of the current page.

**Request Body:**
```json
{
  "fullPage": true
}
```

**Response:** PNG image

#### 8. Execute Script
```
POST /api/session/:sessionId/execute
```

Execute JavaScript in the page context.

**Request Body:**
```json
{
  "script": "return document.title"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "result": "Google"
}
```

#### 9. Click Element
```
POST /api/session/:sessionId/click
```

Click an element by CSS selector.

**Request Body:**
```json
{
  "selector": "input[name='btnK']"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "clicked": true,
  "url": "https://www.google.com/search?q=...",
  "title": "puppeteer - Google Search"
}
```

#### 10. Type Text
```
POST /api/session/:sessionId/type
```

Type text into an input field.

**Request Body:**
```json
{
  "selector": "textarea[name='q']",
  "text": "puppeteer automation",
  "delay": 100
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "typed": true
}
```

#### 11. Get Content
```
POST /api/session/:sessionId/content
```

Get page content (HTML or text).

**Request Body:**
```json
{
  "selector": "body"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Google",
  "content": "..."
}
```

## Usage Examples

### Example 1: Simple Google Search

```bash
# 1. Create session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false}' | jq -r '.sessionId')

# 2. Navigate to Google
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Type search query
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "puppeteer"}'

# 4. Click search
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'

# 5. Get results
curl -X POST http://localhost:3000/api/session/$SESSION_ID/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "return Array.from(document.querySelectorAll(\"h3\")).map(h => h.textContent)"}'

# 6. Take screenshot
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": false}' \
  --output result.png

# 7. Close session
curl -X DELETE http://localhost:3000/api/session/$SESSION_ID
```

### Example 2: Custom Headers for Different Sites

```javascript
// Session for Google
const googleSession = await fetch('http://localhost:3000/api/session/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    headless: true,
    locale: 'en-US',
    headers: {
      'Referer': 'https://www.google.com/'
    }
  })
});

// Session for Facebook
const fbSession = await fetch('http://localhost:3000/api/session/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    headless: true,
    locale: 'en-US',
    headers: {
      'Referer': 'https://www.facebook.com/'
    }
  })
});
```

### Example 3: Persistent Cookies

```bash
# Create session with persistent storage
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "userDataDir": true}' | jq -r '.sessionId')

# Login to a site (cookies will be saved)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://accounts.google.com"}'

# Manually login in the browser window...

# Close session (cookies are saved)
curl -X DELETE http://localhost:3000/api/session/$SESSION_ID

# Later, create new session - cookies will be loaded!
```

## Auto Cleanup

Sessions are automatically cleaned up after **10 minutes of inactivity**.

**Inactivity** means no API calls to that session for 10 minutes.

**Cleanup runs every minute** to check for inactive sessions.

**To prevent cleanup:**
- Make any API call to the session (even just getting session info)
- Or close the session manually when done

## Best Practices

### 1. Always Close Sessions
```bash
# Good - close when done
curl -X DELETE http://localhost:3000/api/session/$SESSION_ID

# Or use cleanup endpoint
curl -X DELETE http://localhost:3000/api/session/
```

### 2. Use Headless for Production
```json
{
  "headless": true  // Faster and uses less resources
}
```

### 3. Set Appropriate Timeouts
```json
{
  "url": "https://slow-site.com",
  "timeout": 120000  // 2 minutes for slow sites
}
```

### 4. Use Custom Headers Per Site
```json
{
  "headers": {
    "Referer": "https://www.google.com/",
    "Accept-Language": "en-US,en;q=0.9"
  }
}
```

### 5. Monitor Active Sessions
```bash
# Check how many sessions are active
curl http://localhost:3000/api/session/list
```

## Error Handling

### Session Not Found
```json
{
  "error": "Session not found",
  "message": "Session 550e8400-e29b-41d4-a716-446655440000 does not exist or has expired"
}
```

**Causes:**
- Session was closed
- Session expired (10 min inactivity)
- Invalid session ID

**Solution:**
- Create a new session
- Check session ID is correct

### Navigation Timeout
```json
{
  "error": "Failed to navigate",
  "message": "Navigation timeout of 90000 ms exceeded"
}
```

**Solution:**
- Increase timeout parameter
- Check if URL is accessible
- Use different waitUntil strategy

## Comparison: Session API vs Regular API

| Feature | Session API | Regular API |
|---------|-------------|-------------|
| Browser Persistence | ✅ Yes | ❌ No |
| Cookie Persistence | ✅ Yes | ❌ No |
| Custom Headers | ✅ Per session | ✅ Per request |
| Multiple Operations | ✅ Same browser | ❌ New browser each time |
| Resource Usage | 🟡 Higher | 🟢 Lower |
| Use Case | Complex workflows | Simple one-off tasks |

## When to Use Session API

✅ **Use Session API when:**
- Need to perform multiple operations on same site
- Need to maintain cookies/login state
- Working with sites that detect browser fingerprints
- Need to interact with CAPTCHA manually
- Building complex automation workflows

❌ **Use Regular API when:**
- Simple one-off screenshots
- No need for state persistence
- Want automatic cleanup
- Lower resource usage needed

## Troubleshooting

### Sessions Not Cleaning Up

Check if cleanup worker is running:
```bash
# Should see cleanup messages in logs every minute
tail -f logs/app.log | grep "Cleaning up"
```

### Too Many Sessions

List and close all:
```bash
curl -X DELETE http://localhost:3000/api/session/
```

### Session Expired Too Quickly

The timeout is 10 minutes. To keep session alive:
```bash
# Ping session periodically
curl http://localhost:3000/api/session/$SESSION_ID
```

## Advanced Usage

### Manual CAPTCHA Solving

```bash
# 1. Create non-headless session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false}' | jq -r '.sessionId')

# 2. Navigate to site with CAPTCHA
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://site-with-captcha.com"}'

# 3. Manually solve CAPTCHA in browser window

# 4. Continue automation
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit"}'
```

### Multiple Tabs (Coming Soon)

Currently each session has one page. Multi-tab support coming in future version.

## Security Notes

- Sessions are stored in memory (not persisted to disk except cookies if enabled)
- Session IDs are UUIDs (hard to guess)
- No authentication required (add your own auth middleware if needed)
- Sessions auto-cleanup prevents resource exhaustion

## Performance

- Each session uses ~100-200MB RAM
- Headless sessions use less resources
- Limit concurrent sessions based on your server capacity
- Monitor with `/api/session/list`

## Summary

The Session API provides powerful persistent browser automation with:
- ✅ Full control over browser lifecycle
- ✅ Custom headers per session
- ✅ Automatic cleanup
- ✅ Cookie persistence
- ✅ Stealth mode enabled
- ✅ Multiple concurrent sessions

Perfect for complex automation workflows that require state persistence!
