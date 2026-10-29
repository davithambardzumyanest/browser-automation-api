// Which paused requests count as images, fonts or media, for
// helpers/requestBlocking.js (allowMedia:false blocks them) and
// helpers/directAssets.js (allowMedia:true fetches them direct, never through
// the proxy).
//
// A page controlled by a service worker never puts its own Image/Font/Media
// request on the network: the worker re-fetches it (usually
// fetch(event.request)), and Chrome's browser-level Fetch domain reports that
// request as 'XHR' (or 'Fetch'). Checked in a test page: the worker's copy
// of an <img> or CSS background-image request keeps Chrome's image Accept
// header, a font or video keeps nothing but its URL. So XHR/Fetch GETs are
// classified by that header and by file extension. Without this, every
// image on a service-worker site (YouTube, X, most PWAs) went through the
// proxy with allowMedia:true - and its fonts and video did even with
// allowMedia:false.

const MEDIA_RESOURCE_TYPES = ['Image', 'Font', 'Media'];
// Resource types a service worker's re-fetch arrives as.
const FORWARDED_RESOURCE_TYPES = ['XHR', 'Fetch'];

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const FONT_FILE_RE = /\.(woff2?|ttf|otf|eot)$/i;
const MEDIA_FILE_RE = /\.(mp4|webm|mov|m4v|ogv|mp3|m4a|aac|oga|ogg|wav|flac)$/i;

const getHeader = (headers, name) =>
    Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

/**
 * The media resource type a paused request is, or null when it isn't one.
 * @param {Object} event - Fetch.requestPaused event
 * @returns {'Image'|'Font'|'Media'|null}
 */
const mediaTypeOf = ({ request, resourceType }) => {
    if (MEDIA_RESOURCE_TYPES.includes(resourceType)) return resourceType;
    if (!FORWARDED_RESOURCE_TYPES.includes(resourceType) || request.method !== 'GET') return null;

    let pathname;
    try {
        ({ pathname } = new URL(request.url));
    } catch (_) {
        return null;
    }
    // Chrome sends "image/avif,image/webp,..." only for an image destination;
    // a script's fetch() defaults to "*/*".
    if (/^image\//i.test(getHeader(request.headers, 'accept') || '') || IMAGE_FILE_RE.test(pathname)) return 'Image';
    if (FONT_FILE_RE.test(pathname)) return 'Font';
    if (MEDIA_FILE_RE.test(pathname)) return 'Media';
    return null;
};

module.exports = { MEDIA_RESOURCE_TYPES, FORWARDED_RESOURCE_TYPES, mediaTypeOf, getHeader };
