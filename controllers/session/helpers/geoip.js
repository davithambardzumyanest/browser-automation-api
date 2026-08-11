// Derives locale/timezone from a proxy's actual egress location instead of
// trusting a static per-locale default that has no idea what country a
// given proxy/session actually exits from. A mismatch here (IP says one
// place, everything else - timezone, Accept-Language, WebGL - says another)
// is exactly the kind of internal-inconsistency signal that got a session
// flagged earlier in this investigation.
const axios = require('axios');

// Country -> best-guess locale. Extend as needed; unknown countries just
// fall back to whatever the caller/session already had (see detectProxyGeo).
const COUNTRY_TO_LOCALE = {
    US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-US', NZ: 'en-US', IE: 'en-GB',
    FR: 'fr-FR', DE: 'de-DE', ES: 'es-ES', IT: 'it-IT', PT: 'pt-BR', BR: 'pt-BR',
    JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN'
};

const buildAxiosProxyConfig = (proxy) => {
    if (!proxy) return null;

    const parseServer = (serverStr, username, password) => {
        try {
            const url = new URL(serverStr.includes('://') ? serverStr : `http://${serverStr}`);
            const config = {
                host: url.hostname,
                port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
                protocol: url.protocol.replace(':', '') || 'http'
            };
            if (username && password) {
                config.auth = { username, password };
            }
            return config;
        } catch (_) {
            return null;
        }
    };

    if (typeof proxy === 'string') {
        return parseServer(proxy);
    }
    if (proxy.server) {
        return parseServer(proxy.server, proxy.username, proxy.password);
    }
    return null;
};

/**
 * Look up the proxy's egress country/timezone. Uses ip-api.com's free,
 * no-API-key JSON endpoint (HTTP only on the free tier - acceptable here
 * since this is a public geo lookup, not sensitive data; swap for
 * ipapi.co/ipinfo.io, both HTTPS, if that tradeoff isn't acceptable). Never
 * throws - returns null on any failure so callers can fall back to existing
 * defaults without session creation failing over a flaky geo lookup.
 * @param {string|Object} proxy - same shape accepted elsewhere (string or {server, username, password})
 * @returns {Promise<{countryCode: string, locale: string|null, timezone: string, latitude: number, longitude: number, ip: string}|null>}
 */
const detectProxyGeo = async (proxy) => {
    const proxyConfig = buildAxiosProxyConfig(proxy);
    if (!proxyConfig) return null;

    try {
        const response = await axios.get('http://ip-api.com/json/', {
            params: { fields: 'status,countryCode,timezone,lat,lon,query' },
            proxy: proxyConfig,
            timeout: 5000
        });

        const data = response.data;
        if (!data || data.status !== 'success' || !data.timezone) {
            return null;
        }

        return {
            countryCode: data.countryCode || null,
            locale: COUNTRY_TO_LOCALE[data.countryCode] || null,
            timezone: data.timezone,
            latitude: data.lat,
            longitude: data.lon,
            ip: data.query
        };
    } catch (error) {
        console.warn('Proxy geo-IP lookup failed, falling back to defaults:', error.message);
        return null;
    }
};

module.exports = { detectProxyGeo };
