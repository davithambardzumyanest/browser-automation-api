// reCAPTCHA + 2Captcha extension integration: sitekey extraction, token
// injection, 2Captcha HTTP API polling, config diagnostics, and Google's
// cookie-consent dialog handling (used by validateGoogle).
const axios = require('axios');
const { wait } = require('./timing');

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

module.exports = {
    configure2CaptchaDirectly,
    validate2CaptchaConfig,
    diagnose2Captcha,
    extractRecaptchaInfo,
    injectRecaptchaToken,
    solveRecaptchaWith2Captcha,
    generateRecommendations,
    acceptGoogleCookies
};
