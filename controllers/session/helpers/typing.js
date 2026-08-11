const { wait, randomDelay } = require('./timing');

// Above this length, character-by-character page.type() is too slow no matter
// how small the requested delay is - each keystroke is its own CDP round trip,
// so per-char overhead (not just the `delay` option) dominates for long text.
// 150 chars keeps worst-case human typing (150 * 160ms) under 25s.
const HUMAN_TYPE_MAX_LENGTH = 50;

/**
 * Simulate human-like typing with random delays and occasional mistakes
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @param {boolean} pressEnter - Whether to press Enter after typing
 */
async function humanType(page, selector, text, pressEnter = false, clearInput = false, fast = false) {
    const str = String(text);

    // Conditionally clear the input if requested
    if (clearInput) {
        try {
            // Try selecting all and deleting (works for inputs and contenteditable)
            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
        } catch (_) {
            // Fallback: direct value clear and fire events
            await page.evaluate(sel => {
                const input = document.querySelector(sel);
                if (input) {
                    input.focus();
                    if ('value' in input) input.value = '';
                    const evOpts = { bubbles: true, cancelable: true };
                    input.dispatchEvent(new Event('input', evOpts));
                    input.dispatchEvent(new Event('change', evOpts));
                }
            }, selector);
        }
        if (!fast) {
            await wait(randomDelay(50, 100));
        }
    }

    if (str.length > 0) {
        if (str.length <= HUMAN_TYPE_MAX_LENGTH) {
            // Short enough to type character-by-character within the time budget.
            await page.type(selector, str, { delay: randomDelay(80, 160) });
        } else {
            // Too long to type character-by-character in reasonable time -
            // set the value directly so the fill completes almost instantly.
            await page.evaluate((sel, value) => {
                const input = document.querySelector(sel);
                if (input) {
                    input.focus();
                    if ('value' in input) {
                        input.value = value;
                    } else {
                        input.textContent = value;
                    }
                    const evOpts = { bubbles: true, cancelable: true };
                    input.dispatchEvent(new Event('input', evOpts));
                    input.dispatchEvent(new Event('change', evOpts));
                }
            }, selector, str);
        }
    }

    // Optionally press Enter
    if (pressEnter) {
        await wait(randomDelay(100, 250));
        // Set up the navigation listener BEFORE pressing Enter (not after) -
        // otherwise a fast navigation can start and finish before we begin
        // waiting for it, and we'd hang until the timeout for nothing. This
        // used to fire-and-forget: the /fill response (and thus whatever the
        // caller checks next, e.g. a screenshot to see if a challenge showed
        // up) could land mid-navigation, on a transitional/interstitial
        // state rather than the settled result page. Non-fatal: some
        // Enter-presses don't trigger a full navigation at all.
        const navigationPromise = page
            .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => null);
        await page.keyboard.press('Enter');
        await navigationPromise;
    }
}

module.exports = { humanType, HUMAN_TYPE_MAX_LENGTH };
