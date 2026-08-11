const { sessions } = require('../state');
const { wait } = require('../helpers/timing');
const { acceptGoogleCookies } = require('../helpers/recaptcha');

// Function to handle Google validation
const validateGoogle = async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
        const { page } = session;

        // Navigate to Google
        await page.goto('https://www.google.com', {
            waitUntil: 'networkidle0',
            timeout: 90000
        });

        // Wait for the page to be fully loaded
        await wait(3000);

        // Try to accept cookies
        const cookiesAccepted = await acceptGoogleCookies(page);

        // Set English as language if possible
        try {
            const langButton = await page.$('button[aria-label*="language"], button[aria-label*="Sprache"]');
            if (langButton) {
                await langButton.click();
                await wait(1000);

                // Try to find and click English option
                const englishOption = await page.$('div[role="menuitem"]:has-text("English"), div[role="menuitem"]:has-text("English (United States)")');
                if (englishOption) {
                    await englishOption.click();
                    await wait(2000);
                }
            }
        } catch (e) {
            console.log('Could not change language, continuing...');
        }
    } catch (error) {
        console.error('Error in validateGoogle:', error);
        return res.status(500).json({
            error: 'Failed to validate Google',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

module.exports = { validateGoogle };
