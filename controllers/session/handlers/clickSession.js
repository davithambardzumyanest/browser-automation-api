const { sessions } = require('../state');
const { getFirstTab, closeExtraTabs } = require('../helpers/tabs');
const { findFrameWithSelector } = require('../helpers/selectOptionMatching');
const { randomDelay } = require('../helpers/timing');

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
                    // Locate whichever frame currently has the selector - main page or any
                    // (possibly nested) iframe - polling as frames attach/navigate, and
                    // falling back to shadow-piercing lookups for closed/open shadow roots.
                    const frame = await findFrameWithSelector(page, selector, 5000);
                    if (!frame) {
                        throw new Error('No elements found');
                    }

                    let elements = await frame.$$(selector);
                    if (elements.length === 0) {
                        elements = await frame.$$(`pierce/${selector}`).catch(() => []);
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
            await element.click({ delay: randomDelay(200, 400) });

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

module.exports = { clickSession };
