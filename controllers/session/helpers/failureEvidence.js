// Failure evidence for session commands: console errors and failed network
// requests recorded while the command ran, plus a screenshot and sanitized
// HTML captured afterwards. Everything is redacted (see ./redaction.js):
// no cookies or headers are ever recorded, URLs lose sensitive query params,
// sensitive inputs are masked in the screenshot and stripped from the HTML.

const {
    REDACTED,
    SENSITIVE_WORDS,
    SENSITIVE_SUBSTRINGS,
    SENSITIVE_AUTOCOMPLETE,
    redactUrl,
    redactText
} = require('./redaction');

const MAX_ENTRIES = 25;
const DEFAULT_MAX_HTML_CHARS = 150000;
const CAPTURE_STEP_TIMEOUT_MS = 5000;
const MAX_MASKED_FRAMES = 10;

const SENSITIVE_CONFIG = {
    words: SENSITIVE_WORDS,
    substrings: SENSITIVE_SUBSTRINGS,
    autocomplete: SENSITIVE_AUTOCOMPLETE,
    redacted: REDACTED
};

const withTimeout = (promise, ms, label) => {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
    ]).finally(() => clearTimeout(timer));
};

// Rolling per-page log of console errors and failed requests. Attached once
// per page (at session creation, or lazily on first use) and kept for the
// page's lifetime, so evidence includes errors from the current document's
// load and not just ones raised while the failing command ran.
const BUFFER_SIZE = 100;
const pageRecorders = new WeakMap();

const getPageRecorder = (page) => {
    const existing = pageRecorders.get(page);
    if (existing) return existing;

    const entries = []; // { kind: 'console' | 'request', ts, entry }
    let documentStartedAt = 0;
    const push = (kind, entry) => {
        entries.push({ kind, ts: Date.now(), entry: { ...entry, at: new Date().toISOString() } });
        if (entries.length > BUFFER_SIZE) entries.shift();
    };

    page.on('console', (msg) => {
        const type = msg.type();
        if (type !== 'error' && type !== 'assert') return;
        const location = msg.location?.() || {};
        push('console', {
            type,
            text: redactText(msg.text()),
            // pptr: URLs are our own evaluate() calls and embed server file paths.
            source: location.url && !location.url.startsWith('pptr:') ? redactUrl(location.url, 300) : undefined
        });
    });
    page.on('pageerror', (error) => {
        push('console', { type: 'pageerror', text: redactText(error?.message ?? String(error)) });
    });
    page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            documentStartedAt = Date.now();
        }
    });
    page.on('requestfailed', (request) => {
        const errorText = request.failure()?.errorText || 'failed';
        // Our own ad/media blocking (helpers/requestBlocking.js) is not a failure.
        if (errorText.includes('ERR_BLOCKED_BY_CLIENT')) return;
        push('request', {
            url: redactUrl(request.url()),
            method: request.method(),
            resourceType: request.resourceType(),
            errorText
        });
    });
    page.on('response', (response) => {
        const status = response.status();
        if (status < 400) return;
        const request = response.request();
        push('request', {
            url: redactUrl(response.url()),
            method: request.method(),
            resourceType: request.resourceType(),
            status,
            statusText: response.statusText()
        });
    });

    const recorder = {
        /** Mark the start of a command: evidence covers the document it began on. */
        begin: () => ({ since: Math.min(Date.now(), documentStartedAt || 0) }),
        snapshot: ({ since = 0 } = {}) => {
            const pick = (kind) => {
                const matching = entries.filter(e => e.kind === kind && e.ts >= since).map(e => e.entry);
                return { list: matching.slice(-MAX_ENTRIES), dropped: Math.max(0, matching.length - MAX_ENTRIES) };
            };
            const consoleErrors = pick('console');
            const failedRequests = pick('request');
            return {
                consoleErrors: consoleErrors.list,
                failedRequests: failedRequests.list,
                ...(consoleErrors.dropped ? { consoleErrorsDropped: consoleErrors.dropped } : {}),
                ...(failedRequests.dropped ? { failedRequestsDropped: failedRequests.dropped } : {})
            };
        }
    };
    pageRecorders.set(page, recorder);
    return recorder;
};

// --- In-page function (serialized by Puppeteer, so it must be self-contained;
// no new Function/eval, which a page's CSP may forbid) ---

