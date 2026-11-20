// Condition-based waits and frame targeting for session commands. Polls the
// element's real state (visible, enabled, stable, unobscured, exact option
// present) instead of sleeping for a fixed time or waiting for "network idle".

const { CommandError, errorMessage } = require('./commandErrors');
const { redactUrl } = require('./redaction');

const VALID_STATES = ['attached', 'visible', 'enabled', 'stable', 'unobscured'];
const DEFAULT_WAIT_TIMEOUT_MS = 10000;
const MAX_WAIT_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 100;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const invalid = (message) => new CommandError('INVALID_REQUEST', message);

const clampTimeout = (value, fallback, field) => {
    if (value === undefined || value === null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw invalid(`${field} must be a non-negative number of milliseconds`);
    return Math.min(n, MAX_WAIT_TIMEOUT_MS);
};

/**
 * Validate `waitFor` from a request body: one spec or an array of them.
 *   { selector | xpath, state: 'visible' | [...], option: { text?, value? }, timeout }
 */
const normalizeWaitSpecs = (waitFor) => {
    if (waitFor === undefined || waitFor === null) return [];
    const list = Array.isArray(waitFor) ? waitFor : [waitFor];
    return list.map((raw, i) => {
        const field = `waitFor[${i}]`;
        const spec = typeof raw === 'string' ? { selector: raw } : raw;
        if (!spec || typeof spec !== 'object') throw invalid(`${field} must be an object or selector string`);
        const { selector, xpath } = spec;
        if (!selector === !xpath) throw invalid(`${field} needs exactly one of selector or xpath`);
        if ((selector && typeof selector !== 'string') || (xpath && typeof xpath !== 'string')) {
            throw invalid(`${field}.selector/xpath must be a string`);
        }

        const states = spec.state === undefined
            ? ['visible']
            : (Array.isArray(spec.state) ? spec.state : [spec.state]);
        for (const s of states) {
            if (!VALID_STATES.includes(s)) {
                throw invalid(`${field}.state "${s}" is not one of ${VALID_STATES.join(', ')}`);
            }
        }

        let option = null;
        if (spec.option !== undefined) {
            option = typeof spec.option === 'object' && spec.option !== null ? spec.option : { text: spec.option };
            if (option.text === undefined && option.value === undefined) {
                throw invalid(`${field}.option needs text and/or value`);
            }
            option = {
                ...(option.text !== undefined ? { text: String(option.text) } : {}),
                ...(option.value !== undefined ? { value: String(option.value) } : {})
            };
        }

        return {
            selector: selector || null,
            xpath: xpath || null,
            states,
            option,
            timeout: clampTimeout(spec.timeout, DEFAULT_WAIT_TIMEOUT_MS, `${field}.timeout`)
        };
    });
};

// In-page probe (serialized by Puppeteer; must be self-contained).
function probeElement(spec) {
    const describe = (node) => {
        if (!node || node.nodeType !== 1) return null;
        let out = node.tagName.toLowerCase();
        if (node.id) out += `#${node.id}`;
        const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
        if (cls.length) out += `.${cls.join('.')}`;
        return out;
    };
    const el = spec.xpath
        ? document.evaluate(spec.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        : document.querySelector(spec.selector);
    if (!el || el.nodeType !== 1) return { found: false, readyState: document.readyState };

    const result = { found: true, element: describe(el) };
    const wants = new Set(spec.states);
    let rect = el.getBoundingClientRect();

    if (wants.has('visible') || wants.has('unobscured')) {
        const style = getComputedStyle(el);
        result.visible = rect.width > 0 && rect.height > 0 &&
            style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
            (typeof el.checkVisibility === 'function'
                ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
                : style.display !== 'none' && parseFloat(style.opacity) !== 0);
    }
    if (wants.has('enabled')) {
        result.enabled = !el.matches(':disabled') &&
            el.getAttribute('aria-disabled') !== 'true' &&
            !el.closest('[inert]');
    }
    if (wants.has('unobscured') && result.visible) {
        let cx = rect.left + rect.width / 2;
        let cy = rect.top + rect.height / 2;
        if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) {
            // Hit-testing only works inside the viewport.
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            rect = el.getBoundingClientRect();
            cx = rect.left + rect.width / 2;
            cy = rect.top + rect.height / 2;
        }
        let hit = document.elementFromPoint(cx, cy);
        while (hit && hit.shadowRoot) {
            const inner = hit.shadowRoot.elementFromPoint(cx, cy);
            if (!inner || inner === hit) break;
            hit = inner;
        }
        const contains = (outer, inner) => {
            for (let n = inner; n; n = n.parentNode || n.host) if (n === outer) return true;
            return false;
        };
        result.unobscured = !!hit && contains(el, hit);
        if (!result.unobscured) result.obscuredBy = describe(hit);
    }
    if (spec.option) {
        const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
        const options = el.tagName === 'SELECT'
            ? Array.from(el.options)
            : Array.from(el.querySelectorAll('option, [role="option"]'));
        const valueOf = (o) => (o.tagName === 'OPTION' ? o.value : (o.getAttribute('data-value') ?? o.getAttribute('value')));
        const match = options.find(o =>
            (spec.option.value === undefined || valueOf(o) === spec.option.value) &&
            (spec.option.text === undefined || norm(o.textContent) === norm(spec.option.text) || norm(o.label) === norm(spec.option.text))
        );
        result.optionCount = options.length;
        result.optionFound = !!match;
        result.optionReady = !!match && !match.disabled && match.getAttribute('aria-disabled') !== 'true';
    }
    result.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    return result;
}

const sameRect = (a, b) => !!a && !!b &&
    ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < 0.5);

