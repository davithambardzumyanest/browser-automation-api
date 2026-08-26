// Shared element-resolution helpers for the click handlers (/click, /click-xpath).
//
// Both handlers need the same three things: turn a selector into element
// handles without paying a timeout when the element is already there, decide
// which match can actually take a mouse click, and clean the handles up.

const { wait } = require('./timing');

// A malformed selector throws on every frame and on every poll, so it must
// fail fast and loudly instead of being mistaken for "element not there yet"
// and costing the caller the whole timeout. Detaching-frame errors ("Execution
// context was destroyed", "Target closed", "detached Frame") don't match this.
const INVALID_SELECTOR = /is not a valid (XPath|selector)|SyntaxError|failed to execute 'querySelector/i;

const isInvalidSelectorError = (error) => INVALID_SELECTOR.test(error?.message || '');

// How many matches to test for visibility before giving up and using the
// first one. Each test is one cheap round trip; the cap keeps a sloppy
// selector matching hundreds of nodes from turning into hundreds of them.
const MAX_VISIBILITY_PROBES = 5;

/**
 * Ask the page, in one round trip, whether the element can take a real mouse
 * click: rendered at a non-zero size, and actually the topmost thing at its
 * own center. Without the elementFromPoint half, an element sitting under an
 * overlay takes a "successful" mouse click that the overlay swallows - the
 * request reports clicked:true while the element's handler never runs.
 */
const probeElement = (handle) => handle.evaluate((el) => {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        return { visible: false, unobstructed: false };
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return { visible: false, unobstructed: false };
    }

    const topmost = el.ownerDocument.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
    );
    // A descendant is fine - the click bubbles up to el. An ancestor or an
    // unrelated node means something else would receive the event.
    return {
        visible: true,
        unobstructed: !!topmost && (topmost === el || el.contains(topmost))
    };
}).catch(() => ({ visible: false, unobstructed: false }));

const disposeAll = (handles) =>
    Promise.all(handles.map((handle) => handle.dispose().catch(() => {})));

/**
 * Resolve a selector to element handles.
 *
 * Ordered fastest-first: one query of the main frame covers the common case.
 * Only a miss pays for the iframe scan, and only a miss in every frame pays
 * for waiting. Frames are scanned before waiting, not after - scanning is a
 * couple of cheap round trips, while waiting is whole seconds, so the other
 * order makes every in-iframe element cost the full timeout.
 *
 * The wait is a single bounded poll, not a retry loop with its own sleeps:
 * a selector that is never going to match must cost `timeout` and nothing
 * more, so a caller can predict the worst case from the request alone.
 *
 * @param {Object} page - Puppeteer page
 * @param {Object} options
 * @param {string} options.query - Puppeteer selector (CSS, or `xpath/...`)
 * @param {number} options.timeout - Max ms to wait for a match to appear
 * @param {boolean} [options.searchFrames=true] - Scan iframes on a main-frame miss
 * @param {boolean} [options.pierce=false] - Retry with `pierce/` for shadow roots
 */
const resolveHandles = async (page, { query, timeout, searchFrames = true, pierce = false }) => {
    const attempt = async () => {
        const frames = searchFrames ? page.frames() : [page.mainFrame()];
        for (const frame of frames) {
            try {
                let handles = await frame.$$(query);
                if (handles.length === 0 && pierce) {
                    handles = await frame.$$(`pierce/${query}`).catch(() => []);
                }
                if (handles.length > 0) return { handles, frame };
            } catch (frameError) {
                if (isInvalidSelectorError(frameError)) throw frameError;
                // Frame may be detaching mid-navigation; try the next one.
            }
        }
        return null;
    };

    const first = await attempt();
    if (first) return first;

    // Element isn't there yet - poll until the deadline so late-rendered
    // elements (and elements in frames that attach late) are still found.
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        await wait(Math.min(100, Math.max(0, deadline - Date.now())));
        const found = await attempt();
        if (found) return found;
    }

    return { handles: [], frame: null };
};

/**
 * Pick which match to click: an explicit index when the caller gave one,
 * otherwise the first match that is visible and unobstructed, preferring a
 * merely-visible one over nothing before falling back to the first match.
 */
const pickHandle = async (handles, index) => {
    if (typeof index === 'number') {
        const handle = handles[index] || null;
        const probe = handle ? await probeElement(handle) : { visible: null, unobstructed: null };
        return { handle, index, ...probe };
    }

    const probes = Math.min(handles.length, MAX_VISIBILITY_PROBES);
    let firstVisible = null;

    for (let i = 0; i < probes; i++) {
        const probe = await probeElement(handles[i]);
        if (probe.visible && probe.unobstructed) {
            return { handle: handles[i], index: i, ...probe };
        }
        if (probe.visible && !firstVisible) {
            firstVisible = { handle: handles[i], index: i, ...probe };
        }
    }

    if (firstVisible) return firstVisible;
    return { handle: handles[0], index: 0, visible: false, unobstructed: false };
};

module.exports = {
    probeElement,
    pickHandle,
    disposeAll,
    resolveHandles,
    isInvalidSelectorError,
    MAX_VISIBILITY_PROBES
};
