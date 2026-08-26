const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const { randomDelay } = require('../helpers/timing');
const { resolveHandles, pickHandle, disposeAll, isInvalidSelectorError } = require('../helpers/clickTargets');

// Puppeteer ships an `xpath/` query handler, so an XPath can be handed to the
// same $/$$/waitForSelector machinery as a CSS selector - no manual
// document.evaluate + handle plumbing needed. Resolution, visibility probing
// and handle cleanup are shared with /click via helpers/clickTargets.
const asPuppeteerSelector = (xpath) => `xpath/${xpath}`;

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

        const resolved = await resolveHandles(page, {
            query: asPuppeteerSelector(xpath),
            timeout,
            searchFrames
        });
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
        if (isInvalidSelectorError(error)) {
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
