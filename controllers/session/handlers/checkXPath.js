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
        const page = await getFirstTab(session);
        session.page = page;

        // Check if XPath exists
        const exists = await page.evaluate((xpath) => {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
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
