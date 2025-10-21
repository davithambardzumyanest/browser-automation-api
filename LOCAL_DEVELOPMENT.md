# Local Development Setup

## Quick Start for Development

### 1. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` for development:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Browser Configuration (for development)
# Set to 'false' to see browser window by default
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

### 2. Start Server

```bash
npm start
```

### 3. Create Session (Browser Opens Automatically!)

```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{}'
```

With the environment variables set, this will:
- ✅ Open a visible browser window
- ✅ Slow down operations by 250ms
- ✅ Auto-open Chrome DevTools

## Environment Variables Explained

### `DEFAULT_HEADLESS`

Controls whether browser is visible by default.

```bash
DEFAULT_HEADLESS=false  # Browser window visible (development)
DEFAULT_HEADLESS=true   # Headless mode (production)
```

**Recommendation:**
- Development: `false` (see what's happening)
- Production: `true` (no GUI needed)

### `DEFAULT_SLOWMO`

Slows down browser operations by N milliseconds.

```bash
DEFAULT_SLOWMO=0     # No delay (production)
DEFAULT_SLOWMO=100   # Slight delay
DEFAULT_SLOWMO=250   # Medium delay (recommended for dev)
DEFAULT_SLOWMO=500   # Slow delay
DEFAULT_SLOWMO=1000  # Very slow (1 second per operation)
```

**Recommendation:**
- Development: `250` (easy to follow)
- Production: `0` (full speed)

### `DEFAULT_DEVTOOLS`

Auto-opens Chrome DevTools.

```bash
DEFAULT_DEVTOOLS=true   # DevTools open (development)
DEFAULT_DEVTOOLS=false  # No DevTools (production)
```

**Recommendation:**
- Development: `true` (debug JavaScript)
- Production: `false` (not needed)

## Development Configurations

### Configuration 1: Full Debugging (Recommended)

**.env:**
```bash
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

**Create session:**
```bash
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Result:**
- ✅ Browser window opens
- ✅ Operations slowed by 250ms
- ✅ DevTools open automatically

### Configuration 2: Fast Development

**.env:**
```bash
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=0
DEFAULT_DEVTOOLS=false
```

**Result:**
- ✅ Browser window opens
- ✅ Full speed operations
- ❌ No DevTools

### Configuration 3: Production-like

**.env:**
```bash
DEFAULT_HEADLESS=true
DEFAULT_SLOWMO=0
DEFAULT_DEVTOOLS=false
```

**Result:**
- ❌ No browser window
- ✅ Full speed
- ❌ No DevTools

## Override Environment Variables

You can always override environment defaults in your request:

```bash
# Override to headless even if env says non-headless
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "headless": true
  }'

# Override slowMo
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "slowMo": 500
  }'

# Override devtools
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "devtools": false
  }'
```

## Development Workflow

### Step 1: Set Up Environment

```bash
# Copy example
cp .env.example .env

# Edit for development
nano .env
```

Set:
```bash
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

### Step 2: Start Server

```bash
npm start
```

### Step 3: Create Session

```bash
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.sessionId')

echo "Session ID: $SESSION_ID"
```

**Browser window opens automatically!**

### Step 4: Test Navigation

```bash
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'
```

**Watch it navigate in the browser window!**

### Step 5: Test Interactions

```bash
# Type (watch each character)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test query"}'

# Click (watch the click)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'
```

### Step 6: Debug in DevTools

- Check Console tab for errors
- Check Network tab for requests
- Inspect Elements tab for DOM
- Use Sources tab for breakpoints

### Step 7: Close Session

```bash
curl -X DELETE http://localhost:3000/api/session/$SESSION_ID
```

## Tips for Local Development

### 1. Use Non-Headless Mode

Always develop with visible browser:
```bash
DEFAULT_HEADLESS=false
```

### 2. Adjust Slow Motion

Find the right speed for you:
- Too fast? Increase `DEFAULT_SLOWMO`
- Too slow? Decrease `DEFAULT_SLOWMO`

### 3. Use DevTools

Enable DevTools to:
- See console errors
- Inspect network requests
- Debug JavaScript
- Test selectors

### 4. Take Screenshots

Screenshot at each step to verify:
```bash
curl -X POST http://localhost:3000/api/session/$SESSION_ID/screenshot \
  -H "Content-Type: application/json" \
  -d '{}' --output step1.png
```

### 5. Test Selectors

Use DevTools Console to test:
```javascript
document.querySelector('textarea[name="q"]')
```

### 6. Watch Network Requests

Open DevTools Network tab before navigating to see all requests.

## Common Development Scenarios

### Scenario 1: Debug Form Submission

```bash
# 1. Create visible session
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.sessionId')

# 2. Navigate
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Fill form (watch it happen)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test"}'

# 4. Submit (watch submission)
curl -X POST http://localhost:3000/api/session/$SESSION_ID/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=\"btnK\"]"}'

# 5. Check result in browser window
```

### Scenario 2: Debug Element Selection

```bash
# 1. Create session with DevTools
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"devtools": true}' | jq -r '.sessionId')

