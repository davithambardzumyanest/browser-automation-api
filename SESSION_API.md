# Session-Based Browser API

## Overview

The Session API allows you to create persistent browser sessions that you can control via API calls. Each session maintains its own browser instance, cookies, and state.

## Key Features

- ✅ **Persistent Sessions** - Keep browser instances alive between requests
- ✅ **Tab Management** - Automatic handling of browser tabs and windows
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

Creates a new browser session with custom configuration. Each session maintains its own browser instance, cookies, and state.

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
  "userDataDir": true,
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass"
  }
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
- `proxy` (string|object, optional) - Proxy configuration
- `slowMo` (number, default: 0) - Slow down operations by N milliseconds (debugging)
- `devtools` (boolean, default: false) - Auto-open Chrome DevTools (debugging)

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

Lists all active sessions with their details including creation time, last activity, and configuration.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "sessions": [
    {
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "created": "2025-10-31T12:00:00.000Z",
      "lastActivity": "2025-10-31T12:05:00.000Z",
      "config": {
        "headless": true,
        "width": 1920,
        "height": 1080
      }
    }
  ]
}
```

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

### Session Operations

#### 3. Get Session Info
```
GET /api/session/:sessionId
```

Retrieves detailed information about a specific session.

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "created": "2025-10-31T12:00:00.000Z",
  "lastActivity": "2025-10-31T12:05:00.000Z",
  "config": {
    "headless": true,
    "width": 1920,
    "height": 1080,
    "userAgent": "Mozilla/5.0...",
    "locale": "en-US"
  },
  "currentUrl": "https://example.com",
  "title": "Example Domain"
}
```

#### 4. Close Session
```
DELETE /api/session/:sessionId
```

Closes the specified session and cleans up all associated resources.

**Response:**
```json
{
  "success": true,
  "message": "Session 550e8400-e29b-41d4-a716-446655440000 closed successfully"
}
```

#### 5. Close All Sessions
```
DELETE /api/session
```

Closes all active sessions and cleans up all resources.

**Response:**
```json
{
  "success": true,
  "message": "Closed 3 session(s)",
  "count": 3
}
```

### Page Navigation

#### 6. Navigate to URL
```
POST /api/session/:sessionId/goto
```

Navigate to a URL in the session. This will always use the first tab.

**Request Body:**
```json
{
  "url": "https://www.google.com",
  "waitUntil": "domcontentloaded",
  "timeout": 90000,
  "referer": "https://www.google.com/",
  "newTab": false
}
```

**Parameters:**
- `url` (string, required) - The URL to navigate to
- `waitUntil` (string, optional, default: 'domcontentloaded') - When to consider navigation succeeded
  - `load` - Navigation is complete when the load event is fired
  - `domcontentloaded` - Navigation is complete when the DOMContentLoaded event is fired
  - `networkidle0` - Navigation is complete when there are no more than 0 network connections for at least 500ms
  - `networkidle2` - Navigation is complete when there are no more than 2 network connections for at least 500ms
- `timeout` (number, optional, default: 30000) - Maximum navigation time in milliseconds
- `referer` (string, optional) - Referer header value
- `newTab` (boolean, optional, default: false) - Open URL in a new tab (will still return to first tab after navigation)

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Google",
  "url": "https://www.google.com/"
}
```

### Content Retrieval

#### 7. Take Screenshot
```
POST /api/session/:sessionId/screenshot
```

Take a screenshot of the current page. This will always capture the first tab if multiple tabs are open.

**Request Body:**
```json
{
  "fullPage": true,
  "quality": 80,
  "type": "png"
}
```

**Parameters:**
- `fullPage` (boolean, optional, default: false) - Capture the full scrollable page
- `quality` (number, optional, default: 80) - Image quality (0-100) for JPEG
- `type` (string, optional, default: 'png') - Image format ('png' or 'jpeg')
- `selector` (string, optional) - CSS selector to capture specific element

**Response:** Image file (PNG/JPEG)

#### 8. Execute JavaScript
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

#### 9. Run Stagehand Actions
```
POST /api/session/:sessionId/stagehand
```

Use Stagehand against the existing browser session and perform the action(s) described in the request `message` field. This endpoint attaches to the current session browser over CDP, so cookies and page state are preserved.

**Request Body:**
```json
{
  "message": "Search for browser automation docs and open the most relevant result",
  "mode": "agent",
  "model": "openai/gpt-4.1-mini",
  "timeoutMs": 120000
}
```

**Parameters:**
- `message` (string, required) - Natural-language action(s) for Stagehand to perform
- `mode` (string, optional, default: `agent`) - Stagehand execution mode:
  - `agent` - Multi-step task execution for requests with multiple actions
  - `act` - Single Stagehand action
  - `observe` - Return candidate actions without executing them
- `model` (string, optional, default: `STAGEHAND_MODEL` env var or `openai/gpt-4.1-mini`) - Stagehand model name
- `timeoutMs` (number, optional, default: `120000`) - Maximum execution time in milliseconds

**Environment:**
- `OPENAI_API_KEY` is read from `.env` by the server and used by Stagehand for OpenAI models
- `STAGEHAND_MODEL` may be set in `.env` to change the default model

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "agent",
  "message": "Search for browser automation docs and open the most relevant result",
  "result": {},
  "pageInfo": {
    "title": "Stagehand Docs",
    "url": "https://docs.stagehand.dev/",
    "timestamp": "2026-07-15T12:00:00.000Z"
  }
}
```

