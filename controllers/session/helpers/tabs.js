// Tab management helpers shared by several handlers.

async function getFirstTab(session) {
    try {
        const pages = await session.browser.pages();
        if (pages.length === 0) {
            const newPage = await session.browser.newPage();
            await newPage.setViewport({ width: 1366, height: 768 });
            return newPage;
        }

        // Focus the first tab
        const firstPage = pages[0];
        await firstPage.bringToFront();
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
