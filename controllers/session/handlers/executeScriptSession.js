const { sessions } = require('../state');

// Execute script
const executeScriptSession = async (req, res) => {
    const { sessionId } = req.params;
    const { script } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Script is required' });
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
        const result = await session.page.evaluate(`(() => { ${script} })()`);

        res.json({
            success: true,
            sessionId,
            result
        });
    } catch (error) {
        console.error('Error executing script:', error);
        res.status(500).json({
            error: 'Failed to execute script',
            message: error.message
        });
    }
};

module.exports = { executeScriptSession };
