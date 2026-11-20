// POST /:sessionId/execute and its job endpoints.
//
// Each execution is a job:
// - The script is an async function body. It can `await`, and it sees
//   `args` (the request's JSON args) and `signal` (an AbortSignal that fires
//   on timeout/cancel).
// - It holds the session lock while it runs, so overlapping commands get
//   SESSION_BUSY.
// - Its result is stored under a jobId and, when given, the client's actionId.
//   Re-sending an actionId returns the stored outcome and never runs the
//   script twice.
// - If it outlives `responseTimeout`, the request returns 202 with the jobId,
//   to be polled at GET /:sessionId/execute/:jobId or cancelled at
//   POST /:sessionId/execute/:jobId/cancel.
// - Navigation is watched from before the script starts; the response says
//   whether it navigated, where to, and how far the new page loaded. A script
//   whose context a navigation destroyed is reported, never re-run.
// - Failures carry error_code/retryable plus redacted evidence (screenshot,
//   HTML, console errors, failed requests).

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { sessions, wasSessionClosed } = require('./sessionStore');
const { tryAcquireSessionLock, releaseSessionLock, sendSessionBusy } = require('./helpers/sessionLock');
const { CommandError, classifyError } = require('./helpers/commandErrors');
const { getPageRecorder, captureFailureEvidence, withTimeout } = require('./helpers/failureEvidence');
const { normalizeWaitSpecs, waitForCondition, normalizeFrameSpec, resolveFrame, sleep } = require('./helpers/waitConditions');
const { redactUrl } = require('./helpers/redaction');

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_NAVIGATION_GRACE_MS = 100;
const MAX_NAVIGATION_GRACE_MS = 5000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 10000;
const MAX_NAVIGATION_TIMEOUT_MS = 60000;
// After timeout/cancel, how long to let the in-page script react to its
// AbortSignal before releasing the session lock anyway.
const ABORT_GRACE_MS = 2000;
const JOB_RETENTION_MS = 30 * 60 * 1000;
const MAX_JOBS_PER_SESSION = 100;
const MAX_ACTION_ID_LENGTH = 200;
const EVIDENCE_MODES = ['on-failure', 'always', 'never'];
const WAIT_UNTIL_VALUES = ['none', 'commit', 'domcontentloaded', 'load'];

// ---------------------------------------------------------------------------
// Request parsing

const invalid = (message) => new CommandError('INVALID_REQUEST', message);

