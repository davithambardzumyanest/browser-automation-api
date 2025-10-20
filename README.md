# Browser API

A RESTful API built with Express.js and Puppeteer for taking screenshots of web pages.

## Features

- 🔒 Security headers with Helmet
- 🌐 CORS enabled
- 📊 Request logging with Morgan
- ⚡ Rate limiting protection
- 🎯 URL validation
- 🔄 Browser instance pooling for better performance
- 💪 Graceful shutdown handling
- 🏥 Health check endpoint
- 🥷 **Stealth mode to bypass bot detection** (works with Google, etc.)
- 🤖 Anti-detection measures (user agent spoofing, webdriver hiding)
- 🎯 **Session-based API** - Persistent browser sessions with custom headers
- ⏰ **Auto cleanup** - Sessions automatically close after 10 minutes of inactivity
- 🍪 **Cookie persistence** - Optional persistent storage for login states

## Installation

```bash
npm install
```

### Dependencies

- **express** - Web framework
- **puppeteer** - Headless Chrome automation
- **puppeteer-extra** - Plugin framework for puppeteer
- **puppeteer-extra-plugin-stealth** - Stealth plugin for bot detection bypass
- **uuid** - Session ID generation
- **helmet** - Security headers
- **cors** - Cross-origin resource sharing
- **morgan** - HTTP request logging
- **express-rate-limit** - Rate limiting
- **dotenv** - Environment variables

## Configuration

Copy `.env.example` to `.env` and configure your environment variables:

```bash
cp .env.example .env
```

## Running the Project

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

## API Types

This API provides two ways to interact with browsers:

### 1. **Regular API** - One-off operations
Simple endpoints for quick tasks. Each request creates and closes a browser.

### 2. **Session API** - Persistent browser sessions
Create long-lived browser sessions for complex workflows. Perfect for:
- Multi-step automation
- Maintaining login state
- Custom headers per session
- Manual CAPTCHA solving

See [SESSION_API.md](SESSION_API.md) for complete session documentation.

## API Endpoints

All browser automation endpoints are prefixed with `/api`.

### Health Check
```
GET /health
```

Returns the API health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-20T12:17:00.000Z"
}
```

---

### 1. Take Screenshot
```
POST /api/screenshot
```

Takes a screenshot of the specified URL.

**Request Body:**
```json
{
  "url": "https://example.com",
  "fullPage": true,
  "width": 1920,
  "height": 1080,
  "timeout": 90000
}
```

**Parameters:**
- `url` (required) - URL to screenshot
- `fullPage` (optional, default: true) - Capture full page or viewport only
- `width` (optional, default: 1920) - Viewport width
- `height` (optional, default: 1080) - Viewport height
- `timeout` (optional, default: 90000) - Navigation timeout in milliseconds

**Response:**
- Content-Type: `image/png`
- Body: PNG image buffer

**Note:** Google and other dynamic sites may need higher timeout values (120000+)

---

### 2. Navigate to URL
```
POST /api/navigate
```

Navigate to a URL and get page information.

**Request Body:**
```json
{
  "url": "https://example.com",
  "waitUntil": "networkidle2"
}
```

**Response:**
```json
{
  "success": true,
  "title": "Page Title",
  "url": "https://example.com"
}
```

---

### 3. Click Element by Text
```
POST /api/click-text
```

Click an element containing specific text.

**Request Body:**
```json
{
  "url": "https://example.com",
  "text": "Login",
  "elementType": "button"
}
```

**Response:**
```json
{
  "success": true,
  "clicked": true,
  "newUrl": "https://example.com/login",
  "title": "Login Page"
}
```

---

### 4. Click Element by Selector
```
POST /api/click-selector
```

Click an element using CSS selector.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": "#submit-button",
  "waitForNavigation": false
}
```

**Response:**
```json
{
  "success": true,
  "clicked": true,
  "newUrl": "https://example.com",
  "title": "Page Title"
}
```

---

### 5. Fill Form
```
POST /api/fill-form
```

Fill multiple form fields.

**Request Body:**
```json
{
  "url": "https://example.com/form",
  "fields": [
    {
      "selector": "#username",
      "value": "john_doe",
      "type": "text"
    },
    {
      "selector": "#password",
      "value": "secret123",
      "type": "text"
    },
    {
      "selector": "#country",
      "value": "US",
      "type": "select"
    },
    {
      "selector": "#agree",
      "value": true,
      "type": "checkbox"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Form filled successfully",
  "fieldsProcessed": 4
}
```

