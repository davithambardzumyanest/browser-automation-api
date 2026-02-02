const puppeteer = require('puppeteer-extra');

/**
 * Applies stealth settings to a page
 * @param {import('puppeteer').Page} page - The page to apply stealth to
 */
async function applyStealth(page) {
    // Override page visibility state
    await page.evaluateOnNewDocument(() => {
        // Page visibility
        Object.defineProperty(document, 'hidden', {
            get: () => false
        });
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible'
        });
        Object.defineProperty(document, 'hasFocus', {
            get: () => true
        });
        window.onblur = null;
        window.onfocus = null;

        // Navigator properties
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        
        // Spoof plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4],
        });
        
        // Spoof languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en', 'fr', 'de'],
        });
        
        // Spoof hardware concurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 4,
        });
        
        // Spoof device memory
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
        });

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    // Set viewport with some randomness
    await page.setViewport({
        width: 1366 + Math.floor(Math.random() * 100),
        height: 768 + Math.floor(Math.random() * 100),
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: false,
        isMobile: false,
    });

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
}

/**
 * Moves mouse naturally to an element
 * @param {import('puppeteer').Page} page - The page
 * @param {string} selector - The selector of the element to move to
 */
async function moveNaturallyToElement(page, selector) {
    const element = await page.$(selector);
    if (!element) return;
    
    const box = await element.boundingBox();
    if (!box) return;

    // Move to a random position first
    await page.mouse.move(
        Math.random() * 1000,
        Math.random() * 100
    );
    
    // Then move to the element with a curve
    await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { steps: 20 }
    );
    
    // Small random movement around the element
    await page.mouse.move(
        box.x + box.width / 2 + (Math.random() * 10 - 5),
        box.y + box.height / 2 + (Math.random() * 10 - 5),
        { steps: 5 }
    );
}

/**
 * Simulates natural tab activity
 * @param {import('puppeteer').Page} page - The page to simulate activity on
 */
async function simulateTabActivity(page) {
    try {
        // Random scrolls
        await page.evaluate(() => {
            window.scrollBy(0, Math.random() * 100 - 50);
        });
        
        // Random mouse movements
        await page.mouse.move(
            Math.random() * 1000,
            Math.random() * 1000,
            { steps: 10 }
        );
    } catch (error) {
        console.error('Error simulating tab activity:', error);
    }
}

/**
 * Tests if the page can detect automation
 * @param {import('puppeteer').Page} page - The page to test
 * @returns {Promise<Object>} Test results
 */
async function testAutomationDetection(page) {
    return page.evaluate(() => {
        const results = {
            webdriver: navigator.webdriver,
            chrome: !!window.chrome,
            permissions: navigator.permissions.query.toString().indexOf('native') > -1,
            plugins: navigator.plugins.length === 0,
            languages: navigator.languages,
            platform: navigator.platform,
            hidden: document.hidden,
            visibilityState: document.visibilityState,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            maxTouchPoints: navigator.maxTouchPoints,
            pdfViewerEnabled: navigator.pdfViewerEnabled,
            cookieEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            webdriver: navigator.webdriver,
            chrome: !!window.chrome,
            permissions: navigator.permissions.query.toString().indexOf('native') > -1,
            plugins: navigator.plugins.length === 0,
            languages: navigator.languages,
            platform: navigator.platform,
            hidden: document.hidden,
            visibilityState: document.visibilityState
        };
        
        // Canvas fingerprinting test
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Test', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Test', 4, 17);
            results.canvasFingerprint = canvas.toDataURL().length > 1000;
        } catch (e) {
            results.canvasFingerprintError = e.message;
        }
        
        // WebGL fingerprinting test
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    results.webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                    results.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                }
            }
        } catch (e) {
            results.webglError = e.message;
        }
        
        return results;
    });
}

/**
 * Gets browser launch options with stealth settings
 * @param {Object} options - Additional options
 * @returns {Object} Launch options
 */
function getStealthLaunchOptions(options = {}) {
    const defaultArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-web-security',
        '--disable-site-isolation-trials',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--start-maximized',
        '--no-zygote',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-app-list-dismiss-on-blur',
        '--disable-accelerated-video-decode',
        '--disable-bundled-ppapi-flash',
        '--disable-datasaver-prompt',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-setuid-sandbox',
        '--disable-speech-api',
        '--disable-sync',
        '--disable-tab-for-desktop-share',
        '--disable-translate',
        '--disable-voice-input',
        '--disable-wake-on-wifi',
        '--enable-async-dns',
        '--enable-simple-cache-backend',
        '--enable-tcp-fast-open',
        '--enable-webgl',
        '--hide-scrollbars',
        '--ignore-gpu-blocklist',
        '--in-process-gpu',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-pings',
        '--no-sandbox',
        '--no-zygote',
        '--password-store=basic',
        '--prune-generated-web-accessible-files',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
        '--window-size=1920,1080'
    ];

    return {
        headless: false, // Important for anti-detection
        args: [...new Set([...defaultArgs, ...(options.args || [])])],
        ignoreHTTPSErrors: true,
        defaultViewport: {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            hasTouch: false,
            isLandscape: false,
            isMobile: false,
        },
        ...options,
    };
}

module.exports = {
    applyStealth,
    moveNaturallyToElement,
    simulateTabActivity,
    testAutomationDetection,
    getStealthLaunchOptions
};
