// Proxy bandwidth saving: fetch third-party static assets (scripts,
// stylesheets, images, fonts, media) directly from this server instead of
// through the session's proxy.
//
// Chrome's --proxy-bypass-list (config/proxyBypassHosts.js) can only route by
// host, so this works one level up: requests of those resource types are
// paused on a browser-level CDP Fetch session (same approach as
// helpers/mediaBlocking.js, so every tab is covered from its first request),
// downloaded here with Node's fetch, and handed back with Fetch.fulfillRequest.
//
// A request only goes direct when ALL of these hold - otherwise it is
// continued untouched through the proxy:
// - Its site (eTLD+1) differs from the top-level page's site, the requesting
//   frame's site and the Referer's site. The site being visited never sees
//   the server IP.
// - Its host is not Google-owned, an anti-bot/captcha vendor or a tracker
//   (config/directAssetRules.js).
// - Its host is not already on the Chrome bypass list (Chrome fetches those
//   directly itself, with its own TLS stack - better than ours).
// - It is a plain GET with no cookies attached. Chrome adds cookies below
//   the Fetch layer, so a paused request never carries them and the direct
//   fetch sends none.
// Exception: a request whose URL path matches one of the session's path
// patterns ("/*.png" entries of proxyBypass, see config/proxyBypassHosts.js)
// goes direct even when it is first-party or has a query string. The other
// rules still apply to it.
// If the direct fetch fails, times out, redirects, answers anything other
// than 200/206 or is larger than MAX_DIRECT_BYTES, the request falls back to
// the proxy, so a page never breaks because of this.
//
// Residual differences a third-party CDN could see: Node's TLS fingerprint
// instead of Chrome's, and no cookies. The page itself can see fulfilled
// requests in the Resource Timing API (no connection timing), which is why
// first-party and anti-bot requests are excluded.
const { getDomain } = require('tldts');
const { isNeverDirectHost } = require('../../../config/directAssetRules');

const DIRECT_RESOURCE_TYPES = ['Script', 'Stylesheet', 'Image', 'Font', 'Media'];
const MEDIA_RESOURCE_TYPES = ['Image', 'Font', 'Media'];

const DIRECT_TIMEOUT_MS = 20000;
const MAX_DIRECT_BYTES = 25 * 1024 * 1024;
// Log every asset served directly / fallen back, to audit what skips the proxy.
const DEBUG = false;

// Request headers Node's fetch sets itself or refuses.
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'cookie']);
// Response headers that describe the wire encoding Node already undid.
const DROPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

// What Chrome's network layer would add below the Fetch domain for a
// cross-site subresource of this type.
const FETCH_METADATA = {
    Script: { dest: 'script', mode: 'no-cors' },
    Stylesheet: { dest: 'style', mode: 'no-cors' },
    Image: { dest: 'image', mode: 'no-cors' },
    Font: { dest: 'font', mode: 'cors' },
    Media: { dest: 'video', mode: 'no-cors' }
};

const siteOf = (url) => {
    try {
        const { hostname } = new URL(url);
        return getDomain(hostname) || hostname;
    } catch (_) {
        return null;
    }
};

