// Per-session execution lock: one state-changing command per session at a
// time. A second command arriving while one is running is rejected with
// SESSION_BUSY (it never ran, so it is safe to retry) instead of interleaving
// clicks, typing and scripts on the same page.
//
// Read-only endpoints (screenshot, html, content, status polling) are not
// locked, so a long-running job can still be inspected.

const { sessions } = require('../sessionStore');

// Upper bound on how long a route handler may hold the lock. A handler that
// hangs forever must not wedge the session permanently.
const ROUTE_LOCK_MAX_MS = 10 * 60 * 1000;

const getActiveOperation = (session) => {
    const op = session.activeOperation;
    if (!op) return null;
    if (Date.now() > op.expiresAt) {
        console.warn(`Session lock for "${op.name}" expired after ${Date.now() - op.startedAt}ms; releasing`);
        session.activeOperation = null;
        return null;
    }
    return op;
};

/**
 * Take the session's lock. Returns a token to pass to releaseSessionLock, or
 * null when another operation already holds it.
 */
const tryAcquireSessionLock = (session, { name, jobId = null, maxMs = ROUTE_LOCK_MAX_MS }) => {
    if (getActiveOperation(session)) return null;
    const now = Date.now();
    const token = { name, jobId, startedAt: now, expiresAt: now + maxMs };
    session.activeOperation = token;
    return token;
};

const releaseSessionLock = (session, token) => {
    if (session && session.activeOperation === token) session.activeOperation = null;
};

const describeActiveOperation = (session) => {
    const op = getActiveOperation(session);
    if (!op) return null;
    return {
        operation: op.name,
        jobId: op.jobId,
        startedAt: new Date(op.startedAt).toISOString(),
        runningForMs: Date.now() - op.startedAt
    };
};

const sendSessionBusy = (res, sessionId, session) => {
    const activeOperation = describeActiveOperation(session);
    return res.status(409).json({
        success: false,
        error: 'Session busy',
        error_code: 'SESSION_BUSY',
        message: `Session ${sessionId} is already running ${activeOperation ? `"${activeOperation.operation}"` : 'another command'}; this command was not executed`,
        retryable: true,
        sessionId,
        activeOperation
    });
};

/**
 * Wrap a route handler so it holds the session lock for its whole run.
 * Unknown sessions fall through to the handler, which sends its own 404.
 */
const withSessionLock = (name, handler) => async (req, res, next) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) return handler(req, res, next);

    const token = tryAcquireSessionLock(session, { name });
    if (!token) return sendSessionBusy(res, sessionId, session);

    try {
        return await handler(req, res, next);
    } finally {
        releaseSessionLock(session, token);
    }
};

module.exports = {
    tryAcquireSessionLock,
    releaseSessionLock,
    describeActiveOperation,
    sendSessionBusy,
    withSessionLock
};
