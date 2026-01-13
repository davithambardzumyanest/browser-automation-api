const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { chromium } = require('playwright');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Browser instance pool
let browsers = new Map();

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

// Get user data directory path
const getUserDataDir = (profileId) => {
    return `./profiles/account_${profileId || 'default'}`;
};

// Initialize browser with stealth mode
const initBrowser = async (profileId) => {
    const userDataDir = getUserDataDir(profileId);
    
    if (!browsers.has(userDataDir)) {
        const browserInstance = await puppeteer.launch({ 
            headless: 'new',
            args: BROWSER_ARGS,
            userDataDir: userDataDir,
            ignoreDefaultArgs: ['--disable-extensions']
        });
        
        // Store browser instance in the map
        browsers.set(userDataDir, browserInstance);
        
        // Handle browser close event to clean up
        browserInstance.on('disconnected', () => {
            browsers.delete(userDataDir);
        });
    }
    
    return browsers.get(userDataDir);
};

// Get browser instance
const getBrowser = async (profileId) => {
    return await initBrowser(profileId);
};

// Create a new page (stealth plugin handles all anti-detection automatically)
const createStealthPage = async (profileId) => {
    const browserInstance = await getBrowser(profileId);
    return await browserInstance.newPage();
};

// Helper function to set realistic headers
const setRealisticHeaders = async (page) => {
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set realistic HTTP headers that Google expects
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
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
    });
};

// Helper function to wait (replaces deprecated page.waitForTimeout)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Close browser
const closeBrowser = async () => {
    if (browser) {
        await browser.close();
        browser = null;
    }
};

// Take screenshot
const takeScreenshot = async (req, res) => {
    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: './profile', // persist cookies
        defaultViewport: { width: 1280, height: 800 },
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'hy-AM,hy;q=0.9,en-US;q=0.8' });

    await page.goto('https://share.google/s8CQCA4d2hBmLZBnS', { waitUntil: 'networkidle2', timeout: 45000 });
    await page.screenshot({ path: 'before_challenge.png', fullPage: true });

    // detect likely captcha/challenge
    const isChallenge = await page.evaluate(() => {
        if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="gstatic.com/recaptcha"]')) return true;
        const body = (document.body && document.body.innerText) || '';
        return /I am not a robot|please verify|are you a human|verify/i.test(body);
    });

    if (isChallenge) {
        console.log('Challenge detected. Please solve it in the opened browser. Waiting up to 5 minutes...');
        try {
            await page.waitForFunction(() => {
                // return true when challenge text/iframe no longer present
                if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="gstatic.com/recaptcha"]')) return false;
                const body = (document.body && document.body.innerText) || '';
                return !/I am not a robot|please verify|are you a human|verify/i.test(body);
            }, { timeout: 1000 * 60 * 5 });
            console.log('Challenge cleared — continuing automation.');
        } catch (e) {
            console.warn('Timed out waiting for manual solve. Inspect the browser window.');
            return; // stop here; do not auto-bypass
        }
    } else {
        console.log('No interactive challenge detected; continuing.');
    }

    // Continue with the rest of your automation here
    await page.screenshot({ path: 'after_solve.png', fullPage: true });
    console.log('Current URL:', page.url());
    return;
    const { url, fullPage = true, width = 1920, height = 1080, timeout = 90000 } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        new URL(url);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    try {
        page = await createStealthPage();

        // Set realistic headers for Google compatibility
        await setRealisticHeaders(page);
        
        await page.setViewport({ width, height });
        
        // Try to navigate, but don't fail if timeout occurs
        try {
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: timeout,
                referer: 'https://www.facebook.com/'
            });
        } catch (navError) {
            // If navigation times out, log it but continue to take screenshot
            console.log('Navigation timeout, but attempting screenshot anyway:', navError.message);
        }
        
        // Wait for dynamic content to render
        await wait(5000);

        // Take screenshot of whatever has loaded
        const screenshotBuffer = await page.screenshot({ fullPage });

        res.set('Content-Type', 'image/png');
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        
        // Try to take a screenshot anyway before failing
        if (page) {
            try {
                const emergencyScreenshot = await page.screenshot({ fullPage: false });
                res.set('Content-Type', 'image/png');
                res.send(emergencyScreenshot);
                return;
            } catch (screenshotError) {
                // If screenshot also fails, return error
                res.status(500).json({ 
                    error: 'Failed to take screenshot',
                    message: error.message 
                });
            }
        } else {
            res.status(500).json({ 
                error: 'Failed to take screenshot',
                message: error.message 
            });
        }
    } finally {
        if (page) await page.close();
    }
};

