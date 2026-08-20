const { sessions } = require('../state');
const { setupPageRealism } = require('../helpers/browserFingerprint');
const { attachDialogGuard } = require('../helpers/dialogs');
const { applyProxyAuth } = require('../helpers/proxyAuth');

const navigateSession = async (req, res) => {
    const { sessionId } = req.params;
    const { url, waitUntil = 'domcontentloaded', timeout = 90000, referer, newTab = false } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const parsedUrl = new URL(url);

        // Block Chrome extension URLs and other invalid protocols
        if (parsedUrl.protocol === 'chrome-extension:') {
            return res.status(400).json({
                error: 'Invalid URL protocol',
                message: 'Chrome extension URLs are not supported for navigation'
            });
        }

        // Only allow http, https, and file protocols
        if (!['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({
                error: 'Invalid URL protocol',
                message: 'Only HTTP, HTTPS, and file URLs are supported'
            });
        }
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format', message: err.message });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        const options = { waitUntil, timeout };
        if (referer) {
            options.referer = referer;
        }

        const browser = session.browser;
        const pages = await browser.pages();

        // Close all tabs except the first one
        for (let i = pages.length - 1; i > 0; i--) {
            try {
                await pages[i].close();
            } catch (e) {
                console.error(`Error closing tab ${i}:`, e);
            }
        }

        // Get the first (and only) remaining tab
        const [firstPage] = await browser.pages();
        if (!firstPage) {
            throw new Error('No pages available after closing tabs');
        }

        // Update session's page reference
        session.page = firstPage;

        // If newTab is requested, open a new tab after closing others
        let targetPage = firstPage;
        if (newTab) {
            targetPage = await browser.newPage();
            session.page = targetPage;
        }

        // Update the session's page reference
        session.page = targetPage;

        // If geolocation config exists, pre-authorize and set geolocation before navigation
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                const origin = new URL(url).origin;
                const context = browser.defaultBrowserContext();
                // Pre-authorize the target origin
                try {
                    await context.overridePermissions(origin, ['geolocation']);
                } catch (permErr) {
                    console.warn('Failed to override geolocation permissions:', permErr.message);
                }
                // Also re-authorize any configured origins
                if (Array.isArray(cfg.geolocationOrigins)) {
                    for (const o of cfg.geolocationOrigins) {
                        try {
                            await context.overridePermissions(o, ['geolocation']);
                        } catch (permErr) {
                            console.warn(`Failed to override geolocation for ${o}:`, permErr.message);
                        }
                    }
                }

                // Grant permission for all current frame origins (main + iframes)
                try {
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}

                // Keep granting for any later iframe navigations
                try {
                    const grantForFrame = async (frame) => {
                        try {
                            const u = frame.url();
                            if (u && u.startsWith('http')) {
                                await context.overridePermissions(new URL(u).origin, ['geolocation']);
                            }
                        } catch (_) {}
                    };
                    targetPage.on('framenavigated', grantForFrame);
                } catch (_) {}
                try {
                    await targetPage.setGeolocation(cfg.geolocation);
                } catch (geoErr) {
                    console.warn('Failed to apply geolocation on target page:', geoErr.message);
                }
            }
        } catch (prepErr) {
            console.warn('Geolocation pre-navigation setup failed:', prepErr.message);
        }

        // Re-apply UA/viewport/timezone/headers/fingerprint spoofing to
        // whatever page object we ended up with. Overrides applied once at
        // session-creation time were found NOT to reliably survive to the
        // page object a later /goto call resolves via browser.pages()[0] -
        // confirmed directly: a session's initial page correctly reported
        // the spoofed UA via JS, but after navigating through this handler,
        // both navigator.userAgent and the actual wire-level User-Agent
        // header seen by the destination server had silently reverted to
        // Chromium's raw native identity (HeadlessChrome/<bundled-version>,
        // generic Sec-CH-UA brands). setupPageRealism() is idempotent enough
        // to call again here (registerBrowserRealism specifically guards
        // against piling up duplicate evaluateOnNewDocument scripts).
        // The page resolved above may be a different object than the one
        // guarded at session creation (a popup, or a tab that replaced it), and
        // an unguarded dialog freezes every later action on it. Idempotent, so
        // re-guarding the same page is free.
        if (session.blockDialogs !== false) {
            attachDialogGuard(targetPage, {
                action: session.dialogAction || 'dismiss',
                stats: session.dialogStats
            });
        }

        // Same per-page story as the dialog guard: credentials are registered
        // on a Page, so a page resolved later needs its own registration
        // rather than relying on Chrome's credential cache.
        if (session.proxyCredentials) {
            await applyProxyAuth(targetPage, session.proxyCredentials);
        }

        if (session.browserProfile && session.requestHeaders) {
            try {
                await setupPageRealism(targetPage, session.browserProfile, session.requestHeaders);
            } catch (realismError) {
                console.warn(`[${sessionId}] Failed to re-apply page realism before navigation:`, realismError.message);
            }
        }

        // Navigate to the URL
        try {
            await targetPage.goto(url, options);
        } catch (navError) {
            // Handle common navigation errors
            if (navError.message.includes('ERR_BLOCKED_BY_CLIENT') ||
                navError.message.includes('chrome-extension://')) {
                console.warn('Navigation blocked by browser extension, attempting recovery...');

                // Try to close any extension pages that might have opened
                try {
                    const pages = await browser.pages();
                    for (const page of pages) {
                        const pageUrl = page.url();
                        if (pageUrl.startsWith('chrome-extension://')) {
                            console.log('Closing extension page:', pageUrl);
                            await page.close();
                        }
                    }

                    // Get a fresh page reference
                    const freshPages = await browser.pages();
                    const activePage = freshPages.find(p => !p.url().startsWith('chrome-extension://')) || freshPages[0];
                    session.page = activePage;

                    // Retry navigation with more permissive options
                    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (retryError) {
                    throw new Error(`Navigation failed due to browser extension interference. Try restarting the browser session or disable extensions. Error: ${retryError.message}`);
                }
            } else if (navError.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                       navError.message.includes('net::ERR_CONNECTION_TIMED_OUT') ||
                       navError.message.includes('net::ERR_CONNECTION_REFUSED')) {
                throw new Error(`Network error: ${navError.message}. Please check the URL and network connectivity.`);
            } else {
                throw navError;
            }
        }
        // Re-apply geolocation after navigation in case the page asked during load, and re-grant iframe origins
        try {
            const cfg = session.config || {};
            if (cfg.geolocation && cfg.grantGeolocationOnNavigation) {
                await targetPage.setGeolocation(cfg.geolocation);
                try {
                    const context = browser.defaultBrowserContext();
                    const frames = targetPage.frames();
                    const uniqueOrigins = new Set();
                    for (const f of frames) {
                        try {
                            const furl = f.url();
                            if (furl && furl.startsWith('http')) uniqueOrigins.add(new URL(furl).origin);
                        } catch (_) {}
                    }
                    for (const o of uniqueOrigins) {
                        try { await context.overridePermissions(o, ['geolocation']); } catch (_) {}
                    }
                } catch (_) {}
            }
        } catch (postNavGeoErr) {
            console.warn('Failed to re-apply geolocation after navigation:', postNavGeoErr.message);
        }
        const pageTitle = await targetPage.title();
        const pageUrl = targetPage.url();

        res.json({
            success: true,
            sessionId,
            title: pageTitle,
            url: pageUrl,
            tabCount: (await browser.pages()).length
        });
    } catch (error) {
        console.error('Error navigating:', error);
        res.status(500).json({
            error: 'Failed to navigate',
            message: error.message
        });
    }
};

module.exports = { navigateSession };
