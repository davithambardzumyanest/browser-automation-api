const { sessions } = require('../state');

const typeSession = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, delay = 120 } = req.body;

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

module.exports = { typeSession };
