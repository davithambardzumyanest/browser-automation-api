# 2Captcha Extension Configuration Guide

## Overview

This guide explains how to configure the 2Captcha browser extension programmatically without UI interaction. The new system uses Chrome's Storage API to directly configure the extension.

## 🚀 **New Features**

### **Direct Configuration (No UI Required)**
- Configure API key and proxy settings programmatically
- No need to interact with extension's options page
- Automatic extension detection and configuration
- Validation endpoints to verify configuration

### **API Endpoints**

#### **Configure 2Captcha**
```http
POST /api/session/:sessionId/configure-2captcha
Content-Type: application/json

{
  "apiKey": "your-api-key-here",
  "proxy": {
    "username": "proxy-user",
    "password": "proxy-pass",
    "server": "http://proxy.example.com:8080",
    "type": "HTTP"
  },
  "useProxy": true,
  "proxyType": "HTTP"
}
```

#### **Validate Configuration**
```http
GET /api/session/:sessionId/validate-2captcha
```

#### **Response Example**
```json
{
  "success": true,
  "sessionId": "abc123",
  "validation": {
    "configured": true,
    "apiKeySet": true,
    "proxyEnabled": true,
    "proxySet": true,
    "extensionEnabled": true,
    "config": {
      "apiKey": "your-api-key",
      "useProxy": true,
      "proxytype": "HTTP",
      "proxy": "user:pass@proxy.example.com:8080",
      "isPluginEnabled": true
    }
  }
}
```

## 🔧 **Implementation Details**

### **How It Works**

1. **Extension Detection**: Automatically finds the 2Captcha extension ID
2. **Direct Storage**: Uses `chrome.storage.local.set()` to configure
3. **No UI Interaction**: Bypasses the options page completely
4. **Validation**: Verifies configuration was applied correctly

### **Key Functions**

#### **`configure2CaptchaDirectly(page, options)`**
Main function that configures the extension without UI.

**Parameters:**
- `page`: Puppeteer page object
- `options.apiKey`: 2Captcha API key (defaults to `process.env.TWO_CAPTCHA_API_KEY`)
- `options.proxy`: Proxy configuration object
- `options.useProxy`: Boolean to enable/disable proxy
- `options.proxyType`: Proxy type (HTTP, HTTPS, SOCKS4, SOCKS5)

#### **`validate2CaptchaConfig(page)`**
Validates current extension configuration.

**Returns:**
- `configured`: Whether API key is set
- `apiKeySet`: API key presence
- `proxyEnabled`: Proxy usage enabled
- `proxySet`: Proxy configuration present
- `extensionEnabled`: Extension is active

## 📝 **Usage Examples**

### **Basic Configuration**
```javascript
// Configure with API key only
await configure2CaptchaDirectly(page, {
  apiKey: "your-api-key-here"
});
```

### **With Proxy**
```javascript
// Configure with proxy
await configure2CaptchaDirectly(page, {
  apiKey: "your-api-key-here",
  proxy: {
    username: "proxyuser",
    password: "proxypass",
    server: "http://proxy.example.com:8080",
    type: "HTTP"
  },
  useProxy: true,
  proxyType: "HTTP"
});
```

### **Environment Variable**
```bash
# Set in .env file
TWO_CAPTCHA_API_KEY=your-api-key-here
```

### **API Usage**
```bash
# Configure 2Captcha
curl -X POST http://localhost:3000/api/session/abc123/configure-2captcha \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your-api-key",
    "proxy": {
      "username": "user",
      "password": "pass", 
      "server": "http://proxy.example.com:8080"
    },
    "useProxy": true
  }'

# Validate configuration
curl http://localhost:3000/api/session/abc123/validate-2captcha
```

## 🔄 **Migration from Old System**

### **Before (UI-based)**
```javascript
// Old method - required UI interaction
await page.goto('chrome-extension://xxx/options/options.html');
await page.type('#apiKey', apikey);
await page.click('#connect');
```

### **After (Direct Configuration)**
```javascript
// New method - direct configuration
await configure2CaptchaDirectly(page, {
  apiKey: apikey,
  proxy: proxyConfig
});
```

## 🛠️ **Technical Details**

### **Extension Configuration Structure**
```javascript
{
  isPluginEnabled: true,
  apiKey: "your-api-key",
  valute: "USD",
  email: null,
  autoSubmitForms: true,
  submitFormsDelay: 0,
  useProxy: false,
  proxytype: "HTTP",
  proxy: "user:pass@proxy.example.com:8080",
  // ... other settings
}
```

### **Browser Arguments**
The system automatically adjusts browser arguments to allow the extension:
- Removes `--disable-extensions` arguments
- Adds `--load-extension=/path/to/2captcha`
- Adds `--disable-extensions-except=/path/to/2captcha`

### **Error Handling**
- Extension not found → Returns error
- Invalid API key → Continues with warning
- Proxy configuration errors → Logs but doesn't fail
- Storage permission errors → Returns detailed error

## 🔍 **Troubleshooting**

### **Common Issues**

1. **Extension Not Found**
   - Ensure extension path is correct
   - Check extension is properly loaded
   - Verify browser arguments allow extensions

2. **Configuration Not Applied**
   - Check extension permissions
   - Verify Chrome storage API access
   - Use validation endpoint to debug

3. **Proxy Not Working**
   - Verify proxy format: `user:pass@host:port`
   - Check proxy type matches server
   - Test proxy connectivity separately

### **Debug Commands**
```javascript
// Check extension is loaded
const extensions = await page.evaluate(() => {
  return new Promise(resolve => {
    chrome.management.getAll(resolve);
  });
});

// Check current configuration
const config = await page.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.local.get('config', result => resolve(result));
  });
});
```

## 📋 **Configuration Options**

### **Supported Captcha Types**
- reCAPTCHA v2
- reCAPTCHA v3
- hCaptcha
- GeeTest
- GeeTest v4
- KeyCaptcha
- Arkose Labs
- Lemin
- Yandex SmartCaptcha
- Capy Puzzle
- Amazon WAF
- Turnstile

### **Proxy Types**
- HTTP
- HTTPS
- SOCKS4
- SOCKS5

### **Auto-Solve Settings**
- Enable/disable per captcha type
- Set minimum scores (reCAPTCHA v3)
- Configure form submission delays
- Set error retry attempts

## 🎯 **Best Practices**

1. **Environment Variables**: Store API key in environment variables
2. **Validation**: Always validate configuration after setting
3. **Error Handling**: Handle configuration failures gracefully
4. **Security**: Don't expose API keys in client-side code
5. **Testing**: Test with different proxy configurations

## 📞 **Support**

For issues with:
- **API Keys**: Contact 2Captcha support
- **Extension**: Check 2Captcha extension documentation
- **Integration**: Review browser console logs
- **Proxy**: Verify proxy server connectivity
