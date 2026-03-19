# Browser Automation API - Session Management

Complete documentation for all session management endpoints in the Browser Automation API.

## Table of Contents

- [Session Management](#session-management)
- [Navigation & Page Control](#navigation--page-control)
- [Element Interaction](#element-interaction)
- [Content & Data Retrieval](#content--data-retrieval)
- [reCAPTCHA & Anti-Bot](#recaptcha--anti-bot)
- [Advanced Features](#advanced-features)
- [Error Handling](#error-handling)

---

## Session Management

### Create Session
**POST** `/api/session/create`

Creates a new browser session with customizable options.

**Request Body:**
```json
{
  "headless": true,
  "slowMo": 0,
  "viewport": {
    "width": 1920,
    "height": 1080
  },
  "userAgent": "Mozilla/5.0...",
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass",
    "type": "HTTP"
  },
  "geolocation": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "accuracy": 100
  },
  "locale": "en-US",
  "timezone": "America/New_York"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "browserInfo": {
    "userAgent": "Mozilla/5.0...",
    "viewport": {
      "width": 1920,
      "height": 1080
    },
    "headless": true
  },
  "timestamp": "2026-03-19T10:14:00.000Z"
}
```

---

### List Sessions
**GET** `/api/session/list`

Returns all active sessions.

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "sessionId": "uuid-v4-session-id",
      "createdAt": "2026-03-19T10:14:00.000Z",
      "lastUsed": "2026-03-19T10:14:00.000Z",
      "userAgent": "Mozilla/5.0...",
      "headless": true
    }
  ],
  "total": 1
}
```

---

### Get Session Info
**GET** `/api/session/:sessionId`

Retrieves detailed information about a specific session.

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "sessionInfo": {
    "createdAt": "2026-03-19T10:14:00.000Z",
    "lastUsed": "2026-03-19T10:14:00.000Z",
    "userAgent": "Mozilla/5.0...",
    "viewport": {
      "width": 1920,
      "height": 1080
    },
    "currentUrl": "https://example.com",
    "pageTitle": "Example Page"
  }
}
```

---

### Close Session
**DELETE** `/api/session/:sessionId`

Closes a specific session and cleans up resources.

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Session closed successfully"
}
```

---

### Close All Sessions
**DELETE** `/api/session/`

Closes all active sessions.

**Response:**
```json
{
  "success": true,
  "closedSessions": 3,
  "message": "All sessions closed successfully"
}
```

---

## Navigation & Page Control

### Navigate to URL
**POST** `/api/session/:sessionId/goto`

Navigates the session to a specified URL.

**Request Body:**
```json
{
  "url": "https://example.com",
  "waitUntil": "domcontentloaded",
  "timeout": 90000,
  "referer": "https://google.com",
  "newTab": false
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "url": "https://example.com",
  "title": "Example Page",
  "timestamp": "2026-03-19T10:14:00.000Z"
}
```

---

### Refresh Page
**POST** `/api/session/:sessionId/refresh`

Reloads the current page.

**Request Body:**
```json
{
  "waitUntil": "domcontentloaded",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Page refreshed successfully",
  "pageInfo": {
    "title": "Example Page",
    "url": "https://example.com",
    "timestamp": "2026-03-19T10:14:00.000Z"
  }
}
```

---

### Scroll to Bottom
**POST** `/api/session/:sessionId/scroll-to-bottom`

Scrolls the page to the bottom.

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Scrolled to bottom successfully"
}
```

---

## Element Interaction

### Click Element
**POST** `/api/session/:sessionId/click`

Clicks on an element using CSS selector.

**Request Body:**
```json
{
  "selector": "button.submit",
  "waitForNavigation": true,
  "timeout": 30000,
  "waitUntil": "domcontentloaded"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Element clicked successfully",
  "navigation": {
    "triggered": true,
    "newUrl": "https://example.com/success"
  }
}
```

---

### Type Text
**POST** `/api/session/:sessionId/type`

Types text into an element.

**Request Body:**
```json
{
  "selector": "input[name='username']",
  "text": "john.doe",
  "delay": 120
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Text typed successfully",
  "element": "input[name='username']",
  "textLength": 8
}
```

---

### Fill Input
**POST** `/api/session/:sessionId/fill`

Fills an input field with text (advanced version of type).

**Request Body:**
```json
{
  "selector": "input[name='email']",
  "text": "user@example.com",
  "pressEnter": false,
  "clearInput": true
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "message": "Input filled successfully",
  "element": "input[name='email']",
  "textEntered": "user@example.com"
}
```

---

### Check XPath
**POST** `/api/session/:sessionId/check-xpath`

Checks if elements matching XPath exist on the page.

**Request Body:**
```json
{
  "xpath": "//button[contains(text(), 'Submit')]"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "xpath": "//button[contains(text(), 'Submit')]",
  "found": true,
  "count": 1,
  "elements": [
    {
      "text": "Submit",
      "tagName": "BUTTON",
      "className": "submit-btn"
    }
  ]
}
```

---

## Content & Data Retrieval

### Take Screenshot
**POST** `/api/session/:sessionId/screenshot`

Takes a screenshot of the current page.

**Request Body:**
```json
{
  "fullPage": true
}
```

**Response:**
- **Content-Type:** `image/png`
- **Body:** Binary image data

---

### Execute JavaScript
**POST** `/api/session/:sessionId/execute`

Executes JavaScript code in the page context.

**Request Body:**
```json
{
  "script": "document.title + ' - ' + window.location.href"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "result": "Example Page - https://example.com",
  "executionTime": 15
}
```

---

### Get Page HTML
**GET** `/api/session/:sessionId/html`

Returns the full HTML content of the page.

**Query Parameters:**
- `waitFor` (optional): Wait condition (`networkidle0`, `domcontentloaded`)
- `timeout` (optional): Timeout in milliseconds

**Response:**
- **Content-Type:** `text/html`
- **Body:** Full HTML content

---

### Get Element Content
**POST** `/api/session/:sessionId/content`

Retrieves content from specific elements.

**Request Body:**
```json
{
  "selector": ".content-area"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "content": {
    "text": "Element text content",
    "html": "<div class=\"content-area\">Element text content</div>",
    "attributes": {
      "class": "content-area",
      "id": "main-content"
    }
  }
}
```

---

## reCAPTCHA & Anti-Bot

### Solve reCAPTCHA
**POST** `/api/session/:sessionId/solve-recaptcha`

Automatically solves reCAPTCHA challenges using 2Captcha API with advanced anti-detection.

**Request Body:**
```json
{
  "submitAfter": false,
  "waitTime": 5000
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "tokenPreview": "03AHJ_Vuv... (first 30 chars)",
  "submitted": false,
  "submitResult": null,
  "solvingTime": 34256,
  "browserFingerprint": {
    "userAgent": "Mozilla/5.0...",
    "platform": "Linux x86_64",
    "language": "en-US",
    "screenResolution": "1920x1080",
    "timezone": "America/New_York"
  }
}
```

**Features:**
- ✅ Advanced browser fingerprinting
- ✅ Local solving simulation (25-40 seconds)
- ✅ Random scrolls and mouse movements
- ✅ Click at 100x100 position
- ✅ Proxy support
- ✅ Enterprise reCAPTCHA support
- ✅ Anti-detection measures

---

### Configure 2Captcha (Deprecated)
**POST** `/api/session/:sessionId/configure-2captcha`

> **Note:** This endpoint is deprecated. The solve-recaptcha endpoint now uses direct API calls.

---

### Validate 2Captcha (Deprecated)
**GET** `/api/session/:sessionId/validate-2captcha`

> **Note:** This endpoint is deprecated.

---

### Diagnose 2Captcha (Deprecated)
**GET** `/api/session/:sessionId/diagnose-2captcha`

> **Note:** This endpoint is deprecated.

---

## Advanced Features

### Simulate User Actions
**POST** `/api/session/:sessionId/simulate-actions`

Simulates realistic user behavior for extended periods.

**Request Body:**
```json
{
  "durationMinutes": 5
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "simulation": {
    "duration": 300,
    "actions": [
      "scroll",
      "click",
      "type",
      "navigate"
    ],
    "pagesVisited": 3,
    "interactions": 15
  }
}
```

---

### Validate Google
**POST** `/api/session/:sessionId/validate-google`

Validates Google login page status and challenges.

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-v4-session-id",
  "validation": {
    "isGooglePage": true,
    "hasRecaptcha": true,
    "recaptchaType": "enterprise",
    "challenges": ["recaptcha"],
    "ready": true
  }
}
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Session not found",
  "message": "Session uuid-v4-session-id does not exist or has expired",
  "code": "SESSION_NOT_FOUND"
}
```

### Common Error Codes:

| Code | Description |
|------|-------------|
| `SESSION_NOT_FOUND` | Session ID doesn't exist or expired |
| `INVALID_URL` | Provided URL is malformed |
| `ELEMENT_NOT_FOUND` | CSS/XPath selector not found |
| `TIMEOUT` | Operation timed out |
| `NAVIGATION_FAILED` | Page navigation failed |
| `CAPTCHA_FAILED` | reCAPTCHA solving failed |
| `PROXY_ERROR` | Proxy connection failed |
| `SCRIPT_ERROR` | JavaScript execution failed |

### HTTP Status Codes:

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (session doesn't exist)
- `500` - Internal Server Error
- `503` - Service Unavailable (browser issues)

---

## Environment Variables

Required for reCAPTCHA solving:

```bash
TWO_CAPTCHA_API_KEY=your_2captcha_api_key
```

Optional defaults:

```bash
DEFAULT_HEADLESS=true
DEFAULT_SLOWMO=0
```

---

## Rate Limits & Usage

- **Session Timeout:** 60 minutes of inactivity
- **Cleanup:** Automatic cleanup every 1 minute
- **Concurrent Sessions:** No hard limit (resource dependent)
- **reCAPTCHA Limits:** Depends on 2Captcha plan

---

## Examples

### Basic Session Workflow

```bash
# 1. Create session
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "viewport": {"width": 1920, "height": 1080}}'

