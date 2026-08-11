// Realistic, internally-consistent device identity bundles.
//
// Previously, UA/platform/WebGL/hardware were derived independently: a
// random UA string picked one of 3 (Windows/macOS/Linux) options, but
// hardwareConcurrency/deviceMemory were hardcoded to 8/8 for every session
// regardless of platform, and the WebGL profile was looked up separately by
// parsed platform. Aggregated across many sessions, "always exactly 8 cores,
// 8GB RAM, one of 3 UA strings" is itself a clustering signal - the kind of
// too-consistent fleet fingerprint fraud engines specifically watch for.
//
// Each entry here bundles a platform-appropriate UA/WebGL/hardware/screen
// combination that reads as one plausible real device, sourced from common
// real-world hardware. Chrome's version is filled in dynamically from the
// actually-installed binary (browserVersion.js) rather than hardcoded, so
// the UA/Client-Hints claim always matches the real binary Puppeteer
// launches - see browserVersion.js for why that matters (TLS/JA3
// fingerprint consistency).
//
// navigator.deviceMemory is capped at 8 by spec/Chrome's implementation
// (browsers only ever report {0.25, 0.5, 1, 2, 4, 8} regardless of real
// RAM) - never set higher, a real Chrome literally cannot report it.
const { detectChromeVersion } = require('./browserVersion');

const PLATFORM_META = {
    Windows: {
        secChUaPlatform: '"Windows"',
        secChUaPlatformVersion: '"15.0.0"',
        navigatorPlatform: 'Win32',
        osCpu: 'Windows NT 10.0; Win64; x64',
        uaOsSegment: 'Windows NT 10.0; Win64; x64'
    },
    macOS: {
        secChUaPlatform: '"macOS"',
        secChUaPlatformVersion: '"14.0.0"',
        navigatorPlatform: 'MacIntel',
        osCpu: 'Intel Mac OS X 10_15_7',
        // Real Apple Silicon Macs still send "Intel Mac OS X 10_15_7" in the
        // UA string for web compatibility (Chrome does not expose the ARM
        // arch there even on M-series) - the WebGL renderer below is what
        // actually reveals Apple Silicon vs Intel, exactly as on a real Mac.
        uaOsSegment: 'Macintosh; Intel Mac OS X 10_15_7'
    },
    Linux: {
        secChUaPlatform: '"Linux"',
        secChUaPlatformVersion: '"6.0.0"',
        navigatorPlatform: 'Linux x86_64',
        osCpu: 'Linux x86_64',
        uaOsSegment: 'X11; Linux x86_64'
    }
};

const DEVICE_PROFILE_TEMPLATES = [
    // Windows
    {
        platform: 'Windows',
        webgl: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        hardwareConcurrency: 8, deviceMemory: 8, screen: { width: 1920, height: 1080 }
    },
    {
        platform: 'Windows',
        webgl: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        hardwareConcurrency: 12, deviceMemory: 8, screen: { width: 2560, height: 1440 }
    },
    {
        platform: 'Windows',
        webgl: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        hardwareConcurrency: 6, deviceMemory: 8, screen: { width: 1920, height: 1080 }
    },
    {
        platform: 'Windows',
        webgl: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        hardwareConcurrency: 4, deviceMemory: 8, screen: { width: 1366, height: 768 }
    },
    // macOS
    {
        platform: 'macOS',
        webgl: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
        hardwareConcurrency: 8, deviceMemory: 8, screen: { width: 1440, height: 900 }
    },
    {
        platform: 'macOS',
        webgl: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' },
        hardwareConcurrency: 8, deviceMemory: 8, screen: { width: 1512, height: 982 }
    },
    {
        platform: 'macOS',
        webgl: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' },
        hardwareConcurrency: 8, deviceMemory: 8, screen: { width: 1512, height: 982 }
    },
    // Linux
    {
        platform: 'Linux',
        webgl: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)' },
        hardwareConcurrency: 8, deviceMemory: 8, screen: { width: 1920, height: 1080 }
    },
    {
        platform: 'Linux',
        webgl: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 (NAVI23, DRM 3.49.0), OpenGL 4.6)' },
        hardwareConcurrency: 6, deviceMemory: 8, screen: { width: 1920, height: 1080 }
    },
    {
        platform: 'Linux',
        webgl: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.6)' },
        hardwareConcurrency: 12, deviceMemory: 8, screen: { width: 1920, height: 1080 }
    }
];

const buildUserAgent = (platform, chromeFull) => {
    const meta = PLATFORM_META[platform];
    return `Mozilla/5.0 (${meta.uaOsSegment}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;
};

const getRandomDeviceProfile = () => {
    const template = DEVICE_PROFILE_TEMPLATES[Math.floor(Math.random() * DEVICE_PROFILE_TEMPLATES.length)];
    const { full: chromeFull } = detectChromeVersion();
    const meta = PLATFORM_META[template.platform];

    return {
        userAgent: buildUserAgent(template.platform, chromeFull),
        platformProfile: {
            secChUaPlatform: meta.secChUaPlatform,
            secChUaPlatformVersion: meta.secChUaPlatformVersion,
            navigatorPlatform: meta.navigatorPlatform,
            osCpu: meta.osCpu
        },
        webgl: template.webgl,
        hardwareConcurrency: template.hardwareConcurrency,
        deviceMemory: template.deviceMemory,
        screen: { ...template.screen }
    };
};

module.exports = { getRandomDeviceProfile, DEVICE_PROFILE_TEMPLATES };
