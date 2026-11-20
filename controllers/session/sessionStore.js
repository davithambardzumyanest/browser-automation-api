// Shared session registry. Lives in its own module so the session controller
// and the per-feature modules under controllers/session/ (execute jobs,
// locks) can all reach it without a circular require.

const sessions = new Map();

// Recently closed session ids, so a client polling for a job result after its
// session was closed gets SESSION_CLOSED instead of an ambiguous "not found".
const CLOSED_SESSION_TTL_MS = 60 * 60 * 1000;
const closedSessions = new Map();

const markSessionClosed = (sessionId) => {
    closedSessions.set(sessionId, Date.now());
    const cutoff = Date.now() - CLOSED_SESSION_TTL_MS;
    for (const [id, closedAt] of closedSessions) {
        if (closedAt < cutoff) closedSessions.delete(id);
    }
};

const wasSessionClosed = (sessionId) => {
    const closedAt = closedSessions.get(sessionId);
    return closedAt !== undefined && Date.now() - closedAt < CLOSED_SESSION_TTL_MS;
};

module.exports = { sessions, markSessionClosed, wasSessionClosed };
