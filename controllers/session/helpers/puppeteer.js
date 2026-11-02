// Single place puppeteer-extra + the stealth plugin get configured. Every
// handler that needs to launch/connect should require the singleton from
// here instead of requiring 'puppeteer-extra' directly and re-registering
// the plugin, so registration only ever happens once regardless of require
// order across files (require() caches by path, so a raw 'puppeteer-extra'
// require elsewhere would still return this same instance - but importing
// from here keeps that fact from being something callers need to know).
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');

// Profile preferences that stop Chrome's own traffic through the proxy. Neither
// has a working command-line flag. They're set through this plugin because the
// stealth plugin depends on it, and it rewrites the profile's Preferences file
// on every launch: anything written there by hand is lost.
puppeteer.use(UserPreferencesPlugin({
    userPrefs: {
        // Network prediction off (chrome::NetworkPredictionOptions::kDisabled),
        // Chrome's "preload pages" setting. With it on, every
        // <link rel=preconnect> opens a connection whether or not a request
        // ever uses it: a CONNECT and a TLS handshake (about 7 KB) per host,
        // including hosts whose files all go direct (see
        // helpers/directAssets.js).
        net: { network_prediction_options: 2 },
        // No spellcheck dictionaries. Otherwise the first keystroke in any field
        // downloads en-us-10-1.bdic from gvt1.com, 459 KB per session - as much
        // as a whole Google search. A page can't tell.
        spellcheck: { dictionaries: [], dictionary: '' }
    }
}));
puppeteer.use(StealthPlugin());

module.exports = puppeteer;
