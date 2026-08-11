const { sessions } = require('../state');
const { validate2CaptchaConfig } = require('../helpers/recaptcha');

const validate2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const validation = await validate2CaptchaConfig(session.page);
        res.json({
            success: true,
            sessionId,
            validation
        });
    } catch (error) {
        console.error('Error validating 2Captcha config:', error);
        res.status(500).json({
            error: 'Failed to validate 2Captcha configuration',
            message: error.message
        });
    }
};

module.exports = { validate2CaptchaEndpoint };
