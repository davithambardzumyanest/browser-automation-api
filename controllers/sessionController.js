const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Session storage
const sessions = new Map();

// Session cleanup interval (check every minute)
const CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_TIMEOUT = 600000; // 10 minutes

// Browser launch arguments
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
];

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

// Create new session
const createSession = async (req, res) => {
    // Use environment variables for defaults in development
    const defaultHeadless = process.env.DEFAULT_HEADLESS === 'false' ? false : true;
    const defaultSlowMo = parseInt(process.env.DEFAULT_SLOWMO || '0', 10);
    const defaultDevtools = process.env.DEFAULT_DEVTOOLS === 'true' ? true : false;

    const { 
        headless = defaultHeadless, 
        width = 1920, 
        height = 1080,
        userAgent,
        headers = {},
        userDataDir,
        locale = 'en-US',
        proxy,
        slowMo = defaultSlowMo,
        devtools = defaultDevtools
    } = req.body;

    try {
        const sessionId = uuidv4();
        
        // Launch browser with custom options
        const launchOptions = {
            headless: headless ? 'new' : false,
            args: [...BROWSER_ARGS],
            defaultViewport: { width, height },
            slowMo: slowMo, // Slow down operations for debugging
            devtools: devtools // Auto-open DevTools
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

        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

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
    const { url, waitUntil = 'domcontentloaded', timeout = 90000, referer } = req.body;

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

        await session.page.goto(url, options);
        const pageTitle = await session.page.title();
        const pageUrl = session.page.url();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            url: pageUrl
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

module.exports = {
    createSession,
    getSession,
    listSessions,
    navigateSession,
    screenshotSession,
    executeScriptSession,
    clickSession,
    typeSession,
    getContentSession,
    closeSessionEndpoint,
    closeAllSessions
};
