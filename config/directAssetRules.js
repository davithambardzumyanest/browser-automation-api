// Registrable domains (eTLD+1, or a suffix of one) whose assets must never be
// fetched directly - they always go through the session proxy, even when
// they are third-party to the page. See helpers/directAssets.js.
//
// A match is the domain itself or any subdomain of it.

// Google-owned. Google could tie the server IP fetching these to the proxy
// IP the same session searches from.
const GOOGLE_DOMAINS = [
    'google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com',
    'googlesyndication.com', 'googleadservices.com', 'googletagmanager.com',
    'googletagservices.com', 'google-analytics.com', 'googleoptimize.com',
    'doubleclick.net', 'youtube.com', 'youtube-nocookie.com', 'ytimg.com',
    'ggpht.com', 'googlevideo.com', 'gvt1.com', 'gvt2.com', 'withgoogle.com',
    'recaptcha.net', 'ampproject.org', 'blogger.com', 'blogspot.com',
    'appspot.com', 'firebaseio.com', 'firebaseapp.com', 'web.app',
    'googlesource.com', 'gmail.com', 'android.com', '2mdn.net', 'admob.com',
    'app-measurement.com', 'crashlytics.com', 'googlemail.com', 'chrome.com',
    'gvt3.com', 'googlezip.net', 'googleanalytics.com'
];
// Country-code and vanity Google domains (google.de, google.co.uk, *.google).
const GOOGLE_DOMAIN_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$|\.google$/;

// Captcha, bot-detection and device-fingerprinting vendors. Their scripts
// score the visitor; fetching them from another IP, or without Chrome's TLS
// fingerprint, can fail the check or flag the session.
const ANTIBOT_DOMAINS = [
    'hcaptcha.com', 'challenges.cloudflare.com', 'cloudflareinsights.com',
    'arkoselabs.com', 'funcaptcha.com', 'perimeterx.net', 'px-cdn.net',
    'px-cloud.net', 'pxchk.net', 'datadome.co', 'captcha-delivery.com',
    'geetest.com', 'fpjs.io', 'fpcdn.io', 'openfpcdn.io', 'kasada.io',
    'distilnetworks.com', 'imperva.com', 'incapsula.com', 'akamai.com',
    'friendlycaptcha.com', 'mtcaptcha.com', 'threatmetrix.com',
    'online-metrix.net', 'iovation.com', 'sift.com', 'siftscience.com',
    'forter.com', 'riskified.com', 'signifyd.com', 'seon.io'
];

// Analytics, tag managers and ad/tracking pixels. They report the visitor's
// IP back to the site or an ad network.
const TRACKER_DOMAINS = [
    'facebook.com', 'facebook.net', 'fbcdn.net', 'instagram.com',
    'linkedin.com', 'licdn.com', 'bing.com', 'clarity.ms', 'hotjar.com',
    'hotjar.io', 'segment.com', 'segment.io', 'mixpanel.com', 'amplitude.com',
    'heap.io', 'heapanalytics.com', 'fullstory.com', 'mouseflow.com',
    'newrelic.com', 'nr-data.net', 'sentry.io', 'sentry-cdn.com',
    'datadoghq.com', 'browser-intake-datadoghq.com', 'quantserve.com',
    'scorecardresearch.com', 'chartbeat.com', 'chartbeat.net', 'criteo.com',
    'criteo.net', 'taboola.com', 'outbrain.com', 'adnxs.com', 'rubiconproject.com',
    'pubmatic.com', 'openx.net', 'amazon-adsystem.com', 'adsrvr.org',
    'tiktok.com', 'tiktokcdn.com', 'snapchat.com', 'sc-static.net', 'twitter.com',
    'x.com', 'ads-twitter.com', 'pinterest.com', 'pinimg.com', 'reddit.com',
    'redditstatic.com', 'yandex.ru', 'mc.yandex.ru', 'usefathom.com',
    'carbonads.com', 'carbonads.net', 'buysellads.com', 'buysellads.net',
    'adform.net', 'smartadserver.com', 'casalemedia.com', 'teads.tv',
    'cxense.com', 'id5-sync.com', 'permutive.com', 'permutive.app', '3lift.com',
    'doubleverify.com', 'dv.tech', 'adsafeprotected.com', 'dotmetrics.net',
    'webcontentassessor.com', 'the-ozone-project.com', 'bidswitch.net',
    'a-mo.net', 'springserve.com', 'ipredictive.com', 'insightexpressai.com',
    'bidr.io', 'yahoo.com', 'tinypass.com', 'piano.io', 'privacy-mgmt.com',
    'sourcepoint.com', 'optimizely.com', 'speedcurve.com', 'prebid.org',
    'moatads.com', 'indexww.com', 'sharethrough.com', 'media.net', 'yieldmo.com',
    'gumgum.com', 'lijit.com', 'sovrn.com', 'demdex.net', 'omtrdc.net',
    'everesttech.net', 'krxd.net', 'bluekai.com', 'tapad.com', 'liveramp.com',
    'rlcdn.com', 'crwdcntrl.net', 'agkn.com', 'mathtag.com', 'contextweb.com',
    'plausible.io', 'matomo.cloud', 'cookielaw.org', 'onetrust.com',
    'cookiebot.com', 'trustarc.com', 'quantcast.com', 'ipify.org', 'ip-api.com',
    'ipinfo.io', 'ipapi.co', 'nel.cloudflare.com'
];

const NEVER_DIRECT_DOMAINS = [...GOOGLE_DOMAINS, ...ANTIBOT_DOMAINS, ...TRACKER_DOMAINS];

const isNeverDirectHost = (hostname) =>
    GOOGLE_DOMAIN_RE.test(hostname) ||
    NEVER_DIRECT_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

module.exports = { GOOGLE_DOMAINS, ANTIBOT_DOMAINS, TRACKER_DOMAINS, isNeverDirectHost };