const readMs = (value, { field, fallback, max }) => {
    if (value === undefined || value === null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw invalid(`${field} must be a non-negative number of milliseconds`);
    return Math.min(n, max);
};

const hashRequest = (script, args) => crypto
    .createHash('sha256')
    .update(script)
    .update('\u0000')
    .update(JSON.stringify(args ?? null))
    .digest('hex');

const parseExecuteOptions = (body) => {
    const { script, args, actionId, evidence = 'on-failure' } = body;
    if (typeof script !== 'string' || !script.trim()) throw invalid('Script is required');
    if (actionId !== undefined && (typeof actionId !== 'string' || !actionId || actionId.length > MAX_ACTION_ID_LENGTH)) {
        throw invalid(`actionId must be a non-empty string of at most ${MAX_ACTION_ID_LENGTH} characters`);
    }
    if (!EVIDENCE_MODES.includes(evidence)) throw invalid(`evidence must be one of ${EVIDENCE_MODES.join(', ')}`);

    const timeout = readMs(body.timeout, { field: 'timeout', fallback: DEFAULT_TIMEOUT_MS, max: MAX_TIMEOUT_MS });
    // Default: hold the request until the job finishes (the behaviour callers
    // already rely on). Set lower to get a 202 + jobId for long scripts.
    const responseTimeout = readMs(body.responseTimeout, { field: 'responseTimeout', fallback: Infinity, max: Infinity });

    const nav = body.navigation ?? {};
    if (typeof nav !== 'object') throw invalid('navigation must be an object');
    const waitUntil = nav.waitUntil ?? 'domcontentloaded';
    if (!WAIT_UNTIL_VALUES.includes(waitUntil)) throw invalid(`navigation.waitUntil must be one of ${WAIT_UNTIL_VALUES.join(', ')}`);

    return {
        script,
        args,
        actionId: actionId ?? null,
        requestHash: hashRequest(script, args),
        timeout,
        responseTimeout,
        frame: normalizeFrameSpec(body.frame),
        waits: normalizeWaitSpecs(body.waitFor),
        navigation: {
            waitUntil,
            graceMs: readMs(nav.graceMs, { field: 'navigation.graceMs', fallback: DEFAULT_NAVIGATION_GRACE_MS, max: MAX_NAVIGATION_GRACE_MS }),
            timeout: readMs(nav.timeout, { field: 'navigation.timeout', fallback: DEFAULT_NAVIGATION_TIMEOUT_MS, max: MAX_NAVIGATION_TIMEOUT_MS })
        },
        evidence
    };
};

// ---------------------------------------------------------------------------
// Job store (per session, in memory; lost if the session or server goes away)

const getJobStore = (session) => {
    if (!session.executeJobs) {
        session.executeJobs = { byId: new Map(), byActionId: new Map() };
    }
    return session.executeJobs;
};

const pruneJobs = (store) => {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    const finished = [...store.byId.values()].filter(j => j.status !== 'running');
    const excess = Math.max(0, store.byId.size - MAX_JOBS_PER_SESSION);
    finished
        .sort((a, b) => a.finishedAt - b.finishedAt)
        .forEach((job, i) => {
            if (job.finishedAt < cutoff || i < excess) {
                store.byId.delete(job.jobId);
                if (job.actionId) store.byActionId.delete(job.actionId);
            }
        });
};

const findJob = (store, id) => store.byId.get(id) || store.byId.get(store.byActionId.get(id));

const createJob = (sessionId, opts) => {
    let resolveDone;
    const job = {
        jobId: uuidv4(),
        actionId: opts.actionId,
        sessionId,
        requestHash: opts.requestHash,
        status: 'running',
        phase: 'queued',
        scriptStarted: false,
        startedAt: Date.now(),
        finishedAt: null,
        cancelRequested: false,
        abortInPage: null,
        waits: [],
        done: new Promise(resolve => { resolveDone = resolve; })
    };
    job.resolveDone = resolveDone;
    return job;
};

const serializeJob = (job, { includeEvidence = true, duplicate = false } = {}) => {
    const finished = job.status !== 'running';
    const out = {
        success: job.status === 'succeeded',
        sessionId: job.sessionId,
        jobId: job.jobId,
        actionId: job.actionId || undefined,
        status: job.status,
        ...(job.status === 'running' ? { phase: job.phase } : {}),
        ...(duplicate ? { duplicate: true } : {}),
        ...(job.status === 'succeeded' ? { result: job.result } : {})
    };
    if (job.error) {
        Object.assign(out, {
            error: 'Failed to execute script',
            error_code: job.error.code,
            message: job.error.message,
            retryable: job.error.retryable,
            ...(job.error.details !== undefined ? { details: job.error.details } : {})
        });
    }
    Object.assign(out, {
        scriptStarted: job.scriptStarted,
        urlBefore: job.urlBefore,
        url: job.url ?? job.urlBefore,
        navigated: job.navigation?.occurred ?? false,
        navigation: job.navigation,
        frameUrl: job.frameUrl,
        waits: job.waits.length ? job.waits : undefined,
        startedAt: new Date(job.startedAt).toISOString(),
        finishedAt: finished ? new Date(job.finishedAt).toISOString() : undefined,
        durationMs: (finished ? job.finishedAt : Date.now()) - job.startedAt
    });
    if (job.evidence) out.evidence = includeEvidence ? job.evidence : { omitted: true };
    return out;
};

const httpStatusFor = (job) => {
    if (job.status === 'running') return 202;
    if (job.status === 'succeeded') return 200;
    return job.error?.status ?? 500;
};

const sendError = (res, error, extra = {}) => res.status(error.status).json({
    success: false,
    error: error.message,
    error_code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...extra
});

const sendSessionMissing = (res, sessionId) => sendError(res, wasSessionClosed(sessionId)
    ? new CommandError('SESSION_CLOSED', `Session ${sessionId} was closed`)
    : new CommandError('SESSION_NOT_FOUND', `Session ${sessionId} does not exist or has expired`), { sessionId });

/** Answer with the job once it finishes, or 202 if it outlives waitMs. */
const respondWithJob = async (res, job, waitMs, serializeOptions) => {
    if (job.status === 'running' && waitMs > 0) {
        let timer;
        await Promise.race([
            job.done,
            ...(Number.isFinite(waitMs) ? [new Promise(resolve => { timer = setTimeout(resolve, waitMs); })] : [])
        ]);
        clearTimeout(timer);
    }
    if (res.headersSent || res.destroyed) return;
    res.status(httpStatusFor(job)).json(serializeJob(job, serializeOptions));
};

// ---------------------------------------------------------------------------
// Navigation watching

const readReadyState = (frame) => withTimeout(frame.evaluate(() => document.readyState), 1500, 'readyState');

/**
 * Watch the main frame for navigations from before the script starts, so a
 * navigation the script triggers is never missed.
 */
const armNavigationWatcher = (page) => {
    const mainFrame = page.mainFrame();
    const state = { requested: false, committed: false, pendingRequest: null, lastEventAt: 0 };

    const onRequest = (request) => {
        if (request.isNavigationRequest() && request.frame() === mainFrame) {
            state.requested = true;
            state.pendingRequest = request;
            state.lastEventAt = Date.now();
        }
    };
    const onRequestDone = (request) => {
        if (request === state.pendingRequest) {
            state.pendingRequest = null;
            state.lastEventAt = Date.now();
        }
    };
    const onFrameNavigated = (frame) => {
        if (frame === mainFrame) {
            state.committed = true;
            state.lastEventAt = Date.now();
        }
    };

    page.on('request', onRequest);
    page.on('requestfinished', onRequestDone);
    page.on('requestfailed', onRequestDone);
    page.on('framenavigated', onFrameNavigated);

    const stop = () => {
        page.off('request', onRequest);
        page.off('requestfinished', onRequestDone);
        page.off('requestfailed', onRequestDone);
        page.off('framenavigated', onFrameNavigated);
    };

    /**
     * After the script: give a just-triggered navigation graceMs to start,
     * then wait (up to timeout) for it to commit and reach waitUntil.
     */
    const settle = async ({ graceMs, waitUntil, timeout }, urlBefore) => {
        const graceEnd = Date.now() + graceMs;
        while (!state.requested && !state.committed && Date.now() < graceEnd) await sleep(25);

        const deadline = Date.now() + timeout;
        let settled = true;

        if (waitUntil !== 'none' && state.requested) {
            // Wait for the navigation request to commit. Some never do
            // (204, download, blocked): once the request ends with no commit
            // and no follow-up redirect for 500ms, stop waiting.
            while (!state.committed && Date.now() < deadline) {
                if (!state.pendingRequest && Date.now() - state.lastEventAt > 500) break;
                await sleep(50);
            }
            if (!state.committed && state.pendingRequest) settled = false;
        }

        let readyState = null;
        const target = waitUntil === 'load' ? ['complete'] : ['interactive', 'complete'];
        if (!page.isClosed()) {
            while (true) {
                readyState = await readReadyState(mainFrame).catch(() => null);
                if (waitUntil === 'none' || waitUntil === 'commit' || !state.committed || target.includes(readyState)) break;
                if (Date.now() >= deadline) { settled = false; break; }
                await sleep(100);
            }
        }

        let url = null;
        try { url = page.url(); } catch {}
        const occurred = state.committed || (url !== null && url !== urlBefore);
        return {
            occurred,
            requested: state.requested,
            committed: state.committed,
            ...(state.requested && !state.committed ? { aborted: !state.pendingRequest } : {}),
            readyState,
            settled: occurred ? settled : true,
            url: url !== null ? redactUrl(url, 2000) : null
        };
    };

    return { stop, settle };
};

// ---------------------------------------------------------------------------
// Running a job

const runWithTimeoutAndCancel = (promise, job, timeoutMs) => new Promise((resolve, reject) => {
    let finished = false;
    const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        job.onCancel = null;
        fn(value);
    };
    const timer = setTimeout(() => finish(reject, new CommandError(
        'TIMEOUT',
        `Script did not finish within ${timeoutMs}ms. It was signalled to abort but may have had side effects; it was not re-run.`
    )), timeoutMs);
    job.onCancel = () => finish(reject, new CommandError(
        'CANCELLED',
        'Cancelled by request while the script was running. It may have had side effects; it was not re-run.'
    ));
    promise.then(value => finish(resolve, value), error => finish(reject, error));
});

