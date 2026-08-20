const { sessions } = require('../state');

// Schemes a business-directory flow never legitimately needs. Google Maps on an
// Android UA is the common offender: its "Open app" button navigates to
// intent://...#Intent;package=com.google.android.apps.maps, and on Linux Chrome
// falls back to xdg-open, raising the native "Open xdg-open?" dialog.
const DEFAULT_BLOCKED_SCHEMES = [
    'intent', 'android-app', 'market', 'maps', 'comgooglemaps',
    'geo', 'itms-apps', 'itms-appss', 'fb', 'twitter', 'whatsapp', 'tg', 'xdg-open'
];

/**
 * Dismiss Chrome's external-protocol ("Open <app>?") dialog and stop it coming back.
 *
 * Why it works the way it does - all four points verified against Chrome 141:
 *
 *  1. That dialog is BROWSER UI (a tab-modal views dialog), not page DOM, so its
 *     Cancel button is not reachable from CDP. Input.dispatchKeyEvent with Escape
 *     is delivered to the renderer and leaves the dialog untouched.
 *  2. It does NOT block automation. With the dialog open, clicks/fills/execute all
 *     still work, because CDP input goes straight to the renderer and bypasses
 *     browser UI. Cancelling is about keeping a headful window clean and stopping a
 *     stray xdg-open, not about unblocking the run.
 *  3. Closing an open dialog requires a navigation that CHANGES ORIGIN. The dialog is
 *     keyed to the origin that asked for the launch: a same-document navigation
 *     (pushState / hash change) leaves it up, and so does a same-origin one - even a
 *     full reload of the very same URL. Only crossing to another origin closes it,
 *     so `reload` bounces through about:blank and then back to the original URL.
 *  4. Prevention is best-effort by necessity. `location.href = 'intent://...'` cannot
 *     be intercepted from JS: window.location is non-configurable and `href` is an own
 *     property of the Location instance, not an overridable prototype accessor. The
 *     guard below covers anchor clicks, window.open, Location.assign/replace, form
 *     submits and injected iframes; a direct location.href assignment still gets
 *     through. The complete fix for Maps is to not send an Android user agent.
 */
