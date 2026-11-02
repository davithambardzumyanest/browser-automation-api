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
// Every GET of those types goes direct, from any host, first-party included.
// That includes XHR/Fetch requests that are really static files: a service
// worker's copies and a video player's segments (see helpers/mediaRequests.js).
// Every other XHR/Fetch is continued untouched. The exceptions (see
// directFetchSite):
// - captcha/anti-bot vendors and challenge paths (config/directAssetRules.js),
// - hosts already on the Chrome bypass list (Chrome fetches those directly
//   itself, with its own TLS stack),
// - scripts that look dynamic rather than static: a query string and no static
//   file extension (config endpoints, ad verification),
// - "Other" requests (preloads, prefetches, favicons) that don't match a
//   proxyBypass path pattern ("/*.js", "/*.ico", ...).
// Paused requests carry no cookies (Chrome adds them below the Fetch layer)
// and the direct fetch sends none.
// A redirect is handed to Chrome, which follows it and pauses the next hop
// here again. If the direct fetch fails, times out, answers anything other
// than 200/206 or is larger than MAX_DIRECT_BYTES, the request falls back to
// the proxy, so a page never breaks because of this.
//
// Images, fonts and media are the exception: an allowMedia:false session
// blocks them outright, so an allowMedia:true session must not spend proxy
// bandwidth on them either. They never fall back - a tracking pixel, or a file
// whose direct fetch fails, is blocked instead (MEDIA_BLOCKED). Only anti-bot
// requests (captcha image tiles) still use the proxy, as they must.
//
// A video stream signed for the IP that requested it (YouTube's ip= parameter
// is the proxy's) answers the direct fetch with an error, and is blocked like
// any other failed media request: the page renders but that video won't play.
//
// What a server can see: the server IP instead of the proxy IP for these
// files, Node's TLS fingerprint instead of Chrome's, and no cookies. The page
// itself can see fulfilled requests in the Resource Timing API (no
// connection timing).
const { getDomain } = require('tldts');
const { isAntiBotRequest, isTrackingHost } = require('../../../config/directAssetRules');
const { MEDIA_RESOURCE_TYPES, FORWARDED_RESOURCE_TYPES, VERSIONED_BUNDLE_RE, forwardedTypeOf, getHeader } = require('./mediaRequests');

const DIRECT_RESOURCE_TYPES = ['Script', 'Stylesheet', 'Image', 'Font', 'Media'];
// What Chrome types <link rel=modulepreload/prefetch>, speculation-rule
// prefetches and favicons as. Too broad to send direct on the third-party
// rule alone (beacons and odd fetches land here too), so only taken when the
// URL matches a proxyBypass path pattern ("/*.js", "/*.ico", ...).
const PATH_ONLY_RESOURCE_TYPES = ['Other'];
// directFetchSite's answer for a tracking pixel (see the header note).
const MEDIA_BLOCKED = Symbol('media blocked');
// Image CDNs of Google and tracker-listed companies, whose query strings are
// signatures/sizes on a real image, not tracking: anything on gstatic, ggpht or
// googleusercontent (search thumbnails encrypted-tbn0.gstatic.com/images?q=,
// favicons, Maps place photos and Street View), YouTube thumbnails
// i.ytimg.com/vi/...?sqp=, Google Maps tiles and Facebook/Instagram/LinkedIn/
// TikTok/Pinterest/Reddit media. reCAPTCHA on gstatic never gets this far: it's
// an anti-bot path.
const IMAGE_CDN_HOST_RE = /^([\w-]+\.gstatic\.com|i\d?\.ytimg\.com|[\w-]+\.googleusercontent\.com|[\w-]+\.ggpht\.com|maps\.googleapis\.com|streetviewpixels-pa\.googleapis\.com|(khms?|mts?|cbk)\d*\.google(apis)?\.com|[\w.-]+\.fbcdn\.net|[\w.-]+\.cdninstagram\.com|media(-\w+)?\.licdn\.com|[\w.-]+\.tiktokcdn(-\w+)?\.com|[\w-]+\.pinimg\.com|[\w.-]+\.redd\.it|[\w.-]+\.redditmedia\.com)$/;
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
const BEACON_PATH_RE = /\/(b\/ss|collect|pixel|beacon|track|gen_204|generate_204|ping|pagead|sync|usersync\d*|cksync|cookie[-_]?sync|setuid|rum|hit|tap\.php|cm|activity|conversion)(\/|\.|\?|$)/i;
// A path can read like a beacon and still be a picture
// (/track/album-cover.jpg, /collect/summer.png). GIF stays out: it's the
// classic pixel format.
const PHOTO_FILE_RE = /\.(jpe?g|png|webp|avif|svg)$/i;
// Ad-tech id-sync pixels on hosts no list can keep up with: named for what they
// do (sync.1rx.io, pixel-sync.sitescout.com), or carrying consent strings or a
// redirect target no image CDN needs.
const SYNC_HOST_RE = /(^|[.-])(\w*sync|pixel|match|cookie|beacon|tracking|tracker|analytics|adx?|rtb)\d*([.-])/i;
const SYNC_QUERY_RE = /^(gdpr|gdpr_consent|us_privacy|gpp|gpp_sid|redir|redirect|rurl|puid|partner_uid|external_user_id)$/i;

