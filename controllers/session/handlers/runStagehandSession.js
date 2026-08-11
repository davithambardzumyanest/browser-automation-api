const { sessions } = require('../state');

const runStagehandSession = async (req, res) => {
    const { sessionId } = req.params;
    const {
        message,
        model = process.env.STAGEHAND_MODEL || 'openai/gpt-4.1-mini',
        mode = 'agent',
        timeoutMs = 120000,
        verbose = 1,
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

    if (typeof model !== 'string' || !model.trim()) {
        return res.status(400).json({
            error: 'Invalid model',
            message: 'model must be a non-empty Stagehand model name string'
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

    // NOTE: this currently always returns 501 regardless of createSession's
    // actual Stagehand wiring - see the summary note about this handler
    // being out of sync with createSession.js after this refactor.
    return res.status(501).json({
        error: 'Stagehand unavailable',
        message: 'AI-driven actions are disabled: Stagehand is no longer initialized for every session because its injected script left a fingerprintable automation signature on every page regardless of use. Use /goto, /fill, /click, etc. instead.'
    });
};

module.exports = { runStagehandSession };
