const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const INTERCEPT = process.env.INTERCEPT === '1';
(async () => {
  const dir = process.env.JOBTMP + '/hdr-' + Date.now();
  const { BROWSER_ARGS } = require('./controllers/session/helpers/browserFingerprint');
  const browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS, userDataDir: dir });
  const page = (await browser.pages())[0];
  if (INTERCEPT) {
    await page.setRequestInterception(true);
    page.on('request', r => r.continue());
  }
  await page.goto('https://postman-echo.com/headers', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const body = await page.evaluate(() => document.body.innerText);
  const h = JSON.parse(body).headers;
  console.log(`INTERCEPT=${INTERCEPT} cache-control=${h['cache-control']} pragma=${h['pragma']}`);
  await browser.close();
  require('fs').rmSync(dir, { recursive: true, force: true });
})();
