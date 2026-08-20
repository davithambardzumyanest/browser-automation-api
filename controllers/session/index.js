// Aggregates every session route handler into the same shape
// controllers/sessionController.js used to export, so routes/sessionRoutes.js
// only needs to change its require() target.
const AIService = require('../../services/aiService');

// Initialize AI service on startup
AIService.initialize();

const { createSession } = require('./handlers/createSession');
const { listSessions } = require('./handlers/listSessions');
const { getSession } = require('./handlers/getSession');
const { scrollToBottom } = require('./handlers/scrollToBottom');
const { getPageHTML } = require('./handlers/getPageHTML');
const { navigateSession } = require('./handlers/navigateSession');
const { closeSessionEndpoint, closeAllSessions } = require('./handlers/closeSession');
const { screenshotSession } = require('./handlers/screenshotSession');
const { executeScriptSession } = require('./handlers/executeScriptSession');
const { clickSession } = require('./handlers/clickSession');
const { typeSession } = require('./handlers/typeSession');
const { selectOptionSession } = require('./handlers/selectOptionSession');
const { getContentSession } = require('./handlers/getContentSession');
const { simulateUserActions } = require('./handlers/simulateUserActions');
const { validateGoogle } = require('./handlers/validateGoogle');
const { fillInput } = require('./handlers/fillInput');
const { fillImageInput } = require('./handlers/fillImageInput');
const { checkXPath } = require('./handlers/checkXPath');
const { clickXPath } = require('./handlers/clickXPath');
const { configure2CaptchaEndpoint } = require('./handlers/configure2CaptchaEndpoint');
const { validate2CaptchaEndpoint } = require('./handlers/validate2CaptchaEndpoint');
const { diagnose2CaptchaEndpoint } = require('./handlers/diagnose2CaptchaEndpoint');
const { solveRecaptchaEndpoint } = require('./handlers/solveRecaptchaEndpoint');
const { refreshSession } = require('./handlers/refreshSession');
const { runStagehandSession } = require('./handlers/runStagehandSession');
const { dismissProtocolDialog } = require('./handlers/dismissProtocolDialog');

module.exports = {
    createSession,
    listSessions,
    getSession,
    scrollToBottom,
    getPageHTML,
    navigateSession,
    closeSessionEndpoint,
    closeAllSessions,
    screenshotSession,
    executeScriptSession,
    clickSession,
    typeSession,
    selectOptionSession,
    getContentSession,
    simulateUserActions,
    validateGoogle,
    fillInput,
    fillImageInput,
    checkXPath,
    clickXPath,
    configure2CaptchaEndpoint,
    validate2CaptchaEndpoint,
    diagnose2CaptchaEndpoint,
    solveRecaptchaEndpoint,
    refreshSession,
    dismissProtocolDialog,
    runStagehandSession
};
