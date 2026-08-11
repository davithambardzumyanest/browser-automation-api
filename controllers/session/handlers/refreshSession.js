const { sessions } = require('../state');

/**
 * Refresh the active page in a session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const refreshSession = async (req, res) => {
    const { sessionId } = req.params;
    const { waitUntil = 'domcontentloaded', timeout = 30000 } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const { page } = session;

        if (!page) {
            return res.status(400).json({
                error: 'No active page found',
                message: 'Session exists but no active page is available'
            });
        }

        console.log(`Refreshing page in session ${sessionId}`);

        // Reload the page with specified options
        await page.reload({
            waitUntil,
            timeout
        });

        // Get updated page information
        const pageTitle = await page.title();
        const pageUrl = page.url();

        res.json({
            success: true,
            sessionId,
            message: 'Page refreshed successfully',
            pageInfo: {
                title: pageTitle,
                url: pageUrl,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`Error refreshing page in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to refresh page',
            message: error.message
        });
    }
};

module.exports = { refreshSession };
