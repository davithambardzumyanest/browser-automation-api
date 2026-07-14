# Session API Documentation

This document covers only the session endpoints exposed by `routes/sessionRoutes.js`.

Base path: `/api/session`

## Common behavior

- Session-scoped endpoints require `:sessionId` that must exist in memory.
- Most endpoints update session activity (`lastUsed` or `lastActivity`) to keep the session alive.
- Common not-found response:

```json
{
  "error": "Session not found",
  "message": "Session <sessionId> does not exist or has expired"
}
```

---

## 1) Create Session

**POST** `/create`

Creates a new browser instance and page, applies anti-detection settings, headers, optional proxy/geolocation/timezone, and stores it in the in-memory session map.

### Request body (example)

```json
{
  "headless": true,
  "width": 1920,
  "height": 1080,
  "locale": "en-US",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  "headers": {
    "Accept-Language": "en-US,en;q=0.9"
  },
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass",
    "type": "HTTP"
  },
  "geolocation": {
    "latitude": 40.7128,
    "longitude": -74.006,
    "accuracy": 50
  },
  "geolocationOrigins": [
    "https://www.google.com"
  ],
  "grantGeolocationOnNavigation": true,
  "timezone": "America/New_York",
  "slowMo": 0,
  "devtools": false,
  "allowMedia": false,
  "stealth": true
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Session created successfully",
  "config": {
    "headless": true,
    "width": 1920,
    "height": 1080,
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "locale": "en-US"
  }
}
```

### Error response

```json
{
  "error": "Failed to create session",
  "message": "Error details"
}
```

---

## 2) List Sessions

**GET** `/list`

Returns all active sessions from memory, including each session config and timestamps.

### Success response

```json
{
  "success": true,
  "count": 1,
  "sessions": [
    {
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "created": "2026-06-23T08:00:00.000Z",
      "lastUsed": "2026-06-23T08:01:00.000Z",
      "config": {
        "headless": true,
        "width": 1920,
        "height": 1080,
        "locale": "en-US"
      }
    }
  ]
}
```

---

## 3) Get Session

**GET** `/:sessionId`

