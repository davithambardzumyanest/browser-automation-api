const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const { humanType } = require('../helpers/typing');
const { randomDelay } = require('../helpers/timing');

/**
 * Fill an input field with human-like typing
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {string} req.params.sessionId - The session ID
 * @param {Object} req.body - Request body
 * @param {string} req.body.selector - CSS selector for the input element
 * @param {string} req.body.text - Text to type
 * @param {boolean} [req.body.pressEnter=false] - Whether to press Enter after typing
 * @param {Object} res - Express response object
 */
const fillInput = async (req, res) => {
    const { sessionId } = req.params;
    const { selector, text, pressEnter = false, clearInput = true } = req.body;

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    if (!selector || text === undefined) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'Both selector and text are required'
        });
    }

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    // Ensure we're using the first tab
    const page = await getFirstTab(session);
    session.page = page; // Update the active page in session

    try {
        // Wait for the element to be visible
        await page.waitForSelector(selector, {
            visible: true,
            timeout: 10000
        });

        // Scroll the element into view
        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, selector);

        // Add a small delay after scrolling
        await new Promise(resolve => setTimeout(resolve, randomDelay(50, 150)));

        // Type the text with human-like behavior, honoring clearInput flag
        await humanType(page, selector, text, pressEnter, clearInput);

        res.json({
            success: true,
            message: 'Text filled successfully' + (pressEnter ? ' and Enter was pressed' : ''),
            selector,
            textLength: text.length,
            pressEnterPerformed: pressEnter
        });
    } catch (error) {
        console.error(`[${sessionId}] Error filling input:`, error);

        res.status(500).json({
            error: 'Failed to fill input',
            message: error.message,
            details: error.stack
        });
    }
};

module.exports = { fillInput };
