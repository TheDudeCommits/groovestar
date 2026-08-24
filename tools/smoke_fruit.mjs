// Fruit Slice rebuild smoke: demo mode, run 26s of gameplay, sample the
// score along the way, screenshot early + during frenzy window.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${process.env.PORT ?? 5174}`);
await page.waitForFunction(() => document.querySelectorAll('.game-tile').length >= 6, null, { timeout: 15000 });
await page.click('.game-tile');
await page.waitForTimeout(4600);          // camera fail + countdown
await page.screenshot({ path: '/tmp/fruit_early.png' });
await page.waitForTimeout(8000);
await page.screenshot({ path: '/tmp/fruit_mid.png' });
await page.waitForTimeout(14000);         // ~26s in: past first frenzy
await page.screenshot({ path: '/tmp/fruit_frenzy.png' });
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
