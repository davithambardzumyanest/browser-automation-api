const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Stagehand } = require('@browserbasehq/stagehand');
const { v4: uuidv4 } = require('uuid');
const { cleanupStaleProfileLocks } = require('../utils/browserProfile');
const AIService = require('../services/aiService');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Initialize AI service on startup
AIService.initialize();

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
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-extensions',
    '--disable-extensions-except',
    '--disable-extensions-file-access-check',
    '--disable-component-extensions-with-background-pages',
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
    '--disable-search-geolocation-disclosure',
    '--disable-blink-features',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-features=MediaSource',
    '--ignore-certificate-errors'
];

// Common Chrome user agents (version must match Client Hints below)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
];

// Function to get a random user agent
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

const detectPlatformFromUA = (ua = '') => {
    const input = String(ua);
    if (input.includes('Windows')) {
        return {
            secChUaPlatform: '"Windows"',
            secChUaPlatformVersion: '"15.0.0"',
            navigatorPlatform: 'Win32',
            osCpu: 'Windows NT 10.0; Win64; x64'
        };
    }
    if (input.includes('Macintosh') || input.includes('Mac OS X')) {
        return {
            secChUaPlatform: '"macOS"',
            secChUaPlatformVersion: '"14.0.0"',
            navigatorPlatform: 'MacIntel',
            osCpu: 'Intel Mac OS X 10_15_7'
        };
    }
    if (input.includes('Linux')) {
        return {
            secChUaPlatform: '"Linux"',
            secChUaPlatformVersion: '"6.0.0"',
            navigatorPlatform: 'Linux x86_64',
            osCpu: 'Linux x86_64'
        };
    }
    return {
        secChUaPlatform: '"Windows"',
        secChUaPlatformVersion: '"15.0.0"',
        navigatorPlatform: 'Win32',
        osCpu: 'Windows NT 10.0; Win64; x64'
    };
};

const isChromeUserAgent = (ua = '') => /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);

const parseChromeVersionFromUA = (ua = '') => {
    const fullMatch = String(ua).match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (fullMatch) {
        return {
            major: fullMatch[1],
            full: `${fullMatch[1]}.${fullMatch[2]}.${fullMatch[3]}.${fullMatch[4]}`
        };
    }
    const majorMatch = String(ua).match(/Chrome\/(\d+)/);
    if (majorMatch) {
        return { major: majorMatch[1], full: `${majorMatch[1]}.0.0.0` };
    }
    return { major: '145', full: '145.0.0.0' };
};

const buildChromeClientHints = (userAgent, platformProfile) => {
    const { major, full } = parseChromeVersionFromUA(userAgent);
    const platformName = platformProfile.secChUaPlatform.replace(/"/g, '');
    const platformVersion = platformProfile.secChUaPlatformVersion.replace(/"/g, '');

    const brands = [
        { brand: 'Not:A-Brand', version: '99' },
        { brand: 'Google Chrome', version: major },
        { brand: 'Chromium', version: major }
    ];

    const fullVersionList = [
        { brand: 'Not:A-Brand', version: '99.0.0.0' },
        { brand: 'Google Chrome', version: full },
        { brand: 'Chromium', version: full }
    ];

    return {
        major,
        full,
        brands,
        fullVersionList,
        secChUa: brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
        secChUaFullVersionList: fullVersionList.map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
        userAgentMetadata: {
            brands,
            fullVersion: full,
            platform: platformName,
            platformVersion,
            architecture: 'x86',
            model: '',
            mobile: false,
            bitness: '64'
        }
    };
};

const applyChromeIdentity = async (page, userAgent, platformProfile) => {
    if (!isChromeUserAgent(userAgent)) {
        await page.setUserAgent(userAgent);
        return null;
    }

    const chromeHints = buildChromeClientHints(userAgent, platformProfile);
    await page.setUserAgent(userAgent, chromeHints.userAgentMetadata);
    return chromeHints;
};

const buildConsistentHeaders = ({ locale, userAgent, customHeaders = {}, chromeHints = null }) => {
    const languageCode = String(locale || 'en-US').split('-')[0];
    const platform = detectPlatformFromUA(userAgent);
    const hints = chromeHints || (isChromeUserAgent(userAgent)
        ? buildChromeClientHints(userAgent, platform)
        : null);

    const defaultHeaders = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': `${locale},${languageCode};q=0.9,en;q=0.8`,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Pragma': 'no-cache',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': platform.secChUaPlatform,
        'Sec-CH-UA-Platform-Version': platform.secChUaPlatformVersion
    };

    if (hints) {
        defaultHeaders['Sec-CH-UA'] = hints.secChUa;
        defaultHeaders['Sec-CH-UA-Full-Version-List'] = hints.secChUaFullVersionList;
    }

    return { ...defaultHeaders, ...customHeaders };
};

const LOCALE_TIMEZONE_DEFAULTS = {
    'en-US': 'America/New_York',
    'en-CA': 'America/Toronto',
    'en-GB': 'Europe/London',
    'fr-CA': 'America/Toronto',
    'fr-FR': 'Europe/Paris',
    'de-DE': 'Europe/Berlin',
    'es-ES': 'Europe/Madrid',
    'it-IT': 'Europe/Rome',
    'pt-BR': 'America/Sao_Paulo',
    'ja-JP': 'Asia/Tokyo',
    'ko-KR': 'Asia/Seoul',
    'zh-CN': 'Asia/Shanghai'
};

const resolveSessionTimezone = (locale, timezone, geolocation) => {
    if (timezone) return timezone;
    if (geolocation?.timezone) return geolocation.timezone;
    return LOCALE_TIMEZONE_DEFAULTS[locale] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
};

const buildBrowserProfile = ({
    locale,
    timezone,
    userAgent,
    platformProfile,
    chromeHints,
    width,
    height,
    deviceScaleFactor = 1,
    geolocation
}) => {
    const languageCode = String(locale || 'en-US').split('-')[0];
    const resolvedTimezone = resolveSessionTimezone(locale, timezone, geolocation);
    const viewportWidth = width || 1920;
    const viewportHeight = height || 1080;
    const chromeUiHeight = 88;

    return {
        locale,
        languageCode,
        timezone: resolvedTimezone,
        userAgent,
        platformProfile,
        chromeProfile: chromeHints,
        viewport: {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor
        },
        screen: {
            width: viewportWidth,
            height: viewportHeight,
            availWidth: viewportWidth,
            availHeight: Math.max(viewportHeight - 40, viewportHeight),
            colorDepth: 24,
            pixelDepth: 24,
            devicePixelRatio: deviceScaleFactor
        },
        window: {
            outerWidth: viewportWidth,
            outerHeight: viewportHeight + chromeUiHeight,
            innerWidth: viewportWidth,
            innerHeight: viewportHeight
        },
        webgl: {
            vendor: 'Google Inc. (Intel)',
            renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
        },
        hardware: {
            hardwareConcurrency: 8,
            deviceMemory: 8,
            maxTouchPoints: 0
        },
        permissions: {
            geolocation: geolocation ? 'granted' : 'prompt',
            notifications: 'default',
            camera: 'prompt',
            microphone: 'prompt',
            'clipboard-read': 'prompt',
            'clipboard-write': 'granted'
        },
        hasGeolocation: Boolean(
            geolocation &&
            typeof geolocation.latitude === 'number' &&
            typeof geolocation.longitude === 'number'
        )
    };
};

const registerBrowserRealism = async (page, profile) => {
    await page.evaluateOnNewDocument((browserProfile) => {
        const {
            locale,
            languageCode,
            timezone,
            platformProfile,
            chromeProfile,
            screen: screenMetrics,
            window: windowMetrics,
            webgl,
            hardware,
            permissions
        } = browserProfile;

        const defineGetter = (obj, prop, getter) => {
            try {
                Object.defineProperty(obj, prop, { get: getter, configurable: true });
            } catch (_) {}
        };

        defineGetter(navigator, 'webdriver', () => false);
        defineGetter(navigator, 'language', () => locale);
        defineGetter(navigator, 'languages', () => [locale, languageCode, 'en-US', 'en']);
        defineGetter(navigator, 'platform', () => platformProfile.navigatorPlatform);
        defineGetter(navigator, 'vendor', () => 'Google Inc.');
        defineGetter(navigator, 'productSub', () => '20030107');
        defineGetter(navigator, 'cookieEnabled', () => true);
        defineGetter(navigator, 'pdfViewerEnabled', () => true);
        defineGetter(navigator, 'doNotTrack', () => null);
        defineGetter(navigator, 'hardwareConcurrency', () => hardware.hardwareConcurrency);
        defineGetter(navigator, 'deviceMemory', () => hardware.deviceMemory);
        defineGetter(navigator, 'maxTouchPoints', () => hardware.maxTouchPoints);

        if ('oscpu' in navigator) {
            defineGetter(navigator, 'oscpu', () => platformProfile.osCpu);
        }

        if ('userAgentData' in navigator && chromeProfile) {
            defineGetter(navigator, 'userAgentData', () => ({
                brands: chromeProfile.brands,
                mobile: false,
                platform: platformProfile.secChUaPlatform.replace(/"/g, ''),
                getHighEntropyValues: async () => ({
                    architecture: 'x86',
                    bitness: '64',
                    mobile: false,
                    model: '',
                    platform: platformProfile.secChUaPlatform.replace(/"/g, ''),
                    platformVersion: platformProfile.secChUaPlatformVersion.replace(/"/g, ''),
                    uaFullVersion: chromeProfile.full,
                    fullVersionList: chromeProfile.fullVersionList
                })
            }));
        }

        defineGetter(navigator, 'connection', () => ({
            downlink: 10,
            effectiveType: '4g',
            rtt: 50,
            saveData: false,
            type: 'wifi'
        }));

        defineGetter(screen, 'width', () => screenMetrics.width);
        defineGetter(screen, 'height', () => screenMetrics.height);
        defineGetter(screen, 'availWidth', () => screenMetrics.availWidth);
        defineGetter(screen, 'availHeight', () => screenMetrics.availHeight);
        defineGetter(screen, 'colorDepth', () => screenMetrics.colorDepth);
        defineGetter(screen, 'pixelDepth', () => screenMetrics.pixelDepth);
        defineGetter(window, 'devicePixelRatio', () => screenMetrics.devicePixelRatio);
        defineGetter(window, 'outerWidth', () => windowMetrics.outerWidth);
        defineGetter(window, 'outerHeight', () => windowMetrics.outerHeight);
        defineGetter(window, 'innerWidth', () => windowMetrics.innerWidth);
        defineGetter(window, 'innerHeight', () => windowMetrics.innerHeight);

        const patchWebGL = (Context) => {
            if (!Context || !Context.prototype) return;
            const originalGetParameter = Context.prototype.getParameter;
            Context.prototype.getParameter = function getParameter(parameter) {
                if (parameter === 37445) return webgl.vendor;
                if (parameter === 37446) return webgl.renderer;
                return originalGetParameter.call(this, parameter);
            };
        };
        patchWebGL(window.WebGLRenderingContext);
        patchWebGL(window.WebGL2RenderingContext);

        const originalPermissionsQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (originalPermissionsQuery) {
            navigator.permissions.query = (parameters) => {
                const name = parameters?.name;
                if (name && Object.prototype.hasOwnProperty.call(permissions, name)) {
                    return Promise.resolve({ state: permissions[name], onchange: null });
                }
                return originalPermissionsQuery(parameters);
            };
        }

        if (typeof Notification !== 'undefined' && Notification.requestPermission) {
            Notification.requestPermission = () => Promise.resolve(permissions.notifications);
        }

        window.chrome = window.chrome || {};
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.app = window.chrome.app || { isInstalled: false };

        const OriginalDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function DateTimeFormat(locales, options) {
            const opts = options ? { ...options } : {};
            if (!opts.timeZone) opts.timeZone = timezone;
            return new OriginalDateTimeFormat(locales, opts);
        };
        Intl.DateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
        Intl.DateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf;

        const originalResolvedOptions = OriginalDateTimeFormat.prototype.resolvedOptions;
        OriginalDateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
            const result = originalResolvedOptions.call(this);
            return { ...result, timeZone: timezone };
        };
    }, profile);
};

const setupPageRealism = async (page, browserProfile, requestHeaders) => {
    await applyChromeIdentity(page, browserProfile.userAgent, browserProfile.platformProfile);
    await page.setViewport({
        width: browserProfile.viewport.width,
        height: browserProfile.viewport.height,
        deviceScaleFactor: browserProfile.viewport.deviceScaleFactor,
        isMobile: false,
        hasTouch: false,
        isLandscape: browserProfile.viewport.width > browserProfile.viewport.height
    });

    try {
        await page.emulateTimezone(browserProfile.timezone);
    } catch (tzError) {
        console.warn(`Failed to set timezone "${browserProfile.timezone}":`, tzError.message);
    }

    await page.setExtraHTTPHeaders(requestHeaders);
    await registerBrowserRealism(page, browserProfile);
};

const MIME_TO_EXTENSION = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const parseImagePayload = (image) => {
    if (image === undefined || image === null || image === '') {
        return null;
    }

    const value = String(image).trim();
    const dataUrlMatch = value.match(/^data:([^;]+);base64,(.+)$/i);

    if (dataUrlMatch) {
        return {
            mimeType: dataUrlMatch[1],
            base64: dataUrlMatch[2]
        };
    }

    return {
        mimeType: null,
        base64: value
    };
};

const extensionFromMime = (mimeType) => MIME_TO_EXTENSION[mimeType?.toLowerCase()] || 'png';

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

/**
 * API endpoint to solve reCAPTCHA on current page
 */

/**
 * API endpoint to solve reCAPTCHA on current page
 */

/**
 * Configure 2Captcha extension using Chrome extension APIs
 * @param {Object} page - Puppeteer page object
 * @param {Object} options - Configuration options
 * @param {string} options.apiKey - 2Captcha API key
 * @param {Object} options.proxy - Proxy configuration
 * @param {string} options.proxy.username - Proxy username
 * @param {string} options.proxy.password - Proxy password
 * @param {string} options.proxy.server - Proxy server URL
 * @param {string} options.proxy.type - Proxy type (HTTP, HTTPS, SOCKS4, SOCKS5)
 * @param {boolean} options.useProxy - Whether to use proxy
 * @param {string} options.proxyType - Proxy type
 * @param {string} options.extId - String type
 */
const configure2CaptchaDirectly = async (page, options = {}) => {
    const proxy = options.proxy;

    return await page.evaluate((cfg, extId) => {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(
                extId,
                { type: 'SET_CONFIG', config: cfg },
                res => resolve(res)
            );
        });
    }, {
        apiKey: process.env.TWO_CAPTCHA_API_KEY,
        isPluginEnabled: true,
        recaptcha: {
            enabled: true,
            autoSolveV2: true,
            autoSolveInvisibleV2: true
        },

        repeatOnErrorTimes: 2,
        repeatOnErrorDelay: 1000,
        useProxy: true,
        proxy: proxy && proxy.username && proxy.password && proxy.server
            ? `${proxy.username}:${proxy.password}@${proxy.server.replace(/^https?:\/\//, '')}`
            : "",
    }, options.extId);
};


/**
 * Legacy function for backward compatibility - now uses direct configuration
 * @param {Object} page - Puppeteer page object
 * @param {Object} proxy - Proxy configuration
 */
const login2Captcha = async (page, proxy) => {
    console.log('Using legacy login2Captcha function - redirecting to direct configuration');
    
    const success = await configure2CaptchaDirectly(page, {
        apiKey: process.env.TWO_CAPTCHA_API_KEY,
        proxy: proxy,
        useProxy: proxy && proxy.username && proxy.password,
        proxyType: proxy?.type || 'HTTP'
    });

    if (success) {
        console.log('2Captcha configured successfully via direct method');
    } else {
        console.error('Failed to configure 2Captcha');
    }

    return success;
};

/**
 * Validate 2Captcha extension configuration
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Configuration status
 */
const validate2CaptchaConfig = async (page) => {
    try {
        const config = await page.evaluate(() => {
            return new Promise((resolve) => {
                chrome.storage.local.get('config', (result) => {
                    resolve(result.config || {});
                });
            });
        });

        return {
            configured: !!config.apiKey,
            apiKeySet: !!config.apiKey,
            proxyEnabled: config.useProxy,
            proxySet: !!config.proxy,
            extensionEnabled: config.isPluginEnabled,
            config: config
        };
    } catch (error) {
        console.error('Failed to validate 2Captcha config:', error);
        return {
            configured: false,
            error: error.message
        };
    }
};

const solveRecaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { submitAfter = false, waitTime = 5000 } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    const page = session.page;

    try {
        console.log("🚀 Starting captcha solving");

        const sessionProxy = session.config?.proxy_full || session.proxy || null;
        console.log("🔐 Session proxy:", session.proxy);
        console.log("🔐 Session config proxy:", session.config?.proxy_full);
        console.log("🔐 Using proxy:", sessionProxy);

        if (!page.__browserConsoleForwarderAttached) {
            page.on("console", msg => console.log("BROWSER:", msg.text()));
            page.__browserConsoleForwarderAttached = true;
        }

        const captchaInfo = await extractRecaptchaInfo(page);

        if (!captchaInfo.siteKey) {
            return res.status(400).json({
                success: false,
                message: "No reCAPTCHA detected",
                details: captchaInfo
            });
        }

        console.log("🎫 Sitekey:", captchaInfo.siteKey);
        console.log("🏢 Enterprise:", captchaInfo.isEnterprise);
        console.log("🔑 s Parameter:", captchaInfo.s);
        console.log("🎬 Action:", captchaInfo.action);

        const token = await solveRecaptchaWith2Captcha(
            page,
            captchaInfo.siteKey,
            page.url(),
            sessionProxy,
            captchaInfo.isEnterprise,
            captchaInfo.s,
            captchaInfo.action
        );

        console.log("🎯 Captcha solved");

        const injectionResult = await injectRecaptchaToken(page, token, captchaInfo);
        console.log("💉 Token injection result:", injectionResult);

        await new Promise(resolve => setTimeout(resolve, waitTime));

        let submitResult = null;
        if (submitAfter) {
            submitResult = await page.evaluate(() => {
                const buttons = document.querySelectorAll("button, input[type=submit]");
                for (const btn of buttons) {
                    if (!btn.disabled && btn.offsetParent !== null) {
                        btn.click();
                        return { success: true, text: btn.innerText || btn.value || null };
                    }
                }
                return { success: false };
            });
        }

        return res.json({
            success: true,
            sessionId,
            tokenPreview: token.substring(0, 30) + "...",
            submitted: submitAfter,
            submitResult,
            captcha: {
                siteKey: captchaInfo.siteKey,
                isEnterprise: captchaInfo.isEnterprise,
                s: captchaInfo.s || null,
                action: captchaInfo.action || null
            },
            injectionResult
        });
    } catch (error) {
        console.error("Captcha solving error:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
/**
 * API endpoint to configure 2Captcha extension
 */
const configure2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { apiKey, proxy, useProxy, proxyType = 'HTTP' } = req.body;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const success = await configure2CaptchaDirectly(session.page, {
            apiKey: apiKey || process.env.TWO_CAPTCHA_API_KEY,
            proxy: proxy,
            useProxy: useProxy,
            proxyType: proxyType
        });

        if (success) {
            const validation = await validate2CaptchaConfig(session.page);
            res.json({
                success: true,
                message: '2Captcha configured successfully',
                configuration: validation
            });
        } else {
            res.status(500).json({
                error: 'Failed to configure 2Captcha',
                message: 'Extension may not be loaded or configuration failed'
            });
        }
    } catch (error) {
        console.error('Error configuring 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to configure 2Captcha',
            message: error.message
        });
    }
};

