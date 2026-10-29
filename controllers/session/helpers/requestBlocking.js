// Proxy bandwidth saving: requests a session never needs are aborted before
// they leave the browser. Ads, beacons and prefetches are blocked in every
// session; images, fonts and media only in allowMedia:false sessions (with
// allowMedia:true they go direct instead - see helpers/directAssets.js).
//
// Interception runs on a single browser-level CDP session instead of per page
// (page.setRequestInterception). Two reasons:
// - It covers every tab from its very first request. A per-page handler is
//   attached from 'targetcreated', which fires after a popup has already
//   started loading, so its first fonts/media slipped through.
// - Fetch.enable only pauses requests that match the patterns below, and no
//   pattern matches a Document. Navigations are never paused or rebuilt, so
//   their headers (and header order) stay exactly what Chrome sends natively
//   and page.setUserAgent()'s override still applies to them - no need for
//   the document header rewrite page-level interception required (see
//   ANTI_DETECTION_TROUBLESHOOTING.md #2 and #21).
const { BLOCKED_REQUEST_PATTERNS } = require('../../../config/blockedRequestPatterns');
const { MEDIA_RESOURCE_TYPES, FORWARDED_RESOURCE_TYPES, mediaTypeOf } = require('./mediaRequests');

// Always aborted: Ping (beacons) carries nothing the session needs. Chrome's
// Fetch filter rejects TextTrack, Manifest, Prefetch, EventSource and
// WebSocket as resource types (Fetch.enable fails outright, and with it
// session creation); subtitles and manifests are tiny, and prefetches are
// caught via 'Other' below.
const ALWAYS_BLOCKED_RESOURCE_TYPES = ['Ping'];
// Also aborted when media is blocked: MEDIA_RESOURCE_TYPES, and a service
// worker's copies of such requests, which arrive as XHR/Fetch (see
// helpers/mediaRequests.js).

// Subresource types aborted when the URL matches BLOCKED_REQUEST_PATTERNS.
// Document is deliberately absent: clicking a link that routes through one of
// those domains still navigates.
const AD_RESOURCE_TYPES = ['Script', 'Stylesheet', 'XHR'];

// Types paused for every URL and decided per request: ad URLs, plus
// speculative downloads (<link rel=prefetch>) the page may never use. Seen
// from the browser target, Chrome reports a prefetch as 'Fetch' (as 'Other'
// from a page target), so it's recognised by its Sec-Purpose header. Blocking
// one is harmless: a real request for the same URL later fetches it normally.
// Everything else here is continued untouched.
const INSPECTED_RESOURCE_TYPES = ['Fetch', 'Other'];

const isSpeculative = (headers) => {
    const purpose = Object.entries(headers || {})
        .find(([name]) => name.toLowerCase() === 'sec-purpose')?.[1] || '';
    return purpose.includes('prefetch');
};

const isAdRequest = (url) => BLOCKED_REQUEST_PATTERNS.some(pattern => url.includes(pattern));

const buildPatterns = (blockedTypes, inspectedTypes) => [
    ...blockedTypes.map(resourceType => ({ urlPattern: '*', resourceType })),
    ...BLOCKED_REQUEST_PATTERNS.flatMap(pattern =>
        AD_RESOURCE_TYPES.map(resourceType => ({ urlPattern: `*${pattern}*`, resourceType }))
    ),
    ...inspectedTypes.map(resourceType => ({ urlPattern: '*', resourceType }))
];

/**
 * Block ads, beacons and prefetches (and, unless allowMedia, media and
 * fonts) across every tab of the browser.
 *
 * @param {Object} browser - Puppeteer browser
 * @param {Object} [options]
 * @param {boolean} [options.allowMedia=true] - false also blocks images,
 *   fonts and media
 */
const enableRequestBlocking = async (browser, { allowMedia = true } = {}) => {
    const blockedTypes = allowMedia
        ? ALWAYS_BLOCKED_RESOURCE_TYPES
        : [...MEDIA_RESOURCE_TYPES, ...ALWAYS_BLOCKED_RESOURCE_TYPES];
    const inspectedTypes = allowMedia
        ? INSPECTED_RESOURCE_TYPES
        : [...new Set([...INSPECTED_RESOURCE_TYPES, ...FORWARDED_RESOURCE_TYPES])];

    const shouldBlock = (event) => {
        const { resourceType, request } = event;
        if (blockedTypes.includes(resourceType)) return true;
        if (!allowMedia && FORWARDED_RESOURCE_TYPES.includes(resourceType) && mediaTypeOf(event)) return true;
        if (INSPECTED_RESOURCE_TYPES.includes(resourceType)) return isSpeculative(request.headers) || isAdRequest(request.url);
        return AD_RESOURCE_TYPES.includes(resourceType) && isAdRequest(request.url);
    };

    const cdp = await browser.target().createCDPSession();
    cdp.on('Fetch.requestPaused', async (event) => {
        try {
            if (shouldBlock(event)) {
                await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
            } else {
                await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
            }
        } catch (error) {
            // The tab or request is gone (closed page, cancelled navigation).
            if (!/Invalid InterceptionId|Target closed|Session closed/i.test(error.message)) {
                console.error('Request blocking error:', error.message);
            }
        }
    });
    await cdp.send('Fetch.enable', { patterns: buildPatterns(blockedTypes, inspectedTypes) });
};

module.exports = { enableRequestBlocking };
