const { sessions } = require('../state');
const { getFirstTab } = require('../helpers/tabs');

const runStagehandSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        message,
        mode = 'agent',
        timeoutMs = 120000,
        resetConversation = false
    } = req.body ?? {};

    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({
            error: 'Message is required',
            message: 'Provide a non-empty message field describing the action(s) Stagehand should perform'
        });
    }

    if (!['agent', 'act', 'observe'].includes(mode)) {
        return res.status(400).json({
            error: 'Invalid mode',
            message: 'mode must be one of: agent, act, observe'
        });
    }

    const stagehandTimeoutMs = Number(timeoutMs);
    if (!Number.isFinite(stagehandTimeoutMs) || stagehandTimeoutMs <= 0) {
        return res.status(400).json({
            error: 'Invalid timeoutMs',
            message: 'timeoutMs must be a positive number'
        });
    }

    if (!sessions.has(sessionId)) {
        return res.status(404).json({
            error: 'Session not found',
            message: `Session ${sessionId} does not exist or has expired`
        });
    }

    const session = sessions.get(sessionId);
    session.lastUsed = Date.now();
    session.lastActivity = Date.now();

    if (!session.stagehand || !session.agent) {
        return res.status(500).json({
            error: 'Stagehand unavailable',
            message: 'This session was not initialized with Stagehand support'
        });
    }

    const { stagehand } = session;

    try {
        const page = await getFirstTab(session);
        session.page = page;

        let result;
        if (mode === 'act') {
            result = await Promise.race([
                stagehand.act(message),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand action timed out')), stagehandTimeoutMs))
            ]);
        } else if (mode === 'observe') {
            result = await Promise.race([
                stagehand.observe(message),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand observation timed out')), stagehandTimeoutMs))
            ]);
        } else {
            if (resetConversation) {
                session.agentMessages = undefined;
            }

            const agentOptions = { instruction: message };
            if (session.agentMessages) {
                // Continue the same CUA conversation so the agent remembers what it
                // already did (page state, prior actions). Without this, every call
                // starts a brand-new conversation and the agent tends to re-orient by
                // re-navigating/reloading the page instead of picking up where it left off.
                agentOptions.messages = session.agentMessages;
            }

            result = await Promise.race([
                session.agent.execute(agentOptions),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Stagehand agent timed out')), stagehandTimeoutMs))
            ]);

            if (result?.messages) {
                session.agentMessages = result.messages;
            }
        }

        const activePage = await getFirstTab(session);
        session.page = activePage;
        session.lastUsed = Date.now();
        session.lastActivity = Date.now();

        res.json({
            success: true,
            sessionId,
            mode,
            message,
            result,
            pageInfo: {
                title: await activePage.title(),
                url: activePage.url(),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error(`Error running Stagehand in session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to run Stagehand action',
            message: error.message
        });
    }
};

module.exports = { runStagehandSession };