/**
 * Enhanced diagnostic function to check for recaptcha errors
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Diagnostic results
 */
const diagnose2Captcha = async (page) => {
    console.log('🔍 Diagnosing 2Captcha extension...');
    
    const diagnostics = {
        extensionLoaded: false,
        configAccessible: false,
        apiKeySet: false,
        proxyEnabled: false,
        errors: [],
        recaptchaObjectFound: false,
        configObjectFound: false
    };

    try {
        // Check if extension is loaded by trying to access its options page
        try {
            await page.goto('chrome-extension://kdkekakoakfeklbmhphehpbbcpnlaocn/options/options.html', {
                waitUntil: 'domcontentloaded',
                timeout: 5000
            });
            diagnostics.extensionLoaded = true;
            console.log('✅ Extension options page accessible');
        } catch (err) {
            diagnostics.errors.push(`Extension not accessible: ${err.message}`);
            console.log('❌ Extension options page not accessible');
        }

        if (diagnostics.extensionLoaded) {
            // Check for recaptcha object and other global objects
            try {
                const globalCheck = await page.evaluate(() => {
                    const results = {
                        configObjectFound: typeof Config !== 'undefined',
                        recaptchaObjectFound: typeof recaptcha !== 'undefined',
                        grecaptchaObjectFound: typeof grecaptcha !== 'undefined',
                        chromeStorageAvailable: typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local,
                        chromeRuntimeAvailable: typeof chrome !== 'undefined' && chrome.runtime,
                        windowConfig: window.config || null,
                        documentRecaptcha: !!document.querySelector('[data-sitekey], .g-recaptcha, #recaptcha')
                    };
                    
                    // Try to get current config
                    if (typeof Config !== 'undefined') {
                        try {
                            results.currentConfig = Config.default || {};
                            results.apiKeySet = !!(results.currentConfig.apiKey);
                            results.useProxy = results.currentConfig.useProxy || false;
                        } catch (configErr) {
                            results.configError = configErr.message;
                        }
                    }
                    
                    return results;
                });

                diagnostics.configObjectFound = globalCheck.configObjectFound;
                diagnostics.recaptchaObjectFound = globalCheck.recaptchaObjectFound;
                diagnostics.grecaptchaObjectFound = globalCheck.grecaptchaObjectFound;
                diagnostics.chromeStorageAvailable = globalCheck.chromeStorageAvailable;
                diagnostics.chromeRuntimeAvailable = globalCheck.chromeRuntimeAvailable;
                diagnostics.documentRecaptcha = globalCheck.documentRecaptcha;
                
                if (globalCheck.configError) {
                    diagnostics.errors.push(`Config object error: ${globalCheck.configError}`);
                }
                
                if (globalCheck.currentConfig) {
                    diagnostics.apiKeySet = globalCheck.currentConfig.apiKeySet;
                    diagnostics.proxyEnabled = globalCheck.currentConfig.useProxy;
                }

                console.log('📋 Global objects check:', {
                    configObjectFound: globalCheck.configObjectFound,
                    recaptchaObjectFound: globalCheck.recaptchaObjectFound,
                    grecaptchaObjectFound: globalCheck.grecaptchaObjectFound,
                    chromeStorageAvailable: globalCheck.chromeStorageAvailable,
                    chromeRuntimeAvailable: globalCheck.chromeRuntimeAvailable
                });

                if (globalCheck.configObjectFound) {
                    console.log('✅ Configuration system accessible');
                    diagnostics.configAccessible = true;
                } else {
                    diagnostics.errors.push('Config object not found');
                    console.log('❌ Configuration system not accessible');
                }

                // Check for recaptcha-specific issues
                if (!globalCheck.recaptchaObjectFound && !globalCheck.grecaptchaObjectFound && globalCheck.documentRecaptcha) {
                    diagnostics.errors.push('No recaptcha objects found on page - extension may not be active');
                }

            } catch (err) {
                diagnostics.errors.push(`Global check failed: ${err.message}`);
                console.log('❌ Global check failed');
            }

            // Try to read current stored configuration
            try {
                const storedConfig = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            chrome.storage.local.get('config', (result) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ error: chrome.runtime.lastError.message });
                                } else {
                                    resolve(result.config || {});
                                }
                            });
                        } else {
                            resolve({ error: 'Chrome storage not available' });
                        }
                    });
                });

                if (!storedConfig.error) {
                    console.log('📦 Stored configuration found:', {
                        apiKey: storedConfig.apiKey ? '***SET***' : 'NOT_SET',
                        useProxy: storedConfig.useProxy,
                        proxySet: !!storedConfig.proxy,
                        enabledForRecaptchaV2: storedConfig.enabledForRecaptchaV2,
                        autoSolveRecaptchaV2: storedConfig.autoSolveRecaptchaV2
                    });
                } else {
                    diagnostics.errors.push(`Stored config error: ${storedConfig.error}`);
                }
            } catch (err) {
                diagnostics.errors.push(`Stored config check failed: ${err.message}`);
            }
        }

        // Check extension's background script status
        try {
            const bgStatus = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getBackgroundPage) {
                        chrome.runtime.getBackgroundPage((bgPage) => {
                            if (chrome.runtime.lastError) {
                                resolve({ error: chrome.runtime.lastError.message });
                            } else {
                                resolve({ 
                                    backgroundPageAccessible: !!bgPage,
                                    apiInitialized: bgPage && typeof bgPage.API !== 'undefined',
                                    hasTwoCaptchaAPI: bgPage && bgPage.API && typeof bgPage.API.solve !== 'undefined'
                                });
                            }
                        });
                    } else {
                        resolve({ error: 'Runtime API not available' });
                    }
                });
            });

            if (!bgStatus.error) {
                console.log('🔧 Background script status:', bgStatus);
                if (bgStatus.hasTwoCaptchaAPI) {
                    console.log('✅ 2Captcha API initialized in background script');
                }
            } else {
                diagnostics.errors.push(`Background script error: ${bgStatus.error}`);
            }
        } catch (err) {
            diagnostics.errors.push(`Background script check failed: ${err.message}`);
        }

    } catch (err) {
        diagnostics.errors.push(`General diagnosis error: ${err.message}`);
    }

    return diagnostics;
};

const extractRecaptchaInfo = async (page) => {
    return await page.evaluate(() => {
        const result = {
            siteKey: null,
            isEnterprise: false,
            s: null,
            action: null,
            widgetIds: [],
            iframeSources: []
        };

        const iframes = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]'));
        result.iframeSources = iframes.map((iframe) => iframe.src);

        for (const iframe of iframes) {
            try {
                const url = new URL(iframe.src);
                const siteKey = url.searchParams.get('k');
                const dataS = url.searchParams.get('s');

                if (siteKey && !result.siteKey) {
                    result.siteKey = siteKey;
                }

                if (dataS && !result.s) {
                    result.s = dataS;
                }

                if (iframe.src.includes('/enterprise/')) {
                    result.isEnterprise = true;
                }
            } catch (error) {
                console.log('Failed to parse reCAPTCHA iframe URL:', error.message);
            }
        }

        const siteKeyElement = document.querySelector('[data-sitekey], [data-site-key]');
        if (!result.siteKey && siteKeyElement) {
            result.siteKey =
                siteKeyElement.getAttribute('data-sitekey') ||
                siteKeyElement.getAttribute('data-site-key');
        }

        const visited = new Set();
        const callbacks = [];

        const scan = (value, currentWidgetId = null) => {
            if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
                return;
            }

            if (visited.has(value)) {
                return;
            }
            visited.add(value);

            if (typeof value.sitekey === 'string' && !result.siteKey) {
                result.siteKey = value.sitekey;
            }

            if (value.enterprise === true) {
                result.isEnterprise = true;
            }

            if (typeof value.s === 'string' && !result.s) {
                result.s = value.s;
            }

            if (typeof value.action === 'string' && !result.action) {
                result.action = value.action;
            }

            if (typeof value.callback === 'function' || typeof value.callback === 'string') {
                callbacks.push({ widgetId: currentWidgetId, callbackType: typeof value.callback });
            }

            for (const [key, nested] of Object.entries(value)) {
                const nextWidgetId = key.match(/^\d+$/) ? key : currentWidgetId;
                scan(nested, nextWidgetId);
            }
        };

        if (window.___grecaptcha_cfg?.clients) {
            for (const [widgetId, client] of Object.entries(window.___grecaptcha_cfg.clients)) {
                result.widgetIds.push(widgetId);
                scan(client, widgetId);
            }
        }

        result.widgetIds = [...new Set(result.widgetIds)];
        result.callbackCount = callbacks.length;

        return result;
    });
};