const runJob = async (session, sessionId, job, opts) => {
    const page = session.page;
    const isCancelled = () => job.cancelRequested;
    let frame = null;
    let evidenceMark = null;
    let navWatcher = null;
    let evalPromise = null;
    const handles = [];
    let rawUrlBefore = null;

    try {
        rawUrlBefore = page.url();
        job.urlBefore = redactUrl(rawUrlBefore, 2000);
        evidenceMark = getPageRecorder(page).begin();
        navWatcher = armNavigationWatcher(page);

        job.phase = 'resolving-frame';
        frame = await resolveFrame(page, opts.frame, { isCancelled });
        if (opts.frame) job.frameUrl = redactUrl(frame.url(), 2000);

        job.phase = 'waiting';
        for (const spec of opts.waits) {
            job.waits.push(await waitForCondition(frame, spec, { isCancelled }));
        }
        if (isCancelled()) throw new CommandError('CANCELLED', 'Cancelled before the script started', { retryable: true });

        job.phase = 'compiling';
        // Trailing newline so a final `// comment` can't swallow the brace.
        const fnHandle = await frame.evaluateHandle(`(async function (args, signal) {\n${opts.script}\n})`);
        handles.push(fnHandle);
        const controllerHandle = await frame.evaluateHandle(() => new AbortController());
        handles.push(controllerHandle);
        job.abortInPage = (reason) => controllerHandle
            .evaluate((c, r) => c.abort(new DOMException(r, r === 'timeout' ? 'TimeoutError' : 'AbortError')), reason)
            .catch(() => {});

        if (isCancelled()) throw new CommandError('CANCELLED', 'Cancelled before the script started', { retryable: true });
        job.phase = 'running';
        job.scriptStarted = true;
        evalPromise = frame.evaluate((fn, controller, a) => fn(a, controller.signal), fnHandle, controllerHandle, opts.args);
        evalPromise.catch(() => {}); // may settle after we stopped waiting
        job.result = await runWithTimeoutAndCancel(evalPromise, job, opts.timeout);
        job.status = 'succeeded';
    } catch (rawError) {
        const sessionGone = !sessions.has(sessionId) || page.isClosed();
        job.error = classifyError(rawError, { scriptStarted: job.scriptStarted, sessionGone });
        job.status = job.error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        if (job.error.code === 'INTERNAL_ERROR') console.error(`execute job ${job.jobId} internal error:`, rawError);

        if ((job.error.code === 'TIMEOUT' || job.error.code === 'CANCELLED') && job.abortInPage && evalPromise) {
            await job.abortInPage(job.error.code === 'TIMEOUT' ? 'timeout' : 'cancelled');
            await Promise.race([evalPromise.catch(() => {}), sleep(ABORT_GRACE_MS)]);
        }
    }

    try {
        if (navWatcher && !page.isClosed()) {
            job.phase = 'settling-navigation';
            job.navigation = await navWatcher.settle(opts.navigation, rawUrlBefore);
            job.url = job.navigation.url;
        }
    } catch (error) {
        console.error(`execute job ${job.jobId}: navigation settle failed:`, error.message);
    }

    try {
        const wantEvidence = opts.evidence === 'always' ||
            (opts.evidence === 'on-failure' && job.status === 'failed' && job.error?.code !== 'SESSION_CLOSED');
        if (wantEvidence && !page.isClosed()) {
            job.phase = 'capturing-evidence';
            job.evidence = await captureFailureEvidence(page, frame, evidenceMark);
        }
    } catch (error) {
        job.evidence = { captureErrors: { evidence: error.message } };
    } finally {
        navWatcher?.stop();
        for (const handle of handles) await handle.dispose().catch(() => {});
        job.abortInPage = null;
        job.onCancel = null;
        job.finishedAt = Date.now();
        job.phase = 'done';
        if (sessions.has(sessionId)) sessions.get(sessionId).lastUsed = Date.now();
        job.resolveDone();
    }
};

