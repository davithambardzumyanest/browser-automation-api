const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Session storage
const sessions = new Map();

// Session cleanup interval (check every minute)
const CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_TIMEOUT = 3600000; // 60 minutes (1 hour)

// Browser launch arguments
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-extensions',
    '--disable-default-apps',
    '--mute-audio',
    '--safebrowsing-disable-auto-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-client-side-phishing-detection',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-back-forward-cache-for-cache-control-no-store',
    '--disable-back-forward-cache',
    '--disable-breakpad',
    '--disable-ipc-flooding-protection',
    '--disable-session-crashed-bubble',
    '--force-color-profile=srgb',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--deny-permission-prompts',
    '--disable-search-geolocation-disclosure',
    '--disable-features=site-per-process',
    '--disable-blink-features',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-features=MediaSource',
    '--disable-blink-features=AutomationControlled',
];

// Common user agents for rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/118.0'
];

// Function to get a random user agent
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Session cleanup worker
const startCleanupWorker = () => {
    setInterval(async () => {
        const now = Date.now();
        const sessionsToDelete = [];

        for (const [sessionId, session] of sessions.entries()) {
            if (now - session.lastUsed > SESSION_TIMEOUT) {
                console.log(`Cleaning up inactive session: ${sessionId}`);
                sessionsToDelete.push(sessionId);
            }
        }

        for (const sessionId of sessionsToDelete) {
            await closeSession(sessionId);
        }
    }, CLEANUP_INTERVAL);
};

// Start cleanup worker
startCleanupWorker();

/**
 * Get the first tab of the browser and bring it to front
 * @param {Object} session - The session object
 * @returns {Promise<Object>} The first page in the browser
 */
async function getFirstTab(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length === 0) {
            const newPage = await session.browser.newPage();
            await newPage.setViewport({ width: 1366, height: 768 });
            return newPage;
        }
        
        // Focus the first tab
        const firstPage = pages[0];
        await firstPage.bringToFront();
        return firstPage;
    } catch (error) {
        console.error('Error in getFirstTab:', error);
        throw error;
    }
}

/**
 * Close all tabs except the first one
 * @param {Object} session - The session object
 */
async function closeExtraTabs(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length > 1) {
            // Close all but the first tab
            for (let i = 1; i < pages.length; i++) {
                try {
                    await pages[i].close();
                } catch (closeError) {
                    console.error('Error closing tab:', closeError);
                }
            }
            // Update the active page to the first tab
            session.page = await getFirstTab(session);
        }
    } catch (error) {
        console.error('Error in closeExtraTabs:', error);
        throw error;
    }
}

