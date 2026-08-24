// Sprint 0 smoke test: demo mode (no camera), boot Fruit Slice through the
// new countdown flow, verify tuning globals, watch for console errors.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${process.env.PORT ?? 5173}`);
await page.waitForFunction(() => document.querySelectorAll('.game-tile').length >= 6, null, { timeout: 15000 });

const tune = await page.evaluate(() => [gsTune('swing.minSpeed'), gsTune('punch.minZVel'), typeof gsTuneReset]);
console.log('tuning globals:', JSON.stringify(tune));

await page.click('.game-tile');                       // Fruit Slice
await page.waitForTimeout(1500);                      // camera fails fast in headless -> demo path
const midCard = await page.evaluate(() => document.querySelector('.ready-card')?.textContent ?? 'gone');
console.log('ready card during countdown:', JSON.stringify(midCard.slice(0, 120)));
await page.waitForTimeout(3500);                      // countdown done, game running
const cardGone = await page.evaluate(() => !document.querySelector('.ready-card'));
console.log('card removed after countdown:', cardGone);
await page.screenshot({ path: '/tmp/gs_fruit_demo.png' });

// backquote toggles the debug overlay even in demo mode
await page.keyboard.press('Backquote');
await page.waitForTimeout(600);
const overlayOn = await page.evaluate(() => localStorage.getItem('gs-debug') === '1' && [...document.querySelectorAll('canvas')].some((c) => c.style.zIndex === '40'));
console.log('debug overlay toggled on:', overlayOn);
await page.screenshot({ path: '/tmp/gs_fruit_debug.png' });
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);
const overlayOff = await page.evaluate(() => ![...document.querySelectorAll('canvas')].some((c) => c.style.zIndex === '40'));
console.log('debug overlay toggled off:', overlayOff);

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
