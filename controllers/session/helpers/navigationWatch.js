// Bounded navigation waiting for click-style handlers.
//
// The naive `waitForNavigation` after a click costs the full navigation
// timeout on every click that does not navigate - which is most of them.
// This watches for a navigation actually *starting* (the main frame's
// document request going out, or the frame committing) and only then waits
// for it to finish. A click that navigates nothing returns after the short
// grace window instead of after the timeout.

const { wait } = require('./timing');

const GRACE = Symbol('grace');

/**
 * Arm a navigation watch. Must be called *before* the click, so a fast
 * redirect cannot fire in the gap between the click and the wait being
 * set up.
 *
 * @param {Object} page - Puppeteer page
 * @param {Object} options
 * @param {number} options.timeout - Max ms to wait once a navigation started
 * @param {number} options.grace - Max ms to wait for a navigation to start
 * @returns {{settle: () => Promise<boolean>, cancel: () => void}}
 */
const armNavigation = (page, { timeout, grace }) => {
    let started = false;

    const onRequest = (request) => {
        try {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
                started = true;
            }
        } catch (_) {
            // Request/frame can be gone already; nothing to record.
        }
    };
    const onFrameNavigated = (frame) => {
        if (frame === page.mainFrame()) started = true;
    };

    // Listening only - no request interception is enabled here, so nothing
    // has to be continue()d and no interception deadlock is possible.
    page.on('request', onRequest);
    page.on('framenavigated', onFrameNavigated);

    const navigation = page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout })
        .then(() => true)
        .catch(() => false);

    const cancel = () => {
        page.off('request', onRequest);
        page.off('framenavigated', onFrameNavigated);
    };

    return {
        cancel,
        async settle() {
            try {
                const raced = await Promise.race([
                    navigation,
                    wait(grace).then(() => GRACE)
                ]);

                // Navigation already finished inside the grace window.
                if (raced !== GRACE) return raced;

                // Nothing in flight: the click did not navigate, so don't
                // burn the rest of the timeout finding that out.
                if (!started) return false;

                // Something is loading - now the full timeout is worth paying.
                return await navigation;
            } finally {
                cancel();
            }
        }
    };
};

module.exports = { armNavigation };