/**
 * Create a new browser session with anti-detection measures
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createSession = async (req, res) => {
    // Use environment variables for defaults in development
    const defaultHeadless = process.env.DEFAULT_HEADLESS === 'false' ? false : true;
    const defaultSlowMo = parseInt(process.env.DEFAULT_SLOWMO || '0', 10);
    const defaultDevtools = process.env.DEFAULT_DEVTOOLS === 'true' ? true : false;

    // First destructure without the headers
    const {
        headless = defaultHeadless,
        width = 1920,
        height = 1080,
        userAgent = getRandomUserAgent(),
        headers: headersParam,
        userDataDir,
        profileId,
        locale = 'en-US',
        proxy,
        slowMo = defaultSlowMo,
        devtools = defaultDevtools,
        stealth = true,
        allowMedia = false,
        geolocation,
        geolocationOrigin,
        geolocationOrigins,
        grantGeolocationOnNavigation = true,
        timezone,
    } = req.body || {};
    console.log(width)
    console.log(height)
    // Define default headers after destructuring
    const defaultHeaders = {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    };

    // Use default headers if none provided
    const headers = headersParam ? { ...headersParam } : { ...defaultHeaders };
    
    const browserArgs = [...BROWSER_ARGS];

    if (!allowMedia) {
        browserArgs.push('--blink-settings=imagesEnabled=false');
    }

    try {
        const sessionId = uuidv4();

        // Launch browser with custom options
        const launchOptions = {
            headless: headless ? 'new' : false,
            args: [...browserArgs],
            defaultViewport: { 
                width, 
                height,
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                isLandscape: false
            },
            slowMo: slowMo, // Slow down operations for debugging
            devtools: devtools, // Auto-open DevTools
            ignoreHTTPSErrors: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            timeout: 60000, // 60 seconds timeout
            dumpio: false,
            ignoreDefaultArgs: ['--enable-automation']
        };

        launchOptions.args.push(
            `--lang=${locale}`
        );
        // For non-headless mode (visible browser), optimize args for visibility
        if (!headless) {
            // Remove args that are only needed for headless mode
            launchOptions.args = launchOptions.args.filter(arg =>
                !arg.includes('--disable-gpu') &&
                !arg.includes('--no-zygote')
            );

            // Add args for better visibility in development
            launchOptions.args.push(
                '--start-maximized',
                '--disable-blink-features=AutomationControlled'
            );
        }

        // Add proxy configuration if specified
        if (proxy) {
            if (typeof proxy === 'string') {
                // Simple proxy string: "http://host:port"
                launchOptions.args.push(`--proxy-server=${proxy}`);
            } else if (typeof proxy === 'object') {
                // Proxy object with server and optional auth
                if (proxy.server) {
                    launchOptions.args.push(`--proxy-server=${proxy.server}`);
                }
            }
        }

        // Set up user data directory
        if (profileId) {
            // Use profile-based directory if profileId is provided
            const profileDir = `./profiles/account_${profileId}`;
            launchOptions.userDataDir = profileDir;
            
            // Ensure the directory exists
            const fs = require('fs');
            if (!fs.existsSync(launchOptions.userDataDir)) {
                fs.mkdirSync(launchOptions.userDataDir, { recursive: true });
            }
            
            // Check if there's an existing session with the same profileId and close it
            for (const [existingSessionId, session] of sessions.entries()) {
                if (session.profileId === profileId) {
                    console.log(`Closing existing session ${existingSessionId} with profileId ${profileId}`);
                    await closeSession(existingSessionId);
                    break;
                }
            }
        } else if (userDataDir) {
            // Fallback to session-based directory if no profileId but userDataDir is true
            launchOptions.userDataDir = `./sessions/${sessionId}`;
        }
        
        // Set locale settings
        const languageCode = locale.split('-')[0];
        const acceptLanguage = `${locale},${languageCode};q=0.9,en;q=0.8`;
        
        // Update Accept-Language in headers
        headers['Accept-Language'] = acceptLanguage;
        
        // Add extra arguments for locale
        launchOptions.args.push(
            `--lang=${locale}`,
            `--accept-lang=${locale},${languageCode},en`
        );

        // If geolocation is requested, avoid hard-deny prompts flag which can conflict with overrides
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            launchOptions.args = (launchOptions.args || []).filter(a => a !== '--deny-permission-prompts');
        }

        // Configure viewport settings using the provided width and height
        // or default to 1920x1080 if not provided
        const viewportWidth = width || 1920;
        const viewportHeight = height || 1080;
        
        // Create viewport settings
        const viewportSettings = {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: viewportWidth > viewportHeight
        };
        
        // Update launch options with viewport settings
        launchOptions.defaultViewport = viewportSettings;

        // Add additional browser arguments for better stealth
        launchOptions.args.push(
            '--disable-blink-features=AutomationControlled',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-features=IsolateOrigins,site-per-process',
            `--window-size=${viewportWidth},${viewportHeight}`
        );

        // Launch browser and create page
        const browser = await puppeteer.launch(launchOptions);
        const context = browser.defaultBrowserContext();

        // Set up realistic permissions
        await context.overridePermissions('https://*', [
            'geolocation',
            'notifications',
            'camera',
            'microphone',
            'background-sync',
            'clipboard-read',
            'clipboard-write',
            'payment-handler',
        ]);

        const page = await browser.newPage();

        // Set browser headers with our configured headers
        const browserHeaders = {
            ...headers,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-CH-UA': '"Google Chrome";v="120", "Not A(Brand";v="24", "Chromium";v="120"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Windows"',
            'Sec-CH-UA-Platform-Version': '"15.0.0"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Upgrade-Insecure-Requests': '1'
        };

        // Set the headers and user agent
        await page.setExtraHTTPHeaders(browserHeaders);
        await page.setUserAgent(userAgent);

        // Set viewport
        await page.setViewport(launchOptions.defaultViewport);

        // If timezone is provided, emulate it
        if (timezone) {
            try {
                await page.emulateTimezone(timezone);
            } catch (tzError) {
                console.warn(`Failed to set timezone "${timezone}":`, tzError.message);
            }
        }
        
        // Override navigator properties to match the specified locale and enhance realism
        await page.evaluateOnNewDocument((locale, languageCode) => {
            // Language and locale
            Object.defineProperty(navigator, 'language', { get: () => locale });
            Object.defineProperty(navigator, 'languages', { 
                get: () => [locale, languageCode, 'en-US', 'en'] 
            });
            
            // WebDriver detection
            Object.defineProperty(navigator, 'webdriver', { 
                get: () => false 
            });
            
            // Platform
            Object.defineProperty(navigator, 'platform', { 
                get: () => 'Win32' 
            });
            
            // Connection
            const connection = navigator.connection || {};
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    ...connection,
                    downlink: 10,
                    effectiveType: '4g',
                    rtt: 50,
                    saveData: false,
                    type: 'wifi'
                })
            });
            
            // Hardware concurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', { 
                value: 8 
            });
            
            // Device memory (in GB)
            Object.defineProperty(navigator, 'deviceMemory', { 
                value: 8 
            });
            
            // Max touch points
            Object.defineProperty(navigator, 'maxTouchPoints', { 
                value: 0 
            });
            
            // User agent data
            if ('userAgentData' in navigator) {
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => ({
                        brands: [
                            { brand: 'Google Chrome', version: '120' },
                            { brand: 'Not A;Brand', version: '99' },
                            { brand: 'Chromium', version: '120' }
                        ],
                        mobile: false,
                        platform: 'Windows'
                    })
                });
            }
            
            // WebGL vendor and renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                // UNMASKED_VENDOR_WEBGL
                if (parameter === 37445) {
                    return 'Google Inc.';
                }
                // UNMASKED_RENDERER_WEBGL
                if (parameter === 37446) {
                    return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                }
                return getParameter(parameter);
            };
            
            // Disable permissions.query function
            const originalQuery = window.navigator.permissions?.query;
            if (originalQuery) {
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ? 
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
            }
            
            // Disable notifications permission request
            const originalRequestPermission = Notification.requestPermission;
            Notification.requestPermission = function() {
                return Promise.resolve('denied');
            };
            
        }, locale, languageCode);

        // Relay console logs from the page to Node (helps surface evaluateOnNewDocument logs)
        const attachConsoleRelay = (p) => {
            try {
                p.on('console', msg => {
                    try {
                        const loc = msg.location?.() || {};
                        console.log(`[page ${msg.type()}] ${msg.text()}${loc.url ? ` (${loc.url}:${loc.lineNumber}:${loc.columnNumber})` : ''}`);
                    } catch (e) {
                        console.log(`[page ${msg.type()}] ${msg.text()}`);
                    }
                });
            } catch (_) {}
        };
        attachConsoleRelay(page);

        // Also attach for any new pages (popups/new tabs)
        browser.on('targetcreated', async target => {
            try {
                const newPage = await target.page();
                if (newPage) attachConsoleRelay(newPage);
            } catch (e) {
                // ignore
            }
        });

        // Normalize geolocation origins (support string or array)
        const geoOrigins = Array.isArray(geolocationOrigins)
            ? [...geolocationOrigins] // Create a mutable copy
            : (geolocationOrigin ? [geolocationOrigin] : []);

        // If geolocation is provided, always ensure Google Maps is a permitted origin
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            if (!geoOrigins.includes('https://www.google.com')) {
                geoOrigins.push('https://www.google.com');
            }
        }

        // If geolocation is provided, apply it to the page and optionally pre-authorize origins
        if (geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number') {
            try {
                // Ensure accuracy default
                const geo = { accuracy: 50, ...geolocation };
                await page.setGeolocation(geo);

                const context = browser.defaultBrowserContext();

                // Pre-authorize any configured origins
                if (geoOrigins.length) {
                    for (const origin of geoOrigins) {
                        try {
                            await context.overridePermissions(origin, ['geolocation']);
                        } catch (permErr) {
                            console.warn(`Failed to pre-authorize geolocation for ${origin}:`, permErr.message);
                        }
                    }
                }

                // Grant permission for all current frame origins (main + iframes)
                try {
                    const frames = page.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}

                // Keep granting for any later iframe navigations in this page
                try {
                    const grantForFrame = async (frame) => {
                        try {
                            const u = frame.url();
                            if (u && u.startsWith('http')) {
                                await context.overridePermissions(new URL(u).origin, ['geolocation']);
                            }
                        } catch (_) {}
                    };
                    page.on('framenavigated', grantForFrame);
                } catch (_) {}

                // Inject a geolocation mock so early calls resolve with provided coordinates
                await page.evaluateOnNewDocument(({ lat, lon, acc }) => {
                    try {
                        const makePosition = () => ({
                            coords: {
                                latitude: lat,
                                longitude: lon,
                                accuracy: acc ?? 50,
                                altitude: null,
                                altitudeAccuracy: null,
                                heading: null,
                                speed: null,
                            },
                            timestamp: Date.now(),
                        });

                        const geo = navigator.geolocation;

                        if (!geo) return;

                        const originalGet = geo.getCurrentPosition?.bind(geo);
                        const originalWatch = geo.watchPosition?.bind(geo);

                        geo.getCurrentPosition = function (success, error, options) {
                            if (typeof success === 'function') {
                                try { success(makePosition()); } catch (e) {}
                            } else if (typeof error === 'function') {
                                error({ code: 1, message: 'Permission denied' });
                            }
                        };

                        geo.watchPosition = function (success, error, options) {
                            let id = Math.floor(Math.random() * 1e6);
                            if (typeof success === 'function') {
                                try { success(makePosition()); } catch (e) {}
                            }
                            return id;
                        };

                        // Patch Permissions API for geolocation -> granted
                        if (navigator.permissions && navigator.permissions.query) {
                            const originalPermQuery = navigator.permissions.query.bind(navigator.permissions);
                            navigator.permissions.query = (params) => {
                                if (params && params.name === 'geolocation') {
                                    return Promise.resolve({ state: 'granted' });
                                }
                                return originalPermQuery(params);
                            };
                        }
                    } catch (e) {
                        // swallow errors in preload script
                    }
                }, { lat: geo.latitude, lon: geo.longitude, acc: geo.accuracy });
            } catch (geoErr) {
                console.warn('Failed to set geolocation or permissions:', geoErr.message);
            }
        }

        let isIntercepting = false;

        // Enable request interception to block images, fonts, and stylesheets
        await page.setRequestInterception(true);
        if (!isIntercepting) {
            isIntercepting = true;
            page.on('request', async (request) => {
                try {
                    if (!allowMedia && ['image', 'font', 'media', 'imageset'].includes(request.resourceType())) {
                        await request.abort();
                    } else {
                        await request.continue();
                    }
                } catch (error) {
                    // Ignore errors from aborted requests
                    if (!error.message.includes('Request is already handled')) {
                        console.error('Request interception error:', error);
                    }
                }
            });
        }
        // Store browser and page references in session
        const sessionData = {
            browser,
            page,
            userAgent: userAgent,
            lastActivity: Date.now(),
            stealth: stealth,
            proxy: proxy || null,
            cookies: [],
            activeTabIndex: 0,
            maxTabs: 1 // Only allow one tab
        };
        
        sessions.set(sessionId, sessionData);

        // Apply stealth mode if enabled
        if (stealth) {
            await page.evaluateOnNewDocument(() => {
                // WebDriver detection
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                });

                // Chrome object mocking
                window.chrome = window.chrome || {};
                window.chrome.runtime = {};
                
                // Plugins spoofing
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5], // Mock plugins array
                });

                // Languages spoofing
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                    configurable: false,
                    writable: false
                });

                // Permissions spoofing
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: 'denied' }) :
                        originalQuery(parameters)
                );

                // WebGL vendor and renderer spoofing
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) {
                        return 'Google Inc. (NVIDIA)';
                    }
                    // UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) {
                        return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    }
                    return getParameter(parameter);
                };

                // Prevent detection of headless Chrome
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5],
                });

                // Override the languages property to prevent modification
                const originalLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages');
                Object.defineProperty(navigator, 'languages', {
                    ...originalLanguages,
                    value: ['en-US', 'en'],
                    configurable: false,
                    writable: false
                });

                // Mock permissions
                const originalPermissions = {
                    query: window.navigator.permissions.query,
                    request: window.navigator.permissions.request,
                    revoke: window.navigator.permissions.revoke
                };

                window.navigator.permissions.query = (parameters) => {
                    if (parameters.name === 'notifications') {
                        return Promise.resolve({ state: 'denied' });
                    }
                    return originalPermissions.query(parameters);
                };
            });

            // Set additional HTTP headers
            await page.setExtraHTTPHeaders(headers);
            
            // Set viewport and other browser-like properties
            await page.setViewport(launchOptions.defaultViewport);
            await page.setBypassCSP(true);

            // Disable timeout for page load
            page.setDefaultNavigationTimeout(0);
            page.setDefaultTimeout(60000);
        }

        // Set proxy authentication if provided
        if (proxy && typeof proxy === 'object' && proxy.username && proxy.password) {
            try {
                // First try to authenticate using page.authenticate
                await page.authenticate({
                    username: proxy.username,
                    password: proxy.password
                });

                console.log('Proxy authentication set successfully');

                // Set up a handler for authentication dialogs
                page.on('dialog', async dialog => {
                    console.log('Authentication dialog detected, attempting to authenticate...');
                    try {
                        await dialog.authenticate({
                            username: proxy.username,
                            password: proxy.password
                        });
                        console.log('Dialog authentication successful');
                    } catch (authError) {
                        console.error('Dialog authentication failed:', authError.message);
                        await dialog.dismiss();
                    }
                });

                // Test the proxy connection with a simple navigation
                try {
                    console.log('Testing proxy connection...');
                    await page.goto('https://api.ipify.org?format=json', {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                    console.log('Proxy connection test completed');
                } catch (testError) {
                    console.warn('Proxy test navigation failed, but continuing:', testError.message);
                }

            } catch (error) {
                console.error('Error setting up proxy authentication:', error.message);
                // Continue with session creation even if proxy setup fails
            }
        }

        // Set custom user agent or default
        const finalUserAgent = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        await page.setUserAgent(finalUserAgent);

        // Set custom headers
        const defaultHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': `${locale},en;q=0.9`,
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        };

        // Set viewport with the configured settings
        await page.setViewport(launchOptions.defaultViewport);

        // Merge custom headers with defaults
        const finalHeaders = { ...defaultHeaders, ...headers };
        await page.setExtraHTTPHeaders(finalHeaders);
        // Store session
        sessions.set(sessionId, {
            browser,
            page,
            created: Date.now(),
            lastUsed: Date.now(),
            profileId: profileId || null, // Store the profileId with the session
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                headers: finalHeaders,
                locale,
                proxy: proxy ? (typeof proxy === 'string' ? proxy : proxy.server) : null,
                geolocation: geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number'
                    ? { accuracy: 50, ...geolocation }
                    : null,
                geolocationOrigin: geolocationOrigin || null, // deprecated in favor of geolocationOrigins
                geolocationOrigins: geoOrigins,
                grantGeolocationOnNavigation: Boolean(grantGeolocationOnNavigation),
                timezone: timezone || null
            }
        });

        res.json({
            success: true,
            sessionId,
            message: 'Session created successfully',
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                locale
            }
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({
            error: 'Failed to create session',
            message: error.message
        });
    }
};

// Get session info
const getSession = (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    res.json({
        success: true,
        sessionId,
        created: new Date(session.created).toISOString(),
        lastUsed: new Date(session.lastUsed).toISOString(),
        config: session.config
    });
};

// List all active sessions
const listSessions = (req, res) => {
    const activeSessions = [];

    for (const [sessionId, session] of sessions.entries()) {
        activeSessions.push({
            sessionId,
            created: new Date(session.created).toISOString(),
            lastUsed: new Date(session.lastUsed).toISOString(),
            config: session.config
        });
    }

    res.json({
        success: true,
        count: activeSessions.length,
        sessions: activeSessions
    });
};

// Navigate to URL
const navigateSession = async (req, res) => {
    const { sessionId } = req.params;
    const { url, waitUntil = 'domcontentloaded', timeout = 90000, referer, newTab = false } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        new URL(url);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const options = { waitUntil, timeout };
        if (referer) {
            options.referer = referer;
        }

        const browser = session.browser;
        const pages = await browser.pages();
        
        // Close all tabs except the first one
        for (let i = pages.length - 1; i > 0; i--) {
            try {
                await pages[i].close();
            } catch (e) {
                console.error(`Error closing tab ${i}:`, e);
            }
        }
        
        // Get the first (and only) remaining tab
        const [firstPage] = await browser.pages();
        if (!firstPage) {
            throw new Error('No pages available after closing tabs');
        }
        
        // Update session's page reference
        session.page = firstPage;
        
        // If newTab is requested, open a new tab after closing others
        let targetPage = firstPage;
        if (newTab) {
            targetPage = await browser.newPage();
            session.page = targetPage;
        }

        // Update the session's page reference
        session.page = targetPage;
        
        // If geolocation config exists, pre-authorize and set geolocation before navigation
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                const origin = new URL(url).origin;
                const context = browser.defaultBrowserContext();
                // Pre-authorize the target origin
                try {
                    await context.overridePermissions(origin, ['geolocation']);
                } catch (permErr) {
                    console.warn('Failed to override geolocation permissions:', permErr.message);
                }
                // Also re-authorize any configured origins
                if (Array.isArray(cfg.geolocationOrigins)) {
                    for (const o of cfg.geolocationOrigins) {
                        try {
                            await context.overridePermissions(o, ['geolocation']);
                        } catch (permErr) {
                            console.warn(`Failed to override geolocation for ${o}:`, permErr.message);
                        }
                    }
                }

                // Grant permission for all current frame origins (main + iframes)
                try {
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}

                // Keep granting for any later iframe navigations
                try {
                    const grantForFrame = async (frame) => {
                        try {
                            const u = frame.url();
                            if (u && u.startsWith('http')) {
                                await context.overridePermissions(new URL(u).origin, ['geolocation']);
                            }
                        } catch (_) {}
                    };
                    targetPage.on('framenavigated', grantForFrame);
                } catch (_) {}
                try {
                    await targetPage.setGeolocation(cfg.geolocation);
                } catch (geoErr) {
                    console.warn('Failed to apply geolocation on target page:', geoErr.message);
                }
            }
        } catch (prepErr) {
            console.warn('Geolocation pre-navigation setup failed:', prepErr.message);
        }

        // Navigate to the URL
        await targetPage.goto(url, options);
        // Re-apply geolocation after navigation in case the page asked during load, and re-grant iframe origins
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                await targetPage.setGeolocation(cfg.geolocation);
                try {
                    const context = browser.defaultBrowserContext();
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}
            }
        } catch (postNavGeoErr) {
            console.warn('Failed to re-apply geolocation after navigation:', postNavGeoErr.message);
        }
        const pageTitle = await targetPage.title();
        const pageUrl = targetPage.url();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            url: pageUrl,
            tabCount: (await browser.pages()).length
        });
    } catch (error) {
        console.error('Error navigating:', error);
        res.status(500).json({
            error: 'Failed to navigate',
            message: error.message
        });
    }
};

// Take screenshot
const screenshotSession = async (req, res) => {
    const { sessionId } = req.params;
    const { fullPage = true } = req.body ?? {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await wait(2000); // Wait for dynamic content
        const screenshotBuffer = await session.page.screenshot({ fullPage });

        res.set('Content-Type', 'image/png');
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({
            error: 'Failed to take screenshot',
            message: error.message
        });
    }
};

// Execute script
const executeScriptSession = async (req, res) => {
    const { sessionId } = req.params;
    const { script } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Script is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const result = await session.page.evaluate(script);

        res.json({
            success: true,
            sessionId,
            result
        });
    } catch (error) {
        console.error('Error executing script:', error);
        res.status(500).json({
            error: 'Failed to execute script',
            message: error.message
        });
    }
};

/**
 * Check if an XPath exists on the page
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.xpath - XPath selector to check
 * @param {Object} res - Express response object
 */
