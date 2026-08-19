// Tab management helpers shared by several handlers.

/**
 * Resolve the session's first tab.
 *
 * `focus` controls whether the tab is also brought to the front. Focusing
 * costs a full CDP round trip, which is only worth paying for handlers that
 * actually interact with the page (click/type/screenshot need the tab
 * rendered and hit-testable). Read-only DOM queries do not - and with a
 * non-zero `slowMo` on the session that single extra round trip is delayed
 * by the whole slowMo value, doubling the latency of a query that otherwise
 * takes ~1ms. Defaults to true so existing callers keep the old behavior.
 *
 * @param {Object} session - The session object
 * @param {Object} [options]
 * @param {boolean} [options.focus=true] - Bring the tab to the front
 */
async function getFirstTab(session, { focus = true } = {}) {
    try {
        const pages = await session.browser.pages();
        if (pages.length === 0) {
            const newPage = await session.browser.newPage();
            await newPage.setViewport({ width: 1366, height: 768 });
            return newPage;
        }

        // Focus the first tab
        const firstPage = pages[0];
        if (focus) {
            await firstPage.bringToFront();
        }
        return firstPage;
    } catch (error) {
        console.error('Error in getFirstTab:', error);
        throw error;
    }
}

/**
 * Close all tabs except the first one
 * @param {Object} session - The session object
 */
async function closeExtraTabs(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length > 1) {
            // Close all but the first tab
            for (let i = 1; i < pages.length; i++) {
                try {
                    await pages[i].close();
                } catch (closeError) {
                    console.error('Error closing tab:', closeError);
                }
            }
            // Update the active page to the first tab
            session.page = await getFirstTab(session);
        }
    } catch (error) {
        console.error('Error in closeExtraTabs:', error);
        throw error;
    }
}

module.exports = { getFirstTab, closeExtraTabs };
