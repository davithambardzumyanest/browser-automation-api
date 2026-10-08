// Hosts Chrome fetches directly instead of through the session's proxy
// (--proxy-bypass-list). Residential proxies bill per GB, and these serve
// only static, cookieless assets (JS libraries, CSS, fonts, images) that
// every page pulls again on each fresh session profile.
//
// Every host here sees the server's real IP instead of the proxy IP, so the
// list is limited to neutral CDNs. Deliberately excluded:
// - Anything Google owns (see GOOGLE_STATIC_HOSTS) - Google could tie the
//   server IP to the proxy IP the same session searches from.
// - Analytics / tag managers / ad pixels (google-analytics, googletagmanager,
//   stats.wp.com, p.typekit.net, ...) - they report the visitor's IP.
// - Captcha and anti-bot endpoints (recaptcha, hcaptcha, challenges.cloudflare.com).
// - Consent/geo services (geolocation.onetrust.com, ...) - they pick a region by IP.
// - Shared hosting CDNs that also serve APIs (*.cloudfront.net, *.akamaized.net).
// Hosts are listed exactly rather than by wildcard wherever a wildcard
// would also catch one of those (e.g. *.wp.com includes stats.wp.com).
//
// Override per session with the `proxyBypass` option of /session/create.
//
// Entries starting with "/" are URL path patterns instead of hosts, matched
// against the request's path with "*" as a wildcard, e.g. "/*.png" or
// "/*.woff2". Chrome's bypass list can only match hosts, so these are served
// by helpers/directAssets.js instead (it fetches them directly and hands them
// to the browser). Unlike the
// automatic third-party rule there, a path pattern also applies to the
// visited site's own assets, so that site sees the server IP for them.
// Google, anti-bot and tracker hosts (config/directAssetRules.js) still
// stay on the proxy. Needs directAssets on; only scripts, stylesheets and
// (unless allowMedia is false) images, fonts and media are covered.
const DEFAULT_PROXY_BYPASS_HOSTS = [
    // Public JS/CSS library CDNs
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'fastly.jsdelivr.net',
    'unpkg.com',
    'code.jquery.com',
    'ajax.aspnetcdn.com',
    'cdn.skypack.dev',
    'esm.sh',
    'stackpath.bootstrapcdn.com',
    'maxcdn.bootstrapcdn.com',
    'cdn.tailwindcss.com',

    // Fonts and icons
    'use.fontawesome.com',
    'ka-f.fontawesome.com',
    'use.typekit.net',
    'fonts.bunny.net',

    // Site-builder static assets (theme JS/CSS, product and page images)
    'cdn.shopify.com',
    'static.parastorage.com',
    'static.wixstatic.com',
    'static1.squarespace.com',
    'images.squarespace-cdn.com',
    'assets.squarespace.com',
    'i0.wp.com',
    'i1.wp.com',
    'i2.wp.com',
    's0.wp.com',
    'c0.wp.com',

    // Stock images
    'images.unsplash.com',
    'images.pexels.com',

    // URL path patterns - see the note above. Images, stylesheets and video
    // on any site, the visited site included.
    '/*.png',
    '/*.jpg',
    '/*.jpeg',
    '/*.gif',
    '/*.webp',
    '/*.avif',
    '/*.svg',
    '/*.ico',
    '/*.css',
    '/*.mp4',
    '/*.webm',
    '/*.mov',
    '/*.m4v',
    '/*.ogv'
];

// Google-owned static hosts. Big savings (Google's JS bundles, fonts, image
// thumbnails), but Google sees the server IP fetching them alongside the
// proxy IP running the search. Opt in by adding them to DEFAULT_PROXY_BYPASS_HOSTS
// or a session's `proxyBypass`.
const GOOGLE_STATIC_HOSTS = [
    '*.gstatic.com',
    'fonts.googleapis.com',
    'ajax.googleapis.com',
    '*.ytimg.com'
];

// Path patterns ("/*.png") never reach Chrome's --proxy-bypass-list.
const isPathPattern = (entry) => entry.startsWith('/');

/**
 * Split a proxyBypass list into Chrome host patterns and URL path patterns.
 * @param {string[]|false} entries
 * @returns {{hosts: string[], paths: string[]}}
 */
const splitProxyBypass = (entries) => {
    const list = Array.isArray(entries) ? entries : [];
    return {
        hosts: list.filter(entry => !isPathPattern(entry)),
        paths: list.filter(isPathPattern)
    };
};

module.exports = { DEFAULT_PROXY_BYPASS_HOSTS, GOOGLE_STATIC_HOSTS, splitProxyBypass };
