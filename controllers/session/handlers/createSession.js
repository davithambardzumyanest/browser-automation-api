const { Stagehand } = require('@browserbasehq/stagehand');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const puppeteer = require('../helpers/puppeteer');
const { cleanupStaleProfileLocks } = require('../../../utils/browserProfile');
const { sessions } = require('../state');
const { closeSession } = require('./closeSession');
const { wait } = require('../helpers/timing');
const {
    BROWSER_ARGS,
    detectPlatformFromUA,
    isChromeUserAgent,
    buildChromeClientHints,
    buildPreferredLanguages,
    resolveSessionTimezone,
    buildBrowserProfile,
    buildConsistentHeaders,
    setupPageRealism,
    sanitizeGeolocation
} = require('../helpers/browserFingerprint');
const { getRandomDeviceProfile } = require('../helpers/deviceProfiles');
const { attachDialogGuard } = require('../helpers/dialogs');
const { getProxyCredentials, stripProxyCredentials, applyProxyAuth } = require('../helpers/proxyAuth');
const { installProtocolGuard, DEFAULT_BLOCKED_SCHEMES } = require('./dismissProtocolDialog');
const { detectProxyGeo } = require('../helpers/geoip');

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
    const body = req.body || {};
    const {
        headless = defaultHeadless,
        width = 1920,
        height = 1080,
        userAgent,
        headers: headersParam,
        userDataDir,
        profileId,
        proxy,
        slowMo = defaultSlowMo,
        devtools = defaultDevtools,
        stealth = true,
        // Defaulting this to false used to mean every session, unless a
        // caller explicitly opted in, never downloaded a single image or
        // font - blocked twice over (--blink-settings=imagesEnabled=false at
        // the render layer, plus request.abort() at the network layer below).
        // A real browser always loads these; Google's servers see the HTML/
        // CSS/JS requests come in and then literally zero requests ever
        // arrive for the dozens of image/font URLs referenced inside them -
        // a structural anomaly no header tuning touches, and it also means
        // all text renders in a fallback system font instead of the page's
        // real web font (affects canvas-based text-rendering fingerprints
        // too). Defaults to loading media now, matching real browsing;
        // callers that specifically want the bandwidth/speed tradeoff for a
        // non-detection-sensitive use case can still pass allowMedia:false.
        allowMedia = true,
        geolocation,
        geolocationOrigin,
        geolocationOrigins,
        grantGeolocationOnNavigation = true,
        deviceScaleFactor = 1,
        persistSession = false,
        // Javascript dialogs freeze the renderer until something closes them,
        // so every page gets a guard by default - see helpers/dialogs.js.
        // blockDialogs:false restores the raw behavior (a dialog then blocks
        // every subsequent action on that page).
        blockDialogs = true,
        // What confirm/prompt dialogs should answer. alert and beforeunload
        // are always accepted regardless.
        dialogAction = 'dismiss',
        // Chrome's native "Open <app>?" external-protocol dialog (intent://,
        // android-app://, market:// ...). Off by default, unlike blockDialogs:
        // this dialog does NOT freeze the renderer - CDP input bypasses browser
        // UI entirely, so a run keeps working with one on screen - and the guard
        // patches window.open/Location.assign, which is a fingerprinting surface
        // not worth adding to every session. Turn it on for headful runs against
        // sites that push a mobile app (Google Maps on an Android UA).
        blockExternalProtocols = false,
    } = body;

    let locale = body.locale ?? 'en-US';
    let timezone = body.timezone;

    // Auto-derive locale/timezone from the proxy's actual egress location
    // when the caller didn't explicitly pin either and didn't already
    // supply geolocation.timezone. A static per-locale default (or whatever
    // locale happened to be requested) has no idea what country THIS
    // specific proxy/session actually exits from - trusting it is exactly
    // the kind of mismatch (IP says one place, everything else says
    // another) that got a session flagged earlier in this investigation.
    // Never overrides an explicit caller choice, and never fails session
    // creation if the lookup is slow/unavailable - just falls through to
    // the existing defaults below.
    if (proxy && body.locale === undefined && body.timezone === undefined && !geolocation?.timezone) {
        const proxyGeo = await detectProxyGeo(proxy);
        if (proxyGeo) {
            if (proxyGeo.locale) locale = proxyGeo.locale;
            if (proxyGeo.timezone) timezone = proxyGeo.timezone;
            console.log(`Auto-detected proxy geo (${proxyGeo.countryCode}): locale=${locale}, timezone=${timezone || '(default)'}`);
        }
    }

    // Device identity: when the caller supplies a custom userAgent, keep the
    // old behavior of deriving platform/WebGL from that string alone (no
    // bundle exists for an arbitrary UA). Otherwise pick a full, internally-
    // consistent device profile (UA + WebGL + hardwareConcurrency +
    // deviceMemory + screen resolution together) instead of randomizing the
    // UA independently of everything else - see deviceProfiles.js for why.
    let deviceProfile = null;
    let finalUserAgent = userAgent;
    if (!finalUserAgent) {
        deviceProfile = getRandomDeviceProfile();
        finalUserAgent = deviceProfile.userAgent;
    }
    const platformProfile = deviceProfile?.platformProfile || detectPlatformFromUA(finalUserAgent);
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
        geolocation,
        deviceProfile
    });
    console.log(width)
    console.log(height)
    const headers = buildConsistentHeaders({ customHeaders: headersParam });

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
            `--lang=${locale}`,
            // Belt-and-suspenders alongside the runtime page.setUserAgent()
            // CDP override: baking the UA in at launch means it's never at
            // the mercy of interception/tab-resolution timing later - see the
            // note by identityHeaders below for why the runtime-only override
            // wasn't reliably reaching the wire.
            `--user-agent=${finalUserAgent}`
        );
        // For non-headless mode (visible browser), optimize args for visibility
        if (!headless) {
            // Remove args that are only needed for headless mode
            launchOptions.args = launchOptions.args.filter(arg =>
                !arg.includes('--disable-gpu') &&
                !arg.includes('--no-zygote')
            );

            // --start-maximized silently wins over --window-size regardless of
            // argv order - Chrome maximizes to the real host screen resolution
            // and ignores whatever size was requested. Only maximize when the
            // caller didn't ask for a specific size (nicer default for
            // interactive/dev use); otherwise the explicit --window-size push
            // further down must actually be honored, or every spoofed
            // viewport/screen/window.outerWidth value is claiming a size the
            // real on-screen window doesn't have.
            if (body.width === undefined && body.height === undefined) {
                launchOptions.args.push('--start-maximized');
            }
        }

        // Add proxy configuration if specified. Credentials never belong in
        // --proxy-server (Chrome ignores them there, and the proxy then answers
        // 407 for every request); they are registered per page with
        // page.authenticate() instead - see helpers/proxyAuth.js.
        if (proxy) {
            if (typeof proxy === 'string') {
                // Simple proxy string: "http://host:port", optionally
                // "http://user:pass@host:port".
                launchOptions.args.push(`--proxy-server=${stripProxyCredentials(proxy)}`);
            } else if (typeof proxy === 'object') {
                // Proxy object with server and optional auth
                if (proxy.server) {
                    launchOptions.args.push(`--proxy-server=${stripProxyCredentials(proxy.server)}`);
                }
            }
        }

        // Set up user data directory
        let ephemeralProfileDir = null;
        if (profileId) {
            // Use profile-based directory if profileId is provided
            const profileDir = `./profiles/account_${profileId}`;
            launchOptions.userDataDir = profileDir;

            // Ensure the directory exists
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
        } else {
            // No profile requested: give this session its own throwaway directory
            // instead of leaving userDataDir unset. Google (and most fraud
            // engines) fingerprint the profile itself - cookies, localStorage,
            // IndexedDB, Google's own device/session cookies - not just the
            // network layer. Relying on Puppeteer's implicit default keeps
            // sessions isolated in practice, but making it explicit here means
            // it's guaranteed and we control cleanup, so no two "no profile"
            // sessions can ever end up sharing a directory (and therefore
            // cookies/device identity) across different proxies/IPs.
            launchOptions.userDataDir = `./sessions/ephemeral-${sessionId}`;
            ephemeralProfileDir = launchOptions.userDataDir;
        }

        if (launchOptions.userDataDir) {
            cleanupStaleProfileLocks(launchOptions.userDataDir);
        }

        // --accept-lang built from the same list as the Accept-Language header
        // and navigator.languages (see buildPreferredLanguages) rather than its
        // own hardcoded template - which for any English-based locale used to
        // produce "en-US,en,en" (the same tag twice). --lang was already
        // pushed above; not repeated here.
        launchOptions.args.push(
            `--accept-lang=${buildPreferredLanguages(locale).join(',')}`
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
            // Keep this as the single --disable-features list. Puppeteer
            // merges every --disable-features= arg it is given into one flag
            // (ChromeLauncher.defaultArgs -> getFeatures), so a second push
            // would survive, but raw Chrome keeps only the last occurrence -
            // one list stays correct either way.
            // ExternalProtocolDialog: requested for google.com/maps, which
            // hands off to external protocol handlers (maps:/intent:) and can
            // raise a native "Open in another app?" modal. NOTE: this is not a
            // registered Chrome feature name (141 only ships
            // ExternalProtocolDialogShowAlwaysOpenCheckbox) and unknown names
            // are silently ignored, so it is inert - see docs/directories.
            '--disable-features=IsolateOrigins,site-per-process,ExternalProtocolDialog',
            `--window-size=${viewportWidth},${viewportHeight}`,
        );

        // Deliberately launching Puppeteer's bundled Chromium here rather than
        // a real installed Google Chrome (previously done via
        // `launchOptions.channel = 'chrome'`). Official Google Chrome builds
        // carry proprietary Google integration that open-source Chromium
        // doesn't have - notably the X-Client-Data header (Chrome's
        // variations/field-trial system, gated behind an embedded official
        // Google API key) sent on every request to *.google.com, plus its
        // own Safe Browsing/telemetry channels. That's a signal Google's own
        // servers read directly, independent of any proxy/UA/fingerprint
        // spoofing done elsewhere in this file - and unlike userDataDir, nothing
        // here guarantees it's fresh per session. Bundled Chromium has no
        // official API key, so it doesn't participate in that channel at all.
        // Confirmed empirically: switching off the real-Chrome channel made
        // the reCAPTCHA challenge stop appearing.
        const browser = await puppeteer.launch(launchOptions);
        const context = browser.defaultBrowserContext();

        // Set up realistic permissions. 'geolocation' is deliberately NOT
        // included unconditionally: this used to grant it to every https
        // origin regardless of whether a fake geolocation was configured for
        // the session. With no page.setGeolocation() override in place (that
        // only happens further below when `geolocation` is actually passed
        // in), any site could then call
        // navigator.geolocation.getCurrentPosition() and get an instant,
        // no-prompt answer using Chrome's real network-derived location -
        // leaking the real server location and contradicting the
        // timezone/locale/proxy spoofing done everywhere else (and
        // contradicting the permissions.query() patch below, which already
        // correctly reports 'prompt' when no geolocation is configured -
        // that mismatch between reported and actual permission state is
        // itself detectable). Only grant it here when this session actually
        // has a fake geolocation to serve.
        const hasFakeGeolocation = Boolean(
            geolocation &&
            typeof geolocation.latitude === 'number' &&
            typeof geolocation.longitude === 'number'
        );
        const grantedPermissions = [
            'notifications',
            'camera',
            'microphone',
            'background-sync',
            'clipboard-read',
            'clipboard-write',
            'payment-handler',
        ];
        if (hasFakeGeolocation) {
            grantedPermissions.push('geolocation');
        }
        await context.overridePermissions('https://*', grantedPermissions);

        // Chrome always creates one blank tab automatically on launch (visible
        // as browser.pages()[0]). Unconditionally calling browser.newPage()
        // here used to create a SECOND tab on top of that - leaving Chrome's
        // own raw, completely unconfigured tab sitting at index 0 while our
        // spoofed/hardened page ended up at index 1. navigateSession's "close
        // every tab except the first" logic (index 0) then closed our GOOD
        // tab and kept the BAD one, so every /goto call ran on a tab that
        // never got setupPageRealism() or any evaluateOnNewDocument spoofing
        // applied - a raw, native Chromium identity. Confirmed directly: a
        // captured request showed an unspoofed Chrome/141 UA and the generic
        // "Not?A_Brand" client-hint placeholder, neither of which this
        // codebase ever generates. Reuse Chrome's own initial tab instead of
        // adding a second one, so there's only ever one tab and no ambiguity
        // about which one is "the" tab.
        // Works for { username, password } and for credentials embedded in a
        // proxy URL string, which previously authenticated nothing at all.
        const proxyCredentials = getProxyCredentials(proxy);

        const existingPages = await browser.pages();
        const page = existingPages[0] || await browser.newPage();
        for (const extraPage of existingPages.slice(1)) {
            try { await extraPage.close(); } catch (_) {}
        }

        // Do not force Sec-Fetch-*/Upgrade-Insecure-Requests here: those are
        // per-request, browser-computed headers. Statically pinning them (this
        // used to hardcode Sec-Fetch-Site: same-origin onto every single
        // request, including the very first cross-site navigation, where a
        // real browser sends "none") is an easy, IP-independent bot signal.
        // Let Chrome's own network stack set them; only locale is forced.
        await setupPageRealism(page, browserProfile, headers);

        // Counters kept on the session so a caller can tell after the fact
        // that a page popped a dialog and what was done with it.
        const dialogStats = { handled: 0, last: null };
        if (blockDialogs) {
            attachDialogGuard(page, { action: dialogAction, stats: dialogStats });
        }

        // Register credentials before anything can navigate. The later proxy
        // block re-applies them (idempotent) and still runs its connectivity
        // check; doing it here as well means no request can race the auth
        // registration.
        await applyProxyAuth(page, proxyCredentials);

        if (blockExternalProtocols) {
            await installProtocolGuard(page, DEFAULT_BLOCKED_SCHEMES);
        }

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
                    // Popups and click-opened tabs pop dialogs too, and each
                    // page needs its own listener.
                    if (blockDialogs) {
                        attachDialogGuard(newPage, { action: dialogAction, stats: dialogStats });
                    }
                    // page.authenticate() is per page, not browser-wide. Chrome
                    // usually caches proxy credentials after the first success,
                    // but a popup that issues its first request before that (or
                    // after a credential change) would otherwise hit a 407.
                    await applyProxyAuth(newPage, proxyCredentials);
                    await setupPageRealism(newPage, browserProfile, headers);
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
                const geo = sanitizeGeolocation(geolocation);
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

        // page.setUserAgent()'s CDP-level override (Network.setUserAgentOverride)
        // does not reliably survive once request interception is active: with
        // Fetch-domain interception on, request.continue() with no explicit
        // headers resumes the request with Chromium's own raw, native
        // user-agent/client-hint headers rather than the override - confirmed
        // directly (wire-level User-Agent/Sec-CH-UA came back as
        // "HeadlessChrome/<bundled-version>" with generic brands, not our
        // spoofed values, despite setUserAgent() having been called and
        // navigator.userAgent correctly reflecting it pre-navigation). Since
        // interception has to stay on to block images/fonts, re-assert the
        // identity headers explicitly on every continued request instead.
        const identityHeaders = { 'user-agent': finalUserAgent };
        if (chromeHints) {
            identityHeaders['sec-ch-ua'] = chromeHints.secChUa;
            identityHeaders['sec-ch-ua-mobile'] = '?0';
            identityHeaders['sec-ch-ua-platform'] = platformProfile.secChUaPlatform;
        }

        // Enable request interception to block images, fonts, and stylesheets
        await page.setRequestInterception(true);
        if (!isIntercepting) {
            isIntercepting = true;
            page.on('request', async (request) => {
                try {
                    if (!allowMedia && ['image', 'font', 'media', 'imageset'].includes(request.resourceType())) {
                        await request.abort();
                    } else {
                        await request.continue({
                            headers: { ...request.headers(), ...identityHeaders }
                        });
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
            userAgent: finalUserAgent,
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
        if (proxyCredentials) {
            try {
                // Already registered above; idempotent, and kept here so the
                // connectivity check below still reports on the same block.
                await applyProxyAuth(page, proxyCredentials);

                console.log('Proxy authentication set successfully');

                // Proxy auth is handled by page.authenticate() above. There is
                // no dialog to catch here: Puppeteer's Dialog only ever has
                // type alert/confirm/prompt/beforeunload (validateDialogType in
                // puppeteer-core/lib/cjs/puppeteer/common/util.js) and exposes
                // no authenticate() method, so the old 'dialog' listener here
                // could only ever throw and fall back to dismissing. Dismissing
                // is now the dialog guard's job, for every session rather than
                // only the ones that happen to use an authenticated proxy.

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
            ephemeralProfileDir, // set when no profile/persistence was requested; removed on close
            // Kept so navigateSession (and anything else resolving a fresh
            // page/target later) can re-run setupPageRealism() - see the note
            // on setupPageRealism for why that's necessary.
            browserProfile,
            requestHeaders: finalHeaders,
            // Same reason: a page resolved later needs the dialog guard too,
            // and these carry the session's answer for what to do with one.
            blockDialogs,
            dialogAction,
            dialogStats,
            proxyCredentials,
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
                    ? sanitizeGeolocation(geolocation)
                    : null,
                geolocationOrigin: geolocationOrigin || null, // deprecated in favor of geolocationOrigins
                geolocationOrigins: geoOrigins,
                grantGeolocationOnNavigation: Boolean(grantGeolocationOnNavigation),
                timezone: resolvedTimezone,
                deviceScaleFactor,
                blockDialogs,
                dialogAction,
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

module.exports = { createSession };
