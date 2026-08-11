const { sessions } = require('../state');
const { configure2CaptchaDirectly, validate2CaptchaConfig } = require('../helpers/recaptcha');

/**
 * API endpoint to configure 2Captcha extension
 */
const configure2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { apiKey, proxy, useProxy, proxyType = 'HTTP' } = req.body;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const success = await configure2CaptchaDirectly(session.page, {
            apiKey: apiKey || process.env.TWO_CAPTCHA_API_KEY,
            proxy: proxy,
            useProxy: useProxy,
            proxyType: proxyType
        });

        if (success) {
            const validation = await validate2CaptchaConfig(session.page);
            res.json({
                success: true,
                message: '2Captcha configured successfully',
                configuration: validation
            });
        } else {
            res.status(500).json({
                error: 'Failed to configure 2Captcha',
                message: 'Extension may not be loaded or configuration failed'
            });
        }
    } catch (error) {
        console.error('Error configuring 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to configure 2Captcha',
            message: error.message
        });
    }
};

module.exports = { configure2CaptchaEndpoint };
