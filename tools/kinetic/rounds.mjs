import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const ids = process.env.GROOVESTAR_QA_GAMES?.split(",") ?? [
  "blade",
  "box",
  "rush",
  "fruit",
  "bowl",
  "tennis",
];
await mkdir("output/playwright", { recursive: true });
const report = [];
// Separate browsers keep each visible during simultaneous round-completion checks.
await Promise.all(
  ids.map(async (id) => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    const errors = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      page.on("pageerror", (e) => errors.push(e.message));
      if(id==="bowl2")await page.addInitScript(()=>sessionStorage.setItem("gs-bowl-players","2"));
      await page.goto(id==="dance"?`${origin}/?dancetest`:`${origin}/?demo=${id==="bowl2"?"bowl":id}`);
      await page.waitForSelector(
        id === "fruit" ? ".k-canvas-controls" : id === "dance" ? ".kinetic-dance-layer" : ".kinetic-game",
        { timeout: 15000 },
      );
      await page.waitForTimeout(14000);
      const mid = await page.evaluate(() => window.gsKinetic ?? null);
      await page.screenshot({
        path: `output/playwright/round-${id}-action.png`,
      });
      await page.waitForSelector(".k-result", { timeout: 180000 });
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: `output/playwright/round-${id}-results.png`,
      });
      const result = await page.locator(".k-result main").innerText();
      assert.match(result, /DEMO COMPLETE/);
      if(id==="bowl2")assert.match(result,/PLAYER 2/);
      if(id==="dance")assert.equal(await page.evaluate(()=>localStorage.getItem("gs-stars")),null);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("gs-kinetic-records")),
        null,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("gs-fruit-stats")),
        null,
      );
      assert.equal(await page.locator(".kinetic-game").count(), 0);
      assert.equal(errors.length, 0, errors.join("\n"));
      report.push({ id, mid, result, errors });
      console.log(
        "Completed",
        id,
        result.match(/\n([\d,]+)\nPOINTS/)?.[1] ?? "result displayed",
      );
    } catch (error) {
      report.push({ id, errors, error: String(error) });
      process.exitCode = 1;
      console.error(id, String(error));
    } finally {
      await browser.close();
    }
  }),
);
await writeFile(
  process.env.GROOVESTAR_QA_REPORT??"output/playwright/rounds-report.json",
  JSON.stringify(report, null, 2),
);
console.log("Round checks finished; all browsers closed.");
