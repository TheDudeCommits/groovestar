// Fruit Slice smoke: home catalog -> fruit home -> solo run through intro,
// boss, finale, outro, and the results ceremony. Demo mode (no camera).
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${process.env.PORT ?? 5174}`);
await page.waitForFunction(() => document.querySelectorAll('#home-row .game-tile').length >= 7, null, { timeout: 15000 });
await page.screenshot({ path: '/tmp/home.png' });

await page.click('#home-row .game-tile:nth-child(2)');       // Fruit Slice
await page.waitForSelector('#fh-solo', { timeout: 5000 });
await page.screenshot({ path: '/tmp/fruit_home.png' });

await page.click('#fh-solo');
await page.waitForTimeout(4600);          // camera fail + countdown
await page.screenshot({ path: '/tmp/fruit_early.png' });
await page.waitForTimeout(8000);
await page.screenshot({ path: '/tmp/fruit_mid.png' });
await page.waitForTimeout(18000);         // ~31s in: boss on screen
await page.screenshot({ path: '/tmp/fruit_boss.png' });
await page.waitForTimeout(25000);         // ~56s in: finale
await page.screenshot({ path: '/tmp/fruit_finale.png' });
await page.waitForTimeout(13000);         // outro + results
await page.screenshot({ path: '/tmp/fruit_results.png' });
const results = await page.evaluate(() => document.querySelector('.results')?.textContent ?? 'NO RESULTS');
console.log('results:', JSON.stringify(results.slice(0, 220)));
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