const injectRecaptchaToken = async (page, token, captchaInfo) => {
    return await page.evaluate(({ token, captchaInfo }) => {
        const methods = [];
        const callbackResults = [];
        const widgetIds = Array.isArray(captchaInfo.widgetIds) ? captchaInfo.widgetIds : [];

        const ensureTextarea = (id, name) => {
            let textarea = document.getElementById(id);

            if (!textarea) {
                textarea = document.createElement('textarea');
                textarea.id = id;
                textarea.name = name;
                textarea.style.display = 'none';
                (document.body || document.documentElement).appendChild(textarea);
                methods.push(`created:${id}`);
            }

            textarea.value = token;
            textarea.textContent = token;
            textarea.setAttribute('value', token);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return textarea;
        };

        ensureTextarea('g-recaptcha-response', 'g-recaptcha-response');
        methods.push('set:g-recaptcha-response');

        for (const widgetId of widgetIds) {
            ensureTextarea(`g-recaptcha-response-${widgetId}`, `g-recaptcha-response-${widgetId}`);
            methods.push(`set:g-recaptcha-response-${widgetId}`);
        }

        if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
            const originalGetResponse = window.grecaptcha.getResponse.bind(window.grecaptcha);
            window.grecaptcha.getResponse = function(widgetId) {
                if (widgetId === undefined || widgetIds.includes(String(widgetId))) {
                    return token;
                }
                return originalGetResponse(widgetId);
            };
            methods.push('hook:getResponse');
        }

        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
            const originalExecute = window.grecaptcha.execute.bind(window.grecaptcha);
            window.grecaptcha.execute = function(...args) {
                try {
                    return Promise.resolve(token);
                } catch (error) {
                    return originalExecute(...args);
                }
            };
            methods.push('hook:execute');
        }

        if (window.grecaptcha?.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
            const originalEnterpriseExecute = window.grecaptcha.enterprise.execute.bind(window.grecaptcha.enterprise);
            window.grecaptcha.enterprise.execute = function(...args) {
                try {
                    return Promise.resolve(token);
                } catch (error) {
                    return originalEnterpriseExecute(...args);
                }
            };
            methods.push('hook:enterprise.execute');
        }

        const visited = new Set();
        const invokeCallbacks = (value) => {
            if (!value || typeof value !== 'object') {
                return;
            }

            if (visited.has(value)) {
                return;
            }
            visited.add(value);

            if (typeof value.callback === 'function') {
                try {
                    value.callback(token);
                    callbackResults.push({ type: 'function', ok: true });
                } catch (error) {
                    callbackResults.push({ type: 'function', ok: false, message: error.message });
                }
            }

            if (typeof value.callback === 'string') {
                try {
                    const callbackFn = window[value.callback];
                    if (typeof callbackFn === 'function') {
                        callbackFn(token);
                        callbackResults.push({ type: 'string', ok: true, name: value.callback });
                    }
                } catch (error) {
                    callbackResults.push({ type: 'string', ok: false, message: error.message, name: value.callback });
                }
            }

            for (const nested of Object.values(value)) {
                invokeCallbacks(nested);
            }
        };

        if (window.___grecaptcha_cfg?.clients) {
            Object.values(window.___grecaptcha_cfg.clients).forEach((client) => invokeCallbacks(client));
            methods.push('invoke:grecaptcha-callbacks');
        }

        window.__captchaToken = token;
        window.__solvedRecaptchaToken = token;
        document.dispatchEvent(new CustomEvent('recaptcha-token-injected', { detail: { token } }));
        methods.push('store:window');
        methods.push('dispatch:recaptcha-token-injected');

        return {
            success: true,
            methods: [...new Set(methods)],
            callbackResults,
            widgetIds,
            responsePresent: Array.from(document.querySelectorAll('textarea[name^="g-recaptcha-response"]'))
                .some((el) => el.value === token)
        };
    }, { token, captchaInfo });
};

/**
 * Solve reCAPTCHA using 2Captcha API with proxy support
 * @param {Object} page - Puppeteer page object
 * @param {string} siteKey - The reCAPTCHA site key
 * @param {string} pageUrl - The URL of the page with reCAPTCHA
 * @param {Object} proxy - Proxy configuration (optional)
 * @returns {Promise<string>} The solved reCAPTCHA token
 */
const solveRecaptchaWith2Captcha = async (page, siteKey, pageUrl, proxy = null, isEnterprise = false, s = null, action = null) => {
    const API_KEY = process.env.TWO_CAPTCHA_API_KEY;
    
    if (!API_KEY) {
        throw new Error('TWO_CAPTCHA_API_KEY environment variable is not set');
    }

    try {
        console.log('🔍 Sending reCAPTCHA to 2Captcha service...');
        console.log(`📋 Site Key: ${siteKey}`);
        console.log(`📋 Page URL: ${pageUrl}`);
        console.log(`🔑 s Parameter: ${s}`);
        console.log(proxy)

        // Get browser fingerprint for Google with enhanced anti-detection
        const browserInfo = await page.evaluate(() => {
            // Enhanced fingerprinting for Google anti-detection
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Browser fingerprint', 2, 2);
            
            const webgl = document.createElement('canvas');
            const gl = webgl.getContext('webgl') || webgl.getContext('experimental-webgl');
            const debugInfo = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
            
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                languages: navigator.languages,
                screenResolution: `${screen.width}x${screen.height}`,
                colorDepth: screen.colorDepth,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                timezoneOffset: new Date().getTimezoneOffset(),
                webdriver: navigator.webdriver,
                chrome: !!window.chrome,
                chromeRuntime: !!window.chrome?.runtime,
                plugins: Array.from(navigator.plugins).map(p => ({
                    name: p.name,
                    description: p.description,
                    filename: p.filename
                })).slice(0, 5),
                canvas: !!canvas.getContext,
                canvasFingerprint: canvas.toDataURL().slice(-50), // Last 50 chars
                webgl: !!gl,
                webglVendor: gl ? gl.getParameter(gl.VENDOR) : null,
                webglRenderer: gl ? gl.getParameter(gl.RENDERER) : null,
                cookies: navigator.cookieEnabled,
                dnt: navigator.doNotTrack,
                onLine: navigator.onLine,
                connection: navigator.connection ? {
                    effectiveType: navigator.connection.effectiveType,
                    downlink: navigator.connection.downlink,
                    rtt: navigator.connection.rtt
                } : null,
                deviceMemory: navigator.deviceMemory || 0,
                hardwareConcurrency: navigator.hardwareConcurrency || 1,
                permissions: navigator.permissions ? Object.keys(navigator.permissions) : [],
                // Google-specific properties
                googleAccount: !!window.google?.accounts,
                gapi: !!window.gapi,
                recaptcha: !!window.grecaptcha,
                // Anti-automation detection
                automation: {
                    hasPhantom: !!window.callPhantom,
                    hasSelenium: !!window._selenium,
                    hasWebDriver: !!navigator.webdriver,
                    hasChromeDriver: !!window.chrome?.runtime?.onConnect
                }
            };
        });

        console.log('🖥️ Enhanced browser fingerprint:', browserInfo);

        // Prepare 2Captcha API parameters with exact values
        const apiParams = {
            key: API_KEY,
            method: 'userrecaptcha',
            googlekey: siteKey,
            pageurl: pageUrl,
            invisible: 0,
            version: 'v2',
            soft_id: 2834,
            header_acao: 1,
            json: 1,
            userAgent: browserInfo.userAgent
        };

        if (isEnterprise) {
            apiParams.enterprise = 1;
        }

        if (s) {
            apiParams['data-s'] = s;
        }

        if (action) {
            apiParams.action = action;
        }

        // Add proxy parameters if proxy is available
        if (proxy) {
            let proxyString = '';
            let proxyType = 'HTTP'; // Default proxy type
            
            if (typeof proxy === 'string') {
                // Simple proxy string: "http://host:port" or "host:port"
                proxyString = proxy.startsWith('http') ? proxy.replace(/^https?:\/\//, '') : proxy;
            } else if (typeof proxy === 'object') {
                // Proxy object with server, username, password, type
                if (proxy.server) {
                    proxyString = proxy.server.replace(/^https?:\/\//, '');
                    
                    // Add authentication if provided
                    if (proxy.username && proxy.password) {
                        proxyString = `${proxy.username}:${proxy.password}@${proxyString}`;
                    }
                }
                proxyType = proxy.type || proxyType;
            }
            
            if (proxyString) {
                apiParams.proxy = proxyString;
                apiParams.proxytype = proxyType.toUpperCase();
                console.log(`🔐 Added proxy: ${proxyString} (${proxyType})`);
            }
        }

        console.log('📤 API Parameters:', {
            ...apiParams,
            key: '***hidden***'
        });

        // Send captcha to 2Captcha
        const axios = require('axios');
        const response = await axios.get('http://2captcha.com/in.php', {
            params: apiParams,
            timeout: 30000
        });

        if (!response.data || response.data.status !== 1 || !response.data.request) {
            throw new Error(`2Captcha submit failed: ${response.data?.request || 'Unknown error'}`);
        }

        const captchaId = response.data.request;
        console.log(`🎫 Captcha ID: ${captchaId}`);

        if (!captchaId) {
            throw new Error('Failed to get captcha ID from 2Captcha');
        }

        // Wait until solved
        console.log('⏳ Waiting for captcha to be solved...');
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes max wait

        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

            const result = await axios.get('http://2captcha.com/res.php', {
                params: {
                    key: API_KEY,
                    action: 'get',
                    id: captchaId,
                    json: 1
                },
                timeout: 10000
            });

            if (result.data.status === 1 && result.data.request) {
                console.log('✅ reCAPTCHA solved successfully!');
                const token = result.data.request;
                
                // Simulate local solving to make it look like it was solved in the browser
                console.log('🎭 Simulating local solving events...');
                
                // Add local solving timestamp and browser context
                const localSolvingData = {
                    token: token,
                    solvedAt: Date.now(),
                    userAgent: browserInfo.userAgent,
                    platform: browserInfo.platform,
                    language: browserInfo.language,
                    screen: browserInfo.screenResolution,
                    timezone: browserInfo.timezone,
                    // Add random mouse movements and interactions
                    interactions: {
                        mouseMovements: Math.floor(Math.random() * 10) + 5, // 5-15 movements
                        clicks: Math.floor(Math.random() * 3) + 1, // 1-3 clicks
                        typingSpeed: Math.floor(Math.random() * 100) + 50, // 50-150ms per char
                        solveTime: Math.floor(Math.random() * 30000) + 15000 // 15-45 seconds
                    }
                };
                
                console.log('🎭 Local solving data:', localSolvingData);
                
                return token;
            } else if (result.data.request === 'CAPCHA_NOT_READY') {
                console.log(`⏳ Still solving... (${attempts}/${maxAttempts})`);
                continue;
            } else {
                throw new Error(`2Captcha error: ${result.data.request}`);
            }
        }

        throw new Error('reCAPTCHA solving timeout after 10 minutes');

    } catch (error) {
        console.error('❌ Error solving reCAPTCHA:', error.message);
        throw error;
    }
};

/**
 * Find reCAPTCHA on page and solve it
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<Object>} Result of solving attempt
 */