### Page Interaction

#### 10. Click Element
```
POST /api/session/:sessionId/click
```

Click an element by CSS selector. This endpoint automatically handles:
- Element visibility and scrolling
- Human-like delays and interactions
- Tab management (automatically closes new tabs and returns to the main tab)
- Navigation waiting

**Request Body:**
```json
{
  "selector": "input[name='btnK']"
}
```

**Parameters:**
- `selector` (string, required) - CSS selector of the element to click
- `waitForNavigation` (boolean, optional, default: true) - Wait for page navigation to complete
- `timeout` (number, optional, default: 10000) - Maximum time to wait for the element in milliseconds

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

#### 10a. Click by Coordinates (X, Y)
```
POST /api/session/:sessionId/click-xy
```

Click at a raw viewport coordinate instead of a CSS selector. Dispatches
through Puppeteer's `page.mouse` API (Chrome DevTools Protocol `Input`
domain), which hit-tests at the compositor level - unlike selector-based
`/click`, this reaches content inside **cross-origin iframes** that a
same-origin DOM query can't touch at all, such as a Cloudflare Turnstile
checkbox rendered from `challenges.cloudflare.com`. Confirmed live: clicking
the coordinates of a Turnstile "Verify you are human" checkbox correctly
triggered its verification flow (visible state change to "Verifying...",
with a fresh Ray ID), which `/click` cannot reach at all since the widget
isn't a same-origin, selector-addressable element.

Includes the same human-like mouse-move-before-click behavior as `/click`
(the cursor moves to the target over several steps with a randomized delay
before the click itself, rather than teleporting straight there).

**Request Body:**
```json
{
  "x": 532,
  "y": 337
}
```

**Parameters:**
- `x` (number, required) - Viewport X coordinate to click
- `y` (number, required) - Viewport Y coordinate to click
- `button` (string, optional, default: `"left"`) - One of `"left"`, `"right"`, `"middle"`
- `clickCount` (number, optional, default: 1) - Number of clicks (e.g. `2` for a double-click)
- `waitForNavigation` (boolean, optional, default: false) - Wait for page navigation to complete after the click
- `navigationTimeout` (number, optional, default: 10000) - Maximum time to wait for navigation, in milliseconds

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "clicked": true,
  "x": 532,
  "y": 337,
  "navigated": false,
  "url": "https://example.com/",
  "title": "Example Domain"
}
```

**Finding coordinates:** use `/screenshot` to see the current page visually,
or `/execute` with `element.getBoundingClientRect()` to compute exact
coordinates for a specific element - useful when the target is same-origin
and you just want precise coordinates instead of relying on selector
matching:
```json
{
  "script": "const el = document.querySelector('a'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };"
}
```

#### 10. Type Text in Input Field
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

#### 11. Get Page Content
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

### Advanced Features

#### 12. Fill Input Field with Human-like Typing
```
POST /api/session/:sessionId/fill
```

Fill an input field with human-like typing behavior, including random delays and occasional mistakes.

**Request Body:**
```json
{
  "selector": "input[name='username']",
  "text": "example_user",
  "pressEnter": false
}
```

**Parameters:**
- `selector` (string, required) - CSS selector of the input element
- `text` (string, required) - Text to type into the field
- `pressEnter` (boolean, optional, default: false) - Whether to press Enter after typing

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "typed": true,
  "charactersTyped": 12
}
```

