const fs = require('fs');
const proxyChain = require('proxy-chain');
const { sessions } = require('../state');

const closeSession = async (sessionId) => {
    if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        try {
            await session.browser.close();
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
        sessions.delete(sessionId);

        // Local proxy-chain forwarding server started in createSession.js -
        // leaks a listening port/process if not explicitly closed (unlike
        // Chrome's own process, it isn't a child of the browser being
        // closed above).
        if (session.anonymizedProxyUrl) {
            try {
                await proxyChain.closeAnonymizedProxy(session.anonymizedProxyUrl, true);
            } catch (error) {
                console.error(`Error closing anonymized proxy for session ${sessionId}:`, error);
            }
        }

        // Remove the throwaway per-session profile dir created for sessions
        // that didn't request a persistent profileId/userDataDir, so it can't
        // accumulate on disk or accidentally get reused by a later session.
        if (session.ephemeralProfileDir) {
            try {
                fs.rmSync(session.ephemeralProfileDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error(`Error removing ephemeral profile dir for session ${sessionId}:`, cleanupError);
            }
        }
    }
};

// Close session endpoint
const closeSessionEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    await closeSession(sessionId);

    res.json({
        success: true,
        message: `Session ${sessionId} closed successfully`
    });
};

// Close all sessions
const closeAllSessions = async (req, res) => {
    const sessionIds = Array.from(sessions.keys());

    for (const sessionId of sessionIds) {
        await closeSession(sessionId);
    }

    res.json({
        success: true,
        message: `Closed ${sessionIds.length} session(s)`,
        count: sessionIds.length
    });
};

module.exports = { closeSession, closeSessionEndpoint, closeAllSessions };
