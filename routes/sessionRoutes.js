const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');

// Session management
router.post('/create', sessionController.createSession);
router.get('/list', sessionController.listSessions);
router.get('/:sessionId', sessionController.getSession);
router.delete('/:sessionId', sessionController.closeSessionEndpoint);
router.delete('/', sessionController.closeAllSessions);

// Session operations
router.post('/:sessionId/goto', sessionController.navigateSession);
router.post('/:sessionId/refresh', sessionController.refreshSession);
router.post('/:sessionId/screenshot', sessionController.screenshotSession);
router.post('/:sessionId/execute', sessionController.executeScriptSession);
router.post('/:sessionId/click', sessionController.clickSession);
router.post('/:sessionId/check-xpath', sessionController.checkXPath);
router.post('/:sessionId/type', sessionController.typeSession);
router.post('/:sessionId/select', sessionController.selectOptionSession);
router.post('/:sessionId/fill', sessionController.fillInput);
router.post('/:sessionId/fill-image', sessionController.fillImageInput);
router.post('/:sessionId/content', sessionController.getContentSession);
router.get('/:sessionId/html', sessionController.getPageHTML);
router.post('/:sessionId/simulate-actions', sessionController.simulateUserActions);
router.post('/:sessionId/validate-google', sessionController.validateGoogle);
router.post('/:sessionId/solve-recaptcha', sessionController.solveRecaptchaEndpoint);
router.post('/:sessionId/configure-2captcha', sessionController.configure2CaptchaEndpoint);
router.get('/:sessionId/validate-2captcha', sessionController.validate2CaptchaEndpoint);
router.get('/:sessionId/diagnose-2captcha', sessionController.diagnose2CaptchaEndpoint);
router.post('/:sessionId/scroll-to-bottom', sessionController.scrollToBottom);

module.exports = router;