# 2. Navigate
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Test selector in DevTools Console
# Type: document.querySelector('textarea[name="q"]')

# 4. Use correct selector in automation
curl -X POST http://localhost:3000/api/session/$SESSION_ID/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea[name=\"q\"]", "text": "test"}'
```

### Scenario 3: Debug Navigation Issues

```bash
# 1. Create slow session with DevTools
SESSION_ID=$(curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"slowMo": 500, "devtools": true}' | jq -r '.sessionId')

# 2. Navigate and watch
curl -X POST http://localhost:3000/api/session/$SESSION_ID/goto \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com"}'

# 3. Check DevTools Console for errors
# 4. Check DevTools Network tab for failed requests
```

## Switching Between Development and Production

### Development (.env)
```bash
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

### Production (.env)
```bash
DEFAULT_HEADLESS=true
DEFAULT_SLOWMO=0
DEFAULT_DEVTOOLS=false
```

Or use different env files:

```bash
# Development
cp .env.development .env
npm start

# Production
cp .env.production .env
npm start
```

## Troubleshooting

### Browser Window Not Opening

**Check:**
1. Is `DEFAULT_HEADLESS=false` in `.env`?
2. Are you on a server with no display? (Use headless mode)
3. Is X11 forwarding enabled? (For SSH)

**Solution:**
```bash
# Verify .env
cat .env | grep DEFAULT_HEADLESS

# Should show: DEFAULT_HEADLESS=false
```

### Operations Too Fast

**Solution:**
```bash
# Increase slowMo in .env
DEFAULT_SLOWMO=500
```

### DevTools Not Opening

**Solution:**
```bash
# Enable in .env
DEFAULT_DEVTOOLS=true
```

### Can't See What's Happening

**Solution:**
```bash
# Use full debugging setup
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

## Best Practices

1. **Always use non-headless for development**
   ```bash
   DEFAULT_HEADLESS=false
   ```

2. **Use slow motion to catch issues**
   ```bash
   DEFAULT_SLOWMO=250
   ```

3. **Enable DevTools for debugging**
   ```bash
   DEFAULT_DEVTOOLS=true
   ```

4. **Take screenshots at each step**
   ```bash
   curl .../screenshot --output step.png
   ```

5. **Test selectors in DevTools first**
   ```javascript
   document.querySelector('your-selector')
   ```

6. **Switch to headless for production**
   ```bash
   DEFAULT_HEADLESS=true
   ```

## Summary

**For Local Development:**
```bash
# .env
DEFAULT_HEADLESS=false
DEFAULT_SLOWMO=250
DEFAULT_DEVTOOLS=true
```

**Then just:**
```bash
npm start

# Create session (browser opens automatically!)
curl -X POST http://localhost:3000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{}'
```

**You'll see:**
- ✅ Browser window opens
- ✅ Operations slowed down
- ✅ DevTools open
- ✅ Easy to debug!

Happy developing! 🚀
