const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');

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

    // session.page can go stale (detached main frame, or a closed tab) after
    // a navigation that swaps tabs/frames without this reference being
    // refreshed anywhere - e.g. right after pressing Enter on a search box.
    // Re-resolve to a live, attached page first instead of failing outright
    // on whatever the session object happened to still be holding.
    try {
        const isStale = !session.page || session.page.isClosed() || session.page.mainFrame().detached;
        if (isStale) {
            session.page = await getFirstTab(session);
        }
    } catch (_) {
        try { session.page = await getFirstTab(session); } catch (_) {}
    }

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

module.exports = { getPageHTML };
