const { sessions } = require('../state');

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

module.exports = { getContentSession };
