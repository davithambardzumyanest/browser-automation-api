// Typed errors for session commands. Every failure carries an error_code, an
// HTTP status and `retryable`.
//
// retryable means "repeating the identical request cannot duplicate a side
// effect": the command was rejected or failed before any page code ran. Once a
// script has started, nothing is retryable. The script may already have
// clicked, submitted or paid before it failed, so the caller has to look at
// the page (or poll the job) instead of re-sending. This API never retries a
// script on its own.
//
// These codes describe execution only. Outcomes in the caller's domain
// (a directory rejecting a listing, a safety stop deciding not to proceed)
// belong in the script's own return value, not here.

const ERROR_CODES = {
    INVALID_REQUEST: { status: 400, retryable: false },
    SESSION_NOT_FOUND: { status: 404, retryable: false },
    SESSION_CLOSED: { status: 410, retryable: false },
    SESSION_BUSY: { status: 409, retryable: true },
    ACTION_ID_CONFLICT: { status: 409, retryable: false },
    JOB_NOT_FOUND: { status: 404, retryable: false },
    JOB_NOT_RUNNING: { status: 409, retryable: false },
    // Preconditions (frame / waitFor) that failed before the script ran.
    SELECTOR_MISSING: { status: 422, retryable: true },
    CONDITION_NOT_MET: { status: 422, retryable: true },
    SCRIPT_EXCEPTION: { status: 500, retryable: false },
    TIMEOUT: { status: 504, retryable: false },
    CONTEXT_DESTROYED: { status: 500, retryable: false },
    CANCELLED: { status: 409, retryable: false },
    INTERNAL_ERROR: { status: 500, retryable: false }
};

class CommandError extends Error {
    constructor(code, message, { retryable, details, cause } = {}) {
        super(message);
        this.name = 'CommandError';
        this.code = code;
        this.status = ERROR_CODES[code]?.status ?? 500;
        this.retryable = retryable ?? ERROR_CODES[code]?.retryable ?? false;
        if (details !== undefined) this.details = details;
        if (cause !== undefined) this.cause = cause;
    }
}

const CONTEXT_DESTROYED_RE = /Execution context was destroyed|Cannot find context with specified id|Execution context is not available in detached frame|detached Frame|Frame was detached|Inspected target navigated or closed|Promise was collected|Navigating frame was detached/i;
const SESSION_CLOSED_RE = /Target closed|Session closed|Connection closed|browser has disconnected|Page has been closed|No target with given id|Protocol error.*\b(closed|detached)\b/i;

/** Message of anything thrown, including the raw values `throw "x"` produces. */
const errorMessage = (error) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

/**
 * Map a thrown value to a CommandError.
 * @param {*} error
 * @param {Object} ctx
 * @param {boolean} ctx.scriptStarted - whether the user script had begun running
 * @param {boolean} [ctx.sessionGone] - session closed or page closed
 */
const classifyError = (error, { scriptStarted, sessionGone = false }) => {
    if (error instanceof CommandError) return error;
    const message = errorMessage(error);

    if (sessionGone || SESSION_CLOSED_RE.test(message)) {
        return new CommandError('SESSION_CLOSED', `Session or page closed during execution: ${message}`, { cause: error });
    }
    if (CONTEXT_DESTROYED_RE.test(message)) {
        return new CommandError(
            'CONTEXT_DESTROYED',
            scriptStarted
                ? 'The page navigated or the frame was detached while the script was running; it was not re-run. ' +
                  'Check `url`/`navigation` to see where the page ended up.'
                : 'The page navigated or the frame was detached before the script started; nothing was run.',
            { retryable: !scriptStarted, cause: error }
        );
    }
    if (scriptStarted || error?.name === 'SyntaxError') {
        const name = error instanceof Error && error.name && error.name !== 'Error' ? `${error.name}: ` : '';
        const thrownValue = error instanceof Error ? undefined : error;
        return new CommandError('SCRIPT_EXCEPTION', `${name}${message}`, {
            // A syntax error means nothing ran, but re-sending the same script won't help.
            retryable: false,
            details: thrownValue !== undefined ? { thrownValue } : undefined,
            cause: error
        });
    }
    return new CommandError('INTERNAL_ERROR', message, { cause: error });
};

module.exports = { ERROR_CODES, CommandError, classifyError, errorMessage };