const dismissProtocolDialog = async (req, res) => {
    const { sessionId } = req.params;
    const {
        reload = true,
        // After the about:blank bounce, navigate back to the page we were on.
        returnTo = true,
        install = true,
        schemes = DEFAULT_BLOCKED_SCHEMES,
        waitUntil = 'domcontentloaded',
        timeout = 30000
    } = req.body || {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const { page } = session;

        if (!page) {
            return res.status(400).json({
                error: 'No active page found',
                message: 'Session exists but no active page is available'
            });
        }

        const blocked = Array.isArray(schemes) && schemes.length
            ? schemes.map(s => String(s).replace(/:$/, '').toLowerCase())
            : DEFAULT_BLOCKED_SCHEMES;

        let installed = false;
        if (install) {
            await installProtocolGuard(page, blocked);
            session.protocolGuardSchemes = blocked;
            installed = true;
        }

        let dismissed = false;
        let returned = false;
        const original = page.url();
        let url = original;
        if (reload) {
            // about:blank is the origin change that actually closes it. Re-navigating
            // to the same URL does NOT work, however full a reload it is (verified on
            // Chrome 141) - the dialog survives any same-origin navigation.
            await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout });
            dismissed = true;

            // Then back where we were, so the caller's flow can continue. Only for
            // real pages - about:blank/chrome:// starting points are left alone.
            if (returnTo !== false && /^https?:/i.test(original)) {
                await page.goto(original, { waitUntil, timeout });
                returned = true;
            }
            url = page.url();
        }

        res.json({
            success: true,
            sessionId,
            dismissed,
            method: dismissed ? 'about:blank-bounce' : 'none',
            guardInstalled: installed,
            blockedSchemes: blocked,
            previousUrl: original,
            returnedToPreviousUrl: returned,
            url,
            note: dismissed
                ? 'Dialog cleared by bouncing through about:blank (an origin change is required); the page was reloaded.'
                : 'Guard installed for future navigations; an already-open dialog was left alone (reload:false).'
        });

    } catch (error) {
        console.error(`Error dismissing protocol dialog in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to dismiss protocol dialog',
            message: error.message
        });
    }
};

/**
 * Install the page-level guard, for this document and every future one.
 * Overrides are toString-cloaked because this server is used against bot-sensitive
 * sites and a naked `window.open` override is a fingerprinting tell.
 */
async function installProtocolGuard(page, blocked) {
    const guard = buildGuard(blocked);
    // Future documents...
    await page.evaluateOnNewDocument(guard, blocked);
    // ...and the one already loaded.
    try {
        await page.evaluate(guard, blocked);
    } catch (e) {
        // A navigation may be in flight; the evaluateOnNewDocument copy still applies.
    }
}

function buildGuard(_blocked) {
    return function (blockedSchemes) {
        if (window.__externalProtocolGuard) {
            window.__externalProtocolGuard.schemes = blockedSchemes;
            return;
        }

        const state = { schemes: blockedSchemes, blocked: [] };
        window.__externalProtocolGuard = state;

        const isBlocked = (value) => {
            if (!value) return false;
            const m = String(value).trim().match(/^([a-z][a-z0-9+.-]*):/i);
            if (!m) return false;
            return state.schemes.indexOf(m[1].toLowerCase()) !== -1;
        };

        const record = (how, value) => {
            state.blocked.push({ how, url: String(value).slice(0, 200), at: Date.now() });
            if (state.blocked.length > 50) state.blocked.shift();
        };

        // Keep overrides indistinguishable from natives under toString().
        const cloak = (fn, original) => {
            try {
                Object.defineProperty(fn, 'name', { value: original.name });
                Object.defineProperty(fn, 'length', { value: original.length });
                fn.toString = () => original.toString();
            } catch (e) { /* non-fatal */ }
            return fn;
        };

        // 1. Anchor clicks (capture phase, before the site's own handlers).
        document.addEventListener('click', (e) => {
            const target = e.target;
            const a = target && target.closest ? target.closest('a[href]') : null;
            if (a && isBlocked(a.getAttribute('href'))) {
                record('anchor', a.getAttribute('href'));
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        // 2. window.open
        const nativeOpen = window.open;
        window.open = cloak(function (url) {
            if (isBlocked(url)) { record('window.open', url); return null; }
            return nativeOpen.apply(this, arguments);
        }, nativeOpen);

        // 3. Location.assign / Location.replace. NOTE: `location.href = ...` is
        //    deliberately absent - it is not interceptable (see the handler docblock).
        ['assign', 'replace'].forEach((method) => {
            const native = Location.prototype[method];
            if (typeof native !== 'function') return;
            try {
                Location.prototype[method] = cloak(function (url) {
                    if (isBlocked(url)) { record('location.' + method, url); return undefined; }
                    return native.apply(this, arguments);
                }, native);
            } catch (e) { /* frozen prototype */ }
        });

        // 4. Form submits pointed at a blocked scheme.
        document.addEventListener('submit', (e) => {
            const form = e.target;
            if (form && form.getAttribute && isBlocked(form.getAttribute('action'))) {
                record('form', form.getAttribute('action'));
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        // 5. Iframes injected with a blocked src - a common silent trigger.
        const strip = (node) => {
            if (!node || node.nodeType !== 1) return;
            const el = node;
            if (el.tagName === 'IFRAME' && isBlocked(el.getAttribute('src'))) {
                record('iframe', el.getAttribute('src'));
                el.removeAttribute('src');
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        };
        try {
            new MutationObserver((records) => {
                records.forEach((r) => Array.prototype.forEach.call(r.addedNodes || [], strip));
            }).observe(document.documentElement || document, { childList: true, subtree: true });
        } catch (e) { /* document not ready */ }
    };
}

module.exports = { dismissProtocolDialog, DEFAULT_BLOCKED_SCHEMES, installProtocolGuard };
