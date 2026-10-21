const { sessions } = require('../state');
const { wait } = require('../helpers/timing');

// JPEG at 70 is 2-6x smaller than PNG on typical pages and still readable.
const DEFAULT_TYPE = 'jpeg';
const DEFAULT_QUALITY = 70;
const TYPE_ALIASES = { png: 'png', jpeg: 'jpeg', jpg: 'jpeg', webp: 'webp' };

const screenshotSession = async (req, res) => {
    const { sessionId } = req.params;
    const { fullPage = true, selector, type = DEFAULT_TYPE, quality = DEFAULT_QUALITY } = req.body ?? {};

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
            message: `type must be one of: png, jpeg, webp (got "${type}")`
        });
    }

    const qualityNumber = Number(quality);
    if (!Number.isFinite(qualityNumber) || qualityNumber < 1 || qualityNumber > 100) {
        return res.status(400).json({
            error: 'Invalid quality',
            message: `quality must be a number from 1 to 100 (got "${quality}")`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();

    try {
        await wait(2000); // Wait for dynamic content

        const target = selector ? await session.page.$(selector) : session.page;
        if (!target) {
            return res.status(404).json({
                error: 'Element not found',
                message: `No element matches selector "${selector}"`
            });
        }

        const capture = (captureType) => target.screenshot({
            type: captureType,
            ...(captureType === 'png' ? {} : { quality: Math.round(qualityNumber) }),
            ...(selector ? {} : { fullPage })
        });

        let usedType = format;
        let screenshotBuffer = await capture(format);

        // WebP is capped at 16383px per side; Chrome returns an empty image for
        // taller full-page captures instead of failing, so fall back to JPEG.
        if (format === 'webp' && screenshotBuffer.length === 0) {
            usedType = 'jpeg';
            screenshotBuffer = await capture('jpeg');
        }

        res.set('Content-Type', `image/${usedType}`);
        res.send(screenshotBuffer);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({
            error: 'Failed to take screenshot',
            message: error.message
        });
    }
};

module.exports = { screenshotSession };