Returns one session's metadata/config and updates `lastUsed`.

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "created": "2026-06-23T08:00:00.000Z",
  "lastUsed": "2026-06-23T08:02:00.000Z",
  "config": {
    "headless": true,
    "width": 1920,
    "height": 1080,
    "locale": "en-US"
  }
}
```

---

## 4) Close Session

**DELETE** `/:sessionId`

Closes the browser for that session and removes it from memory.

### Success response

```json
{
  "success": true,
  "message": "Session 550e8400-e29b-41d4-a716-446655440000 closed successfully"
}
```

---

## 5) Close All Sessions

**DELETE** `/`

Iterates over all session IDs, closes each browser, clears all sessions.

### Success response

```json
{
  "success": true,
  "message": "Closed 3 session(s)",
  "count": 3
}
```

---

## 6) Navigate

**POST** `/:sessionId/goto`

Navigates the session page to a URL. It validates URL/protocol, normalizes tabs to a single active tab, optionally opens a new tab, and applies geolocation permissions before/after navigation.

### Request body (example)

```json
{
  "url": "https://example.com",
  "waitUntil": "domcontentloaded",
  "timeout": 90000,
  "referer": "https://google.com",
  "newTab": false
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Example Domain",
  "url": "https://example.com/",
  "tabCount": 1
}
```

### Validation error examples

```json
{
  "error": "URL is required"
}
```

```json
{
  "error": "Invalid URL protocol",
  "message": "Only HTTP, HTTPS, and file URLs are supported"
}
```

---

## 7) Refresh Page

**POST** `/:sessionId/refresh`

Reloads the current page and returns updated title/url metadata.

### Request body (example)

```json
{
  "waitUntil": "domcontentloaded",
  "timeout": 30000
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Page refreshed successfully",
  "pageInfo": {
    "title": "Example Domain",
    "url": "https://example.com/",
    "timestamp": "2026-06-23T08:03:00.000Z"
  }
}
```

### Error example

```json
{
  "error": "No active page found",
  "message": "Session exists but no active page is available"
}
```

---

## 8) Screenshot

**POST** `/:sessionId/screenshot`

Waits briefly for dynamic content and returns a PNG screenshot binary.

### Request body (example)

```json
{
  "fullPage": true
}
```

### Success response

- Content-Type: `image/png`
- Body: binary image data

### Error response

```json
{
  "error": "Failed to take screenshot",
  "message": "Error details"
}
```

---

## 9) Execute Script

**POST** `/:sessionId/execute`

Runs JavaScript in the page context using `page.evaluate(script)`.

### Request body (example)

```json
{
  "script": "() => document.title"
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "result": "Example Domain"
}
```

### Validation error

```json
{
  "error": "Script is required"
}
```

---

## 10) Click Element

**POST** `/:sessionId/click`

Finds a clickable element, scrolls into view, performs human-like interaction, optionally waits for navigation/new tab behavior, then returns final URL/title.

### Request body (example)

```json
{
  "selector": "button[type='submit']",
  "waitForNavigation": true,
  "allowNewTab": false,
  "navigationTimeout": 10000
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "clicked": true,
  "navigated": true,
  "url": "https://example.com/next",
  "title": "Next Page"
}
```

### Not-clickable example

```json
{
  "error": "No clickable element found",
  "message": "Could not find a clickable element matching selector: button[type='submit']"
}
```

---

## 11) Check XPath

**POST** `/:sessionId/check-xpath`

Evaluates whether the XPath resolves to at least one node.

### Request body (example)

```json
{
  "xpath": "//button[contains(., 'Submit')]"
}
```

### Success response

```json
{
  "exists": true,
  "xpath": "//button[contains(., 'Submit')]",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Validation error

```json
{
  "error": "XPath is required"
}
```

---

## 12) Type Text

**POST** `/:sessionId/type`

Waits for selector, focuses it, types text with configurable delay.

### Request body (example)

```json
{
  "selector": "input[name='email']",
  "text": "user@example.com",
  "delay": 120
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "typed": true
}
```

### Validation error

```json
{
  "error": "Selector and text are required"
}
```

---

## 13) Fill Input (Human-like)

**POST** `/:sessionId/fill`

Uses a more human-like typing flow (scroll into view, optional clear, random typing delay, optional Enter key).

### Request body (example)

```json
{
  "selector": "input[name='q']",
  "text": "browser automation",
  "pressEnter": false,
  "clearInput": true
}
```

### Success response

```json
{
  "success": true,
  "message": "Text filled successfully",
  "selector": "input[name='q']",
  "textLength": 18,
  "pressEnterPerformed": false
}
```

### Validation error

```json
{
  "error": "Missing required parameters",
  "message": "Both selector and text are required"
}
```

---

## 14) Fill Image (File Input)

**POST** `/:sessionId/fill-image`

Uploads an image into a `<input type="file">` field. Accepts raw base64 or a data URL (`data:image/png;base64,...`). Optionally resizes and compresses the image in the browser before assigning it to the input.

### What happens internally

1. Waits for the file input selector and scrolls it into view.
2. Decodes the base64 image in page context.
3. Optionally scales down using `maxWidth` / `maxHeight`.
4. Optionally re-encodes with `quality` (JPEG/WebP) to reduce file size.
5. Creates a `File` object, assigns it to the input, and dispatches `input` + `change` events.

### Request body (example)

```json
{
  "selector": "input[type='file'][name='photo']",
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
  "filename": "profile-photo.jpg",
  "mimeType": "image/jpeg",
  "resize": {
    "maxWidth": 1280,
    "maxHeight": 1280,
    "quality": 0.8
  }
}
```

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | yes | CSS selector for the file input |
| `image` | string | yes | Base64 string or data URL |
| `filename` | string | no | Uploaded filename (default: `upload.<ext>`) |
| `mimeType` | string | no | MIME type when not included in data URL (default: `image/png`) |
| `maxWidth` | number | no | Max output width in pixels |
| `maxHeight` | number | no | Max output height in pixels |
| `quality` | number | no | Compression quality `0.1`–`1.0` (JPEG/WebP) |
| `resize` | object | no | Same as `maxWidth`, `maxHeight`, `quality` grouped |

You can pass resize fields at the top level or inside `resize`:

```json
{
  "selector": "#avatar",
  "image": "<base64>",
  "maxWidth": 800,
  "maxHeight": 600,
  "quality": 0.75
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Image uploaded to file input successfully",
  "selector": "input[type='file'][name='photo']",
  "filename": "profile-photo.jpg",
  "mimeType": "image/jpeg",
  "originalSize": 2457600,
  "fileSize": 186432,
  "originalWidth": 4032,
  "originalHeight": 3024,
  "width": 1280,
  "height": 960,
  "resized": true,
  "compressed": true
}
```

### Validation errors

```json
{
  "error": "Missing required parameters",
  "message": "selector is required"
}
```

```json
{
  "error": "Missing required parameters",
  "message": "image is required (raw base64 or data URL)"
}
```

### Error response

```json
{
  "error": "Failed to upload image",
  "message": "Element is not a file input"
}
```

### cURL example

```bash
IMAGE_B64=$(base64 -w 0 ./photo.jpg)

curl -X POST "http://localhost:3000/api/session/<sessionId>/fill-image" \
  -H "Content-Type: application/json" \
  -d "{
    \"selector\": \"input[type=file]\",
    \"image\": \"${IMAGE_B64}\",
    \"filename\": \"photo.jpg\",
    \"mimeType\": \"image/jpeg\",
    \"maxWidth\": 1024,
    \"quality\": 0.85
  }"
```

---

## 15) Select Option (AI-Powered)

**POST** `/:sessionId/select`

Selects one or more options in a `<select>` element. Supports AI-powered matching to handle abbreviations, variations, and fuzzy matching when enabled.

Select matches against each option's **value**, **label**, and **visible text** (case-insensitive, with partial match fallback). Hidden native `<select>` elements (common behind custom dropdown UIs) are still supported.

If `selector` points at an `<option>`, `<optgroup>`, `<label>`, or wrapper around a select, the API resolves the parent/associated `<select>` and reads options from it (useful for AI agents that target child nodes).


### Request body (example)

```json
{
  "selector": "select[name='country']",
  "value": "US",
  "useAI": true,
  "context": "Country selection for shipping address"
}
```

### Request fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | yes | CSS selector for the select element (or an option/label/wrapper that resolves to it) |
| `value` / `values` | string/string[] | no | Option `value`, label, or visible text to select (case-insensitive) |
| `label` / `labels` | string/string[] | no | Option label(s) to select (also matched against value/text) |
| `text` / `texts` | string/string[] | no | Option text(s) to select (also matched against value/label) |
| `index` / `indexes` | number/number[] | no | Option index/indices (0-based) |
| `useAI` | boolean | no | Enable AI-powered matching (default: `false`) |
| `context` | string | no | Additional context for AI matching |

### AI-Powered Matching

When `useAI: true` is set:
- First tries deterministic matching on option **value**, **label**, and **text**
- If no direct match, sends the **full available options list** to OpenAI and asks it to pick the best index
- Handles abbreviations (e.g., "US" → "United States")
- Handles numeric / range intent (e.g., `"1"` → `"Less than 5"`, `"10"` → `"6-50"`)
- Handles fuzzy / semantic matching (e.g., "UK" → "United Kingdom")
- Skips placeholders like "Select..." unless explicitly requested

**Requires:** `OPENAI_API_KEY` environment variable

Example when the form has ranges and the agent sends a raw number:

```json
{
  "selector": "select[name='employeeCount']",
  "value": "1",
  "useAI": true,
  "context": "Company employee count dropdown"
}
```

AI can resolve `"1"` to `"Less than 5"` from options like `Less than 5`, `6-50`, `More than 50`.

### Success response (without AI)

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "selector": "select[name='country']",
  "selectedValues": ["us"],
  "selectedOptions": [
    {
      "value": "us",
      "label": "United States",
      "text": "United States"
    }
  ],
  "aiMatching": {
    "enabled": false,
    "available": true,
    "requested": ["US"],
    "matched": null
  }
}
```

### Success response (with AI)

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "selector": "select[name='country']",
  "selectedValues": ["us"],
  "selectedOptions": [
    {
      "value": "us",
      "label": "United States",
      "text": "United States"
    }
  ],
  "aiMatching": {
    "enabled": true,
    "available": true,
    "requested": ["US"],
    "matched": ["United States"]
  }
}
```