#### 13. Simulate User Actions
```
POST /api/session/:sessionId/simulate
```

Simulate realistic user behavior including scrolling, mouse movements, and random clicks.

**Request Body:**
```json
{
  "duration": 30,
  "actions": ["scroll", "move", "click", "form"]
}
```

**Parameters:**
- `duration` (number, optional, default: 30) - Duration of simulation in seconds
- `actions` (array, optional) - List of actions to perform:
  - `scroll` - Random page scrolling
  - `move` - Random mouse movements
  - `click` - Random clicks on interactive elements
  - `form` - Random form filling

**Response:**
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "actionsPerformed": 15,
  "duration": 30
}
```

## Debugging & Development

### Development Mode

For local development, create sessions with debugging features enabled:

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 250,
    "devtools": true
  }'
```

**Features:**
- `headless: false` - See the browser window
- `slowMo: 250` - Slow down operations by 250ms (easy to follow)
- `devtools: true` - Auto-open Chrome DevTools

### Debugging Options

#### 1. Non-Headless Mode
```json
{
  "headless": false
}
```
Opens a visible browser window so you can watch automation in real-time.

**Perfect for:**
- Local development
- Debugging navigation issues
- Manual CAPTCHA solving
- Understanding page behavior

#### 2. Slow Motion
```json
{
  "slowMo": 500
}
```
Slows down browser operations by N milliseconds.

**Recommended values:**
- `100` - Slight delay
- `250` - Medium delay (good for watching)
- `500` - Slow delay (very easy to follow)
- `1000` - Very slow (1 second between operations)

#### 3. DevTools Auto-Open
```json
{
  "devtools": true
}
```
Automatically opens Chrome DevTools when browser launches.

**Use DevTools to:**
- Debug JavaScript execution
- Inspect network requests
- Check console errors
- Inspect DOM elements
- Monitor performance

### Complete Debugging Setup

Best configuration for comprehensive debugging:

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

This gives you:
- ✅ Visible browser window
- ✅ Slowed operations (250ms delay)
- ✅ DevTools for inspection
- ✅ Full HD viewport

### Debugging Workflow Example

```bash
# 1. Create debugging session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": false,
    "slowMo": 500,
    "devtools": true
  }' | jq -r '.sessionId')

# 2. Navigate (watch it happen slowly)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Type (watch each character)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test query"}'

# 4. Click (watch the click happen)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'

# 5. Check DevTools Console for any errors
# 6. Check DevTools Network tab for requests
```

See [DEBUGGING.md](DEBUGGING.md) for comprehensive debugging guide.

## Proxy Configuration

The Session API supports proxy configuration for routing browser traffic through proxy servers.

### Proxy Formats

#### 1. Simple String (No Authentication)
```json
{
  "proxy": "http://proxy.example.com:8080"
}
```

#### 2. Object with Authentication
```json
{
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "proxyuser",
    "password": "proxypass"
  }
}
```

#### 3. SOCKS Proxy
```json
{
  "proxy": "socks5://proxy.example.com:1080"
}
```

### Proxy Examples

#### HTTP Proxy
```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": true,
    "proxy": "http://proxy.example.com:8080"
  }'
```

#### Authenticated Proxy
```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": true,
    "proxy": {
      "server": "http://proxy.example.com:8080",
      "username": "user",
      "password": "pass"
    }
  }'
```

#### SOCKS5 Proxy
```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": true,
    "proxy": "socks5://127.0.0.1:1080"
  }'
```

#### Residential Proxy with Custom Headers
```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": true,
    "proxy": {
      "server": "http://residential-proxy.com:8080",
      "username": "customer-user",
      "password": "customer-pass"
    },
    "locale": "en-US",
    "headers": {
      "Accept-Language": "en-US,en;q=0.9"
    }
  }'
```

### Proxy Use Cases

1. **IP Rotation** - Use different proxies for different sessions
2. **Geo-targeting** - Access region-specific content
3. **Rate Limiting Bypass** - Distribute requests across IPs
4. **Privacy** - Hide your server's IP address
5. **Testing** - Test how sites behave from different locations

### Testing Proxy Connection

```bash
# Create session with proxy
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"proxy": "http://proxy.example.com:8080"}' \
  | jq -r '.sessionId')

# Check IP address
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.ipify.org?format=json"}'

curl -X POST http://localhost:3000/api/session/$SESSION_ID/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "return document.body.textContent"}'
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
