// Javascript dialog (alert/confirm/prompt/beforeunload) handling.
//
// Chrome blocks the entire renderer while a javascript dialog is open, and
// Puppeteer does NOT close dialogs on its own: CdpPage#onDialog only emits a
// 'dialog' event (see puppeteer-core/lib/cjs/puppeteer/cdp/Page.js). With no
// listener the dialog just stays open, so every later click, type, evaluate
// or navigation on that page hangs until the CDP protocol timeout - which is
// what "after an alert, clicks stop working" looks like from the outside.
//
// The only reliable fix is to guarantee a listener on every page, including
// popups and any tab opened later, and to close each dialog the moment it
// opens.

// Which dialog types must always be accepted rather than dismissed:
// - alert has a single OK button, so accept and dismiss are equivalent; accept
//   matches what a user pressing OK does.
// - beforeunload must be accepted or the navigation the page was in the middle
//   of gets cancelled, which strands the session on the old page.
const ALWAYS_ACCEPT = new Set(['alert', 'beforeunload']);

// Pages we've already guarded. A WeakSet rather than a flag on the page keeps
// us from mutating Puppeteer's objects, and lets guarded pages be collected.
const guardedPages = new WeakSet();

/**
 * Attach the dialog guard to a single page.
 *
 * @param {Object} page - Puppeteer page
 * @param {Object} [options]
 * @param {'dismiss'|'accept'} [options.action='dismiss'] - What to do with
 *   confirm/prompt dialogs. alert/beforeunload are always accepted.
 * @param {Object} [options.stats] - Mutable counter object recording what was
 *   handled, so a session can report why a page behaved unexpectedly.
 */
const attachDialogGuard = (page, { action = 'dismiss', stats } = {}) => {
    if (!page || guardedPages.has(page)) return;
    guardedPages.add(page);

    page.on('dialog', async (dialog) => {
        const type = dialog.type();
        const message = dialog.message();
        const decision = ALWAYS_ACCEPT.has(type) ? 'accept' : action;

        if (stats) {
            stats.handled += 1;
            stats.last = { type, message, action: decision, at: Date.now() };
        }

        try {
            if (decision === 'accept') {
                await dialog.accept();
            } else {
                await dialog.dismiss();
            }
            console.log(`Auto-${decision}ed ${type} dialog: ${String(message).slice(0, 200)}`);
        } catch (error) {
            // Already handled elsewhere, or the page went away mid-dialog.
            console.error(`Failed to close ${type} dialog:`, error.message);
        }
    });
};

module.exports = { attachDialogGuard };