### Validation errors

```json
{
  "error": "Selector is required"
}
```

```json
{
  "error": "Option selection is required",
  "message": "Provide value, values, label, labels, text, texts, index, or indexes"
}
```

### Error response (no match)

```json
{
  "error": "Failed to select option",
  "message": "No option found matching \"US\". Available options: us (\"United States\"), ca (\"Canada\")"
}
```

### cURL example (without AI)

```bash
curl -X POST "http://localhost:3000/api/session/<sessionId>/select" \
  -H "Content-Type: application/json" \
  -d '{
    "selector": "select[name='country']",
    "value": "United States"
  }'
```

### cURL example (with AI)

```bash
curl -X POST "http://localhost:3000/api/session/<sessionId>/select" \
  -H "Content-Type: application/json" \
  -d '{
    "selector": "select[name='country']",
    "value": "US",
    "useAI": true,
    "context": "Country selection for shipping address"
  }'
```

### Environment setup for AI

```bash
# Add to .env file
OPENAI_API_KEY=your_openai_api_key_here
```

---

## 16) Get Content

**POST** `/:sessionId/content`

Returns full page HTML when no selector is passed, or selector text content when selector is provided.

### Request body examples

```json
{
  "selector": "h1"
}
```

```json
{}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Example Domain",
  "content": "Example Domain"
}
```

---

## 16) Get Rendered HTML

**GET** `/:sessionId/html`

Waits for network idle, does a short scroll pass to trigger lazy loads, then returns rendered HTML (`document.documentElement.outerHTML`).

### Query parameters