const checkXPath = async (req, res) => {
    const { sessionId } = req.params;
    const { xpath } = req.body;

    if (!xpath) {
        return res.status(400).json({ error: 'XPath is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const session = sessions.get(sessionId);
        const page = await getFirstTab(session);
        session.page = page;

        // Check if XPath exists
        const exists = await page.evaluate((xpath) => {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return result.singleNodeValue !== null;
        }, xpath);

        return res.json({
            exists,
            xpath,
            sessionId
        });

    } catch (error) {
        console.error('Error checking XPath:', error);
        res.status(500).json({
            error: 'Failed to check XPath',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Click element
const clickSession = async (req, res) => {
    const { sessionId } = req.params;
    const { 
        selector, 
        waitForNavigation = true, 
        allowNewTab = false,
        navigationTimeout = 10000
    } = req.body;

    if (!selector) {
        return res.status(400).json({ error: 'Selector is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    
    try {
        // Ensure we're working with the first tab
        const page = await getFirstTab(session);
        session.page = page;
        
        // Store the current URL before clicking
        const originalUrl = page.url();
        
        // Scroll the element into view with smooth scrolling
        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) {
                element.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }, selector);

        // Helper function to find a clickable element
        const findClickableElement = async (selector, maxAttempts = 3) => {
            let attempts = 0;
            while (attempts < maxAttempts) {
                try {
                    // Wait for the element to be in the DOM and visible
                    await page.waitForSelector(selector, { 
                        visible: true,
                        timeout: 5000 
                    });
                    
                    // Get all matching elements
                    const elements = await page.$$(selector);
                    
                    if (elements.length === 0) {
                        throw new Error('No elements found');
                    }
                    
                    // Try to find a clickable element
                    for (const el of elements) {
                        try {
                            // Check if element is visible and in viewport
                            const isVisible = await el.isIntersectingViewport();
                            if (!isVisible) {
                                // Scroll element into view if not visible
                                await el.evaluate(el => el.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center',
                                    inline: 'center'
                                }));
await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete
                            }
                            
                            // Check if element is clickable
                            await el.hover().catch(() => { throw new Error('Element not hoverable'); });
                            return el; // If we got here, element is clickable
                        } catch (e) {
                            console.log(`Element not clickable, trying next one: ${e.message}`);
                            continue;
                        }
                    }
                    
                    // If we get here, no elements were clickable
                    throw new Error('No clickable elements found');
                    
                } catch (e) {
                    attempts++;
                    console.log(`Attempt ${attempts}/${maxAttempts} failed:`, e.message);
                    if (attempts >= maxAttempts) {
                        throw e;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
                }
            }
            throw new Error('Failed to find clickable element after multiple attempts');
        };

        // Find a clickable element
        let element;
        try {
            element = await findClickableElement(selector);
        } catch (error) {
            console.error('Error finding clickable element:', error);
            return res.status(404).json({
                error: 'No clickable element found',
                message: `Could not find a clickable element matching selector: ${selector}`,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
        
        try {
            // Wait a bit before interacting with the element
            await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            
            // Scroll into view if needed
            await element.evaluate(el => {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                });
            });
            
            // Wait for any potential animations
            await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            
            // Move mouse to the element with human-like movement
            try {
                await element.hover();
                await new Promise(resolve => setTimeout(resolve, randomDelay(100, 250)));
            } catch (hoverError) {
                console.log('Hover failed, but continuing with click:', hoverError.message);
            }

            // Set up navigation promise before clicking
            const navigationPromise = waitForNavigation ? 
                page.waitForNavigation({ 
                    waitUntil: ['domcontentloaded', 'networkidle0'],
                    timeout: navigationTimeout
                }).catch(e => console.log('Navigation timeout/error:', e.message)) : 
                Promise.resolve();

            // Set up new tab handling if allowed
            let newTabResolve;
            const newTabPromise = new Promise((resolve) => {
                newTabResolve = resolve;
            });

            const handleNewTab = async (target) => {
                try {
                    const newPage = await target.page();
                    if (newPage) {
                        // Wait for 2-3 seconds before closing the original tab
                        const closeDelay = randomDelay(2000, 3000);
                        console.log(`New tab opened, will close original tab in ${closeDelay}ms`);

                        setTimeout(async () => {
                            try {
                                if (!page.isClosed()) {
                                    console.log('Closing original tab...');
                                    await page.close();
                                }
                            } catch (e) {
                                console.error('Error closing original tab:', e);
                            }
                        }, closeDelay);
                        
                        session.page = newPage;
                        session.browser = session.browser; // Keep the same browser instance
                        newTabResolve(newPage);
                        return true;
                    }
                } catch (e) {
                    console.error('Error handling new tab:', e);
                }
                return false;
            };

            if (allowNewTab && session.browser) {
                session.browser.on('targetcreated', handleNewTab);
                // Set a timeout to clean up the event listener
                setTimeout(() => {
                    if (session.browser) {
                        session.browser.off('targetcreated', handleNewTab);
                    }
                    newTabResolve();
                }, navigationTimeout);
            }

            // Click the element
            await element.click({ delay: getRandomDelay(200, 400) });
            
            // Wait for either navigation or new tab, but don't fail if neither happens
            await Promise.race([
                Promise.all([navigationPromise, newTabPromise]),
                new Promise(resolve => setTimeout(resolve, navigationTimeout))
            ]);

            // Clean up the event listener if it wasn't already removed
            if (allowNewTab && session.browser) {
                session.browser.off('targetcreated', handleNewTab);
            }

            // Update the active page reference
            const activePage = await getFirstTab(session);
            session.page = activePage;
            session.lastActivity = Date.now();

            // Get the final URL and title
            const finalUrl = activePage.url();
            const pageTitle = await activePage.title();

            return res.json({
                success: true,
                sessionId,
                clicked: true,
                navigated: finalUrl !== originalUrl,
                url: finalUrl,
                title: pageTitle
            });
            
        } catch (clickError) {
            console.error('Error during click action:', clickError);
            // Even if there was an error, ensure we're on the first tab
            await closeExtraTabs(session);
            const firstPage = await getFirstTab(session);
            session.page = firstPage;
            
            throw clickError; // Re-throw to be caught by the outer catch
        }
        
    } catch (error) {
        console.error('Error in clickSession:', error);
        
        // Ensure we're on the first tab even in case of error
        try {
            if (sessions.has(sessionId)) {
                const session = sessions.get(sessionId);
                await closeExtraTabs(session);
                const firstPage = await getFirstTab(session);
                session.page = firstPage;
            }
        } catch (cleanupError) {
            console.error('Error during cleanup after click error:', cleanupError);
        }
        
        res.status(500).json({
            error: 'Failed to perform click action',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Type text
const typeSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, delay = 120 } = req.body;

    if (!selector || !text) {
        return res.status(400).json({ error: 'Selector and text are required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await session.page.waitForSelector(selector, { timeout: 10000 });
        await session.page.click(selector);
        await session.page.type(selector, text, { delay });

        res.json({
            success: true,
            sessionId,
            typed: true
        });
    } catch (error) {
        console.error('Error typing text:', error);
        res.status(500).json({
            error: 'Failed to type text',
            message: error.message
        });
    }
};

/**
 * Get the current page content as HTML
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
/**
 * Get a random delay to simulate human-like behavior
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number} Random delay in ms
 */
const getRandomDelay = (min, max) => Math.random() * (max - min) + min;

/**
 * Simulate human-like typing with random delays and occasional mistakes
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @param {boolean} pressEnter - Whether to press Enter after typing
 */
async function humanType(page, selector, text, pressEnter = false, clearInput = false) {
    // Conditionally clear the input if requested
    if (clearInput) {
        try {
            // Try selecting all and deleting (works for inputs and contenteditable)
            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
        } catch (_) {
            // Fallback: direct value clear and fire events
            await page.evaluate(sel => {
                const input = document.querySelector(sel);
                if (input) {
                    input.focus();
                    if ('value' in input) input.value = '';
                    const evOpts = { bubbles: true, cancelable: true };
                    input.dispatchEvent(new Event('input', evOpts));
                    input.dispatchEvent(new Event('change', evOpts));
                }
            }, selector);
        }
        await wait(getRandomDelay(50, 100));
    }

    // Type per-character with higher delay for slower, human-like typing
    await page.type(selector, String(text), { delay: getRandomDelay(80, 160) });

    // Optionally press Enter
    if (pressEnter) {
        await wait(getRandomDelay(100, 250));
        await page.keyboard.press('Enter');
    }
}

/**
 * Fill an input field with human-like typing
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.selector - CSS selector for the input element
 * @param {string} req.body.text - Text to type
 * @param {boolean} [req.body.pressEnter=false] - Whether to press Enter after typing
 * @param {Object} res - Express response object
 */
const fillInput = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, pressEnter = false, clearInput = true } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    if (!selector || text === undefined) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'Both selector and text are required'
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    
    // Ensure we're using the first tab
    const page = await getFirstTab(session);
    session.page = page; // Update the active page in session

    try {
        // Wait for the element to be visible
        await page.waitForSelector(selector, { 
            visible: true, 
            timeout: 10000 
        });
        
        // Scroll the element into view
        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, selector);
        
        // Add a small delay after scrolling
        await new Promise(resolve => setTimeout(resolve, getRandomDelay(50, 150)));
        
        // Type the text with human-like behavior, honoring clearInput flag
        await humanType(page, selector, text, pressEnter, clearInput);

        res.json({
            success: true,
            message: 'Text filled successfully' + (pressEnter ? ' and Enter was pressed' : ''),
            selector,
            textLength: text.length,
            pressEnterPerformed: pressEnter
        });
    } catch (error) {
        console.error(`[${sessionId}] Error filling input:`, error);
        
        res.status(500).json({
            error: 'Failed to fill input',
            message: error.message,
            details: error.stack
        });
    }
};

/**
 * Get the current page content as HTML
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getPageHTML = async (req, res) => {
    const { sessionId } = req.params;
    const { waitFor = 'networkidle0', timeout = 30000 } = req.query;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    try {
        // Wait for network to be idle (Puppeteer's way)
        await session.page.waitForNetworkIdle({ idleTime: 500, timeout: parseInt(timeout) });
        
        // Scroll to trigger lazy loading
        await session.page.evaluate(async () => {
            await new Promise(resolve => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if(totalHeight >= scrollHeight || totalHeight > 2000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        // Get the full HTML content after all scripts have executed
        const html = await session.page.content();
        const renderedHTML = await session.page.evaluate(() => document.documentElement.outerHTML);
        // Set content type to text/html
        res.set('Content-Type', 'text/html');
        
        // Send the fully rendered HTML
        res.send(renderedHTML);
    } catch (error) {
        console.error(`[${sessionId}] Error getting page HTML:`, error);
        
        // If we get a timeout, try to get whatever HTML is available
        if (error.name === 'TimeoutError') {
            try {
                const html = await session.page.content();
                res.set('Content-Type', 'text/html');
                return res.send(html);
            } catch (fallbackError) {
                console.error(`[${sessionId}] Fallback HTML retrieval failed:`, fallbackError);
            }
        }
        
        res.status(500).json({
            error: 'Failed to get page HTML',
            message: error.message,
            details: error.stack
        });
    }
};

// Get page content
const getContentSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        let content;
        if (selector) {
            await session.page.waitForSelector(selector, { timeout: 10000 });
            content = await session.page.$eval(selector, el => el.textContent);
        } else {
            content = await session.page.content();
        }

        const pageTitle = await session.page.title();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            content
        });
    } catch (error) {
        console.error('Error getting content:', error);
        res.status(500).json({
            error: 'Failed to get content',
            message: error.message
        });
    }
};

// Close session
const closeSession = async (sessionId) => {
    if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        try {
            await session.browser.close();
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
        sessions.delete(sessionId);
    }
};

// Close session endpoint
const closeSessionEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    await closeSession(sessionId);

    res.json({
        success: true,
        message: `Session ${sessionId} closed successfully`
    });
};

// Close all sessions
const closeAllSessions = async (req, res) => {
    const sessionIds = Array.from(sessions.keys());

    for (const sessionId of sessionIds) {
        await closeSession(sessionId);
    }

    res.json({
        success: true,
        message: `Closed ${sessionIds.length} session(s)`,
        count: sessionIds.length
    });
};

// Function to generate random delay
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Function to generate a bezier curve for more natural mouse movement
function generateBezierPoints(start, end, controlPoints = 3) {
    const points = [];
    for (let i = 0; i <= controlPoints; i++) {
        const t = i / controlPoints;
        // Add some randomness to the control points
        const cp1x = start.x + (end.x - start.x) * 0.3 + (Math.random() * 100 - 50);
        const cp1y = start.y + (end.y - start.y) * 0.3 + (Math.random() * 100 - 50);
        const cp2x = start.x + (end.x - start.x) * 0.7 + (Math.random() * 100 - 50);
        const cp2y = start.y + (end.y - start.y) * 0.7 + (Math.random() * 100 - 50);
        
        // Cubic bezier curve formula
        const x = Math.pow(1-t, 3) * start.x + 
                 3 * Math.pow(1-t, 2) * t * cp1x + 
                 3 * (1-t) * t * t * cp2x + 
                 t * t * t * end.x;
                 
        const y = Math.pow(1-t, 3) * start.y + 
                 3 * Math.pow(1-t, 2) * t * cp1y + 
                 3 * (1-t) * t * t * cp2y + 
                 t * t * t * end.y;
        
        points.push({x, y});
    }
    return points;
}

// Function to get current mouse position
async function getMousePosition(page) {
    return page.evaluate(() => {
        return {
            x: window.mouseX || 0,
            y: window.mouseY || 0
        };
    });
}

// Function to simulate human-like mouse movement with bezier curves
async function moveMouse(page, targetX, targetY) {
    const currentPos = await getMousePosition(page);
    const start = { x: currentPos.x || 0, y: currentPos.y || 0 };
    const end = { x: targetX, y: targetY };
    
    // Don't move if already at target
    if (Math.abs(start.x - end.x) < 5 && Math.abs(start.y - end.y) < 5) {
        return;
    }
    
    // Generate bezier curve points
    const points = generateBezierPoints(start, end);
    
    // Move through each point
    for (const point of points) {
        await page.mouse.move(point.x, point.y, { steps: 1 });
        await wait(30 + Math.random() * 30); // Variable speed
    }
    
    // Ensure we reach the exact target
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await wait(randomDelay(50, 200));
    
    // Update mouse position in page context
    await page.evaluate((x, y) => {
        window.mouseX = x;
        window.mouseY = y;
    }, end.x, end.y);
}

// Function to simulate human-like typing (legacy version, use the new humanType function instead)
async function simulateHumanTyping(page, selector, text) {
    return new Promise(async (resolve) => {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        for (const char of text) {
            await page.type(selector, char, { delay: Math.random() * 50 + 50 });
            // Random delay between keystrokes (50-150ms)
            await delay(Math.random() * 100 + 50);
        }
        
        resolve();
    });
}

// Function to simulate human-like scrolling
async function randomScroll(page) {
    const viewport = await page.viewport();
    const maxScroll = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    
    if (maxScroll <= 0) return;
    
    // Decide scroll direction and amount
    const direction = Math.random() > 0.5 ? 1 : -1;
    const baseScroll = Math.min(viewport.height * 0.7, maxScroll * 0.2);
    const scrollAmount = Math.floor(baseScroll * (0.8 + Math.random() * 0.4) * direction);
    
    // Get current scroll position
    const currentScroll = await page.evaluate(() => window.scrollY);
    const targetScroll = Math.max(0, Math.min(currentScroll + scrollAmount, maxScroll));
    
    // Scroll in smaller chunks with easing
    const steps = 10 + Math.floor(Math.random() * 10);
    const stepSize = (targetScroll - currentScroll) / steps;
    
    for (let i = 0; i < steps; i++) {
        const progress = i / (steps - 1);
        // Easing function (easeInOutQuad)
        const easeProgress = progress < 0.5 
            ? 2 * progress * progress 
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
        const currentStep = currentScroll + (targetScroll - currentScroll) * easeProgress;
        
        await page.evaluate((y) => {
            window.scrollTo({ top: y, behavior: 'instant' });
        }, currentStep);
        
        // Variable delay between scroll steps
        await wait(30 + Math.random() * 50);
    }
    
    // Small random delay after scrolling
    await wait(randomDelay(300, 1200));
}

// Function to simulate random mouse movements
async function randomMouseMovements(page) {
    const viewport = page.viewport();
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    await moveMouse(page, x, y);
}

// Function to simulate random clicks on interactive elements
async function randomClicks(page) {
    const clickableElements = await page.$$('a, button, [role="button"], [onclick]');
    if (clickableElements.length > 0) {
        const randomIndex = Math.floor(Math.random() * clickableElements.length);
        try {
            await clickableElements[randomIndex].click({ delay: randomDelay(50, 200) });
            await wait(randomDelay(1000, 3000));
            // Go back if we navigated
            if (page.url() !== 'about:blank') {
                await page.reload();
                await wait(randomDelay(1000, 2000));
            }
        } catch (error) {
            console.log(error);
            console.log('Could not click element, continuing...');
        }
    }
}

// Additional realistic non-intrusive actions
async function randomWheelScroll(page) {
    try {
        const deltaY = (Math.random() > 0.5 ? 1 : -1) * randomDelay(100, 600);
        const deltaX = Math.random() < 0.1 ? randomDelay(-60, 60) : 0;
        await page.mouse.wheel({ deltaY, deltaX });
        await wait(randomDelay(200, 800));
    } catch (_) {}
}

async function randomKeyPresses(page) {
    const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'End', 'Enter', 'Enter', 'Enter', 'Enter', 'Enter', 'Enter'];
    const presses = randomDelay(1, 3);
    for (let i = 0; i < presses; i++) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        try {
            await page.keyboard.press(key, { delay: randomDelay(10, 80) });
        } catch (_) {}
        await wait(randomDelay(100, 300));
    }
}

// Function to simulate natural mouse movements during typing
async function moveMouseNaturally(page, element, durationMs) {
    const box = await element.boundingBox();
    if (!box) return;
    
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const startTime = Date.now();
    const endTime = startTime + durationMs;
    
    // Define movement boundaries (slightly larger than the element)
    const padding = Math.min(box.width, box.height) * 0.5;
    const minX = box.x - padding;
    const maxX = box.x + box.width + padding;
    const minY = box.y - padding;
    const maxY = box.y + box.height + padding;
    
    let lastX = startX;
    let lastY = startY;
    
    // Continue moving until time is up
    while (Date.now() < endTime) {
        // Calculate new target position within boundaries
        const targetX = Math.max(minX, Math.min(maxX, lastX + (Math.random() - 0.5) * 40));
        const targetY = Math.max(minY, Math.min(maxY, lastY + (Math.random() - 0.5) * 20));
        
        // Move to new position
        await page.mouse.move(targetX, targetY, { steps: 3 });
        
        // Small random delay
        await wait(50 + Math.random() * 100);
        
        lastX = targetX;
        lastY = targetY;
    }
    
    // Return to the center of the element
    await page.mouse.move(startX, startY, { steps: 5 });
}

// Function to simulate human-like typing with natural variations and mouse movements
async function humanTypeText(page, element, text) {
    try {
        // First try to focus the element
        try {
            await element.focus();
            await wait(randomDelay(50, 200));
        } catch (e) {
            console.log('Could not focus element, trying to click it first');
            const box = await element.boundingBox();
            if (box) {
                await moveMouse(page, box.x + box.width / 2, box.y + box.height / 2);
                await element.click({ delay: randomDelay(30, 100) });
                await wait(randomDelay(200, 500));
            }
        }
        
        // Calculate typing duration (2 seconds minimum, up to 10 seconds for longer text)
        const baseDuration = Math.min(10000, Math.max(2000, text.length * 100));
        const typingStartTime = Date.now();
        let lastMouseMoveTime = 0;
        
        // Type each character with variable speed
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const currentTime = Date.now();
            const elapsedTime = currentTime - typingStartTime;
            
            // Randomly make typing mistakes (5% chance)
            if (Math.random() < 0.05) {
                const mistake = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
                await page.keyboard.type(mistake, { delay: randomDelay(30, 100) });
                await wait(randomDelay(50, 150));
                await page.keyboard.press('Backspace', { delay: randomDelay(20, 50) });
                await wait(randomDelay(50, 150));
            }
            
            // Type the actual character with variable speed
            const delay = randomDelay(30, 150) * (Math.random() > 0.9 ? 2 : 1);
            await page.keyboard.type(char, { delay });
            
            // Random pause between words or sometimes in the middle
            const shouldPause = (char === ' ' && Math.random() > 0.7) || Math.random() > 0.95;
            if (shouldPause) {
                const pauseTime = randomDelay(100, 500);
                await wait(pauseTime);
            }
            
            // Add natural mouse movements during typing
            if (Math.random() > 0.7 && (currentTime - lastMouseMoveTime) > 500) {
                const remainingTime = Math.max(0, baseDuration - elapsedTime);
                const movementDuration = Math.min(1000, remainingTime / (text.length - i));
                if (movementDuration > 200) {
                    moveMouseNaturally(page, element, movementDuration);
                    lastMouseMoveTime = Date.now();
                }
            }
            
            // Adjust typing speed based on remaining time
            const timePerChar = baseDuration / text.length;
            const expectedTime = (i + 1) * timePerChar;
            const actualTime = Date.now() - typingStartTime;
            
            if (actualTime < expectedTime) {
                await wait(expectedTime - actualTime);
            }
        }
    } catch (error) {
        console.log('Error in humanTypeText:', error.message);
        // Fallback to simple typing if the advanced method fails
        try {
            await element.type(text, { delay: randomDelay(50, 150) });
        } catch (e) {
            console.log('Fallback typing also failed:', e.message);
        }
    }
}

// Function to find and interact with Google search box
async function findAndTypeInSearchBox(page) {
    try {
        // Try different selectors for Google search box
        const searchSelectors = [
            'textarea[name="q"]',
            'input[name="q"]',
            'input[type="text"]',
            'textarea',
            'input'
        ];
        
        for (const selector of searchSelectors) {
            try {
                const searchBox = await page.$(selector);
                if (searchBox) {
                    // Check if it's likely a search box
                    const box = await searchBox.boundingBox();
                    if (box && box.width > 100) { // Ensure it's a reasonable size
                        return { element: searchBox, selector };
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (error) {
        console.log('Error finding search box:', error.message);
    }
    return null;
}

// Function to simulate form filling with more human-like behavior
async function fillRandomForms(page) {
    // First try to find and use Google search box
    try {
        const searchBox = await findAndTypeInSearchBox(page);
        if (searchBox) {
            const { element: input, selector } = searchBox;
            
            // Scroll into view
            await input.evaluate(el => el.scrollIntoView({ 
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest' 
            }));
            
            await wait(randomDelay(300, 800));
            
            // Click on the search box
            await input.click({ delay: randomDelay(30, 100) });
            await wait(randomDelay(200, 500));
            
            // Clear any existing text
            await input.click({ clickCount: 3 }); // Select all
            await page.keyboard.press('Backspace');
            await wait(randomDelay(200, 500));
            
            // Type a search query
            const queries = [
                'web development', 'latest news', 'how to code', 'best practices', 
                'technology trends', 'artificial intelligence', 'machine learning', 
                'web design', 'programming languages', 'software development'
            ];
            const query = queries[Math.floor(Math.random() * queries.length)];
            
            console.log(`Typing query: ${query}`);
            await humanTypeText(page, input, query);
            
            // Don't press Enter automatically after typing in search box
            // Just type and leave the cursor there
            await wait(randomDelay(300, 1000));
            return true;
        }
    } catch (error) {
        console.error('Error interacting with search box:', error);
        // Continue to regular form filling if search box interaction fails
    }
    
    // Fallback to regular form filling if no search box found
    const focusableSelectors = [
        'input:not([type="hidden"]):not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        'button:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable]'
    ].join(',');
    
    // Get all focusable elements
    const focusableElements = await page.$$(focusableSelectors);
    
    // Filter for input elements we want to fill
    const inputElements = [];
    for (const el of focusableElements) {
        try {
            const tagName = await (await el.getProperty('tagName')).jsonValue();
            const type = await (await el.getProperty('type')).catch(() => ({})) || {};
            
            if (['INPUT', 'TEXTAREA'].includes(tagName) && 
                !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(String(type).toLowerCase())) {
                inputElements.push(el);
            }
        } catch (e) {
            continue;
        }
    }
    
    if (inputElements.length === 0) return;
    
    // Limit the number of inputs to fill (1-3)
    const inputsToFill = Math.min(inputElements.length, 1 + Math.floor(Math.random() * 3));
    const shuffledInputs = inputElements.sort(() => 0.5 - Math.random()).slice(0, inputsToFill);
    
    for (const input of shuffledInputs) {
        try {
            // Scroll the element into view
            await input.evaluate(el => {
                el.scrollIntoView({ 
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest' 
                });
            });
            
            // Wait a bit after scrolling
            await wait(randomDelay(300, 1000));
            
            // Get the bounding box of the input
            const box = await input.boundingBox();
            if (!box) continue;
            
            // Move to a random position within the input
            const x = box.x + box.width * (0.2 + Math.random() * 0.6);
            const y = box.y + box.height * (0.2 + Math.random() * 0.6);
            
            // Move to the position with human-like movement
            await moveMouse(page, x, y);
            await wait(randomDelay(100, 400));
            
            // Click with human-like behavior
            await page.mouse.down();
            await wait(randomDelay(30, 100));
            await page.mouse.up();
            await wait(randomDelay(200, 600));
            
            // Determine what to type based on input type
            const inputType = await input.evaluate(el => el.type || 'text');
            let value = '';
            
            switch(inputType.toLowerCase()) {
                case 'email':
                    value = `test${Math.floor(100 + Math.random() * 900)}@example.com`;
                    break;
                case 'search':
                    value = ['web development', 'latest news', 'how to code', 'best practices', 
                            'technology trends', 'artificial intelligence', 'machine learning', 
                            'web design', 'programming languages', 'software development']
                            [Math.floor(Math.random() * 10)];
                    break;
                case 'tel':
                    value = `+1${Math.floor(2000000000 + Math.random() * 8000000000)}`;
                    break;
                case 'number':
                    value = String(Math.floor(1 + Math.random() * 100));
                    break;
                case 'url':
                    value = 'https://example.com';
                    break;
                case 'text':
                default:
                    value = [
                        'Hello, how are you today?',
                        'This is a test message.',
                        'Just checking this out.',
                        'Looking for information about this.',
                        'Can you help me with something?',
                        'I have a question about your service.',
                        'Interested in learning more.',
                        'This looks interesting!',
                        'Testing the input field.',
                        'Please provide more details.'
                    ][Math.floor(Math.random() * 10)];
                    break;
            }
            
            // Type the value with human-like behavior
            await humanTypeText(page, input, value);
            
            // Sometimes press Enter or Tab (30% chance)
            if (Math.random() < 0.3) {
                await wait(randomDelay(300, 800));
                await page.keyboard.press(Math.random() > 0.5 ? 'Enter' : 'Tab', {
                    delay: randomDelay(50, 150)
                });
            }
            
            // Random delay before next action
            await wait(randomDelay(500, 2000));
            
        } catch (error) {
            console.log('Error interacting with input:', error.message);
            // Continue with next input
        }
    }
}
async function clearGoogleSearch(page){

    // Try to find and click the clear button/icon after typing
    try {
        const clearButtonSelector = 'div[role="button"] > span';
        await page.waitForSelector(clearButtonSelector, { visible: true, timeout: 3000 });

        // Get all matching elements
        const elements = await page.$$(clearButtonSelector);

        if (elements.length === 0) {
            return
        }

        console.log(elements.length)
        for (const el of elements) {
            // Ensure the random element is in the viewport
            const isVisible = await el.isIntersectingViewport();
            if (!isVisible) {
                await el.evaluate(el => el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                }));
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Resolve a clickable target: closest role=button container or the element itself
            const btnHandle = await el.evaluateHandle(node => node.closest('div[role="button"]') || node);
            const btn = btnHandle.asElement();
            if (btn) {
                await btn.hover().catch(() => {});
                await btn.click({ delay: 20 });
                console.log('Clicked clear button after typing (random element)');
            } else {
                console.log('Could not resolve clickable element for clear button');
            }
        }
        await wait(randomDelay(500, 1000));

    } catch (clearError) {
        console.log('Could not find or click clear button:', clearError.message);
    }
}

// Weighted action types for more realistic behavior
const ACTION_WEIGHTS = {
    SCROLL: 25,         // Basic scrolling
    WHEEL_SCROLL: 15,   // Precise wheel scrolling
    MOUSE_MOVE: 20,     // Random mouse movements
    TYPING: 25,         // Form filling and typing
    NAVIGATION: 5,      // Tab switching, back/forward
    REFRESH: 5,         // Page refresh
    IDLE: 5             // Short periods of inactivity
};

// Calculate total weight for probability distribution
const TOTAL_WEIGHT = Object.values(ACTION_WEIGHTS).reduce((a, b) => a + b, 0);

// Function to select a weighted random action
function getRandomAction() {
    let random = Math.random() * TOTAL_WEIGHT;
    let weightSum = 0;
    
    const actions = Object.entries(ACTION_WEIGHTS);
    for (const [action, weight] of actions) {
        weightSum += weight;
        if (random <= weightSum) return action;
    }
    
    return 'SCROLL'; // Default fallback
}

// Function to simulate tab switching
async function switchTab(page) {
    try {
        // Simulate alt+tab (switch to another application)
        await page.keyboard.down('Alt');
        await page.keyboard.press('Tab');
        await wait(randomDelay(100, 300));
        await page.keyboard.up('Alt');
        
        // Random delay while "using another application"
        await wait(randomDelay(1000, 5000));
        
        // Switch back
        await page.keyboard.down('Alt');
        await page.keyboard.press('Tab');
        await wait(randomDelay(100, 300));
        await page.keyboard.up('Alt');
        
    } catch (error) {
        console.log('Error during tab switch simulation:', error.message);
    }
}

// Function to simulate browsing history navigation
async function navigateHistory(page) {
    try {
        // Randomly decide to go back or forward (70% back, 30% forward)
        const goBack = Math.random() < 0.7;
        
        if (goBack) {
            await page.goBack({ waitUntil: 'networkidle0' });
        } else {
            await page.goForward({ waitUntil: 'networkidle0' });
        }
        
        await wait(randomDelay(1000, 3000));
    } catch (error) {
        // If navigation fails (no history), continue with other actions
        console.log('Navigation not possible, continuing...');
    }
}

// Helper function to ensure we're on the correct URL
async function ensureCorrectUrl(page, targetUrl) {
    try {
        const currentUrl = page.url();
        if (currentUrl !== targetUrl) {
            console.log(`Navigating back to target URL: ${targetUrl}`);
            await page.goto(targetUrl, { 
                waitUntil: 'networkidle0',
                timeout: 30000
            });
            await wait(randomDelay(2000, 4000));
        }
    } catch (error) {
        console.error('Error ensuring correct URL:', error.message);
    }
}

// Main function to simulate user actions
const simulateUserActions = async (req, res) => {
    const { sessionId } = req.params;
    const { durationMinutes = 5 } = req.body;
    
    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = sessions.get(sessionId);
    const { browser, page } = session;
    
    if (!browser || !page) {
        return res.status(400).json({ error: 'Browser or page not available' });
    }
    
    // Store the original URL
    let targetUrl = page.url();
    console.log('Original URL set to:', targetUrl);
    
    try {
        const endTime = Date.now() + (durationMinutes * 60 * 1000);
        let lastTypingTime = 0;
        
        // Start the simulation in the background
        (async () => {
            console.log(`Starting user simulation for session ${sessionId} for ${durationMinutes} minutes`);
            
            // Initial delay to make it seem more natural
            await wait(randomDelay(1000, 3000));
            
            while (Date.now() < endTime) {
                try {
                    // Ensure we're still on the correct URL before each action
                    await ensureCorrectUrl(page, targetUrl);
                    
                    const action = getRandomAction();
                    
                    switch(action) {
                        case 'SCROLL':
                            await randomScroll(page);
                            break;
                            
                        case 'WHEEL_SCROLL':
                            await randomWheelScroll(page);
                            break;
                            
                        case 'MOUSE_MOVE':
                            await randomMouseMovements(page);
                            // Sometimes click on random elements
                            if (Math.random() < 0.3) {
                                await wait(randomDelay(300, 800));
                                await randomClicks(page);
                            }
                            break;
                            
                        case 'TYPING':
                            // Don't type too often in a short period
                            const now = Date.now();
                            if (now - lastTypingTime > 10000) { // At least 10 seconds between typing sessions
                                try {
                                    // Double check URL before typing
                                    await ensureCorrectUrl(page, targetUrl);
                                    
                                    // Try to find and interact with input fields
                                    const success = await fillRandomForms(page);
                                    
                                    if (success) {
                                        console.log('Successfully typed in form field');
                                    } else {
                                        console.log('No suitable input field found for typing');
                                    }
                                    
                                    lastTypingTime = now;
                                    
                                    // Sometimes clear after typing (20% chance)
                                    if (Math.random() < 0.2) {
                                        await clearGoogleSearch(page);
                                    } else if (Math.random() < 0.5) {
                                        await randomKeyPresses(page);
                                    }
                                } catch (error) {
                                    console.error('Error during typing action:', error.message);
                                }
                            }
                            break;
                            
                        case 'NAVIGATION':
                            // Randomly choose between tab switching and history navigation
                            if (Math.random() < 0.7) {
                                await switchTab(page);
                            } else {
                                await navigateHistory(page);
                            }
                            break;
                            
                        case 'REFRESH':
                            if (Math.random() < 0.3) { // 30% chance to actually refresh
                                await page.reload({ 
                                    waitUntil: ['domcontentloaded', 'networkidle0'],
                                    timeout: 30000
                                });
                                await wait(randomDelay(2000, 5000));
                            }
                            break;
                            
                        case 'IDLE':
                            // Random idle time (simulating reading/thinking)
                            await wait(randomDelay(2000, 10000));
                            break;
                    }
                    
                    // Variable delay between actions (shorter for some actions)
                    const baseDelay = ['TYPING', 'IDLE'].includes(action) 
                        ? randomDelay(500, 1500) 
                        : randomDelay(800, 3000);
                        
                    await wait(baseDelay);
                    
                } catch (error) {
                    console.error('Error during simulation:', error.message);
                    // Continue with the next action after a short delay
                    await wait(randomDelay(1000, 3000));
                }
            }
            
            console.log(`User simulation completed for session ${sessionId}`);
        })();
        
        res.json({ 
            success: true, 
            message: `User simulation started for ${durationMinutes} minutes`,
            actions: 'Enhanced human-like behavior with natural mouse movements, typing, and browsing patterns'
        });
        
    } catch (error) {
        console.error('Error starting user simulation:', error);
        res.status(500).json({ 
            error: 'Failed to start user simulation',
            details: error.message
        });
    }
};

// Helper function to accept Google cookies
async function acceptGoogleCookies(page) {
    // Common "Accept all" translations in various languages
    const acceptButtonTexts = [
        // English
        'Accept all', 'Accept all cookies', 'Accept all settings', 'Acceptér alle',
        // French
        'Tout accepter', 'Tout accepter et continuer', 'Zaakceptuj wszystko',
        // German
        'Alle akzeptieren', 'Alle Cookies akzeptieren',
        // Spanish
        'Aceptar todo', 'Aceptar todas', 'Aceptar todo y continuar',
        // Italian
        'Accetta tutto', 'Accetta tutto e continua',
        // Portuguese
        'Aceitar tudo', 'Aceitar todos', 'Aceitar todos os cookies',
        // Danish/Norwegian
        'Accepter alle', 'Accepter alle cookies',
        // Swedish
        'Godkänn alla', 'Acceptera alla',
        // Finnish
        'Hyväksy kaikki', 'Hyväksy kaikki evästeet',
        // Dutch
        'Alle accepteren', 'Alles accepteren',
        // Polish
        'Akceptuję wszystkie', 'Akceptuję wszystko',
        // Czech
        'Přijmout vše', 'Přijmout všechny',
        // Hungarian
        'Elfogadom', 'Elfogad mindent', 'Elfogadás', 'Elfogad minden sütit', 
        'Összes elfogadása', 'Elfogadom az összeset', 'Minden süti elfogadása',
        'Elfogadom a sütiket', 'Összes elfogadása és továbblépés', 'Rendben',
        'Elfogad', 'Elfogadok mindent', 'Minden süti elfogadva',
        'Sütik elfogadása', 'Elfogadom a feltételeket', 'Elfogadás és tovább',
        'Az',
        // Slovak
        'Prijať všetko', 'Súhlasím so všetkým',
        // Croatian/Serbian/Bosnian
        'Prihvaćam sve', 'Prihvati sve',
        // Bulgarian
        'Приемам всички', 'Приемам всичко',
        // Russian
        'Принять все', 'Принимаю все',
        // Ukrainian
        'Прийняти всі', 'Погоджуюсь з усім',
        // And more languages as needed...
    ];

    try {
        // Find all buttons that have a direct div child
        const acceptButton = await page.$$eval('button > div', (divs, texts) => {
            // Convert texts to lowercase for case-insensitive comparison
            const lowerTexts = texts.map(t => t.toLowerCase());
            
            // Find the first div whose text content matches any of our target texts
            for (const div of divs) {
                const button = div.closest('button');
                if (button) {
                    const buttonText = div.textContent.trim();
                    if (lowerTexts.includes(buttonText.toLowerCase())) {
                        return {
                            text: buttonText,
                            button: button,
                            buttonId: button.id,
                        };
                    }
                }
            }
            return null;
        }, acceptButtonTexts);

        if (acceptButton) {
            await page.click('#' + acceptButton.buttonId);
            await wait(1000);
            console.log(`Clicked accept button with text: ${acceptButton.text}`);
            return true;

        }

        // If we get here, no matching button was found
        console.log('No matching accept button found');
        return false;
    } catch (error) {
        console.error('Error in acceptGoogleCookies:', error);
        return false;
    }
}

// Function to handle Google validation
const validateGoogle = async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
        const { page } = session;
        
        // Navigate to Google
        await page.goto('https://www.google.com', { 
            waitUntil: 'networkidle0',
            timeout: 90000 
        });

        // Wait for the page to be fully loaded
        await wait(3000);

        // Try to accept cookies
        const cookiesAccepted = await acceptGoogleCookies(page);

        // Set English as language if possible
        try {
            const langButton = await page.$('button[aria-label*="language"], button[aria-label*="Sprache"]');
            if (langButton) {
                await langButton.click();
                await wait(1000);
                
                // Try to find and click English option
                const englishOption = await page.$('div[role="menuitem"]:has-text("English"), div[role="menuitem"]:has-text("English (United States)")');
                if (englishOption) {
                    await englishOption.click();
                    await wait(2000);
                }
            }
        } catch (e) {
            console.log('Could not change language, continuing...');
        }
    } catch (error) {
        console.error('Error in validateGoogle:', error);
        return res.status(500).json({
            error: 'Failed to validate Google',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Scroll the page to the bottom
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function scrollToBottom(req, res) {
    const { sessionId } = req.params;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const page = await getFirstTab(session);
        
        // Scroll to bottom using document.documentElement for better compatibility
        await page.evaluate(() => {
            // Scroll to bottom of the page
            window.scrollTo({
                top: Math.max(
                    document.body.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight
                ),
                behavior: 'smooth'
            });
        });

        // Wait for scroll to complete
        await page.waitForFunction(
            'window.scrollY + window.innerHeight >= Math.max(' +
            'document.body.scrollHeight, ' +
            'document.body.offsetHeight, ' +
            'document.documentElement.clientHeight, ' +
            'document.documentElement.scrollHeight, ' +
            'document.documentElement.offsetHeight' +
            ') - 10', // Allow 10px tolerance
            { timeout: 5000 }
        );

        res.json({ 
            success: true, 
            message: 'Page scrolled to bottom',
            position: await page.evaluate(() => ({
                scrollY: window.scrollY,
                innerHeight: window.innerHeight,
                scrollHeight: document.body.scrollHeight
            }))
        });
    } catch (error) {
        console.error(`Error scrolling to bottom in session ${sessionId}:`, error);
        res.status(500).json({ 
            error: 'Failed to scroll to bottom',
            details: error.message 
        });
    }
}

module.exports = {
    createSession,
    listSessions,
    getSession,
    scrollToBottom,
    getPageHTML,
    navigateSession,
    closeSessionEndpoint,
    closeAllSessions,
    screenshotSession,
    executeScriptSession,
    clickSession,
    typeSession,
    getContentSession,
    simulateUserActions,
    validateGoogle,
    fillInput,
    checkXPath
};
