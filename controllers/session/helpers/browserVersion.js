// Detects the actual installed/bundled Chrome(ium) version instead of
// hardcoding one in the UA/Client-Hints strings. This matters: the UA claim
// only has to match what the *browser binary itself* will show elsewhere -
// most concretely, the TLS ClientHello (JA3-style fingerprint) reflects
// whatever BoringSSL build actually ships with the real binary, which cannot
// be spoofed via headers. If the UA claims a newer/older Chrome version than
// what's really installed, that's a mismatch between the wire-level TLS
// fingerprint and the HTTP-level identity claim - confirmed as a real,
// unaddressed gap after fixing the UA/Sec-CH-UA header spoofing earlier
// (bundled Chromium was 141, but the hardcoded UA claimed 145, a version
// that didn't even exist yet). Detected once, cached, and used to build the
// UA strings in deviceProfiles.js so the claim always tracks whatever
// Puppeteer actually launches - including after a `npm update puppeteer`
// bumps the bundled build.
const { execFileSync } = require('child_process');
const puppeteer = require('./puppeteer');

// Last-resort fallback only used if detection itself fails (e.g. the binary
// doesn't support --version, or isn't executable in this environment). Not
// meant to be "correct" forever - just better than crashing.
const FALLBACK_VERSION = { major: '141', full: '141.0.0.0' };

let cached = null;

const parseVersionString = (raw) => {
    const match = String(raw || '').match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return { major: match[1], full: `${match[1]}.${match[2]}.${match[3]}.${match[4]}` };
};

const detectChromeVersion = () => {
    if (cached) return cached;

    try {
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
        const output = execFileSync(execPath, ['--version'], {
            encoding: 'utf8',
            timeout: 5000
        });
        const parsed = parseVersionString(output);
        if (parsed) {
            cached = parsed;
            return cached;
        }
        console.warn(`Could not parse Chrome version from "--version" output: "${output.trim()}", using fallback`);
    } catch (error) {
        console.warn('Failed to detect installed Chrome/Chromium version, using fallback:', error.message);
    }

    cached = FALLBACK_VERSION;
    return cached;
};

module.exports = { detectChromeVersion };
