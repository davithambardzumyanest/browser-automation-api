const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { withSessionLock } = require('../controllers/session/helpers/sessionLock');

// State-changing commands hold the per-session lock, so two of them never
// interleave on one page; an overlapping one gets 409 SESSION_BUSY without
// running. Read-only endpoints and job polling/cancel stay unlocked.
// (/execute takes the lock itself, for as long as its job runs.)
const locked = (name, handler) => withSessionLock(name, handler);

// Session management
router.post('/create', sessionController.createSession);
router.get('/list', sessionController.listSessions);
router.get('/:sessionId', sessionController.getSession);
router.delete('/:sessionId', sessionController.closeSessionEndpoint);
router.delete('/', sessionController.closeAllSessions);

// Session operations
router.post('/:sessionId/goto', locked('goto', sessionController.navigateSession));
router.post('/:sessionId/refresh', locked('refresh', sessionController.refreshSession));
router.post('/:sessionId/screenshot', sessionController.screenshotSession);
router.post('/:sessionId/execute', sessionController.executeScriptSession);
router.get('/:sessionId/execute/:jobId', sessionController.getExecuteJob);
router.post('/:sessionId/execute/:jobId/cancel', sessionController.cancelExecuteJob);
router.post('/:sessionId/stagehand', locked('stagehand', sessionController.runStagehandSession));
router.post('/:sessionId/click', locked('click', sessionController.clickSession));
router.post('/:sessionId/click-xy', locked('click-xy', sessionController.clickByCoordinates));
router.post('/:sessionId/check-xpath', sessionController.checkXPath);
router.post('/:sessionId/type', locked('type', sessionController.typeSession));
router.post('/:sessionId/select', locked('select', sessionController.selectOptionSession));
router.post('/:sessionId/fill', locked('fill', sessionController.fillInput));
router.post('/:sessionId/fill-image', locked('fill-image', sessionController.fillImageInput));
router.post('/:sessionId/content', sessionController.getContentSession);
router.get('/:sessionId/html', sessionController.getPageHTML);
router.post('/:sessionId/simulate-actions', locked('simulate-actions', sessionController.simulateUserActions));
router.post('/:sessionId/validate-google', locked('validate-google', sessionController.validateGoogle));
router.post('/:sessionId/solve-recaptcha', locked('solve-recaptcha', sessionController.solveRecaptchaEndpoint));
router.post('/:sessionId/configure-2captcha', locked('configure-2captcha', sessionController.configure2CaptchaEndpoint));
router.get('/:sessionId/validate-2captcha', sessionController.validate2CaptchaEndpoint);
router.get('/:sessionId/diagnose-2captcha', sessionController.diagnose2CaptchaEndpoint);
router.post('/:sessionId/scroll-to-bottom', locked('scroll-to-bottom', sessionController.scrollToBottom));

module.exports = router;