// op 'mask': mask sensitive inputs for the screenshot, returning what is needed
//            to undo it (kept as a JSHandle, so nothing is stored on the page).
// op 'html': sanitized outerHTML of the document.
function pageEvidenceOp(op, cfg, maxChars) {
    const words = new Set(cfg.words);
    const isSensitiveName = (name) => {
        if (!name) return false;
        const lower = String(name).toLowerCase();
        if (cfg.substrings.some(s => lower.includes(s))) return true;
        return String(name)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .some(w => words.has(w));
    };
    const isSensitiveField = (el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'password' || type === 'hidden') return true;
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
        if (cfg.autocomplete.some(a => autocomplete.includes(a))) return true;
        return ['name', 'id', 'aria-label', 'placeholder', 'data-testid']
            .some(attr => isSensitiveName(el.getAttribute(attr)));
    };

    if (op === 'mask') {
        const masked = [];
        for (const el of document.querySelectorAll('input, textarea')) {
            const type = (el.getAttribute('type') || '').toLowerCase();
            // Password fields are already masked natively; hidden ones aren't drawn.
            if (type === 'password' || type === 'hidden' || !isSensitiveField(el)) continue;
            masked.push({
                el,
                hadStyle: el.hasAttribute('style'),
                prev: el.style.getPropertyValue('-webkit-text-security'),
                prio: el.style.getPropertyPriority('-webkit-text-security')
            });
            el.style.setProperty('-webkit-text-security', 'disc', 'important');
        }
        return masked;
    }

    const root = document.documentElement.cloneNode(true);
    for (const el of root.querySelectorAll('input')) {
        if (el.hasAttribute('value') && isSensitiveField(el)) el.setAttribute('value', cfg.redacted);
    }
    for (const el of root.querySelectorAll('textarea')) {
        if (isSensitiveField(el)) el.textContent = cfg.redacted;
    }
    for (const el of root.querySelectorAll('meta[content]')) {
        const name = `${el.getAttribute('name') || ''} ${el.getAttribute('property') || ''}`.toLowerCase();
        if (/csrf|xsrf|token|nonce/.test(name)) el.setAttribute('content', cfg.redacted);
    }
    // Inline scripts often embed tokens and bootstrap state; styles are noise.
    for (const el of root.querySelectorAll('script:not([src]), style')) {
        el.textContent = '/* removed */';
    }
    for (const el of root.querySelectorAll('[nonce]')) el.removeAttribute('nonce');

    let html = `<!DOCTYPE html>\n${root.outerHTML}`;
    const length = html.length;
    const truncated = length > maxChars;
    if (truncated) html = html.slice(0, maxChars);
    return { content: html, length, truncated, url: location.href, title: document.title };
}

function pageUnmaskInputs(masked) {
    for (const { el, hadStyle, prev, prio } of masked) {
        if (prev) el.style.setProperty('-webkit-text-security', prev, prio);
        else el.style.removeProperty('-webkit-text-security');
        if (!hadStyle && !el.getAttribute('style')) el.removeAttribute('style');
    }
}

/**
 * Capture a screenshot, sanitized HTML of `frame` and the page's console and
 * network errors since `mark` (from getPageRecorder(page).begin()). Every step is best-effort: a step that fails (closed
 * tab, mid-navigation) is reported under captureErrors instead of throwing.
 */
const captureFailureEvidence = async (page, frame, mark, {
    screenshot = true,
    html = true,
    maxHtmlChars = DEFAULT_MAX_HTML_CHARS
} = {}) => {
    const evidence = {
        capturedAt: new Date().toISOString(),
        url: null,
        ...getPageRecorder(page).snapshot(mark)
    };
    const captureErrors = {};

    try {
        evidence.url = redactUrl(page.url());
    } catch {}

    if (page.isClosed()) {
        evidence.captureErrors = { page: 'Page is closed' };
        return evidence;
    }

    if (screenshot) {
        const maskedHandles = [];
        try {
            for (const f of page.frames().slice(0, MAX_MASKED_FRAMES)) {
                if (f.detached) continue;
                try {
                    maskedHandles.push(await withTimeout(
                        f.evaluateHandle(pageEvidenceOp, 'mask', SENSITIVE_CONFIG, 0),
                        1500, 'mask inputs'
                    ));
                } catch {}
            }
            const data = await withTimeout(
                page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64', captureBeyondViewport: false }),
                CAPTURE_STEP_TIMEOUT_MS, 'screenshot'
            );
            evidence.screenshot = { mimeType: 'image/jpeg', encoding: 'base64', data };
        } catch (error) {
            captureErrors.screenshot = error.message;
        } finally {
            for (const handle of maskedHandles) {
                await handle.evaluate(pageUnmaskInputs).catch(() => {});
                await handle.dispose().catch(() => {});
            }
        }
    }

    if (html) {
        try {
            const target = frame && !frame.detached ? frame : page.mainFrame();
            const snapshot = await withTimeout(
                target.evaluate(pageEvidenceOp, 'html', SENSITIVE_CONFIG, maxHtmlChars),
                CAPTURE_STEP_TIMEOUT_MS, 'html'
            );
            evidence.html = { ...snapshot, url: redactUrl(snapshot.url) };
        } catch (error) {
            captureErrors.html = error.message;
        }
    }

    if (Object.keys(captureErrors).length) evidence.captureErrors = captureErrors;
    return evidence;
};

module.exports = { getPageRecorder, captureFailureEvidence, withTimeout };