/**
 * Whether an image is a tracking pixel. Only on evidence: an image with a query
 * string and no extension is far more often a real one (i.vimeocdn.com/video/
 * 123-d_640?region=us, pbs.twimg.com/media/x?format=jpg, resizing CDNs) than a
 * pixel, and a pixel this misses costs one small direct fetch, while blocking a
 * real image breaks the page.
 */
const isTrackingPixel = (url, fetchSite, tracking) => {
    if (BEACON_PATH_RE.test(url.pathname) && !PHOTO_FILE_RE.test(url.pathname)) return true;
    if (!url.search || fetchSite !== 'cross-site') return false;
    return tracking || SYNC_HOST_RE.test(url.hostname) || [...url.searchParams.keys()].some(key => SYNC_QUERY_RE.test(key));
};

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

// Fetch metadata for a forwarded request: an image or stylesheet keeps its
// destination (fetch(event.request)); anything recognised only by its URL may
// equally be the page's own fetch(), so it's sent as one.
const forwardedFetchMetadata = (headers) => {
    const accept = getHeader(headers, 'accept') || '';
    if (/^image\//i.test(accept)) return FETCH_METADATA.Image;
    if (/^text\/css/i.test(accept)) return FETCH_METADATA.Stylesheet;
    return { dest: 'empty', mode: 'cors' };
};

// The bytes of a POST: postDataEntries, because Chrome's postData string is a
// lossy text rendering of a binary body.
const requestBodyOf = ({ method, hasPostData, postDataEntries }) => {
    if (method === 'GET' || !hasPostData) return undefined;
    if (!postDataEntries) throw new Error('request body unavailable');
    return Buffer.concat(postDataEntries.map(entry => Buffer.from(entry.bytes || '', 'base64')));
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
    // Paused for static files that arrive as XHR/Fetch (see the header note).
    // With allowMedia:false their images, fonts and media never get here:
    // helpers/requestBlocking.js has already blocked them.
    const pausedTypes = [...interceptedTypes, ...FORWARDED_RESOURCE_TYPES];

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
    const directFetchSite = async ({ request, resourceType, frameId, forwarded }) => {
        // Only a video stream goes direct as a POST (see mediaTypeOf).
        const streamPost = forwarded && resourceType === 'Media';
        if ((request.method !== 'GET' && !streamPost) || !interceptedTypes.includes(resourceType)) return null;

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
            if (IMAGE_CDN_HOST_RE.test(url.hostname)) return fetchSite;
            return isTrackingPixel(url, fetchSite, tracking) ? MEDIA_BLOCKED : fetchSite;
        }
        // Stylesheet, Font, Media
        return fetchSite;
    };

    const fetchDirect = async ({ request, resourceType, forwarded }, fetchSite) => {
        const headers = {};
        for (const [name, value] of Object.entries(request.headers || {})) {
            if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
        }
        const metadata = forwarded
            ? forwardedFetchMetadata(request.headers)
            : FETCH_METADATA[resourceType] || otherFetchMetadata(new URL(request.url).pathname, request.headers);
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
            method: request.method,
            body: requestBodyOf(request),
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS)
        });
        const responseHeaders = [];
        for (const [name, value] of response.headers) {
            if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.push({ name, value });
        }
        if (REDIRECT_STATUSES.includes(response.status) && response.headers.has('location')) {
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

    // Media has no fallback, so a dropped connection would cost the image: it
    // gets one more try. Only connection-level errors, which carry a code; a
    // timeout has already waited DIRECT_TIMEOUT_MS.
    const fetchMediaWithRetry = (event, fetchSite) => fetchDirect(event, fetchSite).catch(error => {
        if (!MEDIA_RESOURCE_TYPES.includes(event.resourceType) || !error.cause?.code) throw error;
        return fetchDirect(event, fetchSite);
    });

    const cdp = await browser.target().createCDPSession();
    cdp.on('Fetch.requestPaused', async (pausedEvent) => {
        // A static file that arrived as XHR/Fetch is handled as its real type;
        // any other XHR/Fetch is continued untouched.
        let event = pausedEvent;
        if (FORWARDED_RESOURCE_TYPES.includes(pausedEvent.resourceType)) {
            const staticType = forwardedTypeOf(pausedEvent);
            event = staticType ? { ...pausedEvent, resourceType: staticType, forwarded: true } : null;
        }
        const isMedia = Boolean(event) && MEDIA_RESOURCE_TYPES.includes(event.resourceType);

        let direct = null;
        let blocked = false;
        if (event) {
            try {
                const fetchSite = await directFetchSite(event);
                if (fetchSite === MEDIA_BLOCKED) {
                    blocked = true;
                    if (DEBUG) console.log(`[direct-asset] blocked ${event.resourceType} ${event.request.url}`);
                } else if (fetchSite) {
                    direct = await fetchMediaWithRetry(event, fetchSite).catch(error => ({ fallback: error.cause?.code || error.message }));
                    if (direct.fallback) {
                        // See the header note: media never falls back.
                        blocked = isMedia;
                        if (DEBUG) console.log(`[direct-asset] ${blocked ? 'blocked' : 'fallback'} (${direct.fallback}) ${event.resourceType} ${event.request.url}`);
                        if (!blocked) stats.fallbacks++;
                        direct = null;
                    } else if (DEBUG) {
                        console.log(`[direct-asset] direct ${direct.status} ${event.resourceType} ${event.request.url}`);
                    }
                }
            } catch (error) {
                console.error('Direct asset check failed:', error.message);
                blocked = isMedia;
            }
        }

        try {
            if (blocked) {
                await cdp.send('Fetch.failRequest', { requestId: pausedEvent.requestId, errorReason: 'BlockedByClient' });
                stats.blocked++;
            } else if (direct) {
                await cdp.send('Fetch.fulfillRequest', {
                    requestId: pausedEvent.requestId,
                    responseCode: direct.status,
                    responseHeaders: direct.headers,
                    body: direct.body.toString('base64')
                });
                stats.requests++;
                stats.bytes += direct.body.length;
            } else {
                await cdp.send('Fetch.continueRequest', { requestId: pausedEvent.requestId });
            }
        } catch (error) {
            // The tab or request is gone (closed page, cancelled navigation).
            if (!/Invalid InterceptionId|Target closed|Session closed/i.test(error.message)) {
                console.error('Direct asset error:', error.message);
            }
        }
    });
    await cdp.send('Fetch.enable', {
        patterns: pausedTypes.map(resourceType => ({ urlPattern: '*', resourceType }))
    });

    return stats;
};

module.exports = { enableDirectAssets };