// Navigate to URL
const navigate = async (req, res) => {
    const { url, waitUntil = 'domcontentloaded', timeout = 90000 } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        new URL(url);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    let page;
    try {
        page = await createStealthPage();
        await setRealisticHeaders(page);
        
        await page.goto(url, { waitUntil, timeout })
        const pageTitle = await page.title();
        const pageUrl = page.url();

        res.json({ 
            success: true,
            title: pageTitle,
            url: pageUrl
        });
    } catch (error) {
        console.error('Error navigating:', error);
        res.status(500).json({ 
            error: 'Failed to navigate',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Click element by text
const clickByText = async (req, res) => {
    const { url, text, elementType = '*', timeout = 90000 } = req.body;
    
    if (!url || !text) {
        return res.status(400).json({ error: 'URL and text are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        await setRealisticHeaders(page);
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        
        // Find and click element by text
        const clicked = await page.evaluate((text, elementType) => {
            const xpath = `//${elementType}[contains(text(), '${text}')]`;
            const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            
            if (element) {
                element.click();
                return true;
            }
            return false;
        }, text, elementType);

        if (!clicked) {
            return res.status(404).json({ 
                error: 'Element not found',
                message: `No element with text "${text}" found` 
            });
        }

        // Wait for navigation if it occurs
        await wait(1000);
        
        const newUrl = page.url();
        const pageTitle = await page.title();

        res.json({ 
            success: true,
            clicked: true,
            newUrl,
            title: pageTitle
        });
    } catch (error) {
        console.error('Error clicking element:', error);
        res.status(500).json({ 
            error: 'Failed to click element',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Click element by selector
const clickBySelector = async (req, res) => {
    const { url, selector, waitForNavigation = false } = req.body;
    
    if (!url || !selector) {
        return res.status(400).json({ error: 'URL and selector are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        await setRealisticHeaders(page);
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector(selector, { timeout: 10000 });
        
        if (waitForNavigation) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click(selector)
            ]);
        } else {
            await page.click(selector);
            await wait(1000);
        }
        
        const newUrl = page.url();
        const pageTitle = await page.title();

        res.json({ 
            success: true,
            clicked: true,
            newUrl,
            title: pageTitle
        });
    } catch (error) {
        console.error('Error clicking element:', error);
        res.status(500).json({ 
            error: 'Failed to click element',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Fill form fields
const fillForm = async (req, res) => {
    const { url, fields } = req.body;
    
    if (!url || !fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: 'URL and fields array are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        for (const field of fields) {
            const { selector, value, type = 'text' } = field;
            
            if (!selector || value === undefined) {
                continue;
            }

            await page.waitForSelector(selector, { timeout: 10000 });
            
            if (type === 'select') {
                await page.select(selector, value);
            } else if (type === 'checkbox' || type === 'radio') {
                await page.click(selector);
            } else {
                await page.type(selector, value.toString(), { delay: 50 });
            }
        }

        res.json({ 
            success: true,
            message: 'Form filled successfully',
            fieldsProcessed: fields.length
        });
    } catch (error) {
        console.error('Error filling form:', error);
        res.status(500).json({ 
            error: 'Failed to fill form',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Get page content
const getPageContent = async (req, res) => {
    const { url, selector = null } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        let content;
        if (selector) {
            await page.waitForSelector(selector, { timeout: 10000 });
            content = await page.$eval(selector, el => el.textContent);
        } else {
            content = await page.content();
        }

        const pageTitle = await page.title();
        const pageUrl = page.url();

        res.json({ 
            success: true,
            title: pageTitle,
            url: pageUrl,
            content
        });
    } catch (error) {
        console.error('Error getting content:', error);
        res.status(500).json({ 
            error: 'Failed to get content',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Execute custom script
const executeScript = async (req, res) => {
    const { url, script } = req.body;
    
    if (!url || !script) {
        return res.status(400).json({ error: 'URL and script are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        await setRealisticHeaders(page);
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        const result = await page.evaluate(script);

        res.json({ 
            success: true,
            result
        });
    } catch (error) {
        console.error('Error executing script:', error);
        res.status(500).json({ 
            error: 'Failed to execute script',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Wait for selector
const waitForElement = async (req, res) => {
    const { url, selector, timeout = 30000 } = req.body;
    
    if (!url || !selector) {
        return res.status(400).json({ error: 'URL and selector are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector(selector, { timeout });

        const elementExists = await page.$(selector) !== null;

        res.json({ 
            success: true,
            elementExists,
            selector
        });
    } catch (error) {
        console.error('Error waiting for element:', error);
        res.status(500).json({ 
            error: 'Failed to wait for element',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Get element attributes
const getElementAttributes = async (req, res) => {
    const { url, selector } = req.body;
    
    if (!url || !selector) {
        return res.status(400).json({ error: 'URL and selector are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector(selector, { timeout: 10000 });

        const attributes = await page.$eval(selector, el => {
            const attrs = {};
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                attrs[attr.name] = attr.value;
            }
            return {
                attributes: attrs,
                textContent: el.textContent,
                innerHTML: el.innerHTML,
                tagName: el.tagName
            };
        });

        res.json({ 
            success: true,
            ...attributes
        });
    } catch (error) {
        console.error('Error getting attributes:', error);
        res.status(500).json({ 
            error: 'Failed to get attributes',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Scroll page
const scrollPage = async (req, res) => {
    const { url, direction = 'down', distance = null } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        if (distance) {
            await page.evaluate((dist, dir) => {
                const scrollAmount = dir === 'up' ? -dist : dist;
                window.scrollBy(0, scrollAmount);
            }, distance, direction);
        } else {
            if (direction === 'bottom') {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            } else if (direction === 'top') {
                await page.evaluate(() => window.scrollTo(0, 0));
            }
        }

        await wait(1000);

        res.json({ 
            success: true,
            scrolled: true
        });
    } catch (error) {
        console.error('Error scrolling page:', error);
        res.status(500).json({ 
            error: 'Failed to scroll page',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Get page PDF
const getPagePDF = async (req, res) => {
    const { url, format = 'A4', landscape = false } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        const pdfBuffer = await page.pdf({ 
            format,
            landscape,
            printBackground: true
        });

        res.set('Content-Type', 'application/pdf');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ 
            error: 'Failed to generate PDF',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Type text with delay
const typeText = async (req, res) => {
    const { url, selector, text, delay = 50 } = req.body;
    
    if (!url || !selector || !text) {
        return res.status(400).json({ error: 'URL, selector, and text are required' });
    }

    let page;
    try {
        page = await createStealthPage();
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector(selector, { timeout: 10000 });
        
        await page.click(selector);
        await page.type(selector, text, { delay });

        res.json({ 
            success: true,
            typed: true
        });
    } catch (error) {
        console.error('Error typing text:', error);
        res.status(500).json({ 
            error: 'Failed to type text',
            message: error.message 
        });
    } finally {
        if (page) await page.close();
    }
};

// Debug screenshot - returns screenshot with debug info
const debugScreenshot = async (req, res) => {
    const { url, fullPage = true, width = 1920, height = 1080, timeout = 90000 } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        new URL(url);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    let page;
    const debugInfo = {
        url,
        timestamp: new Date().toISOString(),
        navigationSuccess: false,
        navigationError: null,
        pageTitle: null,
        pageUrl: null,
        screenshotTaken: false,
        contentLoaded: false
    };

    try {
        page = await createStealthPage();
        await setRealisticHeaders(page);
        await page.setViewport({ width, height });
        
        // Try to navigate
        try {
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: timeout,
                referer: 'https://www.google.com/'
            });
            debugInfo.navigationSuccess = true;
            debugInfo.contentLoaded = true;
        } catch (navError) {
            debugInfo.navigationError = navError.message;
            console.log('Navigation error:', navError.message);
        }
        
        await wait(2000);
        
        // Get page info
        try {
            debugInfo.pageTitle = await page.title();
            debugInfo.pageUrl = page.url();
        } catch (e) {
            console.log('Could not get page info:', e.message);
        }

        // Take screenshot
        const screenshotBuffer = await page.screenshot({ fullPage });
        debugInfo.screenshotTaken = true;
        
        // Return JSON with base64 screenshot and debug info
        res.json({
            success: true,
            debug: debugInfo,
            screenshot: screenshotBuffer.toString('base64')
        });
    } catch (error) {
        console.error('Error in debug screenshot:', error);
        
        // Try emergency screenshot
        if (page) {
            try {
                const emergencyScreenshot = await page.screenshot({ fullPage: false });
                debugInfo.screenshotTaken = true;
                debugInfo.emergency = true;
                
                res.json({
                    success: false,
                    debug: debugInfo,
                    screenshot: emergencyScreenshot.toString('base64'),
                    error: error.message
                });
                return;
            } catch (screenshotError) {
                res.status(500).json({ 
                    error: 'Failed to take screenshot',
                    message: error.message,
                    debug: debugInfo
                });
            }
        } else {
            res.status(500).json({ 
                error: 'Failed to take screenshot',
                message: error.message,
                debug: debugInfo
            });
        }
    } finally {
        if (page) await page.close();
    }
};

module.exports = {
    getBrowser,
    closeBrowser,
    takeScreenshot,
    debugScreenshot,
    navigate,
    clickByText,
    clickBySelector,
    fillForm,
    getPageContent,
    executeScript,
    waitForElement,
    getElementAttributes,
    scrollPage,
    getPagePDF,
    typeText
};