# 2. Navigate to page
curl -X POST http://localhost:3000/api/session/{sessionId}/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# 3. Take screenshot
curl -X POST http://localhost:3000/api/session/{sessionId}/screenshot \
  -H "Content-Type: application/json" \
  -d '{"fullPage": true}' \
  --output screenshot.png

# 4. Solve reCAPTCHA
curl -X POST http://localhost:3000/api/session/{sessionId}/solve-recaptcha \
  -H "Content-Type: application/json" \
  -d '{"submitAfter": true}'

# 5. Close session
curl -X DELETE http://localhost:3000/api/session/{sessionId}
```

### Advanced reCAPTCHA Solving

```bash
curl -X POST http://localhost:3000/api/session/{sessionId}/solve-recaptcha \
  -H "Content-Type: application/json" \
  -d '{
    "submitAfter": true,
    "waitTime": 8000
  }'
```

This will:
1. Detect reCAPTCHA on the page
2. Send to 2Captcha with browser fingerprinting
3. Simulate local solving (25-40 seconds)
4. Add random scrolls and mouse movements
5. Click at 100x100 position
6. Inject token with realistic typing
7. Submit form automatically

---

## SDK Examples

### Node.js

```javascript
const axios = require('axios');

class BrowserAPI {
  constructor(baseURL = 'http://localhost:3000/api/session') {
    this.baseURL = baseURL;
  }