const unmetConditions = (spec, probe, previousRect) => {
    if (!probe?.found) return ['attached'];
    const unmet = [];
    for (const state of spec.states) {
        if (state === 'visible' && !probe.visible) unmet.push('visible');
        if (state === 'enabled' && !probe.enabled) unmet.push('enabled');
        if (state === 'unobscured' && !probe.unobscured) unmet.push('unobscured');
        if (state === 'stable' && !sameRect(probe.rect, previousRect)) unmet.push('stable');
    }
    if (spec.option && !probe.optionReady) unmet.push(probe.optionFound ? 'option-enabled' : 'option-present');
    return unmet;
};

/**
 * Poll until `spec` holds in `frame`. Throws SELECTOR_MISSING if the element
 * never appeared, CONDITION_NOT_MET if it appeared but never reached the
 * state, CANCELLED if isCancelled() turns true.
 */
const waitForCondition = async (frame, spec, { isCancelled = () => false } = {}) => {
    const started = Date.now();
    const deadline = started + spec.timeout;
    const pageSpec = { selector: spec.selector, xpath: spec.xpath, states: spec.states, option: spec.option };
    const target = spec.selector || spec.xpath;
    let previousRect = null;
    let probe = null;
    let lastError = null;
    let everFound = false;

    while (true) {
        if (isCancelled()) throw new CommandError('CANCELLED', `Cancelled while waiting for ${target}`, { retryable: true });
        if (frame.detached) throw new CommandError('CONTEXT_DESTROYED', `Frame detached while waiting for ${target}`, { retryable: true });

        try {
            probe = await frame.evaluate(probeElement, pageSpec);
            lastError = null;
        } catch (error) {
            // A navigation between polls just means "not there yet" - the
            // script hasn't run, so keep polling the new document.
            probe = null;
            lastError = errorMessage(error);
            if (/Target closed|Session closed|Page has been closed/i.test(lastError)) throw error;
        }
        if (probe?.found) everFound = true;

        const unmet = unmetConditions(spec, probe, previousRect);
        previousRect = probe?.rect || null;
        if (!unmet.length) {
            return { target, states: spec.states, option: spec.option || undefined, waitedMs: Date.now() - started };
        }

        if (Date.now() >= deadline) {
            const details = { target, states: spec.states, option: spec.option || undefined, unmet, lastProbe: probe, lastError: lastError || undefined, waitedMs: Date.now() - started };
            if (!probe?.found) {
                throw new CommandError(
                    'SELECTOR_MISSING',
                    `Element ${target} ${everFound ? 'disappeared and was' : 'was'} not found within ${spec.timeout}ms; the script was not run`,
                    { details }
                );
            }
            const extra = probe.obscuredBy ? ` (obscured by ${probe.obscuredBy})` : '';
            throw new CommandError(
                'CONDITION_NOT_MET',
                `Element ${target} did not become ${unmet.join(', ')} within ${spec.timeout}ms${extra}; the script was not run`,
                { details }
            );
        }
        await sleep(POLL_INTERVAL_MS);
    }
};

/**
 * Validate `frame` from a request body: { selector } (an <iframe> element),
 * { name } (frame name) and/or { url } (substring of the frame URL).
 */
const normalizeFrameSpec = (frame) => {
    if (frame === undefined || frame === null) return null;
    const spec = typeof frame === 'string' ? { selector: frame } : frame;
    if (typeof spec !== 'object') throw invalid('frame must be an object or iframe selector string');
    const out = {};
    for (const key of ['selector', 'name', 'url']) {
        if (spec[key] !== undefined) {
            if (typeof spec[key] !== 'string' || !spec[key]) throw invalid(`frame.${key} must be a non-empty string`);
            out[key] = spec[key];
        }
    }
    if (!Object.keys(out).length) throw invalid('frame needs selector, name or url');
    out.timeout = clampTimeout(frame.timeout, DEFAULT_WAIT_TIMEOUT_MS, 'frame.timeout');
    return out;
};

const describeFrameSpec = (spec) => Object.entries(spec)
    .filter(([k]) => k !== 'timeout')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

/** Find the frame `spec` names, polling while frames attach. */
const resolveFrame = async (page, spec, { isCancelled = () => false } = {}) => {
    if (!spec) return page.mainFrame();
    const deadline = Date.now() + spec.timeout;

    while (true) {
        if (isCancelled()) throw new CommandError('CANCELLED', 'Cancelled while resolving frame', { retryable: true });

        let found = null;
        if (spec.selector) {
            // The iframe element may itself be inside another frame.
            for (const f of page.frames()) {
                if (f.detached) continue;
                const handle = await f.$(spec.selector).catch(() => null);
                if (!handle) continue;
                const content = await handle.contentFrame().catch(() => null);
                await handle.dispose().catch(() => {});
                if (content) { found = content; break; }
            }
        } else {
            found = page.frames().find(f => !f.detached &&
                (spec.name === undefined || f.name() === spec.name) &&
                (spec.url === undefined || f.url().includes(spec.url))) || null;
        }
        if (found && (!spec.url || found.url().includes(spec.url))) return found;

        if (Date.now() >= deadline) {
            throw new CommandError(
                'SELECTOR_MISSING',
                `Frame ${describeFrameSpec(spec)} not found within ${spec.timeout}ms; the script was not run`,
                { details: { frame: spec, availableFrames: page.frames().slice(0, 20).map(f => ({ name: f.name() || undefined, url: redactUrl(f.url(), 300) })) } }
            );
        }
        await sleep(POLL_INTERVAL_MS * 2);
    }
};

module.exports = {
    VALID_STATES,
    normalizeWaitSpecs,
    waitForCondition,
    normalizeFrameSpec,
    resolveFrame,
    sleep
};
