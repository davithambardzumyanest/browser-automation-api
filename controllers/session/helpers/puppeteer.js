// Single place puppeteer-extra + the stealth plugin get configured. Every
// handler that needs to launch/connect should require the singleton from
// here instead of requiring 'puppeteer-extra' directly and re-registering
// the plugin, so registration only ever happens once regardless of require
// order across files (require() caches by path, so a raw 'puppeteer-extra'
// require elsewhere would still return this same instance - but importing
// from here keeps that fact from being something callers need to know).
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

module.exports = puppeteer;
