# Browser API - Quick Start Guide

## Installation & Setup

```bash
# Install dependencies
npm install

# Configure environment (optional - defaults work fine)
cp .env.example .env
# Edit .env to change PORT if needed (default: 3000)
```

## Running the Server

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

## Quick Test Examples

### Using cURL

#### 1. Health Check
```bash
curl http://localhost:3000/health
```

#### 2. Take Screenshot
```bash
curl -X POST http://localhost:3000/api/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  --output screenshot.png
```

#### 3. Click Link by Text
```bash
curl -X POST http://localhost:3000/api/click-text \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "text": "More information",
    "elementType": "a"
  }'
```

#### 4. Click Element by CSS Selector
```bash
curl -X POST http://localhost:3000/api/click-selector \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "selector": "#my-button"
  }'
```

#### 5. Fill a Form
```bash
curl -X POST http://localhost:3000/api/fill-form \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/login",
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
      }
    ]
  }'
```

#### 6. Get Page Content
```bash
curl -X POST http://localhost:3000/api/content \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "selector": "h1"
  }'
```

#### 7. Execute JavaScript
```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "script": "return document.title"
  }'
```

#### 8. Type Text
```bash
curl -X POST http://localhost:3000/api/type \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "textarea[name=\"q\"]",
    "text": "hello world",
    "delay": 100
  }'
```

#### 9. Scroll Page
```bash
curl -X POST http://localhost:3000/api/scroll \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "direction": "bottom"
  }'
```

#### 10. Generate PDF
```bash
curl -X POST http://localhost:3000/api/pdf \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "format": "A4",
    "landscape": false
  }' \
  --output page.pdf
```

## Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/screenshot` | POST | Take screenshot |
| `/api/navigate` | POST | Navigate to URL |
| `/api/click-text` | POST | Click element by text |
| `/api/click-selector` | POST | Click element by CSS selector |
| `/api/fill-form` | POST | Fill form fields |
| `/api/content` | POST | Get page content |
| `/api/execute-script` | POST | Execute custom JavaScript |
| `/api/wait-element` | POST | Wait for element to appear |
| `/api/element-attributes` | POST | Get element attributes |
| `/api/scroll` | POST | Scroll page |
| `/api/pdf` | POST | Generate PDF |
| `/api/type` | POST | Type text with delay |

## Common Use Cases

### Web Scraping
```javascript
// Get all links from a page
{
  "url": "https://example.com",
  "script": "return Array.from(document.querySelectorAll('a')).map(a => ({ text: a.textContent, href: a.href }))"
}
```

### Form Automation
```javascript
// Login to a website
{
  "url": "https://example.com/login",
  "fields": [
    { "selector": "#email", "value": "user@example.com", "type": "text" },
    { "selector": "#password", "value": "password123", "type": "text" },
    { "selector": "#remember", "value": true, "type": "checkbox" }
  ]
}
```

### Testing & Monitoring
```javascript
// Check if element exists
{
  "url": "https://example.com",
  "selector": ".error-message",
  "timeout": 5000
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad request (missing/invalid parameters)
- `404` - Element not found
- `500` - Server error

## Tips & Best Practices

1. **URL Validation**: Always provide valid URLs starting with `http://` or `https://`
2. **Timeouts**: Default timeout is 60 seconds for page loads
3. **Selectors**: Use specific CSS selectors for better reliability
4. **Browser Pooling**: The API reuses browser instances for better performance
5. **Error Messages**: Check error messages for debugging information

## Notes

- Port 3000 might be in use. Change `PORT` in `.env` file if needed
- Rate limiting is disabled by default. Enable in `index.js` if needed
- The browser runs in headless mode for better performance
- All endpoints close the page after execution to prevent memory leaks
- **Stealth mode enabled** - Works with Google and other bot-detection sites

## Google & Anti-Detection

The API is configured with stealth mode to bypass bot detection:

✅ **Works with Google Search, Google Forms, and other protected sites**

Example - Search Google:
```bash
curl -X POST http://localhost:3000/api/type \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com",
    "selector": "textarea[name=\"q\"]",
    "text": "puppeteer automation",
    "delay": 100
  }'
```

Example - Get Google Search Results:
```bash
curl -X POST http://localhost:3000/api/execute-script \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=puppeteer",
    "script": "return Array.from(document.querySelectorAll(\"h3\")).map(h => h.textContent)"
  }'
```

The stealth configuration includes:
- User agent spoofing
- WebDriver property hiding
- Chrome runtime object injection
- Realistic HTTP headers
- Plugin simulation

For complete API documentation, see [README.md](README.md)
