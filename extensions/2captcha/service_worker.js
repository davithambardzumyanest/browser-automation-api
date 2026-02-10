importScripts(
    '/common/config.js',
    '/common/api.js',
    '/background/background.js',
    '/content/captcha/normal/background.js'
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_CONFIG') {
        (async () => {
            // Wait until Config is ready
            let retries = 10;
            while (
                (typeof Config === 'undefined' ||
                    !Config.get ||
                    !Config.set) &&
                retries-- > 0
                ) {
                await new Promise(r => setTimeout(r, 300));
            }

            if (!Config || !Config.set) {
                sendResponse({ success: false, error: 'Config not initialized' });
                return;
            }

            // Get existing config first
            const current = await Config.get();

            // Deep-merge to avoid undefined sub-objects
            const safeConfig = {
                ...current,
                ...msg.config,
                recaptcha: {
                    ...(current?.recaptcha || {}),
                    ...(msg.config?.recaptcha || {})
                }
            };

            try {
                await Config.set(safeConfig);
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();

        return true; // keep async channel open
    }
});