const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');

/**
 * Check if an XPath exists on the page
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.xpath - XPath selector to check
 * @param {Object} res - Express response object
 */
const checkXPath = async (req, res) => {
    const { sessionId } = req.params;
    const { xpath } = req.body;

    if (!xpath) {
        return res.status(400).json({ error: 'XPath is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const session = sessions.get(sessionId);
        // Read-only DOM query: resolve the tab without bringing it to the
        // front. Focusing is a CDP round trip that buys nothing here, and on
        // a session launched with slowMo every round trip is padded by the
        // slowMo value - it was doubling this endpoint's latency.
        const page = await getFirstTab(session, { focus: false });
        session.page = page;
        session.lastActivity = Date.now();

        // Check if XPath exists. Evaluated in the page in one round trip;
        // XPathResult.ANY_UNORDERED_NODE_TYPE lets Blink stop at the first
        // match instead of materializing the whole result set.
        const exists = await page.evaluate((xpath) => {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.ANY_UNORDERED_NODE_TYPE,
                null
            );
            return result.singleNodeValue !== null;
        }, xpath);

        return res.json({
            exists,
            xpath,
            sessionId
        });

    } catch (error) {
        console.error('Error checking XPath:', error);
        res.status(500).json({
            error: 'Failed to check XPath',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

module.exports = { checkXPath };
