const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Browser instance pool
let browser = null;

// Stealth configuration to bypass bot detection
const STEALTH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Initialize browser with stealth mode
const initBrowser = async () => {
    if (!browser) {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: STEALTH_ARGS
        });
    }
    return browser;
};

// Configure page to avoid detection
const setupStealthPage = async (page) => {
    // Override the navigator.webdriver property
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    // Override permissions
    await page.evaluateOnNewDocument(() => {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    // Override plugins to make it look real
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
    });

    // Override languages
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });

    // Add Chrome object
    await page.evaluateOnNewDocument(() => {
        window.chrome = {
            runtime: {},
        };
    });

    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Set extra headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    });
};

// Get browser instance
const getBrowser = async () => {
    return await initBrowser();
};

// Create a new page with stealth configuration
const createStealthPage = async () => {
    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();
    await setupStealthPage(page);
    return page;
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

    const browser = await puppeteer.launch({ headless: true });
    const page2 = await browser.newPage();

    await page2.goto('https://www.google.com');
    const screenshotBuffer = await page2.screenshot({ fullPage: true });

    // await page2.type('input[name="q"]', 'chatgpt');
    // await page2.keyboard.press('Enter');
    //
    // await page2.waitForSelector('#search');
    //
    // const results = await page.evaluate(() => {
    //     return Array.from(document.querySelectorAll('h3')).map(el => el.innerText);
    // });
    // const screenshotBuffer = await page2.screenshot({ fullPage });

    // console.log(results);
    await browser.close();

    res.set('Content-Type', 'image/png');
    res.send(screenshotBuffer);
    return
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
    try {
        page = await createStealthPage();
        
        await page.setViewport({ width, height });
        
        // Use domcontentloaded for faster response, especially for Google
        try {
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: timeout 
            });
        } catch (err) {
            // If domcontentloaded fails, try with load
            await page.goto(url, { 
                waitUntil: 'load',
                timeout: timeout 
            });
        }
        
        // Wait a bit for dynamic content to render
        await wait(2000);

        const screenshotBuffer = await page.screenshot({ fullPage });

        res.set('Content-Type', 'image/png');
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({ 
            error: 'Failed to take screenshot',
            message: error.message 
        });
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
        
        await page.goto(url, { waitUntil, timeout });
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

module.exports = {
    getBrowser,
    closeBrowser,
    takeScreenshot,
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
