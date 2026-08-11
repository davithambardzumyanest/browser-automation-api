const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');

/**
 * Scroll the page to the bottom
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function scrollToBottom(req, res) {
    const { sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const page = await getFirstTab(session);

        // Scroll to bottom using document.documentElement for better compatibility
        await page.evaluate(() => {
            // Scroll to bottom of the page
            window.scrollTo({
                top: Math.max(
                    document.body.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight
                ),
                behavior: 'smooth'
            });
        });

        // Wait for scroll to complete
        await page.waitForFunction(
            'window.scrollY + window.innerHeight >= Math.max(' +
            'document.body.scrollHeight, ' +
            'document.body.offsetHeight, ' +
            'document.documentElement.clientHeight, ' +
            'document.documentElement.scrollHeight, ' +
            'document.documentElement.offsetHeight' +
            ') - 10', // Allow 10px tolerance
            { timeout: 5000 }
        );

        res.json({
            success: true,
            message: 'Page scrolled to bottom',
            position: await page.evaluate(() => ({
                scrollY: window.scrollY,
                innerHeight: window.innerHeight,
                scrollHeight: document.body.scrollHeight
            }))
        });
    } catch (error) {
        console.error(`Error scrolling to bottom in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to scroll to bottom',
            details: error.message
        });
    }
}

module.exports = { scrollToBottom };
