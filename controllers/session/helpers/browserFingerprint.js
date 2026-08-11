// Browser fingerprint/anti-detection helpers: UA selection, Client Hints,
// realistic header/profile construction, geolocation sanitization, and
// navigator/screen/WebGL/Intl spoofing (with toString cloaking so the
// spoofed APIs don't out themselves).

const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
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

// IMPORTANT: this only feeds page.setExtraHTTPHeaders(), which applies the given
// headers to EVERY request the page makes (navigations, XHR/fetch, subresources)
// for the lifetime of the page - it does not vary per request the way a real
// browser does. Headers that a real browser computes dynamically per-request
// (Accept, Sec-Fetch-*, Upgrade-Insecure-Requests, Cache-Control/Pragma) must
// NOT be forced here: doing so previously made every request on the page carry
// document-navigation values (e.g. Sec-Fetch-Site: same-origin/none on XHR calls,
// or on the very first cross-site navigation where a real browser sends "none").
// That static, request-type-invariant header combination is a well-known and
// trivially server-detectable bot signal, independent of proxy/IP rotation.
// Chrome already sets these correctly per-request on its own (and Sec-CH-UA-*
// is derived automatically from the userAgentMetadata passed to
// page.setUserAgent(), see applyChromeIdentity), so only locale needs forcing.
const buildConsistentHeaders = ({ locale, customHeaders = {} }) => {
    const languageCode = String(locale || 'en-US').split('-')[0];

    const defaultHeaders = {
        // Lowercase key: HTTP/2 requires lowercase header field names
        // (RFC 7540 8.1.2). Real Chrome always sends lowercase over h2;
        // headers pushed via CDP's Network.setExtraHTTPHeaders go out with
        // whatever casing is given here rather than being renormalized, so a
        // Title-Case name is a free, easily-checked "this wasn't generated by
        // Chrome's own network stack" signal on Google's HTTP/2 edge.
        'accept-language': `${locale},${languageCode};q=0.9,en;q=0.8`
    };

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

// The UA is randomly chosen from Windows/macOS/Linux (see USER_AGENTS), so the
// spoofed WebGL vendor/renderer string must match that platform. Previously
// this was hardcoded to a Windows-only "Direct3D11" ANGLE backend regardless of
// which OS the UA/Sec-CH-UA-Platform claimed, which is an internally
// inconsistent fingerprint (e.g. a macOS UA reporting a Windows D3D11 GPU
// backend) that's detectable without needing any network-level signal at all.
const WEBGL_PROFILES = {
    '"Windows"': {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    },
    '"macOS"': {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'
    },
    '"Linux"': {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'
    }
};

const getWebglProfile = (platformProfile) =>
    WEBGL_PROFILES[platformProfile?.secChUaPlatform] || WEBGL_PROFILES['"Windows"'];

const resolveSessionTimezone = (locale, timezone, geolocation) => {
    if (timezone) return timezone;
    if (geolocation?.timezone) return geolocation.timezone;
    return LOCALE_TIMEZONE_DEFAULTS[locale] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
};

// page.setGeolocation()'s `accuracy` is meters, and callers here have been
// passing through country-level IP-geolocation fallbacks (e.g. accuracy in
// the hundreds of kilometers, centered near a country centroid). Real
// GeolocationCoordinates.accuracy - GPS, WiFi, or even Chrome's own IP-based
// fallback - essentially never exceeds ~150km even in sparse rural areas;
// values far beyond that are a giveaway that the coordinates are synthetic
// rather than anything a real browser's location stack would report. Clamp
// to a realistic band so we never hand a site a number that outs itself.
const MIN_GEOLOCATION_ACCURACY_METERS = 10;
const MAX_GEOLOCATION_ACCURACY_METERS = 150000;

const sanitizeGeolocation = (geolocation) => {
    const accuracy = Number.isFinite(geolocation.accuracy) ? geolocation.accuracy : 50;
    return {
        ...geolocation,
        accuracy: Math.min(
            Math.max(accuracy, MIN_GEOLOCATION_ACCURACY_METERS),
            MAX_GEOLOCATION_ACCURACY_METERS
        )
    };
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
        webgl: getWebglProfile(platformProfile),
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

        // Real native functions stringify to "function name() { [native code] }".
        // Every override below (permissions.query, Notification.requestPermission,
        // Intl.DateTimeFormat, resolvedOptions, WebGL getParameter) replaces a
        // native API with plain JS, so .toString() - and the harder-to-spoof
        // Function.prototype.toString.call(fn) - would otherwise leak real JS
        // source instead of the native stub. That mismatch is one of the most
        // common ways fingerprinting scripts (FingerprintJS, CreepJS, etc.)
        // unmask patched APIs. Cloak each override here so both call styles
        // report back as native. Patching Function.prototype.toString itself
        // (rather than each function's own .toString) also covers
        // Function.prototype.toString.call(fn), and safely layers on top of
        // whatever puppeteer-extra-plugin-stealth already did to it, since
        // uncloaked functions fall through to whatever was there before.
        const nativeToStringMap = new WeakMap();
        const originalFunctionToString = Function.prototype.toString;
        const cloakAsNative = (fn, nativeName) => {
            try {
                nativeToStringMap.set(fn, `function ${nativeName}() { [native code] }`);
            } catch (_) {}
            return fn;
        };
        try {
            const toStringProxy = new Proxy(originalFunctionToString, {
                apply(target, thisArg, args) {
                    if (nativeToStringMap.has(thisArg)) {
                        return nativeToStringMap.get(thisArg);
                    }
                    return Reflect.apply(target, thisArg, args);
                }
            });
            cloakAsNative(toStringProxy, 'toString');
            Function.prototype.toString = toStringProxy;
        } catch (_) {}

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
            const patchedGetParameter = function getParameter(parameter) {
                if (parameter === 37445) return webgl.vendor;
                if (parameter === 37446) return webgl.renderer;
                return originalGetParameter.call(this, parameter);
            };
            Context.prototype.getParameter = cloakAsNative(patchedGetParameter, 'getParameter');
        };
        patchWebGL(window.WebGLRenderingContext);
        patchWebGL(window.WebGL2RenderingContext);

        const originalPermissionsQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (originalPermissionsQuery) {
            const patchedQuery = (parameters) => {
                const name = parameters?.name;
                if (name && Object.prototype.hasOwnProperty.call(permissions, name)) {
                    return Promise.resolve({ state: permissions[name], onchange: null });
                }
                return originalPermissionsQuery(parameters);
            };
            navigator.permissions.query = cloakAsNative(patchedQuery, 'query');
        }

        if (typeof Notification !== 'undefined' && Notification.requestPermission) {
            const patchedRequestPermission = () => Promise.resolve(permissions.notifications);
            Notification.requestPermission = cloakAsNative(patchedRequestPermission, 'requestPermission');
        }

        window.chrome = window.chrome || {};
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.app = window.chrome.app || { isInstalled: false };

        const OriginalDateTimeFormat = Intl.DateTimeFormat;
        const PatchedDateTimeFormat = function DateTimeFormat(locales, options) {
            const opts = options ? { ...options } : {};
            if (!opts.timeZone) opts.timeZone = timezone;
            return new OriginalDateTimeFormat(locales, opts);
        };
        cloakAsNative(PatchedDateTimeFormat, 'DateTimeFormat');
        PatchedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
        PatchedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf;
        Intl.DateTimeFormat = PatchedDateTimeFormat;

        const originalResolvedOptions = OriginalDateTimeFormat.prototype.resolvedOptions;
        const patchedResolvedOptions = function resolvedOptions() {
            const result = originalResolvedOptions.call(this);
            return { ...result, timeZone: timezone };
        };
        OriginalDateTimeFormat.prototype.resolvedOptions = cloakAsNative(patchedResolvedOptions, 'resolvedOptions');
    }, profile);
};

