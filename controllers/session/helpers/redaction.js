// Redaction for anything returned as failure evidence: URLs, console text and
// captured HTML. Errs on the side of over-redacting; evidence is for
// debugging, and a leaked password or session token is worse than a
// "[REDACTED]" in a log.

const REDACTED = '[REDACTED]';

// Matched against the individual words of a field/param name
// ("cardNumber" -> card, number; "g-recaptcha-response" -> g, recaptcha, response).
const SENSITIVE_WORDS = [
    'password', 'passwd', 'pass', 'pw', 'pwd', 'passcode', 'secret', 'token', 'auth', 'authorization',
    'session', 'sessionid', 'sid', 'cookie', 'csrf', 'xsrf', 'apikey', 'key', 'signature', 'sig',
    'otp', 'pin', 'ssn', 'cvv', 'cvc', 'cvn', 'csc', 'card', 'cc', 'iban', 'credential',
    'credentials', 'bearer', 'jwt', 'code', 'verifier', 'refresh', 'recaptcha', 'captcha'
];
// Matched as substrings of the whole lowercased name, for run-together names
// ("accesstoken", "x-api-key", "userpassword").
const SENSITIVE_SUBSTRINGS = [
    'password', 'passwd', 'token', 'secret', 'apikey', 'api_key', 'api-key', 'sessionid',
    'session_id', 'csrf', 'xsrf', 'cookie', 'authorization', 'bearer', 'credential', 'recaptcha',
    'cardnumber', 'card_number', 'securitycode', 'security_code'
];
// autocomplete values that mark a field as sensitive.
const SENSITIVE_AUTOCOMPLETE = [
    'current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp',
    'cc-exp-month', 'cc-exp-year'
];

const sensitiveWordSet = new Set(SENSITIVE_WORDS);

const isSensitiveName = (name) => {
    if (!name) return false;
    const raw = String(name);
    const lower = raw.toLowerCase();
    if (SENSITIVE_SUBSTRINGS.some(s => lower.includes(s))) return true;
    return raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some(word => sensitiveWordSet.has(word));
};

const redactParams = (params) => {
    for (const name of [...params.keys()]) {
        if (isSensitiveName(name)) params.set(name, REDACTED);
    }
};

const redactUrl = (value, maxLength = 500) => {
    if (!value) return value;
    let out;
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = REDACTED;
            url.password = '';
        }
        redactParams(url.searchParams);
        // OAuth implicit flows put tokens in the fragment (#access_token=...).
        if (url.hash.includes('=')) {
            const hashParams = new URLSearchParams(url.hash.slice(1));
            redactParams(hashParams);
            url.hash = hashParams.toString();
        }
        out = url.toString();
    } catch {
        out = String(value);
    }
    return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
};

const KEY_VALUE_RE = /\b([\w-]*(?:password|passwd|pwd|token|secret|api[_-]?key|session(?:_?id)?|cookie|csrf|xsrf|authorization|auth)[\w-]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const URL_RE = /https?:\/\/[^\s"'<>()]+/g;

const redactText = (value, maxLength = 1000) => {
    if (value === undefined || value === null) return value;
    let text = String(value)
        .replace(URL_RE, url => redactUrl(url, 300))
        .replace(BEARER_RE, `$1 ${REDACTED}`)
        .replace(JWT_RE, REDACTED)
        .replace(KEY_VALUE_RE, (_, key, sep) => `${key}${sep}${REDACTED}`);
    if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
    return text;
};

module.exports = {
    REDACTED,
    SENSITIVE_WORDS,
    SENSITIVE_SUBSTRINGS,
    SENSITIVE_AUTOCOMPLETE,
    isSensitiveName,
    redactUrl,
    redactText
};