// "*" wildcard patterns: Chrome --proxy-bypass-list hosts ("*.example.com",
// "cdn.example.com") and proxyBypass path patterns ("/*.png", "/static/*").
const buildGlobMatcher = (patterns) => {
    const regexes = (patterns || []).map(pattern => new RegExp(
        `^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i'
    ));
    return (value) => regexes.some(re => re.test(value));
};

const getHeader = (headers, name) =>
    Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

/**
 * Read a response body, giving up past MAX_DIRECT_BYTES.
 * @returns {Promise<Buffer|null>} null when the body was too large
 */
const readBody = async (response) => {
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_DIRECT_BYTES) return null;

    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_DIRECT_BYTES) return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

/**
 * Serve third-party static assets directly instead of through the proxy,
 * across every tab of the browser.
 *
 * @param {Object} browser - Puppeteer browser
 * @param {Object} options
 * @param {string[]} [options.bypassHosts] - the session's --proxy-bypass-list
 * @param {string[]} [options.bypassPaths] - URL path patterns always fetched
 *   directly, first-party included
 * @param {Object} [options.clientHints] - sec-ch-ua headers Chrome would send
 * @param {boolean} [options.allowMedia=true] - false leaves images, fonts and
 *   media to helpers/mediaBlocking.js
 * @returns {Promise<{requests: number, bytes: number, fallbacks: number}>}
 *   live counters for this browser
 */
const enableDirectAssets = async (browser, { bypassHosts = [], bypassPaths = [], clientHints = {}, allowMedia = true } = {}) => {
    const stats = { requests: 0, bytes: 0, fallbacks: 0 };
    const isBypassed = buildGlobMatcher(bypassHosts);
    const isBypassedPath = buildGlobMatcher(bypassPaths);
    const resourceTypes = allowMedia
        ? DIRECT_RESOURCE_TYPES
        : DIRECT_RESOURCE_TYPES.filter(type => !MEDIA_RESOURCE_TYPES.includes(type));

    // frameId -> Puppeteer Frame, rebuilt from browser.pages() on a miss.
    let frames = new Map();
    const findFrame = async (frameId) => {
        const cached = frames.get(frameId);
        if (cached && !cached.detached) return cached;
        frames = new Map();
        for (const page of await browser.pages()) {
            for (const frame of page.frames()) frames.set(frame._id, frame);
        }
        return frames.get(frameId) || null;
    };

    // Decide from the paused event whether this request may go direct.
    const isDirectCandidate = async ({ request, resourceType, frameId }) => {
        if (request.method !== 'GET' || !resourceTypes.includes(resourceType)) return false;

        let hostname, pathname;
        try {
            const url = new URL(request.url);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
            ({ hostname, pathname } = url);
        } catch (_) {
            return false;
        }
        if (isBypassed(hostname) || isNeverDirectHost(hostname)) return false;
        if (isBypassedPath(pathname)) return true;
        // Tracking and ID-sync pixels are images carrying a query string;
        // real images on third-party CDNs rarely need one.
        if (resourceType === 'Image' && new URL(request.url).search) return false;

        const frame = frameId ? await findFrame(frameId) : null;
        if (!frame) return false;
        const pageSites = [frame.page().mainFrame().url(), frame.url(), getHeader(request.headers, 'referer')]
            .map(url => url && siteOf(url));
        if (!pageSites[0] || !pageSites[1]) return false;

        const assetSite = siteOf(request.url);
        return !pageSites.includes(assetSite);
    };

    const fetchDirect = async ({ request, resourceType }) => {
        const headers = {};
        for (const [name, value] of Object.entries(request.headers || {})) {
            if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
        }
        const metadata = FETCH_METADATA[resourceType];
        Object.assign(headers, clientHints, {
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': metadata.mode,
            'Sec-Fetch-Dest': metadata.dest
        });

        const response = await fetch(request.url, {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS)
        });
        if (response.status !== 200 && response.status !== 206) {
            response.body?.cancel().catch(() => {});
            return { fallback: `status ${response.status}` };
        }
        const body = await readBody(response);
        if (!body) return { fallback: 'too large' };

        const responseHeaders = [];
        for (const [name, value] of response.headers) {
            if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.push({ name, value });
        }
        return { status: response.status, headers: responseHeaders, body };
    };

    const cdp = await browser.target().createCDPSession();
    cdp.on('Fetch.requestPaused', async (event) => {
        let direct = null;
        try {
            if (await isDirectCandidate(event)) {
                direct = await fetchDirect(event).catch(error => ({ fallback: error.cause?.code || error.message }));
                if (DEBUG) console.log(`[direct-asset] ${direct.fallback ? `fallback (${direct.fallback})` : `direct ${direct.status}`} ${event.resourceType} ${event.request.url}`);
                if (direct.fallback) {
                    stats.fallbacks++;
                    direct = null;
                }
            }
        } catch (error) {
            console.error('Direct asset check failed:', error.message);
        }

        try {
            if (direct) {
                await cdp.send('Fetch.fulfillRequest', {
                    requestId: event.requestId,
                    responseCode: direct.status,
                    responseHeaders: direct.headers,
                    body: direct.body.toString('base64')
                });
                stats.requests++;
                stats.bytes += direct.body.length;
            } else {
                await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
            }
        } catch (error) {
            // The tab or request is gone (closed page, cancelled navigation).
            if (!/Invalid InterceptionId|Target closed|Session closed/i.test(error.message)) {
                console.error('Direct asset error:', error.message);
            }
        }
    });
    await cdp.send('Fetch.enable', {
        patterns: resourceTypes.map(resourceType => ({ urlPattern: '*', resourceType }))
    });

    return stats;
};

module.exports = { enableDirectAssets };
