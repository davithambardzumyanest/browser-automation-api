importScripts(
    '/common/config.js',
    '/common/api.js',
    '/background/background.js',
    '/content/captcha/normal/background.js'
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_CONFIG') {
        // Use the extension's own Config object
        if (typeof Config !== 'undefined' && Config.set) {
            Config.set(msg.config)
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ success: false, error: err.message }));
        } else {
            sendResponse({ success: false, error: 'Config object not found' });
        }
        return true; // keep the message channel open for async response
    }
});