  async createSession(options = {}) {
    const response = await axios.post(`${this.baseURL}/create`, options);
    return response.data;
  }

  async navigate(sessionId, url) {
    const response = await axios.post(`${this.baseURL}/${sessionId}/goto`, { url });
    return response.data;
  }

  async solveRecaptcha(sessionId, options = {}) {
    const response = await axios.post(`${this.baseURL}/${sessionId}/solve-recaptcha`, options);
    return response.data;
  }

  async closeSession(sessionId) {
    const response = await axios.delete(`${this.baseURL}/${sessionId}`);
    return response.data;
  }
}

// Usage
const api = new BrowserAPI();

async function example() {
  const session = await api.createSession({
    headless: true,
    viewport: { width: 1920, height: 1080 }
  });

  await api.navigate(session.sessionId, 'https://accounts.google.com');
  
  const result = await api.solveRecaptcha(session.sessionId, {
    submitAfter: true
  });

  console.log('reCAPTCHA solved:', result.success);
  
  await api.closeSession(session.sessionId);
}
```

### Python

```python
import requests
import json

class BrowserAPI:
    def __init__(self, base_url='http://localhost:3000/api/session'):
        self.base_url = base_url

    def create_session(self, options=None):
        response = requests.post(f'{self.base_url}/create', json=options or {})
        return response.json()

    def navigate(self, session_id, url):
        response = requests.post(f'{self.base_url}/{session_id}/goto', 
                               json={'url': url})
        return response.json()

    def solve_recaptcha(self, session_id, options=None):
        response = requests.post(f'{self.base_url}/{session_id}/solve-recaptcha',
                               json=options or {})
        return response.json()

    def close_session(self, session_id):
        response = requests.delete(f'{self.base_url}/{session_id}')
        return response.json()

# Usage
api = BrowserAPI()

session = api.create_session({
    'headless': True,
    'viewport': {'width': 1920, 'height': 1080}
})

api.navigate(session['sessionId'], 'https://accounts.google.com')

result = api.solve_recaptcha(session['sessionId'], {
    'submitAfter': True
})

print(f"reCAPTCHA solved: {result['success']}")

api.close_session(session['sessionId'])
```

---

## Support & Troubleshooting

### Common Issues

1. **Session Not Found**
   - Check if session ID is correct
   - Verify session hasn't expired (60 min timeout)

2. **reCAPTCHA Solving Fails**
   - Verify `TWO_CAPTCHA_API_KEY` environment variable
   - Check 2Captcha account balance
   - Ensure proxy settings are correct

3. **Navigation Timeout**
   - Increase timeout value
   - Check network connectivity
   - Verify URL is accessible

4. **Element Not Found**
   - Verify CSS selector is correct
   - Wait for page to load completely
   - Check if element is in iframe

### Debug Mode

Set environment variable for debugging:
```bash
DEBUG=browser-api
```

This will enable detailed logging for all operations.

---

*Last updated: March 19, 2026*
