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
router.post('/:sessionId/screenshot', sessionController.screenshotSession);
router.post('/:sessionId/execute', sessionController.executeScriptSession);
router.post('/:sessionId/click', sessionController.clickSession);
router.post('/:sessionId/check-xpath', sessionController.checkXPath);
router.post('/:sessionId/type', sessionController.typeSession);
router.post('/:sessionId/fill', sessionController.fillInput);
router.post('/:sessionId/content', sessionController.getContentSession);
router.get('/:sessionId/html', sessionController.getPageHTML);
router.post('/:sessionId/simulate-actions', sessionController.simulateUserActions);
router.post('/:sessionId/validate-google', sessionController.validateGoogle);
router.post('/:sessionId/scroll-to-bottom', sessionController.scrollToBottom);

module.exports = router;