// page.evaluateOnNewDocument() ADDS a script rather than replacing one, so
// calling registerBrowserRealism() repeatedly on the same page would stack
// up duplicate copies of the same patch (harmless individually, but wasteful
// and it'd nest the Function.prototype.toString cloaking Proxy deeper each
// time). Track which page objects already have it registered so
// setupPageRealism() is safe to call again - which it needs to be, since
// overrides applied once in createSession were found not to reliably survive
// to whatever page object a later /goto call resolves (browser.pages()[0] in
// a separate request doesn't always turn out to be a page with the earlier
// CDP-level overrides intact). The rest of setupPageRealism (UA, viewport,
// timezone, headers) is naturally idempotent and safe to redo every time.
const pagesWithRealismRegistered = new WeakSet();

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

    if (!pagesWithRealismRegistered.has(page)) {
        await registerBrowserRealism(page, browserProfile);
        pagesWithRealismRegistered.add(page);
    }
};

module.exports = {
    BROWSER_ARGS,
    USER_AGENTS,
    getRandomUserAgent,
    detectPlatformFromUA,
    isChromeUserAgent,
    parseChromeVersionFromUA,
    buildChromeClientHints,
    applyChromeIdentity,
    buildConsistentHeaders,
    LOCALE_TIMEZONE_DEFAULTS,
    WEBGL_PROFILES,
    getWebglProfile,
    resolveSessionTimezone,
    MIN_GEOLOCATION_ACCURACY_METERS,
    MAX_GEOLOCATION_ACCURACY_METERS,
    sanitizeGeolocation,
    buildBrowserProfile,
    registerBrowserRealism,
    setupPageRealism
};
