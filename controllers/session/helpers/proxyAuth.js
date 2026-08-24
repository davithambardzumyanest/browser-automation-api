// Proxy authentication.
//
// Chrome's --proxy-server flag carries no credentials: user:pass embedded in
// that URL is ignored by Chrome, and the proxy answers 407. Credentials are
// supplied over CDP instead, by page.authenticate(), which responds to
// Fetch.authRequired events. That is a PER-PAGE registration - it is not a
// browser-wide setting, and it is unrelated to javascript dialogs (Puppeteer's
// Dialog only ever has type alert/confirm/prompt/beforeunload and has no
// authenticate() method, so a 'dialog' listener can never supply proxy
// credentials).
//
// In practice Chrome's network service caches credentials after the first
// successful auth, so a later tab usually inherits them - but that is a cache,
// not a guarantee: it does not survive a credential change, and a tab that
// makes its first request before the initial page has authenticated once races
// it. Registering on every page removes the dependency on that cache.

const authenticatedPages = new WeakSet();

/**
 * Normalize whatever the caller passed as `proxy` into credentials.
 * Accepts { server, username, password } or a URL string with credentials
 * embedded (http://user:pass@host:port).
 *
 * @returns {{username: string, password: string}|null}
 */
const getProxyCredentials = (proxy) => {
    if (!proxy) return null;

    if (typeof proxy === 'object') {
        if (!proxy.username || !proxy.password) return null;
        return { username: String(proxy.username), password: String(proxy.password) };
    }

    if (typeof proxy === 'string') {
        try {
            const parsed = new URL(proxy);
            if (!parsed.username || !parsed.password) return null;
            // Credentials in the URL are percent-encoded; Chrome/the proxy want
            // the raw values.
            return {
                username: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password)
            };
        } catch (_) {
            return null;
        }
    }

    return null;
};

/**
 * The proxy URL with any credentials removed, for --proxy-server. Chrome
 * ignores credentials there, and some builds reject the whole flag when they
 * are present, which silently drops the proxy entirely.
 */
const stripProxyCredentials = (proxyUrl) => {
    if (typeof proxyUrl !== 'string') return proxyUrl;
    try {
        const parsed = new URL(proxyUrl);
        if (!parsed.username && !parsed.password) return proxyUrl;
        parsed.username = '';
        parsed.password = '';
        return parsed.toString().replace(/\/$/, '');
    } catch (_) {
        return proxyUrl;
    }
};

/**
 * Build a single "http://user:pass@host:port" URL from whatever shape the
 * caller's `proxy` option came in - the input format proxy-chain's
 * anonymizeProxy() needs (it parses credentials back out of this string
 * itself; --proxy-server can never carry them, see the module comment).
 *
 * @returns {string|null} null if there are no credentials to embed (a bare
 *   proxy string/object with no username+password needs no anonymizing).
 */
const buildAuthenticatedProxyUrl = (proxy) => {
    const credentials = getProxyCredentials(proxy);
    if (!credentials) return null;

    const server = typeof proxy === 'string' ? proxy : proxy.server;
    if (!server) return null;

    try {
        const parsed = new URL(server);
        parsed.username = encodeURIComponent(credentials.username);
        parsed.password = encodeURIComponent(credentials.password);
        return parsed.toString().replace(/\/$/, '');
    } catch (_) {
        return null;
    }
};

/**
 * Register proxy credentials on a page. Idempotent per page.
 *
 * @param {Object} page - Puppeteer page
 * @param {{username: string, password: string}|null} credentials
 * @returns {Promise<boolean>} whether credentials are now registered
 */
const applyProxyAuth = async (page, credentials) => {
    if (!page || !credentials) return false;
    if (authenticatedPages.has(page)) return true;

    try {
        await page.authenticate(credentials);
        authenticatedPages.add(page);
        return true;
    } catch (error) {
        console.error('Failed to apply proxy authentication to page:', error.message);
        return false;
    }
};

module.exports = { getProxyCredentials, stripProxyCredentials, applyProxyAuth, buildAuthenticatedProxyUrl };