---

### 6. Get Page Content
```
POST /api/content
```

Get page HTML content or specific element content.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": ".main-content"
}
```

**Response:**
```json
{
  "success": true,
  "title": "Page Title",
  "url": "https://example.com",
  "content": "<div>...</div>"
}
```

---

### 7. Execute Custom Script
```
POST /api/execute-script
```

Execute custom JavaScript on the page.

**Request Body:**
```json
{
  "url": "https://example.com",
  "script": "return document.querySelectorAll('a').length"
}
```

**Response:**
```json
{
  "success": true,
  "result": 42
}
```

---

### 8. Wait for Element
```
POST /api/wait-element
```

Wait for an element to appear on the page.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": ".dynamic-content",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "elementExists": true,
  "selector": ".dynamic-content"
}
```

---

### 9. Get Element Attributes
```
POST /api/element-attributes
```

Get all attributes and content of an element.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": "#main-button"
}
```

**Response:**
```json
{
  "success": true,
  "attributes": {
    "id": "main-button",
    "class": "btn btn-primary",
    "data-action": "submit"
  },
  "textContent": "Submit",
  "innerHTML": "<span>Submit</span>",
  "tagName": "BUTTON"
}
```

---

### 10. Scroll Page
```
POST /api/scroll
```

Scroll the page in different directions.

**Request Body:**
```json
{
  "url": "https://example.com",
  "direction": "bottom",
  "distance": 500
}
```

Options for `direction`: `"up"`, `"down"`, `"top"`, `"bottom"`

**Response:**
```json
{
  "success": true,
  "scrolled": true
}
```

---

### 11. Generate PDF
```
POST /api/pdf
```

Generate a PDF of the page.

**Request Body:**
```json
{
  "url": "https://example.com",
  "format": "A4",
  "landscape": false
}
```

**Response:**
- Content-Type: `application/pdf`
- Body: PDF buffer

---

### 12. Type Text
```
POST /api/type
```

Type text into an input field with delay.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": "#search-input",
  "text": "search query",
  "delay": 50
}
```

**Response:**
```json
{
  "success": true,
  "typed": true
}
```

## Rate Limiting

Rate limiting is available but currently disabled. To enable it, uncomment the line in `index.js`:
```javascript
app.use('/api', limiter);
```

This will limit all `/api` endpoints to 100 requests per 15 minutes per IP address.

## Best Practices Implemented

1. ✅ Environment variable configuration
2. ✅ Security middleware (Helmet)
3. ✅ CORS configuration
4. ✅ Request logging
5. ✅ Rate limiting
6. ✅ Input validation
7. ✅ Error handling (404 and global error handler)
8. ✅ Browser instance pooling
9. ✅ Graceful shutdown
10. ✅ Proper HTTP status codes
11. ✅ Health check endpoint
12. ✅ Structured error responses
13. ✅ **Stealth browser configuration to bypass bot detection**

## Anti-Detection Features

The browser uses **puppeteer-extra** with the **stealth plugin** to bypass bot detection on sites like Google:

### Powered by puppeteer-extra-plugin-stealth

The stealth plugin automatically handles:

- **User Agent Spoofing** - Mimics real Chrome 120 browser
- **WebDriver Property Hidden** - `navigator.webdriver` returns `false`
- **Chrome Runtime Object** - Adds `window.chrome` object
- **Realistic HTTP Headers** - Complete set of Chrome headers including:
  - Accept, Accept-Language, Accept-Encoding
  - Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site
  - sec-ch-ua (Client Hints)
  - Referer (Google.com)
- **Plugin Simulation** - Simulates browser plugins
- **Language Settings** - Sets realistic language preferences
- **Automation Flags Disabled** - Removes automation indicators
- **Canvas Fingerprinting** - Prevents canvas-based detection
- **WebGL Fingerprinting** - Prevents WebGL-based detection
- **Audio Context** - Prevents audio fingerprinting
- **Permissions** - Handles permission queries realistically
- **And 20+ other evasions** - Comprehensive bot detection bypass

This allows the API to work seamlessly with Google Search, Google Forms, Cloudflare-protected sites, and other sites that typically block headless browsers.

## License

ISC
