const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');
const {
    extractRecaptchaInfo,
    solveRecaptchaWith2Captcha,
    injectRecaptchaToken
} = require('../helpers/recaptcha');

const solveRecaptchaEndpoint = async (req, res) => {
    const { sessionId } = req.params;
    const { submitAfter = false, waitTime = 5000 } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    // session.page can go stale (detached main frame, or a closed tab) right
    // after a navigation - e.g. this endpoint is naturally called immediately
    // after pressing Enter on a search box to check whether a challenge
    // appeared, which is exactly when that can happen. Re-resolve to a live,
    // attached page first instead of failing with a raw "detached Frame"
    // error that looks nothing like "no captcha".
    try {
        const isStale = !session.page || session.page.isClosed() || session.page.mainFrame().detached;
        if (isStale) {
            session.page = await getFirstTab(session);
        }
    } catch (_) {
        try { session.page = await getFirstTab(session); } catch (_) {}
    }

    const page = session.page;

    try {
        console.log("🚀 Starting captcha solving");

        const sessionProxy = session.config?.proxy_full || session.proxy || null;
        console.log("🔐 Session proxy:", session.proxy);
        console.log("🔐 Session config proxy:", session.config?.proxy_full);
        console.log("🔐 Using proxy:", sessionProxy);

        if (!page.__browserConsoleForwarderAttached) {
            page.on("console", msg => console.log("BROWSER:", msg.text()));
            page.__browserConsoleForwarderAttached = true;
        }

        const captchaInfo = await extractRecaptchaInfo(page);

        if (!captchaInfo.siteKey) {
            // No captcha on the page is the common case, not a client error -
            // 200 here so callers checking response.ok don't treat "nothing
            // to solve" as a failure.
            return res.status(200).json({
                success: true,
                hasCaptcha: false,
                message: "No reCAPTCHA detected",
                details: captchaInfo
            });
        }

        console.log("🎫 Sitekey:", captchaInfo.siteKey);
        console.log("🏢 Enterprise:", captchaInfo.isEnterprise);
        console.log("🔑 s Parameter:", captchaInfo.s);
        console.log("🎬 Action:", captchaInfo.action);

        const token = await solveRecaptchaWith2Captcha(
            page,
            captchaInfo.siteKey,
            page.url(),
            sessionProxy,
            captchaInfo.isEnterprise,
            captchaInfo.s,
            captchaInfo.action
        );

        console.log("🎯 Captcha solved");

        const injectionResult = await injectRecaptchaToken(page, token, captchaInfo);
        console.log("💉 Token injection result:", injectionResult);

        await new Promise(resolve => setTimeout(resolve, waitTime));

        let submitResult = null;
        if (submitAfter) {
            submitResult = await page.evaluate(() => {
                const buttons = document.querySelectorAll("button, input[type=submit]");
                for (const btn of buttons) {
                    if (!btn.disabled && btn.offsetParent !== null) {
                        btn.click();
                        return { success: true, text: btn.innerText || btn.value || null };
                    }
                }
                return { success: false };
            });
        }

        return res.json({
            success: true,
            hasCaptcha: true,
            sessionId,
            tokenPreview: token.substring(0, 30) + "...",
            submitted: submitAfter,
            submitResult,
            captcha: {
                siteKey: captchaInfo.siteKey,
                isEnterprise: captchaInfo.isEnterprise,
                s: captchaInfo.s || null,
                action: captchaInfo.action || null
            },
            injectionResult
        });
    } catch (error) {
        console.error("Captcha solving error:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = { solveRecaptchaEndpoint };
