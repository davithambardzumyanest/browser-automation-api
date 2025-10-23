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
    '--disable-remote-fonts',
    '--disable-session-crashed-bubble',
    '--force-color-profile=srgb',
    '--enable-automation',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--deny-permission-prompts',
    '--disable-search-geolocation-disclosure',
    '--disable-features=site-per-process',
    '--disable-blink-features',
    '--disable-blink-features=AutomationControlled'
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
 * Create a new browser session with anti-detection measures
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createSession = async (req, res) => {
    // Use environment variables for defaults in development
    const defaultHeadless = process.env.DEFAULT_HEADLESS === 'false' ? false : true;
    const defaultSlowMo = parseInt(process.env.DEFAULT_SLOWMO || '0', 10);
    const defaultDevtools = process.env.DEFAULT_DEVTOOLS === 'true' ? true : false;

    const {
        headless = defaultHeadless,
        width = 1920,
        height = 1080,
        userAgent = getRandomUserAgent(),
        headers = {
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
        },
        userDataDir,
        locale = 'en-US',
        proxy,
        slowMo = defaultSlowMo,
        devtools = defaultDevtools,
        stealth = true
    } = req.body;

    try {
        const sessionId = uuidv4();

        // Launch browser with custom options
        const launchOptions = {
            headless: headless ? 'new' : false,
            args: [...BROWSER_ARGS],
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

        // Add user data directory if specified (for persistent cookies)
        if (userDataDir) {
            launchOptions.userDataDir = `./sessions/${sessionId}`;
        }

        // Launch browser and create page
        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

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
                    await page.goto('https://whatismyipaddress.com/', {
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

        // Add device metrics for more realistic behavior
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: true
        });

        // Merge custom headers with defaults
        const finalHeaders = { ...defaultHeaders, ...headers };
        await page.setExtraHTTPHeaders(finalHeaders);

        // Store session
        sessions.set(sessionId, {
            browser,
            page,
            created: Date.now(),
            lastUsed: Date.now(),
            config: {
                headless,
                width,
                height,
                userAgent: finalUserAgent,
                headers: finalHeaders,
                locale,
                proxy: proxy ? (typeof proxy === 'string' ? proxy : proxy.server) : null
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

        let targetPage = session.page;
        const browser = await targetPage.browser();
        const pages = await browser.pages();
        
        // If newTab is true or no pages are open, create a new tab
        if (newTab || pages.length === 0) {
            targetPage = await browser.newPage();
            await targetPage.setViewport({ width: 1366, height: 768 });
        } else {
            // Try to find an existing tab with the same URL
            const targetUrl = new URL(url);
            const matchingPage = pages.find(async (page) => {
                try {
                    const pageUrl = new URL(page.url());
                    return pageUrl.hostname === targetUrl.hostname && 
                           pageUrl.pathname === targetUrl.pathname;
                } catch (e) {
                    return false;
                }
            });
            
            if (matchingPage) {
                targetPage = matchingPage;
                await targetPage.bringToFront();
            } else if (pages.length < 10) { // Limit to 10 tabs to prevent memory issues
                targetPage = await browser.newPage();
                await targetPage.setViewport({ width: 1366, height: 768 });
            } else {
                // If we have too many tabs, use the current page
                targetPage = session.page;
            }
        }

        // Update the session's page reference
        session.page = targetPage;
        
        // Navigate to the URL
        await targetPage.goto(url, options);
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

// Click element
const clickSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector } = req.body;

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
    session.lastUsed = Date.now();

    try {
        await session.page.waitForSelector(selector, { timeout: 10000 });
        await session.page.click(selector);
        await wait(1000);

        const newUrl = session.page.url();
        const pageTitle = await session.page.title();

        res.json({
            success: true,
            sessionId,
            clicked: true,
            url: newUrl,
            title: pageTitle
        });
    } catch (error) {
        console.error('Error clicking element:', error);
        res.status(500).json({
            error: 'Failed to click element',
            message: error.message
        });
    }
};

// Type text
const typeSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, delay = 50 } = req.body;

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

// Function to simulate human-like mouse movement
async function moveMouse(page, x, y) {
    await page.mouse.move(x, y, { steps: 20 });
    await wait(randomDelay(100, 300));
}

// Function to simulate human-like typing
async function humanType(page, selector, text) {
    await page.focus(selector);
    for (let char of text) {
        await page.type(selector, char, { delay: randomDelay(30, 150) });
        // Randomly take longer breaks between some characters
        if (Math.random() > 0.9) {
            await wait(randomDelay(100, 500));
        }
    }
}

// Function to simulate random scrolling
async function randomScroll(page) {
    const scrollAmount = Math.floor(Math.random() * 500) + 100;
    await page.evaluate((scrollAmount) => {
        window.scrollBy(0, scrollAmount);
    }, scrollAmount);
    await wait(randomDelay(300, 1000));
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

// Function to simulate form filling
async function fillRandomForms(page) {
    const inputs = await page.$$('input[type="text"], input[type="email"], textarea');
    for (const input of inputs) {
        if (Math.random() > 0.7) { // 30% chance to fill each input
            const inputType = await input.evaluate(el => el.type || 'text');
            let value = '';
            
            switch(inputType) {
                case 'email':
                    value = `test${Math.floor(Math.random() * 1000)}@example.com`;
                    break;
                case 'text':
                default:
                    value = ['Hello', 'BTC', 'Sample', 'News', ' ', ' ', ' ', ' ', 'Text' ,'a', 'b', 't', 'o', 'p', 'd'][Math.floor(Math.random() * 5)];
                    break;
            }
            
            try {
                await input.type(value, { delay: randomDelay(30, 150) });
                await wait(randomDelay(500, 1500));
            } catch (error) {
                console.log('Could not type into input, continuing...');
            }
        }
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
    
    try {
        const endTime = Date.now() + (durationMinutes * 60 * 1000);
        
        // Start the simulation in the background
        (async () => {
            console.log(`Starting user simulation for session ${sessionId} for ${durationMinutes} minutes`);
            
            while (Date.now() < endTime) {
                try {
                    // Randomly choose an action
                    const action = Math.floor(Math.random() * 5);
                    
                    switch(action) {
                        case 0:
                            await randomScroll(page);
                            break;
                        case 1:
                            await randomMouseMovements(page);
                            break;
                        case 2:
                            await randomClicks(page);
                            break;
                        case 3:
                            await fillRandomForms(page);
                            break;
                        case 4:
                            // Random refresh (10% chance)
                            if (Math.random() < 0.1) {
                                await page.reload({ waitUntil: 'networkidle0' });
                            await wait(randomDelay(2000, 5000));
                            }
                            break;
                    }
                    
                    // Random delay between actions
                    await wait(randomDelay(2000, 10000));
                    
                } catch (error) {
                    console.error('Error during simulation:', error.message);
                    // Continue with the next action
                    await wait(1000);
                }
            }
            
            console.log(`User simulation completed for session ${sessionId}`);
        })();
        
        res.json({ 
            success: true, 
            message: `User simulation started for ${durationMinutes} minutes` 
        });
        
    } catch (error) {
        console.error('Error starting user simulation:', error);
        res.status(500).json({ 
            error: 'Failed to start user simulation',
        });
    }
};

// Helper function to accept Google cookies
async function acceptGoogleCookies(page) {
    // Common "Accept all" translations in various languages
    const acceptButtonTexts = [
        // English
        'Accept all', 'Accept all cookies', 'Accept all settings',
        // French
        'Tout accepter', 'Tout accepter et continuer',
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

        // Take a screenshot for debugging
        const screenshot = await page.screenshot({ encoding: 'base64' });

        res.json({
            success: true,
            message: 'Google validation completed',
            cookiesAccepted,
            screenshot: `data:image/png;base64,${screenshot}`
        });
    } catch (error) {
        console.error('Error during Google validation:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
};

module.exports = {
    createSession,
    listSessions,
    getSession,
    navigateSession,
    closeSessionEndpoint,
    closeAllSessions,
    screenshotSession,
    executeScriptSession,
    clickSession,
    typeSession,
    getContentSession,
    simulateUserActions,
    validateGoogle
};
