const express = require('express');
const router = express.Router();
const browserController = require('../controllers/browserController');

// Screenshot endpoint
router.post('/screenshot', browserController.takeScreenshot);

// Navigation endpoint
router.post('/navigate', browserController.navigate);

// Click by text endpoint
router.post('/click-text', browserController.clickByText);

// Click by selector endpoint
router.post('/click-selector', browserController.clickBySelector);

// Fill form endpoint
router.post('/fill-form', browserController.fillForm);

// Get page content endpoint
router.post('/content', browserController.getPageContent);

// Execute script endpoint
router.post('/execute-script', browserController.executeScript);

// Wait for element endpoint
router.post('/wait-element', browserController.waitForElement);

// Get element attributes endpoint
router.post('/element-attributes', browserController.getElementAttributes);

// Scroll page endpoint
router.post('/scroll', browserController.scrollPage);

// Get PDF endpoint
router.post('/pdf', browserController.getPagePDF);

// Type text endpoint
router.post('/type', browserController.typeText);

module.exports = router;
