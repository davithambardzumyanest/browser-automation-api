const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const { wait, randomDelay } = require('../helpers/timing');

// Puppeteer ships an `xpath/` query handler, so an XPath can be handed to the
// same $/$$/waitForSelector machinery as a CSS selector - no manual
// document.evaluate + handle plumbing needed.
const asPuppeteerSelector = (xpath) => `xpath/${xpath}`;

// How many matches to test for visibility before giving up and using the
// first one. Each test is one cheap round trip; the cap keeps a sloppy XPath
// matching hundreds of nodes from turning into hundreds of round trips.
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
 * Resolve the XPath to element handles.
 *
 * Ordered fastest-first: one query of the main frame covers the common case.
 * Only a miss pays for the iframe scan, and only a miss in every frame pays
 * for waiting. Frames are scanned before waiting, not after - scanning is a
 * couple of cheap round trips, while waiting is whole seconds, so the old
 * order made every in-iframe element cost the full timeout.
 */
const resolveHandles = async (page, xpath, { timeout, searchFrames }) => {
    const selector = asPuppeteerSelector(xpath);

    const attempt = async () => {
        const frames = searchFrames ? page.frames() : [page.mainFrame()];
        for (const frame of frames) {
            try {
                const handles = await frame.$$(selector);
                if (handles.length > 0) return { handles, frame };
            } catch (frameError) {
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

/**
 * Click the first element matching an XPath.
 *
 * Built for latency: one query round trip in the common case, a real mouse
 * click via Puppeteer (which auto-scrolls the element into view and computes
 * a clickable point), and - unlike /click - no unconditional wait on
 * navigation. Callers that need the navigation opt in with waitForNavigation.
 *
 * @param {Object} req - Express request object
 * @param {string} req.params.sessionId - The session ID
 * @param {string} req.body.xpath - XPath of the element to click
 * @param {number} [req.body.index] - Which match to click (default: first visible)
 * @param {number} [req.body.timeout=3000] - Max ms to wait for the element to appear
 * @param {boolean} [req.body.waitForNavigation=false] - Wait for a navigation caused by the click
 * @param {number} [req.body.navigationTimeout=10000] - Max ms to wait when waitForNavigation is set
 * @param {boolean} [req.body.searchFrames=true] - Also look inside iframes on a main-frame miss
 * @param {boolean} [req.body.domFallback=true] - Fall back to element.click() if the mouse click fails
 * @param {number} [req.body.clickDelay] - Mousedown→mouseup hold in ms (default: random 20-80)
 * @param {Object} res - Express response object
 */
const clickXPath = async (req, res) => {
    const { sessionId } = req.params;
    const {
        xpath,
        index,
        timeout = 3000,
        waitForNavigation = false,
        navigationTimeout = 10000,
        searchFrames = true,
        domFallback = true,
        clickDelay
    } = req.body || {};

    if (!xpath) {
        return res.status(400).json({ error: 'XPath is required' });
    }

    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
        return res.status(400).json({ error: 'index must be a non-negative integer' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    let handles = [];
    let chosen = null;

    try {
        // Unlike check-xpath, a click does need the tab focused: the mouse
        // events are dispatched against the foreground tab's render surface.
        const page = await getFirstTab(session);
        session.page = page;
        session.lastActivity = Date.now();

        const originalUrl = page.url();

        const resolved = await resolveHandles(page, xpath, { timeout, searchFrames });
        handles = resolved.handles;

        if (handles.length === 0) {
            return res.status(404).json({
                error: 'Element not found',
                message: `No element matched XPath: ${xpath}`,
                xpath,
                matches: 0,
                sessionId
            });
        }

        const picked = await pickHandle(handles, index);
        chosen = picked.handle;

        if (!chosen) {
            return res.status(404).json({
                error: 'Element not found',
                message: `XPath matched ${handles.length} element(s) but index ${index} is out of range`,
                xpath,
                matches: handles.length,
                sessionId
            });
        }

        // Arm the navigation wait before clicking so a fast redirect can't
        // fire in the gap between the click and the wait being set up.
        const navigationPromise = waitForNavigation
            ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navigationTimeout })
                .then(() => true)
                .catch(() => false)
            : null;

        // Puppeteer's click scrolls the element into view and picks a
        // clickable point itself, so no separate scroll round trip.
        // A hidden or covered element can't receive a real mouse click, so go
        // straight to the in-page dispatch rather than clicking whatever is on
        // top of it.
        const clickable = picked.visible && picked.unobstructed;
        let method = 'mouse';

        if (clickable) {
            try {
                await chosen.click({ delay: clickDelay ?? randomDelay(20, 80) });
            } catch (mouseError) {
                if (!domFallback) throw mouseError;
                console.log(`Mouse click failed for XPath, falling back to DOM click: ${mouseError.message}`);
                await chosen.evaluate((el) => el.click());
                method = 'dom';
            }
        } else {
            if (!domFallback) {
                return res.status(409).json({
                    error: 'Element not clickable',
                    message: picked.visible
                        ? 'Element is covered by another element'
                        : 'Element is not visible',
                    xpath,
                    matches: handles.length,
                    index: picked.index,
                    sessionId
                });
            }
            await chosen.evaluate((el) => el.click());
            method = 'dom';
        }

        const navigated = navigationPromise ? await navigationPromise : false;

        return res.json({
            success: true,
            sessionId,
            xpath,
            clicked: true,
            method,
            matches: handles.length,
            index: picked.index,
            visible: picked.visible,
            unobstructed: picked.unobstructed,
            navigated: navigated || page.url() !== originalUrl,
            url: page.url()
        });

    } catch (error) {
        console.error('Error in clickXPath:', error);

        // An invalid expression is the caller's mistake, not a server fault.
        // Keep only the first line: Puppeteer appends its own internal
        // evaluateHandle stack to the message, which is noise for the caller.
        if (/is not a valid XPath|SyntaxError/i.test(error.message || '')) {
            return res.status(400).json({
                error: 'Invalid XPath',
                message: String(error.message).split('\n')[0],
                xpath
            });
        }

        return res.status(500).json({
            error: 'Failed to click element',
            message: error.message,
            xpath,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        await disposeAll(handles);
    }
};

module.exports = { clickXPath };
