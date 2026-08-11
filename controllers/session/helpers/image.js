// Image payload parsing helpers shared by fillImageInput.

const MIME_TO_EXTENSION = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const parseImagePayload = (image) => {
    if (image === undefined || image === null || image === '') {
        return null;
    }

    const value = String(image).trim();
    const dataUrlMatch = value.match(/^data:([^;]+);base64,(.+)$/i);

    if (dataUrlMatch) {
        return {
            mimeType: dataUrlMatch[1],
            base64: dataUrlMatch[2]
        };
    }

    return {
        mimeType: null,
        base64: value
    };
};

const extensionFromMime = (mimeType) => MIME_TO_EXTENSION[mimeType?.toLowerCase()] || 'png';

module.exports = { MIME_TO_EXTENSION, parseImagePayload, extensionFromMime };
