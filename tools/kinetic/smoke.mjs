import { chromium } from "playwright-core";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  report = { origin, games: [], errors };
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.GROOVESTAR_QA_SHARE_FILE)
    await page.goto(
      JSON.parse(await readFile(process.env.GROOVESTAR_QA_SHARE_FILE, "utf8")),
    );
  await page.goto(origin);
  await page.waitForSelector(".k-game-tile");
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator(".k-game-tile").count(), 7);
  await page.screenshot({
    path: "output/playwright/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "THE CREW", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".k-cast-grid img")).every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: "output/playwright/cast-desktop.png" });
  await page.getByRole("button", { name: "Close character selection" }).click();
  await page
    .getByRole("button", { name: "Movement and display settings" })
    .click();
  await page.screenshot({ path: "output/playwright/settings.png" });
  await page.getByRole("button", { name: "Close settings" }).click();
  for (const id of ["blade", "box", "rush", "tennis", "bowl"]) {
    await page.goto(`${origin}/?demo=${id}`);
    await page.waitForFunction((id) => window.gsKinetic?.id === id, id, {
      timeout: 20000,
    });
    await page.waitForTimeout(3600);
    const metrics = await page.evaluate(() => window.gsKinetic);
    report.games.push(metrics);
    await page.screenshot({ path: `output/playwright/game-${id}.png` });
    await page.getByRole("button", { name: "Pause game" }).click();
    const t = await page.evaluate(() => window.gsKinetic.elapsed);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.gsKinetic.elapsed), t);
    await page.getByRole("button", { name: "Resume", exact: false }).click();
    await page.waitForTimeout(300);
    assert.ok((await page.evaluate(() => window.gsKinetic.elapsed)) > t);
    await page.getByRole("button", { name: "Pause game" }).click();
    await page
      .getByRole("button", { name: "Restart session", exact: true })
      .click();
    await page.waitForFunction(
      (id) => window.gsKinetic?.id === id && window.gsKinetic.elapsed < 2,
      id,
    );
    assert.equal(await page.locator(".kinetic-game").count(), 1);
    await page.getByRole("button", { name: "Pause game" }).click();
    await page
      .getByRole("button", { name: "Back to game", exact: true })
      .click();
    await page.waitForSelector(".k-detail");
    assert.equal(await page.locator(".kinetic-game").count(), 0);
    console.log(
      "Smoke",
      id,
      metrics.frameP95?.toFixed(1),
      "ms p95",
      metrics.drawCalls,
      "draws",
    );
  }
  await page.goto(`${origin}/?dancetest`);
  await page.waitForSelector(".kinetic-dance-layer", { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "output/playwright/game-dance.png" });
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await page.waitForSelector(".k-dance-intro");
  await page.screenshot({
    path: "output/playwright/dance-home.png",
    fullPage: true,
  });
  await page.goto(`${origin}/?demo=fruit`);
  await page.waitForSelector(".k-canvas-controls");
  await page.waitForTimeout(3300);
  await page.screenshot({ path: "output/playwright/game-fruit.png" });
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await page.goto(origin);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: "output/playwright/home-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.querySelector(".k-shell").scrollWidth <= innerWidth + 1,
    ),
  );
  await page.getByRole("button", { name: "THE CREW", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".k-cast-grid img")).every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: "output/playwright/cast-mobile.png" });
  await page.getByRole("button", { name: "Close character selection" }).click();
  await page.locator('[data-game="blade"]').click();
  await page.screenshot({
    path: "output/playwright/blade-home-mobile.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(
    await page.evaluate(() => localStorage.getItem("gs-kinetic-records")),
    null,
  );
} finally {
  await browser.close();
  await writeFile(
    "output/playwright/smoke-report.json",
    JSON.stringify(report, null, 2),
  );
}
console.log("Suite smoke complete; browser closed.");
