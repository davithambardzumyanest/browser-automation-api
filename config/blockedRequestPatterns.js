// URL substrings that should always be aborted by request interception,
// regardless of the allowMedia setting (e.g. ad/tracking endpoints).
const BLOCKED_REQUEST_PATTERNS = [
    'zrt_lookup',
    '/vignette',
    'doubleclick',
    'googlesyndication',
    'googleadservices',
    'googleads',
    // Google Maps usage logging: an empty GIF per pan, zoom or click, up to 26
    // on a page. The XHR counterpart of gen_204.
    '/maps/preview/log204'
];


module.exports = { BLOCKED_REQUEST_PATTERNS };
