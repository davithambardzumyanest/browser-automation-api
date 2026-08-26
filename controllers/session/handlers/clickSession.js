const { sessions } = require('../state');
const { getFirstTab, closeExtraTabs } = require('../helpers/tabs');
const { resolveHandles, pickHandle, disposeAll, isInvalidSelectorError } = require('../helpers/clickTargets');
const { armNavigation } = require('../helpers/navigationWatch');
const { randomDelay } = require('../helpers/timing');

/**
 * Click the first clickable element matching a CSS selector.
 *
 * Built for bounded latency. Every wait in here is one a caller asked for:
 *
 * - A selector that never matches costs `timeout` and then 404s. There is no
 *   retry loop, no per-attempt frame-scan timeout and no sleep between
 *   attempts - the old handler stacked three 5s frame scans plus two 1s
 *   sleeps, so "element does not exist" took ~17s to report.
 * - A click that does not navigate costs `navigationGrace`, not
 *   `navigationTimeout`. The old handler waited on a promise that could never
 *   settle (`newTabPromise` was only ever resolved on the allowNewTab path),
 *   so *every* click fell through to the full navigation timeout.
 * - Puppeteer's click scrolls the element into view and picks a clickable
 *   point itself, so there is no separate scroll round trip and no sleep
 *   waiting for smooth scrolling to finish.
 *
 * Worst case is `timeout + navigationTimeout` (default 3s + 5s).
 *
 * @param {Object} req - Express request object
 * @param {string} req.params.sessionId - The session ID
 * @param {string} req.body.selector - CSS selector of the element to click
 * @param {number} [req.body.index] - Which match to click (default: first visible)
 * @param {number} [req.body.timeout=3000] - Max ms to wait for the element to appear
 * @param {boolean} [req.body.waitForNavigation=true] - Wait for a navigation caused by the click
 * @param {number} [req.body.navigationTimeout=5000] - Max ms to wait once a navigation started
 * @param {number} [req.body.navigationGrace=1000] - Max ms to wait for a navigation to start at all
 * @param {boolean} [req.body.allowNewTab=false] - Follow a click that opens a new tab
 * @param {boolean} [req.body.searchFrames=true] - Also look inside iframes on a main-frame miss
 * @param {boolean} [req.body.domFallback=true] - Fall back to element.click() if the mouse click fails
 * @param {number} [req.body.clickDelay] - Mousedown->mouseup hold in ms (default: random 20-80)
 * @param {Object} res - Express response object
 */
const clickSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        selector,
        index,
        timeout = 3000,
        waitForNavigation = true,
        navigationTimeout = 5000,
        navigationGrace = 1000,
        allowNewTab = false,
        searchFrames = true,
        domFallback = true,
        clickDelay
    } = req.body || {};

    if (!selector) {
        return res.status(400).json({ error: 'Selector is required' });
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
    session.lastActivity = Date.now();

    let handles = [];

    try {
        // A click needs the tab focused: the mouse events are dispatched
        // against the foreground tab's render surface.
        const page = await getFirstTab(session);
        session.page = page;

        const originalUrl = page.url();

        const resolved = await resolveHandles(page, {
            query: selector,
            timeout,
            searchFrames,
            pierce: true
        });
        handles = resolved.handles;

        if (handles.length === 0) {
            return res.status(404).json({
                error: 'Element not found',
                message: `No element matched selector: ${selector}`,
                selector,
                matches: 0,
                sessionId
            });
        }

        const picked = await pickHandle(handles, index);

        if (!picked.handle) {
            return res.status(404).json({
                error: 'Element not found',
                message: `Selector matched ${handles.length} element(s) but index ${index} is out of range`,
                selector,
                matches: handles.length,
                sessionId
            });
        }

        const clickable = picked.visible && picked.unobstructed;

        // Rejected before anything is armed, so this path leaks no listeners
        // and no pending navigation wait.
        if (!clickable && !domFallback) {
            return res.status(409).json({
                error: 'Element not clickable',
                message: picked.visible
                    ? 'Element is covered by another element'
                    : 'Element is not visible',
                selector,
                matches: handles.length,
                index: picked.index,
                sessionId
            });
        }

        // Arm the navigation watch before clicking so a fast redirect can't
        // fire in the gap between the click and the wait being set up.
        const navigation = waitForNavigation
            ? armNavigation(page, { timeout: navigationTimeout, grace: navigationGrace })
            : null;

        // A click that opens a new tab: adopt it as the session's page and
        // drop the tab it was opened from, so the response reports the tab
        // the caller actually ended up on.
        let openedTab = null;
        const onTargetCreated = async (target) => {
            try {
                const newPage = await target.page();
                if (newPage && !openedTab) openedTab = newPage;
            } catch (targetError) {
                console.error('Error handling new tab:', targetError);
            }
        };
        if (allowNewTab && session.browser) {
            session.browser.on('targetcreated', onTargetCreated);
        }

        let method = 'mouse';
        try {
            // A hidden or covered element can't receive a real mouse click, so
            // go straight to the in-page dispatch rather than clicking whatever
            // is on top of it.
            if (clickable) {
                try {
                    await picked.handle.click({ delay: clickDelay ?? randomDelay(20, 80) });
                } catch (mouseError) {
                    if (!domFallback) throw mouseError;
                    console.log(`Mouse click failed, falling back to DOM click: ${mouseError.message}`);
                    await picked.handle.evaluate((el) => el.click());
                    method = 'dom';
                }
            } else {
                await picked.handle.evaluate((el) => el.click());
                method = 'dom';
            }

            const navigated = navigation ? await navigation.settle() : false;

            if (allowNewTab && session.browser) {
                session.browser.off('targetcreated', onTargetCreated);
                if (openedTab && openedTab !== page) {
                    // Close the opener first so the adopted tab becomes tab 0.
                    await page.close().catch((e) => console.error('Error closing original tab:', e));
                    session.page = openedTab;
                }
            }

            const activePage = await getFirstTab(session);
            session.page = activePage;
            session.lastActivity = Date.now();

            const finalUrl = activePage.url();
            const pageTitle = await activePage.title().catch(() => '');

            return res.json({
                success: true,
                sessionId,
                selector,
                clicked: true,
                method,
                matches: handles.length,
                index: picked.index,
                visible: picked.visible,
                unobstructed: picked.unobstructed,
                navigated: navigated || finalUrl !== originalUrl,
                url: finalUrl,
                title: pageTitle
            });

        } catch (clickError) {
            if (navigation) navigation.cancel();
            if (allowNewTab && session.browser) {
                session.browser.off('targetcreated', onTargetCreated);
            }
            throw clickError;
        }

    } catch (error) {
        console.error('Error in clickSession:', error);

        // A malformed selector is the caller's mistake, not a server fault.
        // Keep only the first line: Puppeteer appends its own internal
        // evaluateHandle stack to the message, which is noise for the caller.
        if (isInvalidSelectorError(error)) {
            return res.status(400).json({
                error: 'Invalid selector',
                message: String(error.message).split('\n')[0],
                selector
            });
        }

        // Ensure we're back on a single, usable tab even in case of error.
        try {
            if (sessions.has(sessionId)) {
                await closeExtraTabs(session);
                session.page = await getFirstTab(session);
            }
        } catch (cleanupError) {
            console.error('Error during cleanup after click error:', cleanupError);
        }

        return res.status(500).json({
            error: 'Failed to perform click action',
            message: error.message,
            selector,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        await disposeAll(handles);
    }
};

module.exports = { clickSession };
