const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const { randomDelay } = require('../helpers/timing');
const { parseImagePayload, extensionFromMime } = require('../helpers/image');

/**
 * Upload an image to a file input (supports base64 and optional resize/compression).
 */
const fillImageInput = async (req, res) => {
    const { sessionId } = req.params;
    const {
        selector,
        image,
        filename,
        mimeType: mimeTypeParam,
        maxWidth,
        maxHeight,
        quality,
        resize,
        waitForVisible = false
    } = req.body ?? {};

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    if (!selector) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'selector is required'
        });
    }

    const parsedImage = parseImagePayload(image);
    if (!parsedImage) {
        return res.status(400).json({
            error: 'Missing required parameters',
            message: 'image is required (raw base64 or data URL)'
        });
    }

    const resizeOptions = {
        maxWidth: resize?.maxWidth ?? maxWidth ?? null,
        maxHeight: resize?.maxHeight ?? maxHeight ?? null,
        quality: resize?.quality ?? quality ?? null
    };

    if (resizeOptions.maxWidth !== null) {
        resizeOptions.maxWidth = Number(resizeOptions.maxWidth);
    }
    if (resizeOptions.maxHeight !== null) {
        resizeOptions.maxHeight = Number(resizeOptions.maxHeight);
    }
    if (resizeOptions.quality !== null) {
        resizeOptions.quality = Number(resizeOptions.quality);
    }

    const mimeType = mimeTypeParam || parsedImage.mimeType || 'image/png';
    const finalFilename = filename || `upload.${extensionFromMime(mimeType)}`;

    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();

    const page = await getFirstTab(session);
    session.page = page;

    try {
        // Wait for selector - visibility optional since file inputs are often hidden
        await page.waitForSelector(selector, {
            visible: waitForVisible,
            timeout: 30000
        });

        await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, selector);

        await new Promise(resolve => setTimeout(resolve, randomDelay(50, 150)));

        const uploadResult = await page.evaluate(async (sel, base64, name, mime, resizeOpts) => {
            const input = document.querySelector(sel);

            if (!input) {
                throw new Error(`No element found for selector: ${sel}`);
            }

            if (input.tagName.toLowerCase() !== 'input' || input.type !== 'file') {
                throw new Error('Element is not a file input');
            }

            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            let blob = new Blob([bytes], { type: mime });
            const originalSize = blob.size;

            let bitmap;
            try {
                bitmap = await createImageBitmap(blob);
            } catch (decodeError) {
                throw new Error(`Invalid image data: ${decodeError.message}`);
            }

            const originalWidth = bitmap.width;
            const originalHeight = bitmap.height;

            let targetWidth = originalWidth;
            let targetHeight = originalHeight;

            if (resizeOpts.maxWidth || resizeOpts.maxHeight) {
                const scaleW = resizeOpts.maxWidth ? resizeOpts.maxWidth / targetWidth : 1;
                const scaleH = resizeOpts.maxHeight ? resizeOpts.maxHeight / targetHeight : 1;
                const scale = Math.min(1, scaleW, scaleH);

                if (scale < 1) {
                    targetWidth = Math.max(1, Math.round(targetWidth * scale));
                    targetHeight = Math.max(1, Math.round(targetHeight * scale));
                }
            }

            const shouldReencode = (
                targetWidth !== originalWidth ||
                targetHeight !== originalHeight ||
                (resizeOpts.quality !== null && resizeOpts.quality > 0 && resizeOpts.quality <= 1)
            );

            if (shouldReencode) {
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

                const outputQuality = (
                    resizeOpts.quality !== null &&
                    resizeOpts.quality > 0 &&
                    resizeOpts.quality <= 1
                ) ? resizeOpts.quality : 0.85;

                blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(
                        (result) => result ? resolve(result) : reject(new Error('Failed to encode image')),
                        mime,
                        outputQuality
                    );
                });
            }

            bitmap.close?.();

            const file = new File([blob], name, { type: mime });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            input.files = dataTransfer.files;

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            return {
                filename: name,
                mimeType: mime,
                originalSize,
                fileSize: blob.size,
                originalWidth,
                originalHeight,
                width: targetWidth,
                height: targetHeight,
                resized: targetWidth !== originalWidth || targetHeight !== originalHeight,
                compressed: blob.size < originalSize
            };
        }, selector, parsedImage.base64, finalFilename, mimeType, resizeOptions);

        res.json({
            success: true,
            sessionId,
            message: 'Image uploaded to file input successfully',
            selector,
            ...uploadResult
        });
    } catch (error) {
        console.error(`[${sessionId}] Error uploading image:`, error);

        res.status(500).json({
            error: 'Failed to upload image',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

module.exports = { fillImageInput };
