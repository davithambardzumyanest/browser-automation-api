const { sessions } = require('../state');

const getSession = (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    res.json({
        success: true,
        sessionId,
        created: new Date(session.created).toISOString(),
        lastUsed: new Date(session.lastUsed).toISOString(),
        config: session.config
    });
};

module.exports = { getSession };