// ---------------------------------------------------------------------------
// Handlers

const executeScriptSession = async (req, res) => {
    const { sessionId } = req.params;

    let opts;
    try {
        opts = parseExecuteOptions(req.body ?? {});
    } catch (error) {
        return sendError(res, error, { sessionId });
    }

    const session = sessions.get(sessionId);
    if (!session) return sendSessionMissing(res, sessionId);
    session.lastUsed = Date.now();

    const store = getJobStore(session);
    pruneJobs(store);

    // Idempotency: the same actionId never runs twice. No await between this
    // check and registering the new job, so concurrent duplicates can't race.
    if (opts.actionId && store.byActionId.has(opts.actionId)) {
        const existing = findJob(store, opts.actionId);
        if (existing.requestHash !== opts.requestHash) {
            return sendError(res, new CommandError(
                'ACTION_ID_CONFLICT',
                `actionId "${opts.actionId}" was already used for a different script/args (job ${existing.jobId}); it was not re-run`
            ), { sessionId, jobId: existing.jobId });
        }
        return respondWithJob(res, existing, opts.responseTimeout, { duplicate: true });
    }

    const job = createJob(sessionId, opts);
    const waitBudget = opts.waits.reduce((sum, w) => sum + w.timeout, 0) + (opts.frame?.timeout ?? 0);
    const lock = tryAcquireSessionLock(session, {
        name: 'execute',
        jobId: job.jobId,
        maxMs: waitBudget + opts.timeout + opts.navigation.graceMs + opts.navigation.timeout + ABORT_GRACE_MS + 60000
    });
    if (!lock) return sendSessionBusy(res, sessionId, session);

    store.byId.set(job.jobId, job);
    if (job.actionId) store.byActionId.set(job.actionId, job.jobId);

    runJob(session, sessionId, job, opts)
        .catch(error => {
            console.error(`execute job ${job.jobId} crashed:`, error);
            if (job.status === 'running') {
                job.status = 'failed';
                job.error = classifyError(error, { scriptStarted: job.scriptStarted });
                job.finishedAt = Date.now();
                job.resolveDone();
            }
        })
        .finally(() => releaseSessionLock(session, lock));

    return respondWithJob(res, job, opts.responseTimeout);
};

