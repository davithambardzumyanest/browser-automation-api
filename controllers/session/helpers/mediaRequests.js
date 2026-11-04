// Which paused requests count as static files, for
// helpers/requestBlocking.js (allowMedia:false blocks images, fonts and media)
// and helpers/directAssets.js (fetches static files direct, never through the
// proxy).
//
// Chrome's resource type alone misses most of them, because two common kinds
// of static file are reported as 'XHR' or 'Fetch':
//
// - A page controlled by a service worker never puts its own request on the
//   network: the worker re-fetches it (usually fetch(event.request)), and
//   Chrome's browser-level Fetch domain reports that copy as XHR/Fetch.
//   Checked in a test page: the copy of an <img> or CSS background-image keeps
//   Chrome's image Accept header, a stylesheet keeps its text/css one, and a
//   script, font or video keeps nothing but its URL. Without this, every file
//   on a service-worker site (YouTube, X, most PWAs) went through the proxy.
//
// - Video players built on Media Source Extensions (hls.js, dash.js, Shaka,
//   YouTube's) download every segment themselves with XHR/fetch. A 'Media'
//   request is only ever a plain <video src>. Measured on ted.com: 62 MB of
//   .ts segments through the proxy in 20 seconds, with allowMedia either way.
//
// So XHR/Fetch requests are classified by that header and by URL.

const MEDIA_RESOURCE_TYPES = ['Image', 'Font', 'Media'];
// Resource types a service worker's re-fetch or a player's download arrives as.
const FORWARDED_RESOURCE_TYPES = ['XHR', 'Fetch'];

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const FONT_FILE_RE = /\.(woff2?|ttf|otf|eot)$/i;
// Audio and video files, streaming segments and manifests (HLS .m3u8/.ts, DASH
// .mpd/.m4s/.cmfv) and subtitles.
const MEDIA_FILE_RE = /\.(mp4|webm|mov|m4v|ogv|mp3|m4a|aac|oga|ogg|opus|wav|flac|ts|m4s|cmfv|cmfa|m3u8|mpd|vtt|srt)$/i;
const SCRIPT_FILE_RE = /\.(m?js|wasm)$/i;
const STYLESHEET_FILE_RE = /\.css$/i;
// YouTube's video stream: no extension, and a POST as often as a GET.
const VIDEO_STREAM_PATH_RE = /\/videoplayback$/;
// Google Maps tiles and style data, fetched as binary XHR.
const MAP_TILE_PATH_RE = /^\/maps\/(vt|res)(\/|$)/;
// Static scripts despite a query string, the same for every visitor: Google's
// versioned JS/CSS bundles (Search /xjs/_/js/k=...?xjs=s1, Maps
// /maps/_/js/k=..., /_/ss/k=...), Google tag scripts (gtag/js?id=...,
// gtag/destination?id=..., gtm.js?id=..., also on a site's own server-side
// tagging host), MediaWiki's load.php, Reddit's js/concat and Meta pixel
// config.
const VERSIONED_BUNDLE_RE = /\/_\/(js|ss)\/k=|\/gtag\/(js|destination)$|\/gtm\.js$|\/load\.php$|\/js\/concat$|\/signals\/config\/\d+$/;

const getHeader = (headers, name) =>
    Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

const pathnameOf = (url) => {
    try {
        return new URL(url).pathname;
    } catch (_) {
        return null;
    }
};

/**
 * The media resource type a paused request is, or null when it isn't one.
 * @param {Object} event - Fetch.requestPaused event
 * @returns {'Image'|'Font'|'Media'|null}
 */
const mediaTypeOf = ({ request, resourceType }) => {
    if (MEDIA_RESOURCE_TYPES.includes(resourceType)) return resourceType;
    if (!FORWARDED_RESOURCE_TYPES.includes(resourceType)) return null;

    const pathname = pathnameOf(request.url);
    if (pathname === null) return null;
    if (VIDEO_STREAM_PATH_RE.test(pathname)) return 'Media';
    if (request.method !== 'GET') return null;

    // Chrome sends "image/avif,image/webp,..." only for an image destination;
    // a script's fetch() defaults to "*/*".
    if (/^image\//i.test(getHeader(request.headers, 'accept') || '') || IMAGE_FILE_RE.test(pathname) || MAP_TILE_PATH_RE.test(pathname)) return 'Image';
    if (FONT_FILE_RE.test(pathname)) return 'Font';
    if (MEDIA_FILE_RE.test(pathname)) return 'Media';
    return null;
};

/**
 * The static resource type an XHR/Fetch request really is, or null when it's
 * ordinary page data and stays on the proxy.
 * @param {Object} event - Fetch.requestPaused event
 * @returns {'Image'|'Font'|'Media'|'Script'|'Stylesheet'|null}
 */
const forwardedTypeOf = (event) => {
    const mediaType = mediaTypeOf(event);
    if (mediaType) return mediaType;

    const { request } = event;
    if (request.method !== 'GET') return null;
    const pathname = pathnameOf(request.url);
    if (pathname === null) return null;

    if (/^text\/css/i.test(getHeader(request.headers, 'accept') || '') || STYLESHEET_FILE_RE.test(pathname)) return 'Stylesheet';
    if (SCRIPT_FILE_RE.test(pathname) || VERSIONED_BUNDLE_RE.test(pathname)) return 'Script';
    return null;
};

module.exports = {
    MEDIA_RESOURCE_TYPES,
    FORWARDED_RESOURCE_TYPES,
    VERSIONED_BUNDLE_RE,
    mediaTypeOf,
    forwardedTypeOf,
    getHeader
};
