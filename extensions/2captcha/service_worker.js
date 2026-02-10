importScripts(
    '/common/config.js',
    '/common/api.js',
    '/background/background.js',
    '/content/captcha/normal/background.js'
);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'SET_CONFIG') return;

    (async () => {
        try {
            if (!Config || !Config.get || !Config.set) {
                sendResponse({ success: false, error: 'Config not ready' });
                return;
            }

            const current = await Config.get() || {};

            const merged = {
                ...current,
                ...msg.config,

                recaptcha: {
                    ...(current.recaptcha || {}),
                    ...(msg.config.recaptcha || {})
                }
            };

            await Config.set(merged);
            sendResponse({ success: true });
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
    })();

    return true;
});

