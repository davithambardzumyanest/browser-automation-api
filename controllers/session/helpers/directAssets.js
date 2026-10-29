// Proxy bandwidth saving: fetch static resources (scripts, stylesheets,
// images, fonts, media) directly from this server instead of through the
// session's proxy. Pages, XHR/fetch API calls and form posts stay on the
// proxy; resources are most of a page's bytes.
//
// Chrome's --proxy-bypass-list (config/proxyBypassHosts.js) can only route by
// host, so this works one level up: requests of those resource types are
// paused on a browser-level CDP Fetch session (same approach as
// helpers/requestBlocking.js, so every tab is covered from its first request),
// downloaded here with Node's fetch, and handed back with Fetch.fulfillRequest.
//
// Every GET of those types goes direct, from any host, first-party included,
// except (see directFetchSite):
// - captcha/anti-bot vendors and challenge paths (config/directAssetRules.js),
// - hosts already on the Chrome bypass list (Chrome fetches those directly
//   itself, with its own TLS stack),
// - requests that look dynamic rather than static: a script with a query
//   string and no static file extension (config endpoints, ad verification),
//   and tracking pixels - cross-site images with a query string and no image
//   extension, or any image on a beacon path,
// - "Other" requests (preloads, prefetches, favicons) that don't match a
//   proxyBypass path pattern ("/*.js", "/*.ico", ...).
// Paused requests carry no cookies (Chrome adds them below the Fetch layer)
// and the direct fetch sends none.
// If the direct fetch fails, times out, redirects, answers anything other
// than 200/206 or is larger than MAX_DIRECT_BYTES, the request falls back to
// the proxy, so a page never breaks because of this.
//
// Images, fonts and media are the exception: an allowMedia:false session
// blocks them outright, so an allowMedia:true session must not spend proxy
// bandwidth on them either. They never fall back - a tracking pixel that
// would stay on the proxy, or a file whose direct fetch fails, is blocked
// instead (MEDIA_BLOCKED). A redirect is handed to Chrome, which follows it
// and pauses the next hop here again. Only anti-bot requests (captcha image
// tiles) still use the proxy, as they must.
//
// What a server can see: the server IP instead of the proxy IP for these
// files, Node's TLS fingerprint instead of Chrome's, and no cookies. The page
// itself can see fulfilled requests in the Resource Timing API (no
// connection timing).
const { getDomain } = require('tldts');
const { isAntiBotRequest, isTrackingHost } = require('../../../config/directAssetRules');

const DIRECT_RESOURCE_TYPES = ['Script', 'Stylesheet', 'Image', 'Font', 'Media'];
// What Chrome types <link rel=modulepreload/prefetch>, speculation-rule
// prefetches and favicons as. Too broad to send direct on the third-party
// rule alone (beacons and odd fetches land here too), so only taken when the
// URL matches a proxyBypass path pattern ("/*.js", "/*.ico", ...).
const PATH_ONLY_RESOURCE_TYPES = ['Other'];
const MEDIA_RESOURCE_TYPES = ['Image', 'Font', 'Media'];
// directFetchSite's answer for an image that would otherwise stay on the
// proxy (see the header note).
const MEDIA_BLOCKED = Symbol('media blocked');
// Google image hosts whose query strings are signatures/sizes on a real
// image, not tracking (search thumbnails encrypted-tbn0.gstatic.com/images?q=,
// YouTube thumbnails i.ytimg.com/vi/...?sqp=).
const GOOGLE_IMAGE_HOST_RE = /^(encrypted-tbn\d+\.gstatic\.com|i\d?\.ytimg\.com|[\w-]+\.googleusercontent\.com|yt\d\.ggpht\.com)$/;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

const DIRECT_TIMEOUT_MS = 20000;
const MAX_DIRECT_BYTES = 25 * 1024 * 1024;
// Media asks for "bytes=N-" (the rest of the file). Capped to this much per
// request so a large video fits under MAX_DIRECT_BYTES; Chrome's media
// loader requests the next range itself.
const MEDIA_RANGE_BYTES = 8 * 1024 * 1024;
// Log every asset served directly / fallen back, to audit what skips the proxy.
const DEBUG = false;

// Request headers Node's fetch sets itself or refuses.
// Conditional headers too: a 304 answer can't be handed to Chrome, and would
// send the request to the proxy.
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'cookie', 'if-none-match', 'if-modified-since']);
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