- `waitFor` (accepted by API but current implementation always uses network-idle wait internally)
- `timeout` (default `30000`)

### Example request

`GET /api/session/<sessionId>/html?timeout=45000`

### Success response

- Content-Type: `text/html`
- Body: rendered HTML

### Error response

```json
{
  "error": "Failed to get page HTML",
  "message": "Error details"
}
```

---

## 17) Simulate User Actions

**POST** `/:sessionId/simulate-actions`

Starts asynchronous background simulation (scrolling, mouse movement, typing, idle/navigation patterns) for the requested duration, then returns immediately.

### Request body (example)

```json
{
  "durationMinutes": 5
}
```

### Success response

```json
{
  "success": true,
  "message": "User simulation started for 5 minutes",
  "actions": "Enhanced human-like behavior with natural mouse movements, typing, and browsing patterns"
}
```

### Error examples

```json
{
  "error": "Session not found"
}
```

```json
{
  "error": "Browser or page not available"
}
```

---

## 18) Validate Google

**POST** `/:sessionId/validate-google`

Navigates to Google, waits for load, attempts to accept cookie banner, and tries to switch language to English.

### Request body

No request body required.

### Response behavior (important)

- On error, returns:

```json
{
  "error": "Failed to validate Google",
  "message": "Error details"
}
```

- On success, current controller implementation performs actions but does **not** explicitly send a success JSON response body.

---

## 19) Solve reCAPTCHA

**POST** `/:sessionId/solve-recaptcha`

Extracts reCAPTCHA metadata from the active page, requests solution from 2Captcha, injects token into the page, optionally clicks a submit button.

### Request body (example)

```json
{
  "submitAfter": true,
  "waitTime": 5000
}
```

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "tokenPreview": "03AFcWeA...<first 30 chars>...",
  "submitted": true,
  "submitResult": {
    "success": true,
    "text": "Continue"
  },
  "captcha": {
    "siteKey": "6Lc...",
    "isEnterprise": true,
    "s": null,
    "action": null
  },
  "injectionResult": {
    "success": true
  }
}
```

### No-captcha example

```json
{
  "success": false,
  "message": "No reCAPTCHA detected",
  "details": {}
}
```

---

## 20) Configure 2Captcha

**POST** `/:sessionId/configure-2captcha`

Configures 2Captcha extension settings for the session page (API key, proxy, proxy type).

### Request body (example)

```json
{
  "apiKey": "YOUR_2CAPTCHA_API_KEY",
  "proxy": "http://proxy.example.com:8080",
  "useProxy": true,
  "proxyType": "HTTP"
}
```

### Success response

```json
{
  "success": true,
  "message": "2Captcha configured successfully",
  "configuration": {
    "configured": true,
    "apiKeySet": true,
    "proxyEnabled": true,
    "proxySet": true,
    "extensionEnabled": true
  }
}
```

### Error response

```json
{
  "error": "Failed to configure 2Captcha",
  "message": "Extension may not be loaded or configuration failed"
}
```

---

## 21) Validate 2Captcha Config

**GET** `/:sessionId/validate-2captcha`

Reads extension config state and returns whether required values are present.

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "validation": {
    "configured": true,
    "apiKeySet": true,
    "proxyEnabled": false,
    "proxySet": false,
    "extensionEnabled": true
  }
}
```

---

## 22) Diagnose 2Captcha

**GET** `/:sessionId/diagnose-2captcha`

Runs deeper diagnostics against extension availability/config and returns health summary + recommendations.

### Success response

```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "diagnostics": {
    "extensionLoaded": true,
    "configAccessible": true,
    "apiKeySet": true,
    "proxyEnabled": false,
    "errors": []
  },
  "summary": {
    "healthy": true,
    "issues": [],
    "recommendations": []
  }
}
```

---

## 23) Scroll To Bottom

**POST** `/:sessionId/scroll-to-bottom`

Scrolls to the calculated page bottom, waits until viewport reaches bottom threshold, then returns position details.

### Request body

No request body required.

### Success response

```json
{
  "success": true,
  "message": "Page scrolled to bottom",
  "position": {
    "scrollY": 4100,
    "innerHeight": 947,
    "scrollHeight": 5032
  }
}
```

### Error response

```json
{
  "error": "Failed to scroll to bottom",
  "details": "Error details"
}
```

---

## Quick cURL workflow

```bash
# 1) Create session
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": true, "width": 1920, "height": 1080}'

# 2) Navigate
curl -X POST http://localhost:3000/api/session/<sessionId>/goto \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# 3) Extract title with execute
curl -X POST http://localhost:3000/api/session/<sessionId>/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"() => document.title"}'

# 4) Close session
curl -X DELETE http://localhost:3000/api/session/<sessionId>
```
