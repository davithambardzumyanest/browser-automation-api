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
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    // Deliberately no --window-size/--start-maximized here: createSession.js
    // decides between them based on whether the caller asked for a specific
    // window size (see the comment there). --start-maximized silently wins
    // over --window-size regardless of argv order - Chrome maximizes to the
    // real host screen resolution and ignores the requested size entirely -
    // so unconditionally setting both here meant every non-headless session
    // requesting a custom width/height got a real on-screen window that
    // didn't match it, while the spoofed viewport/screen/window.outerWidth
    // all still claimed the requested size.
    // Deliberately no --disable-notifications: that flag doesn't just
    // auto-deny permission prompts, it removes the `window.Notification`
    // global entirely - a real, unmodified Chrome always has it defined
    // (even for a user who's denied every notification prompt they've
    // ever seen). Confirmed 2026-08-24 via bot.sannysoft.com's
    // "Permissions (New)" check: `typeof Notification === 'undefined'`
    // with this flag present, on a host with a real, running desktop
    // notification service (org.freedesktop.Notifications on D-Bus) that
    // Chrome would otherwise have used. Permission behavior is already
    // fully controlled at the JS layer instead - see
    // `navigator.permissions.query`'s 'notifications' handling and
    // `Notification.requestPermission` below, plus stealth's own
    // `Notification.permission` evasion - so the launch flag was
    // redundant on top of being the thing creating the detectable gap.
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

// Android's UA string contains the literal "Linux" ("Mozilla/5.0 (Linux;
// Android 14; Pixel 8) ...") and iOS's contains "Mac OS X" ("... (iPhone; CPU
// iPhone OS 16_3 like Mac OS X) ..."), so the mobile checks MUST come before
// the desktop ones. Before they existed, every mobile session fell through to
// the desktop Linux/macOS branch and inherited a desktop identity end to end:
// an Android-UA session advertised sec-ch-ua-platform: "Linux" on the wire,
// navigator.platform "Linux x86_64", and a desktop Intel/Mesa WebGL renderer,
// while simultaneously emulating a 412x915 touchscreen at DPR 2.625 and
// sending a "Mobile Safari" UA. See ANTI_DETECTION_TROUBLESHOOTING.md #20.
//
// `mobile` here is the single source of truth for everything downstream that
// has to agree about it: the Sec-CH-UA-Mobile request header, the
// userAgentMetadata handed to page.setUserAgent() (which is what Chrome
// derives its own client hints from), and navigator.userAgentData's `mobile`
// field. All three used to be independently hardcoded to the desktop value.
const parseAndroidModel = (ua) => {
    // "(Linux; Android 14; Pixel 8)" -> "Pixel 8"
    // "(Linux; Android 13; SM-S918B Build/TP1A.220624.014)" -> "SM-S918B"
    const match = String(ua).match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/[^)]*)?\)/);
    return match ? match[1].trim() : '';
};

const parseAndroidVersion = (ua) => {
    const match = String(ua).match(/Android\s+([\d.]+)/);
    if (!match) return '14.0.0';
    // Sec-CH-UA-Platform-Version is always major.minor.patch; Android UAs
    // usually carry only the major ("Android 14").
    const parts = match[1].split('.');
    while (parts.length < 3) parts.push('0');
    return parts.slice(0, 3).join('.');
};

const parseIosVersion = (ua) => {
    const match = String(ua).match(/OS\s+(\d+)[._](\d+)(?:[._](\d+))?\s+like Mac OS X/);
    if (!match) return '16.0.0';
    return `${match[1]}.${match[2]}.${match[3] || '0'}`;
};