// Fetch metadata for an "Other" request, from what it fetches: a
// modulepreload of a script is cors/script, a favicon no-cors/image. A
// prefetch (Sec-Purpose header) is always dest empty.
// Analytics and ad beacons that arrive as images (Adobe /b/ss/, GA /collect,
// Google /gen_204 and /pagead/, id-sync pixels).
const BEACON_PATH_RE = /\/(b\/ss|collect|pixel|beacon|track|gen_204|ping|pagead|sync|setuid|rum|hit|tap\.php|cm|activity|conversion)(\/|\.|\?|$)/i;
// Static files despite a query string, the same for every visitor: Google's
// versioned JS/CSS bundles (Search /xjs/_/js/k=...?xjs=s1, Maps
// /maps/_/js/k=..., /_/ss/k=...) and Google tag scripts (gtag/js?id=...,
// gtm.js?id=..., also on a site's own server-side tagging host).
const VERSIONED_BUNDLE_RE = /\/_\/(js|ss)\/k=|\/gtag\/js$|\/gtm\.js$/;

// Same-origin/same-site/cross-site, as Chrome computes Sec-Fetch-Site.
const fetchSiteOf = (pageUrl, requestUrl) => {
    try {
        const page = new URL(pageUrl);
        const target = new URL(requestUrl);
        if (page.origin === target.origin) return 'same-origin';
        return siteOf(pageUrl) === siteOf(requestUrl) ? 'same-site' : 'cross-site';
    } catch (_) {
        return 'cross-site';
    }
};

const otherFetchMetadata = (pathname, headers) => {
    if (getHeader(headers, 'sec-purpose')) return { dest: 'empty', mode: 'no-cors' };
    if (/\.m?js$/i.test(pathname)) return { dest: 'script', mode: 'cors' };
    if (/\.css$/i.test(pathname)) return { dest: 'style', mode: 'no-cors' };
    if (/\.(woff2?|ttf|otf)$/i.test(pathname)) return { dest: 'font', mode: 'cors' };
    if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(pathname)) return { dest: 'image', mode: 'no-cors' };
    return { dest: 'empty', mode: 'no-cors' };
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
 * Serve static resources directly instead of through the proxy, across every
 * tab of the browser.
 *
 * @param {Object} browser - Puppeteer browser
 * @param {Object} options
 * @param {string[]} [options.bypassHosts] - the session's --proxy-bypass-list
 * @param {string[]} [options.bypassPaths] - URL path patterns always fetched
 *   directly, first-party included
 * @param {Object} [options.clientHints] - sec-ch-ua headers Chrome would send
 * @param {boolean} [options.allowMedia=true] - false leaves images, fonts and
 *   media to helpers/requestBlocking.js
 * @returns {Promise<{requests: number, bytes: number, fallbacks: number, blocked: number}>}
 *   live counters for this browser
 */