// GET /:sessionId/execute/:jobId  (jobId or actionId)
// ?wait=<ms> long-polls until the job finishes; ?evidence=false omits evidence.
const getExecuteJob = async (req, res) => {
    const { sessionId, jobId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) return sendSessionMissing(res, sessionId);

    const job = findJob(getJobStore(session), jobId);
    if (!job) {
        return sendError(res, new CommandError('JOB_NOT_FOUND', `No execute job or actionId "${jobId}" in session ${sessionId} (jobs are kept ${JOB_RETENTION_MS / 60000} minutes)`), { sessionId });
    }

    let waitMs = 0;
    try {
        waitMs = readMs(req.query.wait, { field: 'wait', fallback: 0, max: 60000 });
    } catch (error) {
        return sendError(res, error, { sessionId });
    }
    const includeEvidence = req.query.evidence !== 'false';

    if (job.status === 'running' && waitMs > 0) {
        let timer;
        await Promise.race([job.done, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
        clearTimeout(timer);
    }
    // Polling always succeeds as HTTP; the job's own outcome is in the body.
    res.status(200).json(serializeJob(job, { includeEvidence }));
};

// POST /:sessionId/execute/:jobId/cancel
const cancelExecuteJob = async (req, res) => {
    const { sessionId, jobId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) return sendSessionMissing(res, sessionId);

    const job = findJob(getJobStore(session), jobId);
    if (!job) return sendError(res, new CommandError('JOB_NOT_FOUND', `No execute job or actionId "${jobId}" in session ${sessionId}`), { sessionId });
    if (job.status !== 'running') {
        return sendError(res, new CommandError('JOB_NOT_RUNNING', `Job ${job.jobId} already ${job.status}; nothing to cancel`), {
            sessionId,
            job: serializeJob(job, { includeEvidence: false })
        });
    }

    job.cancelRequested = true;
    if (job.onCancel) job.onCancel();

    let timer;
    await Promise.race([job.done, new Promise(resolve => { timer = setTimeout(resolve, ABORT_GRACE_MS + 8000); })]);
    clearTimeout(timer);
    res.status(200).json(serializeJob(job));
};

module.exports = { executeScriptSession, getExecuteJob, cancelExecuteJob };
