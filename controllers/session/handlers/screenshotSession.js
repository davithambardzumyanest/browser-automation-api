const { sessions } = require('../state');
const { wait } = require('../helpers/timing');

// WebP is ~2x smaller than JPEG for the same page and every current browser
// renders it. Screenshots are shrunk until they fit DEFAULT_MAX_BYTES.
const DEFAULT_TYPE = 'webp';
const DEFAULT_QUALITY = 70;
const DEFAULT_MAX_BYTES = 10 * 1024;
const TYPE_ALIASES = { png: 'png', jpeg: 'jpeg', jpg: 'jpeg', webp: 'webp' };

// Fit loop tuning. Scaling down saves far more bytes than lowering quality
// (halving the scale is ~3x smaller, quality 70 -> 10 only ~30%), and keeps
// text more legible per byte, so scale goes first and quality only drops once
// the image is already at MIN_OUTPUT_WIDTH.
const MAX_ATTEMPTS = 8;
const INITIAL_MAX_PIXELS = 1_500_000; // first guess; avoids a slow full-res encode of tall pages
const MIN_OUTPUT_WIDTH = 240;
const MIN_QUALITY = 10;
const QUALITY_STEP = 20;
const WEBP_MAX_SIDE = 16383; // Chrome returns an empty WebP above this

// CSS-pixel rectangle to capture, plus the device pixel ratio that the
// capture is multiplied by.
const getCaptureArea = async (page, selector, fullPage) => {
    if (selector) {
        const element = await page.$(selector);
        if (!element) return null;
        await element.scrollIntoView().catch(() => {});
        const box = await element.boundingBox();
        if (!box || box.width === 0 || box.height === 0) {
            throw new Error(`Element "${selector}" is not visible or has zero size`);
        }
        const offset = await page.evaluate(() => ({
            x: window.visualViewport?.pageLeft ?? window.scrollX,
            y: window.visualViewport?.pageTop ?? window.scrollY,
            dpr: window.devicePixelRatio || 1
        }));
        return {
            clip: { x: box.x + offset.x, y: box.y + offset.y, width: box.width, height: box.height },
            dpr: offset.dpr
        };
    }

    return page.evaluate((full) => {
        const doc = document.documentElement;
        const vv = window.visualViewport;
        const dpr = window.devicePixelRatio || 1;
        if (full) {
            return { clip: { x: 0, y: 0, width: doc.scrollWidth, height: doc.scrollHeight }, dpr };
        }
        return {
            clip: {
                x: vv?.pageLeft ?? window.scrollX,
                y: vv?.pageTop ?? window.scrollY,
                width: vv?.width ?? window.innerWidth,
                height: vv?.height ?? window.innerHeight
            },
            dpr
        };
    }, fullPage);
};

const screenshotSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        fullPage = true,
        selector,
        type = DEFAULT_TYPE,
        quality = DEFAULT_QUALITY,
        maxBytes = DEFAULT_MAX_BYTES
    } = req.body ?? {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const format = TYPE_ALIASES[String(type).toLowerCase()];
    if (!format) {
        return res.status(400).json({
            error: 'Invalid type',
            message: `type must be one of: webp, jpeg, png (got "${type}")`
        });
    }

    const qualityNumber = Number(quality);
    if (!Number.isFinite(qualityNumber) || qualityNumber < 1 || qualityNumber > 100) {
        return res.status(400).json({
            error: 'Invalid quality',
            message: `quality must be a number from 1 to 100 (got "${quality}")`
        });
    }

    // 0 turns the size limit off.
    const byteLimit = Number(maxBytes);
    if (!Number.isFinite(byteLimit) || (byteLimit !== 0 && byteLimit < 1024)) {
        return res.status(400).json({
            error: 'Invalid maxBytes',
            message: `maxBytes must be 0 (no limit) or at least 1024 (got "${maxBytes}")`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await wait(2000); // Wait for dynamic content

        const page = session.page;
        const area = await getCaptureArea(page, selector, fullPage);
        if (!area) {
            return res.status(404).json({
                error: 'Element not found',
                message: `No element matches selector "${selector}"`
            });
        }

        const clip = { ...area.clip };
        const { dpr } = area;
        const pixelWidth = clip.width * dpr;
        const pixelHeight = clip.height * dpr;

        // Scale is relative to CSS pixels; output size = clip * scale * dpr.
        const maxScale = 1;
        const minScale = Math.min(maxScale, MIN_OUTPUT_WIDTH / pixelWidth);
        let scale = maxScale;
        if (byteLimit) {
            const firstGuess = Math.sqrt(INITIAL_MAX_PIXELS / (pixelWidth * pixelHeight));
            scale = Math.max(minScale, Math.min(scale, firstGuess));
        }
        if (format === 'webp') {
            scale = Math.min(scale, (WEBP_MAX_SIDE - 1) / Math.max(pixelWidth, pixelHeight));
        }

        let usedType = format;
        let currentQuality = Math.round(qualityNumber);

        const capture = () => page.screenshot({
            type: usedType,
            ...(usedType === 'png' ? {} : { quality: currentQuality }),
            clip: { ...clip, scale },
            captureBeyondViewport: true
        });

        let best = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            let buffer = await capture();

            // WebP is capped at 16383px per side; Chrome returns an empty image
            // instead of failing, so fall back to JPEG.
            if (usedType === 'webp' && buffer.length === 0) {
                usedType = 'jpeg';
                buffer = await capture();
            }

            if (!best || buffer.length < best.buffer.length) {
                best = { buffer, type: usedType, scale, quality: currentQuality, height: clip.height };
            }
            if (!byteLimit || buffer.length <= byteLimit) break;

            if (scale > minScale) {
                // Bytes grow roughly with pixel area, so shrink both sides by
                // sqrt of the overshoot, with 10% headroom.
                scale = Math.max(minScale, scale * Math.sqrt(byteLimit / buffer.length) * 0.9);
            } else if (usedType !== 'png' && currentQuality > MIN_QUALITY) {
                currentQuality = Math.max(MIN_QUALITY, currentQuality - QUALITY_STEP);
            } else if (usedType === 'png') {
                usedType = 'webp'; // PNG cannot get smaller; switch to a lossy format
            } else {
                // Smallest width and quality and still too big (a very tall
                // page): keep the top of the page that fits.
                clip.height = Math.max(1, Math.floor(clip.height * (byteLimit / buffer.length) * 0.9));
            }
        }

        res.set('Content-Type', `image/${best.type}`);
        res.set('X-Screenshot-Scale', best.scale.toFixed(3));
        if (best.type !== 'png') res.set('X-Screenshot-Quality', String(best.quality));
        if (best.height < area.clip.height) res.set('X-Screenshot-Cropped', 'true');
        res.send(best.buffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({
            error: 'Failed to take screenshot',
            message: error.message
        });
    }
};

module.exports = { screenshotSession };