const enableDirectAssets = async (browser, { bypassHosts = [], bypassPaths = [], clientHints = {}, allowMedia = true } = {}) => {
    const stats = { requests: 0, bytes: 0, fallbacks: 0, blocked: 0 };
    const isBypassed = buildGlobMatcher(bypassHosts);
    const isBypassedPath = buildGlobMatcher(bypassPaths);
    const resourceTypes = allowMedia
        ? DIRECT_RESOURCE_TYPES
        : DIRECT_RESOURCE_TYPES.filter(type => !MEDIA_RESOURCE_TYPES.includes(type));
    const interceptedTypes = bypassPaths.length ? [...resourceTypes, ...PATH_ONLY_RESOURCE_TYPES] : resourceTypes;

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

    // Decide from the paused event whether this request goes direct: the
    // Sec-Fetch-Site value to send with it, null to keep it on the proxy, or
    // MEDIA_BLOCKED.
    const directFetchSite = async ({ request, resourceType, frameId }) => {
        if (request.method !== 'GET' || !interceptedTypes.includes(resourceType)) return null;

        let url;
        try {
            url = new URL(request.url);
        } catch (_) {
            return null;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (isBypassed(url.hostname) || isAntiBotRequest(url)) return null;

        const frame = frameId ? await findFrame(frameId) : null;
        const fetchSite = fetchSiteOf(frame?.url() || getHeader(request.headers, 'referer'), request.url);
        const hasQuery = Boolean(url.search);
        const bundle = VERSIONED_BUNDLE_RE.test(url.pathname);
        const staticPath = bundle || isBypassedPath(url.pathname);
        const tracking = isTrackingHost(url.hostname);

        if (PATH_ONLY_RESOURCE_TYPES.includes(resourceType)) {
            return bundle || (staticPath && !(hasQuery && tracking)) ? fetchSite : null;
        }
        if (resourceType === 'Script') {
            if (bundle) return fetchSite;
            if (hasQuery && !staticPath) return null;
            // On Google/tracker hosts a .js URL with a long query is a
            // logging call (visit.js?gdpr=&brver=...), not a file; a short one
            // is a versioned file (gtm.js?id=, pubads_impl.js?cb=).
            if (hasQuery && tracking && [...url.searchParams.keys()].length > 2) return null;
            return fetchSite;
        }
        if (resourceType === 'Image') {
            if (BEACON_PATH_RE.test(url.pathname)) return MEDIA_BLOCKED;
            if (GOOGLE_IMAGE_HOST_RE.test(url.hostname)) return fetchSite;
            if (hasQuery && fetchSite === 'cross-site' && (tracking || !staticPath)) return MEDIA_BLOCKED;
            return fetchSite;
        }
        // Stylesheet, Font, Media
        return fetchSite;
    };

    const fetchDirect = async ({ request, resourceType }, fetchSite) => {
        const headers = {};
        for (const [name, value] of Object.entries(request.headers || {})) {
            if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
        }
        const metadata = FETCH_METADATA[resourceType]
            || otherFetchMetadata(new URL(request.url).pathname, request.headers);
        Object.assign(headers, clientHints, {
            'Sec-Fetch-Site': fetchSite,
            'Sec-Fetch-Mode': metadata.mode,
            'Sec-Fetch-Dest': metadata.dest
        });
        if (resourceType === 'Media') {
            const rangeHeader = Object.keys(headers).find(name => name.toLowerCase() === 'range');
            const openRange = rangeHeader && /^bytes=(\d+)-$/.exec(headers[rangeHeader]);
            if (openRange) {
                const start = Number(openRange[1]);
                headers[rangeHeader] = `bytes=${start}-${start + MEDIA_RANGE_BYTES - 1}`;
            }
        }

        const response = await fetch(request.url, {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS)
        });
        const responseHeaders = [];
        for (const [name, value] of response.headers) {
            if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.push({ name, value });
        }
        if (MEDIA_RESOURCE_TYPES.includes(resourceType) && REDIRECT_STATUSES.includes(response.status) && response.headers.has('location')) {
            response.body?.cancel().catch(() => {});
            return { status: response.status, headers: responseHeaders, body: Buffer.alloc(0) };
        }
        if (response.status !== 200 && response.status !== 206) {
            response.body?.cancel().catch(() => {});
            return { fallback: `status ${response.status}` };
        }
        const body = await readBody(response);
        if (!body) return { fallback: 'too large' };

        return { status: response.status, headers: responseHeaders, body };
    };

    const cdp = await browser.target().createCDPSession();
    cdp.on('Fetch.requestPaused', async (event) => {
        let direct = null;
        let blocked = false;
        try {
            const fetchSite = await directFetchSite(event);
            if (fetchSite === MEDIA_BLOCKED) {
                blocked = true;
                if (DEBUG) console.log(`[direct-asset] blocked ${event.resourceType} ${event.request.url}`);
            } else if (fetchSite) {
                direct = await fetchDirect(event, fetchSite).catch(error => ({ fallback: error.cause?.code || error.message }));
                if (direct.fallback) {
                    // See the header note: media never falls back.
                    blocked = MEDIA_RESOURCE_TYPES.includes(event.resourceType);
                    if (DEBUG) console.log(`[direct-asset] ${blocked ? 'blocked' : 'fallback'} (${direct.fallback}) ${event.resourceType} ${event.request.url}`);
                    if (!blocked) stats.fallbacks++;
                    direct = null;
                } else if (DEBUG) {
                    console.log(`[direct-asset] direct ${direct.status} ${event.resourceType} ${event.request.url}`);
                }
            }
        } catch (error) {
            console.error('Direct asset check failed:', error.message);
        }

        try {
            if (blocked) {
                await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
                stats.blocked++;
            } else if (direct) {
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
        patterns: interceptedTypes.map(resourceType => ({ urlPattern: '*', resourceType }))
    });

    return stats;
};

module.exports = { enableDirectAssets };
