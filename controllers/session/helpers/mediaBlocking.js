// Bandwidth saving for allowMedia:false sessions.
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

// Always aborted. Beyond the heavy media types, Ping (beacons) carries nothing
// the session needs. Chrome's Fetch filter rejects TextTrack, Manifest and
// Prefetch as resource types (Fetch.enable fails outright); subtitles and
// manifests are tiny, and prefetches are caught via 'Other' below.
const BLOCKED_RESOURCE_TYPES = ['Image', 'Font', 'Media', 'Ping'];

// Subresource types aborted when the URL matches BLOCKED_REQUEST_PATTERNS.
// Document is deliberately absent: clicking a link that routes through one of
// those domains still navigates.
const AD_RESOURCE_TYPES = ['Script', 'Stylesheet', 'XHR', 'EventSource'];

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

const buildPatterns = () => [
    ...BLOCKED_RESOURCE_TYPES.map(resourceType => ({ urlPattern: '*', resourceType })),
    ...BLOCKED_REQUEST_PATTERNS.flatMap(pattern =>
        AD_RESOURCE_TYPES.map(resourceType => ({ urlPattern: `*${pattern}*`, resourceType }))
    ),
    ...INSPECTED_RESOURCE_TYPES.map(resourceType => ({ urlPattern: '*', resourceType }))
];

const shouldBlock = ({ resourceType, request }) => {
    if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) return true;
    if (INSPECTED_RESOURCE_TYPES.includes(resourceType)) return isSpeculative(request.headers) || isAdRequest(request.url);
    return AD_RESOURCE_TYPES.includes(resourceType) && isAdRequest(request.url);
};

/**
 * Block media, fonts, prefetches and ad/tracking subresources across every
 * tab of the browser.
 *
 * @param {Object} browser - Puppeteer browser
 */
const enableMediaBlocking = async (browser) => {
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
                console.error('Media blocking error:', error.message);
            }
        }
    });
    await cdp.send('Fetch.enable', { patterns: buildPatterns() });
};

module.exports = { enableMediaBlocking };
