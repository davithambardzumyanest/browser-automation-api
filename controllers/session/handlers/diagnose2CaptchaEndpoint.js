const { sessions } = require('../state');
const { diagnose2Captcha, generateRecommendations } = require('../helpers/recaptcha');

const diagnose2CaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    try {
        const diagnostics = await diagnose2Captcha(session.page);
        res.json({
            success: true,
            sessionId,
            diagnostics,
            summary: {
                healthy: diagnostics.extensionLoaded && diagnostics.configAccessible && diagnostics.apiKeySet,
                issues: diagnostics.errors,
                recommendations: generateRecommendations(diagnostics)
            }
        });
    } catch (error) {
        console.error('Error diagnosing 2Captcha:', error);
        res.status(500).json({
            error: 'Failed to diagnose 2Captcha',
            message: error.message
        });
    }
};

module.exports = { diagnose2CaptchaEndpoint };