const findAndSolveRecaptcha = async (page) => {
    try {
        console.log('🔍 Searching for reCAPTCHA on page...');

        // Get current page URL
        const pageUrl = page.url();
        console.log(`📋 Current page: ${pageUrl}`);

        // Enhanced debugging - check what's actually on the page
        const debugInfo = await page.evaluate(() => {
            const allElements = document.querySelectorAll('*');
            const recaptchaElements = [];
            
            allElements.forEach(el => {
                if (el.className && el.className.includes && el.className.includes('recaptcha')) {
                    recaptchaElements.push({
                        tag: el.tagName,
                        className: el.className,
                        id: el.id,
                        dataset: Object.assign({}, el.dataset),
                        textContent: el.textContent ? el.textContent.substring(0, 100) : null
                    });
                }
            });
            
            const siteKeyElements = document.querySelectorAll('[data-sitekey], [data-site-key]');
            const iframes = document.querySelectorAll('iframe');
            const textareas = document.querySelectorAll('textarea');
            const scripts = document.querySelectorAll('script');
            
            // Check for error messages using XPath for better reliability
            const errorXPaths = [
                '//*[contains(text(), "Too many failed attempts")]',
                '//*[contains(text(), "couldn\'t verify")]', 
                '//*[contains(text(), "try again")]',
                '//*[contains(text(), "blocked")]',
                '//*[contains(text(), "suspicious activity")]',
                '//*[contains(text(), "verify your account")]',
                '//*[contains(text(), "Confirm you\'re not a robot")]', // New specific error
                '//*[contains(text(), "Please verify that you are not a robot")]', // New specific error
                '//*[contains(@class, "CuWxc")]', // Fallback to class if needed
                '//*[@jsname="Bz112c"]', // Fallback to jsname if needed
                '//*[@jsname="Ud7fr"]' // Fallback to jsname if needed
            ];
            
            const errorElements = [];
            let isBlocked = false;
            
            for (const xpath of errorXPaths) {
                try {
                    const result = document.evaluate(
                        xpath, 
                        document, 
                        null, 
                        XPathResult.FIRST_ORDERED_NODE_TYPE, 
                        null
                    );
                    const errorElement = result.singleNodeValue;
                    
                    if (errorElement && errorElement.offsetParent !== null) {
                        const errorText = (errorElement.textContent || '').trim();
                        errorElements.push({
                            text: errorText,
                            className: errorElement.className,
                            jsname: errorElement.getAttribute('jsname'),
                            id: errorElement.id,
                            xpath: xpath
                        });
                        
                        // Check for specific blocking conditions
                        if (errorText.includes('Too many failed attempts') || 
                            errorText.includes('blocked') ||
                            errorText.includes('suspicious activity')) {
                            isBlocked = true;
                        }
                    }
                } catch (error) {
                    console.log('XPath error:', error.message);
                    continue;
                }
            }
            
            return {
                recaptchaElements,
                siteKeyElements: Array.from(siteKeyElements).map(el => ({
                    tag: el.tagName,
                    className: el.className,
                    id: el.id,
                    sitekey: el.dataset.sitekey || el.getAttribute('data-site-key'),
                    enterpriseSiteKey: el.getAttribute('data-enterprise-site-key')
                })),
                iframes: Array.from(iframes).map(iframe => ({
                    src: iframe.src,
                    id: iframe.id,
                    className: iframe.className
                })),
                textareas: Array.from(textareas).map(ta => ({
                    name: ta.name,
                    id: ta.id,
                    className: ta.className
                })),
                scripts: Array.from(scripts).filter(script => 
                    script.src && script.src.includes('recaptcha')
                ).map(script => script.src),
                errorElements: errorElements,
                hasError: errorElements.length > 0,
                isBlocked: isBlocked
            };
        });

        console.log('🔍 Page analysis:', JSON.stringify(debugInfo, null, 2));

        // Try to find site key using multiple enhanced selectors
        let siteKey = null;
        let foundMethod = null;

        const selectors = [
            { selector: '.g-recaptcha[data-sitekey]', method: 'g-recaptcha with data-sitekey' },
            { selector: '.g-recaptcha[data-site-key]', method: 'g-recaptcha with data-site-key (with dash)' },
            { selector: '[data-sitekey]', method: 'any element with data-sitekey' },
            { selector: '[data-site-key]', method: 'any element with data-site-key (with dash)' },
            { selector: 'iframe[src*="recaptcha"]', method: 'recaptcha iframe' },
            { selector: '.g-recaptcha', method: 'g-recaptcha class' },
            { selector: '#recaptcha', method: 'recaptcha id' },
            { selector: '[class*="recaptcha"]', method: 'any element with recaptcha in class' },
            { selector: '[jscontroller*="recaptcha"]', method: 'element with recaptcha jscontroller' },
            { selector: '[data-site-key]', method: 'enterprise site-key attribute' }
        ];

        for (const { selector, method } of selectors) {
            try {
                siteKey = await page.evaluate((sel) => {
                    const elements = document.querySelectorAll(sel);
                    
                    for (const element of elements) {
                        // Try to get sitekey from data-sitekey attribute
                        if (element.dataset && element.dataset.sitekey) {
                            return element.dataset.sitekey;
                        }
                        
                        // Try to get sitekey from data-site-key attribute (with dash)
                        if (element.dataset && element.dataset.siteKey) {
                            return element.dataset.siteKey;
                        }
                        
                        // Try to get sitekey from data-site-key attribute (raw)
                        if (element.hasAttribute && element.hasAttribute('data-site-key')) {
                            return element.getAttribute('data-site-key');
                        }
                        
                        // Try to get sitekey from src attribute (for iframes)
                        if (element.src) {
                            const match = element.src.match(/sitekey=([^&]+)/);
                            if (match) return match[1];
                        }
                        
                        // Try to get sitekey from any attribute
                        for (const attr of element.attributes) {
                            if (attr.name.includes('sitekey') || attr.value.includes('sitekey')) {
                                const match = attr.value.match(/sitekey[=:]?([a-zA-Z0-9_-]+)/);
                                if (match) return match[1];
                            }
                        }
                    }
                    
                    return null;
                }, selector);
                
                if (siteKey) {
                    foundMethod = method;
                    console.log(`✅ Found site key using method: ${method}`);
                    console.log(`🎫 Site Key: ${siteKey}`);
                    break;
                }
            } catch (error) {
                console.log(`❌ Failed with selector ${selector}: ${error.message}`);
            }
        }

        // Additional fallback: look for reCAPTCHA in page content
        if (!siteKey) {
            try {
                const pageContent = await page.content();
                const siteKeyMatch = pageContent.match(/sitekey[\'\"\s]*[:=]?[\'\"\s]*([a-zA-Z0-9_-]{20,})/i);
                if (siteKeyMatch) {
                    siteKey = siteKeyMatch[1];
                    foundMethod = 'page content regex';
                    console.log(`✅ Found site key in page content: ${siteKey}`);
                }
            } catch (error) {
                console.log('❌ Failed to analyze page content:', error.message);
            }
        }

        if (!siteKey) {
            return {
                success: false,
                error: 'No reCAPTCHA found on page',
                foundCaptchas: debugInfo,
                debugInfo: debugInfo
            };
        }

        // Check if reCAPTCHA is blocked or in error state
        if (debugInfo.isBlocked) {
            console.log('🚫 reCAPTCHA is BLOCKED - Too many failed attempts detected');
            return {
                success: false,
                error: 'reCAPTCHA is blocked due to too many failed attempts',
                errorType: 'BLOCKED',
                errorMessages: debugInfo.errorElements.map(el => el.text),
                debugInfo: debugInfo,
                siteKey: siteKey,
                requiresNewIP: true,
                requiresWaitTime: '30 minutes to several hours',
                suggestions: [
                    'Wait 30+ minutes for block to clear',
                    'Use different IP/proxy',
                    'Create new session with different fingerprint',
                    'Try a different Google account',
                    'Clear browser cookies and cache',
                    'Use a different device or browser'
                ]
            };
        }

        if (debugInfo.hasError) {
            console.log('⚠️ reCAPTCHA shows error state, but attempting to solve anyway...');
            // Don't return error immediately - try to solve first
            // Some error states are temporary and the captcha might still solve
        }

        console.log(`🎫 Found reCAPTCHA with site key: ${siteKey} (method: ${foundMethod})`);

        // Solve the reCAPTCHA
        let token;
        try {
            token = await solveRecaptchaWith2Captcha(page, siteKey, pageUrl);
            console.log(`🎯 Solved token: ${token.substring(0, 20)}...`);
        } catch (solveError) {
            console.error('❌ Failed to solve reCAPTCHA:', solveError.message);
            
            // If solving failed and there was an error state, return detailed error
            if (debugInfo.hasError) {
                return {
                    success: false,
                    error: 'reCAPTCHA solving failed - likely due to blocked state',
                    solveError: solveError.message,
                    errorMessages: debugInfo.errorMessages,
                    debugInfo: debugInfo,
                    siteKey: siteKey,
                    requiresNewIP: true,
                    requiresWaitTime: 'Unknown - may be temporary',
                    suggestions: [
                        'Wait 30+ minutes for block to clear',
                        'Use different IP/proxy',
                        'Create new session with different fingerprint',
                        'Try a different Google account'
                    ]
                };
            }
            
            // Return the original solve error if not related to block
            return {
                success: false,
                error: 'Failed to solve reCAPTCHA',
                message: solveError.message,
                siteKey: siteKey
            };
        }

        // Inject the token using Google Enterprise reCAPTCHA flow (not DOM simulation)
        const injectionResult = await page.evaluate((token, siteKey) => {
            console.log('🔧 Starting Google Enterprise reCAPTCHA injection...');
            console.log('🎫 Target sitekey:', siteKey);
            
            let successMethods = [];
            let simulationSteps = [];
            
            // Method 1: Hook grecaptcha.enterprise.execute() to return our token
            if (window.grecaptcha && window.grecaptcha.enterprise) {
                simulationSteps.push('Found grecaptcha.enterprise - hooking execute method');
                
                try {
                    // Store original execute method
                    const originalExecute = window.grecaptcha.enterprise.execute;
                    
                    // Override execute to return our token
                    window.grecaptcha.enterprise.execute = function(options) {
                        console.log('🎯 grecaptcha.enterprise.execute() called - returning solved token');
                        
                        // Call original to maintain compatibility (but return our token)
                        if (originalExecute) {
                            try {
                                const originalResult = originalExecute.call(this, options);
                                // If original returns a Promise, resolve it with our token
                                if (originalResult && typeof originalResult.then === 'function') {
                                    return Promise.resolve(token);
                                }
                            } catch (e) {
                                console.log('Original execute failed:', e);
                            }
                        }
                        
                        // Return our solved token directly
                        return Promise.resolve(token);
                    };
                    
                    successMethods.push('grecaptcha-enterprise-hook');
                    simulationSteps.push('Successfully hooked grecaptcha.enterprise.execute()');
                    
                } catch (hookError) {
                    simulationSteps.push('Failed to hook grecaptcha.enterprise.execute(): ' + hookError.message);
                }
            }
            
            // Method 2: Hook regular grecaptcha.execute() as fallback
            if (window.grecaptcha && window.grecaptcha.execute) {
                simulationSteps.push('Found regular grecaptcha - hooking execute method');
                
                try {
                    const originalExecute = window.grecaptcha.execute;
                    
                    window.grecaptcha.execute = function(sitekey, options) {
                        console.log('🎯 grecaptcha.execute() called - returning solved token');
                        
                        // If this matches our target sitekey, return our token
                        if (sitekey === siteKey || !sitekey) {
                            return Promise.resolve(token);
                        }
                        
                        // Otherwise call original
                        if (originalExecute) {
                            return originalExecute.call(this, sitekey, options);
                        }
                    };
                    
                    successMethods.push('grecaptcha-hook');
                    simulationSteps.push('Successfully hooked grecaptcha.execute()');
                    
                } catch (hookError) {
                    simulationSteps.push('Failed to hook grecaptcha.execute(): ' + hookError.message);
                }
            }
            
            // Method 3: Store token globally for any other hooks
            window.__solvedRecaptchaToken = token;
            window.__captchaToken = token;
            successMethods.push('global-token-storage');
            simulationSteps.push('Stored token globally for fallback access');
            
            // Method 4: Try to trigger any pending reCAPTCHA executions
            setTimeout(() => {
                simulationSteps.push('Attempting to trigger pending reCAPTCHA executions');
                
                // Look for any reCAPTCHA widgets that might be waiting
                if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
                    for (let widgetId in window.___grecaptcha_cfg.clients) {
                        const widget = window.___grecaptcha_cfg.clients[widgetId];
                        
                        // Try to find and trigger callbacks
                        for (let k1 in widget) {
                            if (typeof widget[k1] !== "object") continue;
                            
                            for (let k2 in widget[k1]) {
                                if (widget[k1][k2] && widget[k1][k2].sitekey === siteKey) {
                                    const widgetConfig = widget[k1][k2];
                                    
                                    // Execute any callbacks with our token
                                    for (let prop in widgetConfig) {
                                        if (prop === 'callback' && widgetConfig[prop]) {
                                            const callback = widgetConfig[prop];
                                            
                                            setTimeout(() => {
                                                try {
                                                    if (typeof callback === "function") {
                                                        callback(token);
                                                        successMethods.push('widget-callback-executed');
                                                        simulationSteps.push('Executed widget callback with token');
                                                    } else if (typeof callback === "string" && window[callback]) {
                                                        window[callback](token);
                                                        successMethods.push('widget-string-callback-executed');
                                                        simulationSteps.push('Executed string callback with token');
                                                    }
                                                } catch (callbackError) {
                                                    simulationSteps.push('Widget callback error: ' + callbackError.message);
                                                }
                                            }, 100);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Try to manually trigger execute if available
                if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute) {
                    try {
                        const result = window.grecaptcha.enterprise.execute();
                        if (result && typeof result.then === 'function') {
                            result.then(() => {
                                simulationSteps.push('grecaptcha.enterprise.execute() completed');
                                successMethods.push('manual-execute-success');
                            });
                        }
                    } catch (executeError) {
                        simulationSteps.push('Manual execute error: ' + executeError.message);
                    }
                }
                
            }, 1000);
            
            console.log('📊 Injection steps:', simulationSteps);
            console.log('🎯 Success methods:', successMethods);
            
            return { 
                success: successMethods.length >= 1, // Need at least one successful method
                methods: successMethods,
                steps: simulationSteps,
                element: 'grecaptcha.enterprise.execute() hook',
                token: token.substring(0, 20) + '...' // Partial token for logging
            };
            
        }, token, siteKey);

        if (!injectionResult.success) {
            return {
                success: false,
                error: 'Failed to inject token or trigger callbacks',
                siteKey: siteKey,
                token: token
            };
        }

        console.log(`💉 Token injection successful: ${injectionResult.methods.join(', ')}`);
        console.log(`🔔 Simulation steps: ${injectionResult.steps.join(', ')}`);

        // Wait and verify reCAPTCHA is actually solved before proceeding
        console.log('⏳ Waiting for reCAPTCHA verification...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Verify the reCAPTCHA is solved by checking if the challenge is gone
        const verificationResult = await page.evaluate(() => {
            // Check if reCAPTCHA iframe is still visible
            const recaptchaFrames = document.querySelectorAll('iframe[src*="recaptcha"]');
            let isVisible = false;
            
            recaptchaFrames.forEach(frame => {
                if (frame.offsetParent !== null && frame.style.display !== 'none') {
                    isVisible = true;
                }
            });

            // Check for "I'm not a robot" text
            const robotText = document.body.innerText.includes('I\'m not a robot') || 
                             document.body.innerText.includes('Please verify');
            
            // Check for reCAPTCHA challenge containers
            const challengeContainers = document.querySelectorAll('[class*="recaptcha"], [id*="recaptcha"]');
            let challengeVisible = false;
            
            challengeContainers.forEach(container => {
                if (container.offsetParent !== null && 
                    (container.style.display !== 'none' || !container.style.display)) {
                    challengeVisible = true;
                }
            });

            return {
                recaptchaFrameVisible: isVisible,
                robotTextVisible: robotText,
                challengeVisible: challengeVisible,
                isSolved: !isVisible && !robotText && !challengeVisible
            };
        });

        console.log('🔍 Verification result:', verificationResult);

        if (!verificationResult.isSolved) {
            console.log('⚠️ reCAPTCHA may not be properly solved, but continuing with submission...');
        } else {
            console.log('✅ reCAPTCHA appears to be solved successfully');
        }

        return {
            success: true,
            siteKey: siteKey,
            token: token,
            injectionMethods: injectionResult.methods,
            injectionElement: injectionResult.element,
            simulationSteps: injectionResult.steps,
            verificationResult: verificationResult,
            pageUrl: pageUrl,
            foundMethod: foundMethod,
            debugInfo: debugInfo
        };

    } catch (error) {
        console.error('❌ Error finding and solving reCAPTCHA:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * API endpoint to solve reCAPTCHA on current page
 */
const diagnose2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const diagnostics = await diagnose2Captcha(session.page);
        res.json({
            success: true,
            sessionId,
            diagnostics,
            summary: {
                healthy: diagnostics.extensionLoaded && diagnostics.configAccessible && diagnostics.apiKeySet,
                issues: diagnostics.errors,
                recommendations: generateRecommendations(diagnostics)
            }
        });
    } catch (error) {
        console.error('Error diagnosing 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to diagnose 2Captcha',
            message: error.message
        });
    }
};

/**
 * Generate recommendations based on diagnostics
 */
const generateRecommendations = (diagnostics) => {
    const recommendations = [];
    
    if (!diagnostics.extensionLoaded) {
        recommendations.push('Extension may not be properly loaded - check browser arguments');
    }
    
    if (!diagnostics.configAccessible) {
        recommendations.push('Configuration system not accessible - try restarting browser');
    }
    
    if (!diagnostics.apiKeySet) {
        recommendations.push('API key not set - use configure-2captcha endpoint');
    }
    
    if (diagnostics.errors.length > 0) {
        recommendations.push('Check browser console for detailed error messages');
    }
    
    return recommendations;
};
const validate2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const validation = await validate2CaptchaConfig(session.page);
        res.json({
            success: true,
            sessionId,
            validation
        });
    } catch (error) {
        console.error('Error validating 2Captcha config:', error);
        res.status(500).json({
            error: 'Failed to validate 2Captcha configuration',
            message: error.message
        });
    }
};
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
        deviceScaleFactor = 1,
        persistSession = false,
    } = req.body || {};
    const finalUserAgent = userAgent || getRandomUserAgent();
    const platformProfile = detectPlatformFromUA(finalUserAgent);
    const chromeHints = isChromeUserAgent(finalUserAgent)
        ? buildChromeClientHints(finalUserAgent, platformProfile)
        : null;
    const resolvedTimezone = resolveSessionTimezone(locale, timezone, geolocation);
    const browserProfile = buildBrowserProfile({
        locale,
        timezone: resolvedTimezone,
        userAgent: finalUserAgent,
        platformProfile,
        chromeHints,
        width,
        height,
        deviceScaleFactor,
        geolocation
    });
    console.log(width)
    console.log(height)
    const headers = buildConsistentHeaders({
        locale,
        userAgent: finalUserAgent,
        customHeaders: headersParam,
        chromeHints
    });
    
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
        } else if (userDataDir || persistSession) {
            // Persist cookies/localStorage between sessions for realistic storage state
            launchOptions.userDataDir = `./sessions/${sessionId}`;
        }

        if (launchOptions.userDataDir) {
            cleanupStaleProfileLocks(launchOptions.userDataDir);
        }
        
        // Set locale settings
        const languageCode = locale.split('-')[0];

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
            deviceScaleFactor: deviceScaleFactor || 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: viewportWidth > viewportHeight
        };
        
        // Update launch options with viewport settings
        launchOptions.defaultViewport = viewportSettings;
        const path = require('path');

        console.log('Browser launch options prepared');

        // Remove conflicting extension arguments and add proper ones
        launchOptions.args = launchOptions.args.filter(arg => 
            !arg.includes('--disable-extensions') &&
            !arg.includes('--disable-extensions-except') &&
            !arg.includes('--disable-extensions-file-access-check') &&
            !arg.includes('--disable-component-extensions-with-background-pages')
        );
        
        // Add additional browser arguments for better stealth and extension support
        launchOptions.args.push(
            '--disable-blink-features=AutomationControlled',
            '--disable-software-rasterizer',
            '--disable-features=IsolateOrigins,site-per-process',
            `--window-size=${viewportWidth},${viewportHeight}`,
        );

        // Prefer installed Google Chrome for closer TLS/HTTP fingerprint (fallback to bundled Chromium)
        if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.channel = process.env.PUPPETEER_CHANNEL || 'chrome';
        }

        // Launch browser and create page
        let browser;
        try {
            browser = await puppeteer.launch(launchOptions);
        } catch (launchError) {
            if (launchOptions.channel) {
                console.warn(`Failed to launch with channel "${launchOptions.channel}", falling back to bundled Chromium:`, launchError.message);
                delete launchOptions.channel;
                browser = await puppeteer.launch(launchOptions);
            } else {
                throw launchError;
            }
        }
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

        const browserHeaders = {
            ...headers,
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Upgrade-Insecure-Requests': '1'
        };

        await setupPageRealism(page, browserProfile, browserHeaders);

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
                if (newPage) {
                    attachConsoleRelay(newPage);
                    await setupPageRealism(newPage, browserProfile, browserHeaders);
                }
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
        const stagehand = new Stagehand({
            env: 'LOCAL',
            localBrowserLaunchOptions: {
                cdpUrl: browser.wsEndpoint(),
                viewport: {
                    width: viewportSettings.width || 1920,
                    height: viewportSettings.height || 1080
                }
            },
            model: 'openai/gpt-5.4',
            disablePino: true,
            sessionId,
            verbose: 2,
            // Required for the agent `messages` continuation feature used in
            // runStagehandSession to keep the CUA conversation alive across
            // separate /stagehand calls instead of restarting fresh each time.
            experimental: true,
            disableAPI: true
        });
        await stagehand.init()
        // Store browser and page references in session
        const sessionData = {
            browser,
            stagehand,
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
            await page.setBypassCSP(true);
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

        const finalHeaders = { ...headers };
        const persistStorage = Boolean(profileId || userDataDir || persistSession);
        // Store session
        sessions.set(sessionId, {
            browser,
            stagehand,
            agent: stagehand.agent(),
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
                proxy_full: proxy,
                geolocation: geolocation && typeof geolocation.latitude === 'number' && typeof geolocation.longitude === 'number'
                    ? { accuracy: 50, ...geolocation }
                    : null,
                geolocationOrigin: geolocationOrigin || null, // deprecated in favor of geolocationOrigins
                geolocationOrigins: geoOrigins,
                grantGeolocationOnNavigation: Boolean(grantGeolocationOnNavigation),
                timezone: resolvedTimezone,
                deviceScaleFactor,
                persistStorage,
                realismProfile: {
                    locale,
                    timezone: resolvedTimezone,
                    platform: platformProfile.navigatorPlatform,
                    secChUa: chromeHints?.secChUa || null,
                    webgl: browserProfile.webgl,
                    screen: browserProfile.screen,
                    permissions: browserProfile.permissions
                },
                networkProfile: {
                    proxyConfigured: Boolean(proxy),
                    note: proxy
                        ? 'Traffic routed through configured proxy'
                        : 'Use a residential/mobile proxy for realistic IP reputation during security testing'
                }
            }
        });
        const extPage = (await browser.pages())[0];

        // Wait a moment for the extension to load
        await wait(2000);

        // Configure 2Captcha directly without UI interaction
        // await configure2CaptchaDirectly(extPage, {
        //     apiKey: process.env.TWO_CAPTCHA_API_KEY,
        //     proxy: proxy,
        //     useProxy: proxy && proxy.username && proxy.password,
        //     proxyType: proxy?.type || 'HTTP',
        //     extId: extPage.url().split('/')[2]
        // });

        res.json({
            success: true,
            sessionId,
            message: 'Session created successfully',
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                locale,
                timezone: resolvedTimezone,
                persistStorage,
                secChUa: chromeHints?.secChUa || null
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
        const parsedUrl = new URL(url);
        
        // Block Chrome extension URLs and other invalid protocols
        if (parsedUrl.protocol === 'chrome-extension:') {
            return res.status(400).json({ 
                error: 'Invalid URL protocol',
                message: 'Chrome extension URLs are not supported for navigation' 
            });
        }
        
        // Only allow http, https, and file protocols
        if (!['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ 
                error: 'Invalid URL protocol',
                message: 'Only HTTP, HTTPS, and file URLs are supported' 
            });
        }
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format', message: err.message });
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
        try {
            await targetPage.goto(url, options);
        } catch (navError) {
            // Handle common navigation errors
            if (navError.message.includes('ERR_BLOCKED_BY_CLIENT') || 
                navError.message.includes('chrome-extension://')) {
                console.warn('Navigation blocked by browser extension, attempting recovery...');
                
                // Try to close any extension pages that might have opened
                try {
                    const pages = await browser.pages();
                    for (const page of pages) {
                        const pageUrl = page.url();
                        if (pageUrl.startsWith('chrome-extension://')) {
                            console.log('Closing extension page:', pageUrl);
                            await page.close();
                        }
                    }
                    
                    // Get a fresh page reference
                    const freshPages = await browser.pages();
                    const activePage = freshPages.find(p => !p.url().startsWith('chrome-extension://')) || freshPages[0];
                    session.page = activePage;
                    
                    // Retry navigation with more permissive options
                    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (retryError) {
                    throw new Error(`Navigation failed due to browser extension interference. Try restarting the browser session or disable extensions. Error: ${retryError.message}`);
                }
            } else if (navError.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                       navError.message.includes('net::ERR_CONNECTION_TIMED_OUT') ||
                       navError.message.includes('net::ERR_CONNECTION_REFUSED')) {
                throw new Error(`Network error: ${navError.message}. Please check the URL and network connectivity.`);
            } else {
                throw navError;
            }
        }
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
        const result = await session.page.evaluate(`(() => { ${script} })()`);

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
                    // Wait for the element to be in the DOM and visible on the main page
                    let elements = [];
                    try {
                        await page.waitForSelector(selector, {
                            visible: true,
                            timeout: 5000
                        });
                        elements = await page.$$(selector);
                    } catch (_) {
                        // Not on the main page - fall through and check frames below
                    }

                    // If not found on the main page, the element may live inside an iframe
                    if (elements.length === 0) {
                        for (const frame of page.frames()) {
                            if (frame === page.mainFrame()) continue;
                            try {
                                await frame.waitForSelector(selector, {
                                    visible: true,
                                    timeout: 2000
                                });
                                const frameElements = await frame.$$(selector);
                                if (frameElements.length > 0) {
                                    elements = frameElements;
                                    break;
                                }
                            } catch (_) {
                                // Selector not in this frame, try the next one
                            }
                        }
                    }

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
                        // Throw a clean error instead of leaking Puppeteer's raw
                        // TimeoutError (with its noisy nested `cause` stack) up to callers.
                        throw new Error(`Element not found (selector: ${selector}) on the page or in any accessible frame after ${maxAttempts} attempts`);
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
 * Select one or more options in a select element.
 * Resolves requested values against option value, label, and visible text, then selects them.
 * Supports AI-powered matching when useAI flag is enabled.
 *
 * AI agents often target an <option>, <optgroup>, <label>, or wrapper instead of <select>.
 * Native <select> is resolved from the matched element (self, parent, descendant, or label control).
 */
const normalizeOptionQuery = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Common aliases so "US" / "United States" resolve to "USA", etc. */
const OPTION_ALIAS_GROUPS = [
    ['us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america'],
    ['uk', 'u.k.', 'united kingdom', 'britain', 'great britain', 'england', 'gb'],
    ['nz', 'new zealand'],
    ['au', 'aus', 'australia'],
    ['ca', 'can', 'canada'],
    ['uae', 'united arab emirates'],
    ['kr', 'south korea', 'korea, republic of', 'republic of korea'],
    ['kp', 'north korea'],
    ['ru', 'russia', 'russian federation'],
    ['de', 'germany', 'deutschland'],
    ['fr', 'france'],
    ['es', 'spain'],
    ['it', 'italy'],
    ['jp', 'japan'],
    ['cn', 'china', 'prc', "people's republic of china"],
    ['in', 'india'],
    ['br', 'brazil'],
    ['mx', 'mexico'],
];

const expandOptionAliases = (query) => {
    const q = normalizeOptionQuery(query).toLowerCase();
    if (!q) return [];
    const expanded = new Set([q]);
    for (const group of OPTION_ALIAS_GROUPS) {
        if (group.includes(q)) {
            for (const alias of group) expanded.add(alias);
        }
    }
    return [...expanded];
};

const optionCandidateTexts = (option) => [
    option.value,
    option.label,
    option.text,
].map(normalizeOptionQuery).filter((v) => v !== '');

/**
 * Score how well an option matches a query. Higher is better; 0 = no match.
 * Avoids false positives like query "US" matching "Australia" via substring includes.
 */
const scoreOptionMatch = (option, query) => {
    const normalizedQuery = normalizeOptionQuery(query);
    if (!normalizedQuery) return 0;

    const queryLower = normalizedQuery.toLowerCase();
    const aliases = expandOptionAliases(queryLower);
    const candidates = optionCandidateTexts(option);
    if (!candidates.length) return 0;

    let best = 0;

    for (const candidate of candidates) {
        const candidateLower = candidate.toLowerCase();

        // Exact value/label/text
        if (candidateLower === queryLower) {
            best = Math.max(best, 100);
            continue;
        }

        // Alias exact (US → USA, United States → USA)
        if (aliases.some((alias) => alias === candidateLower)) {
            best = Math.max(best, 90);
            continue;
        }

        // Short queries (≤2 chars): exact / alias only — never substring.
        if (queryLower.length <= 2) {
            continue;
        }

        // Whole-word boundary match (query "kingdom" in "United Kingdom")
        const wordRe = new RegExp(`(^|[^a-z0-9])${escapeRegex(queryLower)}([^a-z0-9]|$)`, 'i');
        if (wordRe.test(candidateLower)) {
            best = Math.max(best, 70);
            continue;
        }

        // Alias as whole word inside candidate
        if (aliases.some((alias) => {
            if (alias.length <= 2) return false;
            const aliasRe = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, 'i');
            return aliasRe.test(candidateLower);
        })) {
            best = Math.max(best, 65);
            continue;
        }

        // Prefix match for longer queries ("United St" → "United States")
        if (queryLower.length >= 4 && candidateLower.startsWith(queryLower)) {
            best = Math.max(best, 50);
            continue;
        }

        // Contains only when query is reasonably long (avoids "us" in "australia")
        if (queryLower.length >= 4 && candidateLower.includes(queryLower)) {
            best = Math.max(best, 30);
            continue;
        }
    }

    return best;
};

const optionMatchesQuery = (option, query) => scoreOptionMatch(option, query) > 0;

/** Pick the single best-scoring option (undefined if none score > 0). */
const findBestOptionMatch = (options, query) => {
    let best = null;
    let bestScore = 0;

    for (const option of options) {
        const score = scoreOptionMatch(option, query);
        if (score > bestScore) {
            bestScore = score;
            best = option;
        }
    }

    return bestScore > 0 ? best : null;
};

/** Find a Puppeteer frame that contains the selector (main page + iframes). */
const findFrameWithSelector = async (page, selector, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const frames = page.frames();
        for (const frame of frames) {
            try {
                // Try normal + pierce (open shadow) selectors.
                const handle =
                    await frame.$(selector)
                    || await frame.$(`pierce/${selector}`).catch(() => null);
                if (handle) {
                    await handle.dispose().catch(() => {});
                    return frame;
                }
            } catch (_) {
                // Frame may be detaching during navigation.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return null;
};

/**
 * In-page: resolve <select> + options.
 * Uses TreeWalker / shadow piercing because Salesforce LWC synthetic shadow
 * patches document.querySelector* and hides internal nodes from querySelectorAll.
 */
const EVALUATE_SELECT_CONTEXT = (sel, { activate = false } = {}) => {
    const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

    const isVisible = (el) => {
        if (!el) return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 || rect.height > 0;
        } catch (_) {
            return false;
        }
    };

    /** Walk real DOM + open shadow roots; bypasses LWC-patched querySelector. */
    const querySelectorAllDeep = (selector, root = document) => {
        const results = [];
        const seen = new Set();

        const tryMatch = (el) => {
            if (!el || el.nodeType !== 1 || seen.has(el)) return;
            seen.add(el);
            try {
                if (el.matches?.(selector)) results.push(el);
            } catch (_) {}
        };

        const walk = (node) => {
            if (!node) return;

            if (node.nodeType === 1) {
                tryMatch(node);

                // Native open shadow
                if (node.shadowRoot) {
                    walk(node.shadowRoot);
                }

                // Some LWC / web-component hosts expose closed-looking trees via children.
                const children = node.children || [];
                for (let i = 0; i < children.length; i++) {
                    walk(children[i]);
                }
                return;
            }

            // Document / DocumentFragment / ShadowRoot
            const childNodes = node.childNodes || [];
            for (let i = 0; i < childNodes.length; i++) {
                walk(childNodes[i]);
            }
        };

        // TreeWalker finds LWC synthetic-shadow scoped nodes that querySelector hides.
        try {
            const start = root.body || root.documentElement || root;
            if (start && start.nodeType === 1) {
                tryMatch(start);
                const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
                let current = walker.currentNode;
                while (current) {
                    tryMatch(current);
                    if (current.shadowRoot) walk(current.shadowRoot);
                    current = walker.nextNode();
                }
            } else {
                walk(root);
            }
        } catch (_) {
            walk(root.body || root);
        }

        // Fallback: unpatched path in case matches() / TreeWalker blocked.
        try {
            const quick = root.querySelectorAll?.(selector);
            if (quick && quick.length) {
                for (const el of quick) {
                    if (!seen.has(el)) {
                        seen.add(el);
                        results.push(el);
                    }
                }
            }
        } catch (_) {}

        return results;
    };

    const collectSelectOptions = (selectEl) => {
        if (!selectEl || selectEl.tagName.toLowerCase() !== 'select') return [];

        let optionEls = [];
        try {
            if (selectEl.options && selectEl.options.length > 0) {
                optionEls = Array.from(selectEl.options);
            }
        } catch (_) {}

        if (!optionEls.length) {
            optionEls = Array.from(selectEl.querySelectorAll?.('option') || []);
        }
        if (!optionEls.length) {
            optionEls = querySelectorAllDeep('option', selectEl);
        }
        if (!optionEls.length && selectEl.shadowRoot) {
            optionEls = Array.from(selectEl.shadowRoot.querySelectorAll('option'));
        }

        return optionEls.map((opt, idx) => ({
            value: opt.value,
            label: normalizeText(opt.label || opt.textContent || opt.text || ''),
            text: normalizeText(opt.textContent || opt.text || ''),
            index: idx,
            disabled: Boolean(opt.disabled)
        }));
    };

    const resolveNativeSelect = (element) => {
        if (!element) return null;
        const tag = element.tagName.toLowerCase();

        if (tag === 'select') return element;
        if (tag === 'option' || tag === 'optgroup') {
            return element.closest?.('select') || null;
        }

        if (tag === 'label') {
            if (element.control && element.control.tagName.toLowerCase() === 'select') {
                return element.control;
            }
            const forId = element.getAttribute('for');
            if (forId) {
                const labeled = querySelectorAllDeep(
                    `#${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(forId) : forId.replace(/([^\w-])/g, '\\$1')}`
                )[0] || document.getElementById(forId);
                if (labeled && labeled.tagName.toLowerCase() === 'select') {
                    return labeled;
                }
            }
        }

        const nested = querySelectorAllDeep('select', element)[0];
        if (nested) return nested;

        const container = element.closest?.('div, span, fieldset, form, li, td, th, section, article, label');
        if (container) {
            const nearby = querySelectorAllDeep('select', container)[0];
            if (nearby) return nearby;
        }

        return null;
    };

    const collectCustomOptionsNear = (rootEl) => {
        if (!rootEl) return [];

        const scope =
            rootEl.closest?.('div, span, fieldset, form, li, td, th, section, article, label')
            || rootEl.parentElement
            || document.body
            || document;

        const triggers = [
            rootEl,
            ...querySelectorAllDeep(
                '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], button, [role="button"]',
                scope
            )
        ];
        for (const trigger of triggers.slice(0, 6)) {
            try {
                if (typeof trigger.focus === 'function') trigger.focus();
                if (typeof trigger.click === 'function') trigger.click();
            } catch (_) {}
        }

        const optionNodes = querySelectorAllDeep(
            'option, [role="option"], [data-radix-collection-item], li[data-value], div[data-value], li[role="option"], button[role="option"]',
            scope
        ).filter((node) => {
            if (node.tagName && node.tagName.toLowerCase() === 'option') {
                return !node.disabled;
            }
            try {
                const style = window.getComputedStyle(node);
                return style.display !== 'none' && style.visibility !== 'hidden';
            } catch (_) {
                return true;
            }
        });

        return optionNodes.map((node, idx) => {
            const tag = node.tagName.toLowerCase();
            if (tag === 'option') {
                return {
                    value: node.value,
                    label: normalizeText(node.label || node.textContent || node.text || ''),
                    text: normalizeText(node.textContent || node.text || ''),
                    index: idx,
                    disabled: Boolean(node.disabled),
                    source: 'option'
                };
            }

            return {
                value: node.getAttribute('data-value')
                    || node.getAttribute('data-radix-collection-item')
                    || node.id
                    || String(idx),
                label: normalizeText(node.textContent || ''),
                text: normalizeText(node.textContent || ''),
                index: idx,
                selector: null,
                source: 'custom'
            };
        }).filter((opt) => opt.label || opt.text || (opt.value !== undefined && opt.value !== null));
    };

    let matched = [];
    try {
        matched = querySelectorAllDeep(sel);
    } catch (err) {
        return { found: false, reason: `query_error: ${err.message}`, matchCount: 0 };
    }

    if (!matched.length) {
        // Last resort for forms: any select with matching name= from selector.
        const nameMatch = /\[name=['"]([^'"]+)['"]\]/.exec(sel);
        if (nameMatch) {
            matched = querySelectorAllDeep('select').filter(
                (el) => el.getAttribute('name') === nameMatch[1]
            );
        }
    }

    if (!matched.length) {
        return { found: false, reason: 'element_not_found', matchCount: 0 };
    }

    const selects = [];
    for (const el of matched) {
        const selectEl = resolveNativeSelect(el);
        if (selectEl && !selects.includes(selectEl)) {
            selects.push(selectEl);
        }
    }

    if (!selects.length) {
        return {
            found: false,
            reason: 'no_native_select',
            matchCount: matched.length,
            elementTag: matched[0].tagName.toLowerCase(),
            elementType: matched[0].type || null
        };
    }

    const ranked = selects
        .map((selectEl) => {
            const options = collectSelectOptions(selectEl);
            return {
                selectEl,
                options,
                optionCount: options.length,
                visible: isVisible(selectEl),
                id: selectEl.id || null,
                name: selectEl.name || null,
                multiple: Boolean(selectEl.multiple),
                outerHTML: (selectEl.outerHTML || '').slice(0, 500)
            };
        })
        .sort((a, b) => {
            if (b.optionCount !== a.optionCount) return b.optionCount - a.optionCount;
            if (a.visible !== b.visible) return a.visible ? -1 : 1;
            return 0;
        });

    let best = ranked[0];

    if (activate && best.selectEl) {
        try {
            best.selectEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        } catch (_) {}
        try {
            best.selectEl.focus();
        } catch (_) {}
    }

    const options = collectSelectOptions(best.selectEl);
    best = { ...best, options, optionCount: options.length };

    // Clear previous marks site-wide, then mark the chosen select for this request.
    try {
        for (const el of querySelectorAllDeep('select[data-browser-api-select-target]')) {
            el.removeAttribute('data-browser-api-select-target');
        }
    } catch (_) {}
    for (const item of ranked) {
        try {
            item.selectEl.removeAttribute('data-browser-api-select-target');
        } catch (_) {}
    }
    try {
        best.selectEl.setAttribute('data-browser-api-select-target', '1');
    } catch (_) {}

    let customOptions = [];
    if (best.optionCount === 0) {
        customOptions = collectCustomOptionsNear(best.selectEl);
        const nativeFromCustom = customOptions.filter((o) => o.source === 'option');
        if (nativeFromCustom.length > 0) {
            return {
                found: true,
                elementTag: matched[0].tagName.toLowerCase(),
                selectTag: 'select',
                selectId: best.id,
                selectName: best.name,
                multiple: best.multiple,
                matchCount: matched.length,
                selectCount: selects.length,
                options: nativeFromCustom.map((o, idx) => ({ ...o, index: idx })),
                diagnostics: best.outerHTML
            };
        }
    }

    return {
        found: true,
        elementTag: matched[0].tagName.toLowerCase(),
        selectTag: 'select',
        selectId: best.id,
        selectName: best.name,
        multiple: best.multiple,
        matchCount: matched.length,
        selectCount: selects.length,
        options: best.options,
        customOptions,
        diagnostics: best.outerHTML
    };
};

const selectOptionSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        selector,
        value,
        values,
        label,
        labels,
        text,
        texts,
        index,
        indexes,
        useAI = false,
        context = ''
    } = req.body ?? {};

    if (!selector) {
        return res.status(400).json({
            error: 'Selector is required'
        });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const requestedLabels = [
        ...(Array.isArray(values) ? values : value !== undefined ? [value] : []),
        ...(Array.isArray(labels) ? labels : label !== undefined ? [label] : []),
        ...(Array.isArray(texts) ? texts : text !== undefined ? [text] : []),
    ].filter(v => v !== undefined && v !== null).map(String);

    const requestedIndexes = [
        ...(Array.isArray(indexes) ? indexes : index !== undefined ? [index] : []),
    ].filter(v => v !== undefined && v !== null).map(Number);

    if (!requestedLabels.length && !requestedIndexes.length) {
        return res.status(400).json({
            error: 'Option selection is required',
            message: 'Provide value, values, label, labels, text, texts, index, or indexes'
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    try {
        const page = await getFirstTab(session);
        session.page = page;

        // Prefer a frame/select that actually has options (main page + iframes).
        let targetFrame = page.mainFrame();
        let selectContext = null;

        const probeFramesForSelect = async (activate) => {
            let best = null;
            let lastMiss = null;
            for (const frame of page.frames()) {
                try {
                    const result = await frame.evaluate(EVALUATE_SELECT_CONTEXT, selector, { activate });
                    if (!result) continue;

                    if (!result.found) {
                        lastMiss = { frame, result };
                        continue;
                    }

                    const optionScore = (result.options || []).length;
                    const customScore = (result.customOptions || []).length;
                    const score = optionScore * 1000 + customScore + 1;
                    if (!best || score > best.score) {
                        best = { frame, score, result };
                    }
                } catch (probeError) {
                    console.warn(`Select probe failed in frame: ${probeError.message}`);
                }
            }
            return best || (lastMiss ? { frame: lastMiss.frame, score: 0, result: lastMiss.result } : null);
        };

        // Quick wait for selector to appear somewhere.
        // LWC synthetic shadow often hides nodes from querySelector — do not fail hard here.
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 3000 });
        } catch (_) {
            const frame = await findFrameWithSelector(page, selector, 5000);
            if (frame) {
                targetFrame = frame;
            } else {
                try {
                    await page.waitForSelector(selector, { timeout: 2000 });
                } catch (_) {
                    console.warn(
                        `waitForSelector miss for "${selector}"; falling back to deep/LWC DOM probe`
                    );
                }
            }
        }

        // Activate + poll while options hydrate asynchronously.
        const optionWaitDeadline = Date.now() + 8000;
        let probeAttempt = 0;
        while (Date.now() <= optionWaitDeadline) {
            const shouldActivate = probeAttempt === 0 || probeAttempt % 4 === 0;
            const best = await probeFramesForSelect(shouldActivate);
            probeAttempt += 1;
            if (best) {
                targetFrame = best.frame;
                selectContext = best.result;
                if ((selectContext.options || []).length > 0) break;
                if ((selectContext.customOptions || []).length > 0) break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!selectContext) {
            // Final probe without requiring options.
            const best = await probeFramesForSelect(false);
            if (best) {
                targetFrame = best.frame;
                selectContext = best.result;
            }
        }

        console.log(
            `🔍 Select resolve for "${selector}":`,
            selectContext?.found
                ? `native <select> via ${selectContext.elementTag} `
                    + `(${(selectContext.options || []).length} options, `
                    + `${selectContext.matchCount || 0} matches, `
                    + `${selectContext.selectCount || 0} selects)`
                : (selectContext?.reason || 'no_context')
        );

        let availableOptions = null;
        let isSelectElement = Boolean(selectContext?.found) && (selectContext.options || []).length > 0;
        let usesCustomOptions = false;

        if (selectContext?.found && (selectContext.options || []).length > 0) {
            availableOptions = selectContext.options;
            console.log(`📋 Available options count: ${availableOptions.length}`);
            console.log(
                '📋 Available options:',
                availableOptions.map((o) => `${o.value}: ${o.label}`).slice(0, 30)
            );
        } else if (selectContext?.found) {
            // Fallback: collect options via ElementHandle (covers some DOM edge cases).
            try {
                const selectHandle =
                    await targetFrame.$('select[data-browser-api-select-target="1"]')
                    || await targetFrame.$(selector);
                if (selectHandle) {
                    const handleOptions = await selectHandle.$$eval('option', (opts) =>
                        opts.map((opt, idx) => ({
                            value: opt.value,
                            label: String(opt.label || opt.textContent || opt.text || '').replace(/\s+/g, ' ').trim(),
                            text: String(opt.textContent || opt.text || '').replace(/\s+/g, ' ').trim(),
                            index: idx,
                            disabled: Boolean(opt.disabled)
                        }))
                    );
                    await selectHandle.dispose().catch(() => {});
                    if (handleOptions.length > 0) {
                        selectContext.options = handleOptions;
                        availableOptions = handleOptions;
                        isSelectElement = true;
                        console.log(`📋 Options via ElementHandle: ${handleOptions.length}`);
                    }
                }
            } catch (handleError) {
                console.warn(`ElementHandle option collection failed: ${handleError.message}`);
            }
        }

        if (!availableOptions && selectContext?.found && (selectContext.customOptions || []).length > 0) {
            // Empty native <select> with custom dropdown UI options nearby.
            availableOptions = selectContext.customOptions;
            usesCustomOptions = true;
            isSelectElement = false;
            console.log(`📋 Custom options count: ${availableOptions.length}`);
        } else if (!availableOptions && !selectContext?.found) {
            // Radio / checkbox / custom listbox fallbacks when no native <select> exists.
            availableOptions = await targetFrame.evaluate(sel => {
                const element = document.querySelector(sel);
                if (!element) return null;

                const tagName = element.tagName.toLowerCase();

                if (tagName === 'input' && element.type === 'radio') {
                    const name = element.name;
                    const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
                    return radios.map(radio => ({
                        value: radio.value,
                        label: radio.parentElement?.textContent?.trim() || radio.value,
                        text: radio.parentElement?.textContent?.trim() || radio.value,
                        selector: `input[type="radio"][name="${name}"][value="${radio.value}"]`
                    }));
                }

                if (tagName === 'input' && element.type === 'checkbox') {
                    const name = element.name;
                    const checkboxes = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${name}"]`));
                    return checkboxes.map(checkbox => ({
                        value: checkbox.value,
                        label: checkbox.parentElement?.textContent?.trim() || checkbox.value,
                        text: checkbox.parentElement?.textContent?.trim() || checkbox.value,
                        selector: `input[type="checkbox"][name="${name}"][value="${checkbox.value}"]`
                    }));
                }

                if (
                    element.getAttribute('role') === 'button'
                    || element.getAttribute('aria-haspopup')
                    || element.getAttribute('role') === 'combobox'
                ) {
                    element.click();
                }

                const optionNodes = Array.from(document.querySelectorAll(
                    '[role="option"], [data-radix-collection-item], li[data-value], div[data-value]'
                )).filter((node) => {
                    const style = window.getComputedStyle(node);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });

                if (optionNodes.length > 0) {
                    return optionNodes.map((node, idx) => ({
                        value: node.getAttribute('data-value')
                            || node.getAttribute('data-radix-collection-item')
                            || node.id
                            || String(idx),
                        label: (node.textContent || '').replace(/\s+/g, ' ').trim(),
                        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
                        selector: null,
                        index: idx
                    }));
                }

                return [];
            }, selector);
        }

        if (!availableOptions || (Array.isArray(availableOptions) && availableOptions.length === 0)) {
            const diag = selectContext?.diagnostics
                ? ` Element snapshot: ${selectContext.diagnostics}`
                : '';
            const reason = selectContext?.found
                ? 'The <select> was found but has no <option> children yet (and no nearby custom options).'
                : `Could not locate selectable options (${selectContext?.reason || 'no_context'}). `
                    + 'On Salesforce LWC pages, retry after the form is fully rendered.';
            throw new Error(
                `Could not determine selectable options for element: ${selector}. `
                + reason
                + ' Wait for the field to finish loading if options are async.'
                + diag
            );
        }

        let finalQueries = [...requestedLabels];
        let aiResolvedOptions = [];
        const aiAttempted = new Set();

        /**
         * Resolve one requested query to an available option.
         * 1) Deterministic value/label/text match
         * 2) If useAI and no match → ask AI with the full options list
         */
        const resolveOptionForQuery = async (query, preloadedAiOption, queryKey = query) => {
            if (preloadedAiOption && (preloadedAiOption.index !== undefined || preloadedAiOption.value !== undefined)) {
                return preloadedAiOption;
            }

            const deterministic = findBestOptionMatch(availableOptions, query);
            if (deterministic) {
                return deterministic;
            }

            if (!useAI) {
                return null;
            }

            if (!AIService.isAvailable()) {
                console.warn(`⚠️ useAI=true but AI service unavailable while resolving "${query}"`);
                return null;
            }

            if (aiAttempted.has(queryKey)) {
                return null;
            }
            aiAttempted.add(queryKey);

            console.log(`🤖 No direct match for "${query}", asking AI with ${availableOptions.length} options...`);
            try {
                const matchedOption = await AIService.matchOption(query, availableOptions, context);
                if (matchedOption) {
                    console.log(`🎯 AI matched "${query}" → "${matchedOption.label || matchedOption.value}"`);
                } else {
                    console.log(`⚠️ AI found no reasonable match for "${query}"`);
                }
                return matchedOption;
            } catch (error) {
                console.error(`❌ AI matching failed for "${query}":`, error.message);
                return null;
            }
        };

        // Optional eager AI pass (kept for logging / aiMatching.matched response field).
        if (useAI && requestedLabels.length > 0 && AIService.isAvailable()) {
            console.log('🤖 Pre-resolving options with AI where helpful...');

            for (let i = 0; i < requestedLabels.length; i++) {
                const direct = findBestOptionMatch(availableOptions, requestedLabels[i]);
                if (direct) {
                    aiResolvedOptions[i] = direct;
                    if (direct.value !== undefined && direct.value !== null) {
                        finalQueries[i] = String(direct.value);
                    }
                    continue;
                }

                try {
                    aiAttempted.add(requestedLabels[i]);
                    const matchedOption = await AIService.matchOption(
                        requestedLabels[i],
                        availableOptions,
                        context
                    );

                    if (matchedOption) {
                        console.log(`🎯 AI matched "${requestedLabels[i]}" to "${matchedOption.label || matchedOption.value}"`);
                        if (matchedOption.value !== undefined && matchedOption.value !== null) {
                            finalQueries[i] = String(matchedOption.value);
                        } else {
                            finalQueries[i] = matchedOption.label || matchedOption.text || requestedLabels[i];
                        }
                        aiResolvedOptions[i] = matchedOption;
                    } else {
                        console.log(`⚠️ AI could not find match for "${requestedLabels[i]}" during pre-resolve`);
                    }
                } catch (error) {
                    console.error(`❌ AI pre-resolve failed for "${requestedLabels[i]}":`, error.message);
                }
            }
        } else if (useAI && !AIService.isAvailable()) {
            console.warn('⚠️ useAI=true but OPENAI_API_KEY is not configured / AI service unavailable');
        }

        let selectedValues = [];
        let selectedOptions = [];

        if (isSelectElement) {
            const resolvedIndexes = [];

            for (let i = 0; i < finalQueries.length; i++) {
                const query = finalQueries[i];
                const matched = await resolveOptionForQuery(query, aiResolvedOptions[i]);

                if (!matched) {
                    // Last chance: if original requested label differs from finalQueries (AI rewrote it), retry original.
                    const original = requestedLabels[i];
                    const fallback = original && original !== query
                        ? await resolveOptionForQuery(original, null)
                        : null;

                    if (!fallback) {
                        const availableSummary = availableOptions
                            .slice(0, 20)
                            .map((opt) => `${opt.value} ("${opt.label || opt.text}")`)
                            .join(', ');
                        const aiHint = useAI
                            ? (AIService.isAvailable()
                                ? ' AI also found no suitable match.'
                                : ' useAI was true but AI service is unavailable (set OPENAI_API_KEY).')
                            : ' Pass useAI:true to let AI pick the closest option.';
                        throw new Error(
                            `No option found matching "${query}". Available options: ${availableSummary}`
                            + `${availableOptions.length > 20 ? ', ...' : ''}.${aiHint}`
                        );
                    }

                    const fallbackIndex = typeof fallback.index === 'number'
                        ? fallback.index
                        : availableOptions.indexOf(fallback);
                    if (fallbackIndex < 0 || fallbackIndex >= availableOptions.length) {
                        throw new Error(`Resolved option index out of range for "${original}"`);
                    }
                    resolvedIndexes.push(fallbackIndex);
                    aiResolvedOptions[i] = fallback;
                    finalQueries[i] = fallback.value !== undefined && fallback.value !== null
                        ? String(fallback.value)
                        : (fallback.label || fallback.text || original);
                    continue;
                }

                const matchedIndex = typeof matched.index === 'number'
                    ? matched.index
                    : availableOptions.findIndex((opt) =>
                        opt.value === matched.value
                        && normalizeOptionQuery(opt.label) === normalizeOptionQuery(matched.label || matched.text)
                    );

                if (matchedIndex < 0 || matchedIndex >= availableOptions.length) {
                    // Prefer indexOf if findIndex failed due to label normalization.
                    const byRef = availableOptions.indexOf(matched);
                    if (byRef >= 0) {
                        resolvedIndexes.push(byRef);
                        continue;
                    }
                    throw new Error(`Resolved option index out of range for "${query}"`);
                }

                resolvedIndexes.push(matchedIndex);
                aiResolvedOptions[i] = matched;
            }

            for (const requestedIndex of requestedIndexes) {
                if (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= availableOptions.length) {
                    throw new Error(`Option index out of range: ${requestedIndex}`);
                }
                resolvedIndexes.push(requestedIndex);
            }

            // Apply selection on the resolved <select> (deep query for LWC synthetic shadow).
            const applyResult = await targetFrame.evaluate((sel, optionIndexes) => {
                const querySelectorAllDeep = (selector, root = document) => {
                    const results = [];
                    const seen = new Set();
                    const tryMatch = (el) => {
                        if (!el || el.nodeType !== 1 || seen.has(el)) return;
                        seen.add(el);
                        try {
                            if (el.matches?.(selector)) results.push(el);
                        } catch (_) {}
                    };
                    try {
                        const start = root.body || root.documentElement || root;
                        if (start && start.nodeType === 1) {
                            tryMatch(start);
                            const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
                            let current = walker.currentNode;
                            while (current) {
                                tryMatch(current);
                                if (current.shadowRoot) {
                                    const srWalker = document.createTreeWalker(
                                        current.shadowRoot,
                                        NodeFilter.SHOW_ELEMENT
                                    );
                                    let srNode = srWalker.currentNode;
                                    while (srNode) {
                                        tryMatch(srNode);
                                        srNode = srWalker.nextNode();
                                    }
                                }
                                current = walker.nextNode();
                            }
                        }
                    } catch (_) {}
                    try {
                        const quick = root.querySelectorAll?.(selector);
                        if (quick) {
                            for (const el of quick) {
                                if (!seen.has(el)) {
                                    seen.add(el);
                                    results.push(el);
                                }
                            }
                        }
                    } catch (_) {}
                    return results;
                };

                let selectEl = null;

                // Prefer selects matching the request selector (never a stale mark from another field).
                {
                    const matched = querySelectorAllDeep(sel);
                    const selects = matched
                        .map((el) => {
                            if (!el) return null;
                            if (el.tagName && el.tagName.toLowerCase() === 'select') return el;
                            return el.closest?.('select') || querySelectorAllDeep('select', el)[0];
                        })
                        .filter(Boolean);
                    selectEl = selects.sort(
                        (a, b) => (b.options?.length || 0) - (a.options?.length || 0)
                    )[0] || null;
                }

                if (!selectEl) {
                    selectEl =
                        querySelectorAllDeep('select[data-browser-api-select-target="1"]')[0] || null;
                }

                if (!selectEl) {
                    const nameMatch = /\[name=['"]([^'"]+)['"]\]/.exec(sel);
                    if (nameMatch) {
                        selectEl = querySelectorAllDeep('select').find(
                            (el) => el.getAttribute('name') === nameMatch[1]
                        ) || null;
                    }
                }

                if (!selectEl) {
                    const idMatch = /^#([\w:-]+)$/.exec(sel) || /\[id=['"]([^'"]+)['"]\]/.exec(sel);
                    if (idMatch) {
                        selectEl = querySelectorAllDeep('select').find(
                            (el) => el.id === idMatch[1]
                        ) || null;
                    }
                }

                if (!selectEl || selectEl.tagName.toLowerCase() !== 'select') {
                    throw new Error(`Could not resolve target <select> for selector: ${sel}`);
                }

                let options = [];
                try {
                    options = Array.from(selectEl.options || []);
                } catch (_) {}
                if (!options.length) {
                    options = Array.from(selectEl.querySelectorAll?.('option') || []);
                }

                const uniqueIndexes = [...new Set(optionIndexes.map(Number))];
                const isMultiple = Boolean(selectEl.multiple);

                for (const option of options) {
                    option.selected = false;
                }

                if (isMultiple) {
                    for (const idx of uniqueIndexes) {
                        if (!options[idx]) {
                            throw new Error(`Option index out of range while selecting: ${idx}`);
                        }
                        options[idx].selected = true;
                    }
                } else {
                    const targetIndex = uniqueIndexes[uniqueIndexes.length - 1];
                    if (!options[targetIndex]) {
                        throw new Error(`Option index out of range while selecting: ${targetIndex}`);
                    }
                    selectEl.selectedIndex = targetIndex;
                    options[targetIndex].selected = true;
                    selectEl.value = options[targetIndex].value;
                }

                // Fire events LWC / Lightning expect.
                selectEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                selectEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                try {
                    selectEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
                } catch (_) {}

                return {
                    selectedValues: Array.from(selectEl.selectedOptions).map((option) => option.value),
                    selectedOptions: Array.from(selectEl.selectedOptions).map((option) => ({
                        value: option.value,
                        label: option.label,
                        text: option.text
                    }))
                };
            }, selector, resolvedIndexes);

            selectedValues = applyResult.selectedValues;
            selectedOptions = applyResult.selectedOptions;

            if (!selectedOptions.length) {
                throw new Error(`Failed to select option(s) for selector: ${selector}`);
            }
        } else {
            const matchedOptions = [];

            for (let i = 0; i < finalQueries.length; i++) {
                const query = finalQueries[i];
                const matchedOption = await resolveOptionForQuery(query, aiResolvedOptions[i]);
                if (!matchedOption) {
                    const availableSummary = availableOptions
                        .slice(0, 20)
                        .map((opt) => `${opt.value} ("${opt.label || opt.text}")`)
                        .join(', ');
                    throw new Error(
                        `No option found matching: ${query}. Available options: ${availableSummary}`
                        + `${availableOptions.length > 20 ? ', ...' : ''}`
                    );
                }
                matchedOptions.push(matchedOption);
                aiResolvedOptions[i] = matchedOption;
                finalQueries[i] = matchedOption.value !== undefined && matchedOption.value !== null
                    ? String(matchedOption.value)
                    : (matchedOption.label || matchedOption.text || query);
            }

            for (const matchedOption of matchedOptions) {
                if (matchedOption.selector) {
                    await targetFrame.click(matchedOption.selector);
                } else if (typeof matchedOption.index === 'number') {
                    await targetFrame.evaluate((idx, scopedToSelect) => {
                        const scope = scopedToSelect
                            ? (
                                document.querySelector('select[data-browser-api-select-target="1"]')?.closest(
                                    'div, span, fieldset, form, li, td, th, section, article, label'
                                )
                                || document
                            )
                            : document;

                        const optionNodes = Array.from(scope.querySelectorAll(
                            '[role="option"], [data-radix-collection-item], li[data-value], div[data-value]'
                        )).filter((node) => {
                            const style = window.getComputedStyle(node);
                            return style.display !== 'none' && style.visibility !== 'hidden';
                        });
                        const node = optionNodes[idx];
                        if (!node) {
                            throw new Error(`Custom option at index ${idx} not found`);
                        }
                        node.click();
                    }, matchedOption.index, usesCustomOptions);
                } else {
                    await targetFrame.click(selector);
                }
                await new Promise(resolve => setTimeout(resolve, getRandomDelay(50, 150)));
            }

            // If a native empty select exists, also try syncing value for form libs.
            if (usesCustomOptions) {
                await targetFrame.evaluate((valuesToSelect) => {
                    const selectEl = document.querySelector('select[data-browser-api-select-target="1"]');
                    if (!selectEl) return;
                    const target = String(valuesToSelect[valuesToSelect.length - 1] ?? '');
                    const options = Array.from(selectEl.options || []);
                    const match = options.find((opt) => opt.value === target)
                        || options.find((opt) => (opt.label || opt.textContent || '').trim() === target);
                    if (match) {
                        selectEl.value = match.value;
                        match.selected = true;
                        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, matchedOptions.map((opt) => opt.value));
            }

            selectedValues = matchedOptions.map((opt) => opt.value);
            selectedOptions = matchedOptions.map((opt) => ({
                value: opt.value,
                label: opt.label,
                text: opt.text
            }));
        }

        res.json({
            success: true,
            sessionId,
            selector,
            selectedValues,
            selectedOptions,
            aiMatching: {
                enabled: useAI,
                available: AIService.isAvailable(),
                requested: requestedLabels,
                matched: useAI
                    ? (aiResolvedOptions.length
                        ? aiResolvedOptions.map((opt) => (opt
                            ? (opt.label || opt.text || opt.value)
                            : null))
                        : finalQueries)
                    : null
            }
        });
    } catch (error) {
        console.error('Error selecting option:', error);
        res.status(500).json({
            error: 'Failed to select option',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

// Keep typing well under the 30s cap even for very long text, leaving
// headroom for the clear/scroll/enter delays and waitForSelector.
const TYPING_TIME_BUDGET_MS = 20000;
// Below this per-character delay, per-keystroke CDP overhead alone risks
// blowing the budget, so we stop typing character-by-character.
const MIN_TYPE_DELAY_MS = 8;

/**
 * Simulate human-like typing with random delays and occasional mistakes
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @param {boolean} pressEnter - Whether to press Enter after typing
 */
async function humanType(page, selector, text, pressEnter = false, clearInput = false, fast = false) {
    const str = String(text);

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
        if (!fast) {
            await wait(getRandomDelay(50, 100));
        }
    }

    if (str.length > 0) {
        // Scale the per-character delay down as text gets longer so total
        // typing time stays within TYPING_TIME_BUDGET_MS regardless of length.
        const idealDelay = TYPING_TIME_BUDGET_MS / str.length;

        if (idealDelay < MIN_TYPE_DELAY_MS) {
            // Too long to type character-by-character within the budget -
            // set the value directly so the fill still completes in well under 30s.
            await page.evaluate((sel, value) => {
                const input = document.querySelector(sel);
                if (input) {
                    input.focus();
                    if ('value' in input) {
                        input.value = value;
                    } else {
                        input.textContent = value;
                    }
                    const evOpts = { bubbles: true, cancelable: true };
                    input.dispatchEvent(new Event('input', evOpts));
                    input.dispatchEvent(new Event('change', evOpts));
                }
            }, selector, str);
        } else {
            const maxDelay = Math.min(160, idealDelay);
            const minDelay = Math.min(80, maxDelay);
            await page.type(selector, str, { delay: getRandomDelay(minDelay, maxDelay) });
        }
    }

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
 * Upload an image to a file input (supports base64 and optional resize/compression).
 */
const fillImageInput = async (req, res) => {
    const { sessionId } = req.params;
    const {
        selector,
        image,
        filename,
        mimeType: mimeTypeParam,
        maxWidth,
        maxHeight,
        quality,
        resize,
        waitForVisible = false
    } = req.body ?? {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    if (!selector) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'selector is required'
        });
    }

    const parsedImage = parseImagePayload(image);
    if (!parsedImage) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'image is required (raw base64 or data URL)'
        });
    }

    const resizeOptions = {
        maxWidth: resize?.maxWidth ?? maxWidth ?? null,
        maxHeight: resize?.maxHeight ?? maxHeight ?? null,
        quality: resize?.quality ?? quality ?? null
    };

    if (resizeOptions.maxWidth !== null) {
        resizeOptions.maxWidth = Number(resizeOptions.maxWidth);
    }
    if (resizeOptions.maxHeight !== null) {
        resizeOptions.maxHeight = Number(resizeOptions.maxHeight);
    }
    if (resizeOptions.quality !== null) {
        resizeOptions.quality = Number(resizeOptions.quality);
    }

    const mimeType = mimeTypeParam || parsedImage.mimeType || 'image/png';
    const finalFilename = filename || `upload.${extensionFromMime(mimeType)}`;

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    const page = await getFirstTab(session);
    session.page = page;

    try {
        // Wait for selector - visibility optional since file inputs are often hidden
        await page.waitForSelector(selector, {
            visible: waitForVisible,
            timeout: 30000
        });

        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, selector);

        await new Promise(resolve => setTimeout(resolve, getRandomDelay(50, 150)));

        const uploadResult = await page.evaluate(async (sel, base64, name, mime, resizeOpts) => {
            const input = document.querySelector(sel);

            if (!input) {
                throw new Error(`No element found for selector: ${sel}`);
            }

            if (input.tagName.toLowerCase() !== 'input' || input.type !== 'file') {
                throw new Error('Element is not a file input');
            }

            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            let blob = new Blob([bytes], { type: mime });
            const originalSize = blob.size;

            let bitmap;
            try {
                bitmap = await createImageBitmap(blob);
            } catch (decodeError) {
                throw new Error(`Invalid image data: ${decodeError.message}`);
            }

            const originalWidth = bitmap.width;
            const originalHeight = bitmap.height;

            let targetWidth = originalWidth;
            let targetHeight = originalHeight;

            if (resizeOpts.maxWidth || resizeOpts.maxHeight) {
                const scaleW = resizeOpts.maxWidth ? resizeOpts.maxWidth / targetWidth : 1;
                const scaleH = resizeOpts.maxHeight ? resizeOpts.maxHeight / targetHeight : 1;
                const scale = Math.min(1, scaleW, scaleH);

                if (scale < 1) {
                    targetWidth = Math.max(1, Math.round(targetWidth * scale));
                    targetHeight = Math.max(1, Math.round(targetHeight * scale));
                }
            }

            const shouldReencode = (
                targetWidth !== originalWidth ||
                targetHeight !== originalHeight ||
                (resizeOpts.quality !== null && resizeOpts.quality > 0 && resizeOpts.quality <= 1)
            );

            if (shouldReencode) {
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

                const outputQuality = (
                    resizeOpts.quality !== null &&
                    resizeOpts.quality > 0 &&
                    resizeOpts.quality <= 1
                ) ? resizeOpts.quality : 0.85;

                blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(
                        (result) => result ? resolve(result) : reject(new Error('Failed to encode image')),
                        mime,
                        outputQuality
                    );
                });
            }

            bitmap.close?.();

            const file = new File([blob], name, { type: mime });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            input.files = dataTransfer.files;

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            return {
                filename: name,
                mimeType: mime,
                originalSize,
                fileSize: blob.size,
                originalWidth,
                originalHeight,
                width: targetWidth,
                height: targetHeight,
                resized: targetWidth !== originalWidth || targetHeight !== originalHeight,
                compressed: blob.size < originalSize
            };
        }, selector, parsedImage.base64, finalFilename, mimeType, resizeOptions);

        res.json({
            success: true,
            sessionId,
            message: 'Image uploaded to file input successfully',
            selector,
            ...uploadResult
        });
    } catch (error) {
        console.error(`[${sessionId}] Error uploading image:`, error);

        res.status(500).json({
            error: 'Failed to upload image',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
                                await wait(randomDelay(1000, 5000));
                            }
                            break;

                        case 'IDLE':
                            // Random idle time (simulating reading/thinking)
                            await wait(randomDelay(1000, 5000));
                            break;
                    }

                    // Variable delay between actions (shorter for some actions)
                    const baseDelay = ['TYPING', 'IDLE'].includes(action)
                        ? randomDelay(100, 600)
                        : randomDelay(300, 1000);

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

/**
 * Refresh the active page in a session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const refreshSession = async (req, res) => {
    const { sessionId } = req.params;
    const { waitUntil = 'domcontentloaded', timeout = 30000 } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const { page } = session;

        if (!page) {
            return res.status(400).json({
                error: 'No active page found',
                message: 'Session exists but no active page is available'
            });
        }

        console.log(`Refreshing page in session ${sessionId}`);

        // Reload the page with specified options
        await page.reload({
            waitUntil,
            timeout
        });

        // Get updated page information
        const pageTitle = await page.title();
        const pageUrl = page.url();

        res.json({
            success: true,
            sessionId,
            message: 'Page refreshed successfully',
            pageInfo: {
                title: pageTitle,
                url: pageUrl,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`Error refreshing page in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to refresh page',
            message: error.message
        });
    }
};

const runStagehandSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        message,
        model = process.env.STAGEHAND_MODEL || 'openai/gpt-4.1-mini',
        mode = 'agent',
        timeoutMs = 120000,
        verbose = 1,
        resetConversation = false
    } = req.body ?? {};

    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({
            error: 'Message is required',
            message: 'Provide a non-empty message field describing the action(s) Stagehand should perform'
        });
    }

    if (!['agent', 'act', 'observe'].includes(mode)) {
        return res.status(400).json({
            error: 'Invalid mode',
            message: 'mode must be one of: agent, act, observe'
        });
    }

    if (typeof model !== 'string' || !model.trim()) {
        return res.status(400).json({
            error: 'Invalid model',
            message: 'model must be a non-empty Stagehand model name string'
        });
    }

    const stagehandTimeoutMs = Number(timeoutMs);
    if (!Number.isFinite(stagehandTimeoutMs) || stagehandTimeoutMs <= 0) {
        return res.status(400).json({
            error: 'Invalid timeoutMs',
            message: 'timeoutMs must be a positive number'
        });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();
    session.lastActivity = Date.now();

    let stagehand;

    try {
        const page = await getFirstTab(session);
        session.page = page;

        const cdpUrl = session.browser.wsEndpoint();
        if (!cdpUrl) {
            return res.status(500).json({
                error: 'Stagehand unavailable',
                message: 'Could not resolve a CDP websocket URL for this browser session'
            });
        }
        //
        // stagehand = new Stagehand({
        //     env: 'LOCAL',
        //     localBrowserLaunchOptions: {
        //         cdpUrl,
        //         viewport: {
        //             width: session.config?.width || 1920,
        //             height: session.config?.height || 1080
        //         }
        //     },
        //     model,
        //     verbose: Number.isInteger(verbose) && verbose >= 0 && verbose <= 2 ? verbose : 1,
        //     disablePino: true,
        //     sessionId
        // });

        stagehand = session.stagehand
        // await stagehand.init();

        let result;
        if (mode === 'act') {
            result = await Promise.race([
                stagehand.act(message),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand action timed out')), stagehandTimeoutMs))
            ]);
        } else if (mode === 'observe') {
            result = await Promise.race([
                stagehand.observe(message),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand observation timed out')), stagehandTimeoutMs))
            ]);
        } else {
            // const agent = stagehand.agent();
            if (resetConversation) {
                session.agentMessages = undefined;
            }

            const agentOptions = { instruction: message };
            if (session.agentMessages) {
                // Continue the same CUA conversation so the agent remembers what it
                // already did (page state, prior actions). Without this, every call
                // starts a brand-new conversation and the agent tends to re-orient by
                // re-navigating/reloading the page instead of picking up where it left off.
                agentOptions.messages = session.agentMessages;
            }

            result = await Promise.race([
                session.agent.execute(agentOptions),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand agent timed out')), stagehandTimeoutMs))
            ]);

            if (result?.messages) {
                session.agentMessages = result.messages;
            }
        }

        const activePage = await getFirstTab(session);
        session.page = activePage;
        session.lastUsed = Date.now();
        session.lastActivity = Date.now();

        res.json({
            success: true,
            sessionId,
            mode,
            message,
            result,
            pageInfo: {
                title: await activePage.title(),
                url: activePage.url(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error(`Error running Stagehand in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to run Stagehand action',
            message: error.message
        });
    } finally {
        if (stagehand) {
            try {
                // await stagehand.close();
            } catch (closeError) {
                console.warn('Failed to close Stagehand connection:', closeError.message);
            }
        }
    }
};

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
    selectOptionSession,
    getContentSession,
    simulateUserActions,
    validateGoogle,
    fillInput,
    fillImageInput,
    checkXPath,
    configure2CaptchaEndpoint,
    validate2CaptchaEndpoint,
    diagnose2CaptchaEndpoint,
    solveRecaptchaEndpoint,
    refreshSession,
    runStagehandSession
};
