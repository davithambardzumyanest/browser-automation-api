const { sessions } = require('../state');

// List all active sessions
const listSessions = (req, res) => {
    const activeSessions = [];

    for (const [sessionId, session] of sessions.entries()) {
        activeSessions.push({
            sessionId,
            created: new Date(session.created).toISOString(),
            lastUsed: new Date(session.lastUsed).toISOString(),
            config: session.config
        });
    }

    res.json({
        success: true,
        count: activeSessions.length,
        sessions: activeSessions
    });
};

module.exports = { listSessions };