const detectPlatformFromUA = (ua = '') => {
    const input = String(ua);
    if (/Android/i.test(input)) {
        return {
            secChUaPlatform: '"Android"',
            secChUaPlatformVersion: `"${parseAndroidVersion(input)}"`,
            // Real Android Chrome reports "Linux armv8l" here even on 64-bit
            // ARM devices - it does not expose aarch64/x86_64 to the web.
            navigatorPlatform: 'Linux armv8l',
            osCpu: 'Linux armv8l',
            mobile: true,
            model: parseAndroidModel(input)
        };
    }
    if (/iPhone|iPod/.test(input)) {
        return {
            secChUaPlatform: '"iOS"',
            secChUaPlatformVersion: `"${parseIosVersion(input)}"`,
            navigatorPlatform: 'iPhone',
            osCpu: 'iPhone',
            mobile: true,
            model: 'iPhone'
        };
    }
    if (/iPad/.test(input)) {
        return {
            secChUaPlatform: '"iOS"',
            secChUaPlatformVersion: `"${parseIosVersion(input)}"`,
            // iPadOS 13+ deliberately reports the desktop Mac value here -
            // this is real Safari behavior, not a mistake.
            navigatorPlatform: 'MacIntel',
            osCpu: 'iPad',
            mobile: true,
            model: 'iPad'
        };
    }
    if (input.includes('Windows')) {
        return {
            secChUaPlatform: '"Windows"',
            secChUaPlatformVersion: '"15.0.0"',
            navigatorPlatform: 'Win32',
            osCpu: 'Windows NT 10.0; Win64; x64',
            mobile: false,
            model: ''
        };
    }
    if (input.includes('Macintosh') || input.includes('Mac OS X')) {
        return {
            secChUaPlatform: '"macOS"',
            secChUaPlatformVersion: '"14.0.0"',
            navigatorPlatform: 'MacIntel',
            osCpu: 'Intel Mac OS X 10_15_7',
            mobile: false,
            model: ''
        };
    }
    if (input.includes('Linux')) {
        return {
            secChUaPlatform: '"Linux"',
            secChUaPlatformVersion: '"6.0.0"',
            navigatorPlatform: 'Linux x86_64',
            osCpu: 'Linux x86_64',
            mobile: false,
            model: ''
        };
    }
    return {
        secChUaPlatform: '"Windows"',
        secChUaPlatformVersion: '"15.0.0"',
        navigatorPlatform: 'Win32',
        osCpu: 'Windows NT 10.0; Win64; x64',
        mobile: false,
        model: ''
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

    // Was hardcoded to the desktop x86/64/non-mobile triple for every
    // session. Chrome derives the Sec-CH-UA-Mobile header and
    // navigator.userAgentData from exactly this object, so on a mobile
    // session it was the direct source of the "Mobile Safari UA + touch
    // viewport, but sec-ch-ua-mobile: ?0 and userAgentData.mobile === false"
    // contradiction (see ANTI_DETECTION_TROUBLESHOOTING.md #20). Real Chrome
    // on Android sends architecture "" and bitness "" (it declines to report
    // them at all on mobile) and populates `model` with the device name -
    // reporting "x86"/"64"/"" there is itself a desktop tell.
    const mobile = Boolean(platformProfile.mobile);
    const architecture = mobile ? '' : 'x86';
    const bitness = mobile ? '' : '64';

    return {
        major,
        full,
        brands,
        fullVersionList,
        mobile,
        secChUa: brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
        secChUaMobile: mobile ? '?1' : '?0',
        secChUaFullVersionList: fullVersionList.map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
        userAgentMetadata: {
            brands,
            fullVersion: full,
            platform: platformName,
            platformVersion,
            architecture,
            model: platformProfile.model || '',
            mobile,
            bitness
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
// Single source of truth for "what languages does this session prefer, in
// order" - used to build BOTH the Accept-Language header and
// navigator.languages (see registerBrowserRealism) so they can never
// diverge. Previously each was a separately hardcoded template that not only
// each produced their own bugs (see below) but never matched each other for
// any locale - navigator.languages always included an "en-US" fallback tier
// the Accept-Language header never had, an easy JS-vs-wire cross-check for
// a fingerprinting script to catch. Deduped so an English-based locale
// (en-US, en-GB, ...) doesn't list "en" twice - the previous hardcoded
// templates did exactly that for both the header
// ("en-US,en;q=0.9,en;q=0.8" - the same tag twice with two different,
// contradictory quality values) and navigator.languages
// (["en-US","en","en-US","en"]), neither of which any real browser would
// ever produce.
const buildPreferredLanguages = (locale) => {
    const normalizedLocale = String(locale || 'en-US');
    const languageCode = normalizedLocale.split('-')[0];
    const langs = [normalizedLocale];
    if (languageCode !== normalizedLocale) langs.push(languageCode);
    if (languageCode !== 'en') langs.push('en');
    return [...new Set(langs)];
};

// accept-language used to be force-set here via CDP on every request. Not
// anymore: the --lang/--accept-lang launch flags (built from this same
// buildPreferredLanguages list, see createSession.js) already make Chrome
// generate the identical header natively - confirmed directly (a page with
// only those launch flags and NO setExtraHTTPHeaders call produced the exact
// same "en-US,en;q=0.9"). Forcing it via CDP was pure redundancy, and every
// CDP-forced header is itself a minor surface (casing/ordering can differ
// from native generation - see the note that used to be here). So this now
// only carries the caller's own explicit customHeaders, if any; setupPageRealism
// skips calling setExtraHTTPHeaders entirely when there's nothing to set.
const buildConsistentHeaders = ({ customHeaders = {} }) => {
    return { ...customHeaders };
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
    },
    // Android UAs used to fall through detectPlatformFromUA's desktop "Linux"
    // branch and inherit the Mesa/Intel desktop renderer above - a discrete
    // desktop GPU on a phone, contradicting the UA, the touch emulation and
    // the DPR all at once. Chrome on Android renders through ANGLE over
    // OpenGL ES, so both the backend and the GPU family differ from any
    // desktop string. Default is the Qualcomm Adreno line (the most common
    // Android GPU by a wide margin); see getWebglProfile for the per-model
    // override that keeps Pixel/Tensor devices on ARM Mali instead.
    '"Android"': {
        vendor: 'Google Inc. (Qualcomm)',
        renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)'
    },
    // Safari on iOS exposes only these two coarse values through
    // WEBGL_debug_renderer_info - it does not report a specific GPU model.
    '"iOS"': {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU'
    }
};

// Google's Tensor SoCs (Pixel 6 and newer) use ARM Mali, not Adreno; every
// other mainstream Android flagship in this pool is Adreno. Keyed off the
// model parsed out of the UA so the GPU string can't contradict the device
// name the same UA advertises.
const ANDROID_WEBGL_OVERRIDES = [
    {
        match: /Pixel\s*([6-9]|1\d)/i,
        profile: {
            vendor: 'Google Inc. (ARM)',
            renderer: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)'
        }
    }
];

const getWebglProfile = (platformProfile) => {
    if (platformProfile?.secChUaPlatform === '"Android"' && platformProfile.model) {
        const override = ANDROID_WEBGL_OVERRIDES.find((entry) => entry.match.test(platformProfile.model));
        if (override) return override.profile;
    }
    return WEBGL_PROFILES[platformProfile?.secChUaPlatform] || WEBGL_PROFILES['"Windows"'];
};

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
    isMobile = false,
    hasTouch = false,
    geolocation,
    // Optional bundle from deviceProfiles.js (webgl/hardwareConcurrency/
    // deviceMemory/screen), consistently matched to the platform - used
    // whenever the caller didn't supply a custom userAgent. Falls back to
    // the old per-platform-only WebGL lookup and hardcoded 8/8 hardware
    // when a custom UA was given (no bundle exists for an arbitrary UA).
    deviceProfile = null
}) => {
    const languageCode = String(locale || 'en-US').split('-')[0];
    const resolvedTimezone = resolveSessionTimezone(locale, timezone, geolocation);
    const viewportWidth = width || 1920;
    const viewportHeight = height || 1080;
    // Desktop Chrome's window is taller than its viewport by roughly the
    // tab strip + omnibox. On mobile there is no such separate window chrome
    // in this sense, and outerHeight tracks innerHeight - the flat +88 was
    // claiming a browser window 88px TALLER THAN THE ENTIRE SCREEN on a
    // 412x915 phone profile, which is impossible on a real device.
    const chromeUiHeight = isMobile ? 0 : 88;

    // A real screen is never smaller than the browser's own viewport - a
    // 1920x1080 window can't fit on a 1366x768 monitor. Previously screen
    // dimensions were just set equal to the viewport every time, which is
    // itself unrealistic (a real user's actual monitor resolution is
    // typically larger than whatever window size the browser happens to be
    // using, since browser chrome/taskbars eat into it). Use the device
    // profile's screen size when it's big enough for the requested
    // viewport; otherwise fall back to viewport-sized (never claim a screen
    // smaller than what's supposedly rendering on it).
    const screenWidth = Math.max(deviceProfile?.screen?.width || 0, viewportWidth);
    const screenHeight = Math.max(deviceProfile?.screen?.height || 0, viewportHeight);

    return {
        locale,
        languageCode,
        preferredLanguages: buildPreferredLanguages(locale),
        timezone: resolvedTimezone,
        userAgent,
        platformProfile,
        chromeProfile: chromeHints,
        viewport: {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor,
            isMobile,
            hasTouch
        },
        screen: {
            width: screenWidth,
            height: screenHeight,
            availWidth: screenWidth,
            // The 40px deduction models a desktop taskbar/dock; phones have
            // no such reserved strip and report availHeight === height.
            availHeight: isMobile ? screenHeight : Math.max(screenHeight - 40, viewportHeight),
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
        webgl: deviceProfile?.webgl || getWebglProfile(platformProfile),
        hardware: {
            hardwareConcurrency: deviceProfile?.hardwareConcurrency ?? 8,
            deviceMemory: deviceProfile?.deviceMemory ?? 8,
            // Was hardcoded to 0 regardless of hasTouch - a touch-capable
            // profile (mobile UA + hasTouch:true) reporting zero touch
            // points is an easy, static (no navigation needed) tell. 5
            // matches real iOS/Android devices' typical value.
            maxTouchPoints: hasTouch ? 5 : 0
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
            preferredLanguages,
            timezone,
            platformProfile,
            chromeProfile,
            screen: screenMetrics,
            window: windowMetrics,
            webgl,
            hardware,
            permissions
        } = browserProfile;

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

        // Real accessor properties stringify their getter as
        // "function get <name>() { [native code] }" - every defineGetter
        // call below installs a plain arrow function instead, which
        // Object.getOwnPropertyDescriptor(navigator, prop).get.toString()
        // would otherwise expose as real JS source (this was missed when
        // toString cloaking was first added - only the fully-replaced
        // functions further down, like permissions.query, got it).
        //
        // CRITICAL: these must be defined on the INTERFACE PROTOTYPE
        // (Navigator.prototype / Screen.prototype), never on the `navigator`
        // or `screen` instance. Every one of these attributes is a WebIDL
        // accessor that lives on the prototype in a real browser, so a real
        // Chrome answers `Object.getOwnPropertyNames(navigator)` with an
        // EMPTY array (verified directly against this project's own Chrome
        // binary with no patches applied). Defining them on the instance
        // instead - which is what this code used to do for all twelve
        // navigator properties and all six screen properties - left an own-
        // property list that named, in order, precisely the values being
        // spoofed. That is a single-expression, zero-network, unspoofable-
        // by-accident tell, and it is the exact bug entry #18 already
        // identified and fixed for `navigator.webdriver` alone without
        // noticing that every other override on this page had it too. See
        // ANTI_DETECTION_TROUBLESHOOTING.md #21.
        //
        // The real descriptors are {get, set: undefined, enumerable: true,
        // configurable: true}; the previous helper produced enumerable:
        // false, which is itself a mismatch a check can read off the
        // descriptor. Reuse the original descriptor's `set` and
        // `enumerable` so the replacement is shaped exactly like what it
        // replaces - `window`'s own properties, which legitimately ARE own
        // properties on the global object, keep their real setters this way
        // instead of silently becoming read-only.
        const redefineAccessor = (target, prop, getter) => {
            try {
                const existing = Object.getOwnPropertyDescriptor(target, prop);
                Object.defineProperty(target, prop, {
                    get: cloakAsNative(getter, `get ${prop}`),
                    set: existing && existing.set ? existing.set : undefined,
                    enumerable: existing ? existing.enumerable : true,
                    configurable: true
                });
            } catch (_) {}
        };
        const defineGetter = (obj, prop, getter) => {
            // Route instance targets to the interface prototype that really
            // owns the attribute; anything else (window) is defined in place.
            if (obj === navigator) return redefineAccessor(Navigator.prototype, prop, getter);
            if (obj === screen) return redefineAccessor(Screen.prototype, prop, getter);
            return redefineAccessor(obj, prop, getter);
        };

        // No navigator.webdriver override here - deliberately. Chrome 88+
        // already reports `false` natively once `--disable-blink-features=
        // AutomationControlled` is set (which this project already does at
        // launch), and puppeteer-extra-plugin-stealth's own dedicated
        // navigator.webdriver evasion (already active, see helpers/
        // puppeteer.js) confirms exactly this and no-ops for exactly that
        // reason. Adding a getter here anyway - even one that also returns
        // `false` - creates an *own property* on the `navigator` instance
        // that a real, non-automated Chrome never has (native `webdriver`
        // lives on `Navigator.prototype`, not the instance). Confirmed
        // 2026-08-24 via bot.sannysoft.com's "WebDriver (New)" check, which
        // failed with exactly this getter present and passes without it -
        // the override was actively creating the detectable signal it was
        // trying to hide.
        defineGetter(navigator, 'language', () => locale);
        // Same ordered list the Accept-Language header is built from (see
        // buildPreferredLanguages) - previously this was a separate hardcoded
        // array that both had its own duplicate-entry bug for English locales
        // and never matched the header's language list for any locale.
        defineGetter(navigator, 'languages', () => preferredLanguages);
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

        // mobile/architecture/bitness/model used to be hardcoded to the
        // desktop values right here, independently of (and so free to
        // contradict) both the UA string and the Sec-CH-UA-Mobile header on
        // the wire. They all now come from the one userAgentMetadata object
        // that Chrome itself was handed via page.setUserAgent(), so the JS
        // view and the wire view cannot diverge. See
        // ANTI_DETECTION_TROUBLESHOOTING.md #20.
        if ('userAgentData' in navigator && chromeProfile) {
            const meta = chromeProfile.userAgentMetadata;
            defineGetter(navigator, 'userAgentData', () => ({
                brands: chromeProfile.brands,
                mobile: meta.mobile,
                platform: meta.platform,
                getHighEntropyValues: async () => ({
                    architecture: meta.architecture,
                    bitness: meta.bitness,
                    brands: chromeProfile.brands,
                    mobile: meta.mobile,
                    model: meta.model,
                    platform: meta.platform,
                    platformVersion: meta.platformVersion,
                    uaFullVersion: chromeProfile.full,
                    fullVersionList: chromeProfile.fullVersionList
                })
            }));
        } else if ('userAgentData' in navigator && !chromeProfile) {
            // Non-Chrome UA (a Safari/iOS string) running on a Chrome binary:
            // navigator.userAgentData is a Chromium-only API that Safari does
            // not implement at all. Leaving Chrome's real one in place meant
            // an "iPhone ... Safari/604.1" session still answered
            // navigator.userAgentData.brands with "Google Chrome" and
            // .platform with the host's real OS - a one-line, no-network
            // contradiction of its own UA. Remove the whole surface so the
            // session looks like what it claims to be.
            //
            // This narrows the gap but does not close it: a Chrome binary
            // wearing a Safari UA still differs from real Safari in JS engine
            // features and TLS fingerprint, neither of which is reachable
            // from here. Prefer an Android *Chrome* UA for mobile sessions.
            try {
                delete Navigator.prototype.userAgentData;
            } catch (_) {}
            try {
                if ('userAgentData' in navigator) delete navigator.userAgentData;
            } catch (_) {}
        }

        // navigator.connection intentionally left native (no override): the
        // previous hardcoded {downlink:10, effectiveType:'4g', rtt:50} meant
        // every single session, regardless of real network/proxy conditions,
        // reported the exact same network stats - a "too consistent across a
        // fleet" signal with no offsetting benefit, since Chrome's real
        // NetworkInformation API already reflects actual conditions on its own.

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

        // PermissionStatus.state only ever has three valid values: 'granted',
        // 'denied', 'prompt' - 'default' is a Notification.permission value,
        // never a valid permissions.query() result. `permissions.notifications`
        // is 'default' (matching the Notification.permission convention, used
        // as-is below for Notification.requestPermission()), so it needs
        // translating here specifically - returning state:'default' from
        // query() is a value no real browser can ever produce, an instant
        // tell. Confirmed 2026-08-24 via bot.sannysoft.com's "Permissions
        // (New)" check, which failed showing exactly this invalid value.
        const toPermissionState = (name, value) =>
            name === 'notifications' && value === 'default' ? 'prompt' : value;
        // Assigning to navigator.permissions.query would create an own
        // property on the Permissions instance, which a real browser never
        // has (query lives on Permissions.prototype) - the same own-property
        // tell described above for navigator/screen. Patch the prototype.
        const originalPermissionsQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (originalPermissionsQuery && typeof Permissions !== 'undefined') {
            const patchedQuery = function query(parameters) {
                const name = parameters?.name;
                if (name && Object.prototype.hasOwnProperty.call(permissions, name)) {
                    return Promise.resolve({ state: toPermissionState(name, permissions[name]), onchange: null });
                }
                return originalPermissionsQuery(parameters);
            };
            try {
                Object.defineProperty(Permissions.prototype, 'query', {
                    value: cloakAsNative(patchedQuery, 'query'),
                    writable: true,
                    enumerable: true,
                    configurable: true
                });
            } catch (_) {}
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
        // Was hardcoded false here regardless of what createSession.js set
        // at launch - since this runs again before every navigation (see
        // comment above setupPageRealism), a mobile session's isMobile/
        // hasTouch got silently reverted to desktop on the very first
        // /goto after creation. See ANTI_DETECTION_TROUBLESHOOTING.md #16.
        isMobile: browserProfile.viewport.isMobile || false,
        hasTouch: browserProfile.viewport.hasTouch || false,
        isLandscape: browserProfile.viewport.width > browserProfile.viewport.height
    });

    try {
        await page.emulateTimezone(browserProfile.timezone);
    } catch (tzError) {
        console.warn(`Failed to set timezone "${browserProfile.timezone}":`, tzError.message);
    }

    // Skip the CDP call entirely when there's nothing to set - an empty-object
    // Network.setExtraHTTPHeaders call still establishes a CDP override in
    // place of Chrome's native per-request header generation, for zero
    // benefit, once accept-language stopped needing to be forced (see
    // buildConsistentHeaders).
    if (requestHeaders && Object.keys(requestHeaders).length > 0) {
        await page.setExtraHTTPHeaders(requestHeaders);
    }

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
    buildPreferredLanguages,
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
