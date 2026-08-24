// Pre-flight a rotating/sticky proxy credential against Google Search before
// spending a browser session on it.
//
// Why this exists (see docs/ANTI_DETECTION_TROUBLESHOOTING.md #19): a large
// minority of this proxy pool's exit IPs are already flagged by Google and
// answer /search with a 302 to /sorry/index (the captcha) for ANY client -
// plain curl included, no browser or fingerprint involved. Sampling the pool
// on 2026-08-24 measured ~20% flagged. A browser session created on one of
// those IPs is guaranteed to hit the captcha no matter how clean its
// fingerprint is, and you've already paid the full cost of launching Chrome
// by the time you find out.
//
// A HEAD-ish probe costs ~1s and no browser, so check first and only create
// the session once an IP comes back clean.
//
// Credentials are never stored here - the caller passes its own proxy config,
// exactly as it does to /session/create.

const CHECK_URL = 'https://www.google.com/search?q=coffee+shops&hl=en';

/**
 * Build the proxy URL string used for the probe.
 * Accepts the same shapes /session/create accepts.
 */
const toProxyUrl = (proxy) => {
    if (!proxy) return null;
    if (typeof proxy === 'string') return proxy;
    const { server, username, password } = proxy;
    if (!server) return null;
    if (!username || !password) return server;
    try {
        const u = new URL(server);
        u.username = encodeURIComponent(username);
        u.password = encodeURIComponent(password);
        return u.toString().replace(/\/$/, '');
    } catch (_) {
        return null;
    }
};

/**
 * Is this specific proxy exit IP currently clean for Google Search?
 *
 * Google answers a flagged IP with a 3xx redirect to /sorry/index, so a
 * non-redirect response is the signal. Deliberately does NOT follow
 * redirects - the redirect itself is the answer.
 *
 * @param {object|string} proxy - same shape as /session/create's `proxy`
 * @param {object} [opts]
 * @param {string} [opts.userAgent] - UA to probe with; use the same one the
 *   session will use, since Google's response can vary by client type.
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<{clean: boolean, status: number|null, error?: string}>}
 */
const isProxyCleanForGoogle = async (proxy, opts = {}) => {
    const { userAgent, timeoutMs = 15000 } = opts;
    const proxyUrl = toProxyUrl(proxy);
    if (!proxyUrl) return { clean: false, status: null, error: 'invalid proxy config' };

    // axios + https-proxy-agent, both already direct dependencies of this
    // project (no new install needed for a preflight helper).
    const axios = require('axios');
    const { HttpsProxyAgent } = require('https-proxy-agent');

    try {
        const res = await axios.get(CHECK_URL, {
            httpsAgent: new HttpsProxyAgent(proxyUrl),
            proxy: false, // let the agent do it; axios's own proxy option would double up
            maxRedirects: 0, // the redirect IS the signal - never follow it
            timeout: timeoutMs,
            headers: userAgent ? { 'User-Agent': userAgent } : {},
            // Treat 3xx as a normal response to inspect rather than a throw.
            validateStatus: (s) => s >= 200 && s < 400,
            responseType: 'text',
            // A flagged IP answers with a tiny redirect body; a clean one
            // returns a full SERP we don't need - cap what we pull down.
            maxContentLength: 512 * 1024
        });
        const location = res.headers?.location || '';
        const redirectedToSorry = res.status >= 300 && /\/sorry\//.test(String(location));
        return { clean: res.status === 200 && !redirectedToSorry, status: res.status };
    } catch (error) {
        // A 302-to-/sorry can surface here depending on axios version/config.
        const status = error.response?.status ?? null;
        const location = error.response?.headers?.location || '';
        if (status && status >= 300 && status < 400) {
            return { clean: false, status, error: /\/sorry\//.test(String(location)) ? 'captcha redirect' : 'redirect' };
        }
        return { clean: false, status, error: error.message };
    }
};

/**
 * Rotate a sticky-session proxy credential until an unflagged exit IP turns
 * up, and hand back the proxy config to actually create the session with.
 *
 * `makeProxy(sessionId)` must return a proxy config for that rotation key -
 * the caller owns how its credential encodes the key (for SOAX that's the
 * `sessionid-<value>` segment of the username), so no credential format is
 * assumed or hardcoded here.
 *
 * @param {(sessionKey: string) => object|string} makeProxy
 * @param {object} [opts]
 * @param {number} [opts.attempts=6]
 * @param {string} [opts.userAgent]
 * @returns {Promise<{proxy: object|string, sessionKey: string, attempts: number}>}
 * @throws if no clean IP appears within `attempts` tries
 */
const pickCleanProxySession = async (makeProxy, opts = {}) => {
    const { attempts = 6, userAgent } = opts;
    const crypto = require('crypto');

    for (let i = 1; i <= attempts; i++) {
        const sessionKey = crypto.randomBytes(8).toString('hex');
        const proxy = makeProxy(sessionKey);
        const result = await isProxyCleanForGoogle(proxy, { userAgent });
        if (result.clean) {
            return { proxy, sessionKey, attempts: i };
        }
        console.log(`[proxy-preflight] attempt ${i}/${attempts} flagged (status ${result.status ?? result.error}), rotating`);
    }
    throw new Error(`No clean proxy exit IP found in ${attempts} attempts`);
};

module.exports = { isProxyCleanForGoogle, pickCleanProxySession };
