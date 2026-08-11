// URL substrings that should always be aborted by request interception,
// regardless of the allowMedia setting (e.g. ad/tracking endpoints).
const BLOCKED_REQUEST_PATTERNS = [
    'zrt_lookup',
    '/vignette',
    'doubleclick',
    'googlesyndication',
    'googleadservices',
    'googleads'
];


module.exports = { BLOCKED_REQUEST_PATTERNS };
