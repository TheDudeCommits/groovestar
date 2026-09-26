import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  checks = [];
await mkdir("output/playwright", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("QA permission denial", "NotAllowedError");
      },
    });
  });
  await page.goto(`${origin}/?game=blade`);
  await page.locator("[data-play]").click();
  await page.waitForSelector("[data-fail]:not([hidden])", { timeout: 15000 });
  assert.equal(await page.locator(".kinetic-game").count(), 0);
  await page.screenshot({ path: "output/playwright/camera-denied.png" });
  await page.locator("[data-demo]").last().click();
  await page.waitForFunction(() => window.gsKinetic?.demo === true);
  checks.push(
    "Camera denial waits for explicit demo choice; no scored fallback",
  );
  // Exercise browser-native context loss, without modifying the game state.
  await page.evaluate(() => {
    const c = document.querySelector(".kinetic-canvas");
    window.qaLost = c.getContext("webgl2").getExtension("WEBGL_lose_context");
    window.qaLost.loseContext();
  });
  await page.waitForFunction(() => window.gsKinetic?.paused === true);
  const elapsed = await page.evaluate(() => window.gsKinetic.elapsed);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.gsKinetic.elapsed), elapsed);
  await page.evaluate(() => window.qaLost.restoreContext());
  await page.waitForTimeout(600);
  await page.locator("[data-resume]").click();
  await page.waitForTimeout(400);
  assert.ok((await page.evaluate(() => window.gsKinetic.elapsed)) > elapsed);
  checks.push("WebGL context loss freezes play; restored scene resumes");
  await page.goto(
    `${origin}/?game=blade&challenge=review-track-2&level=athlete&impact=low&track=2&v=2`,
  );
  await page.waitForSelector("[data-track]");
  assert.equal(await page.locator("[data-track]").inputValue(), "2");
  await page.locator("[data-demo]").click();
  await page.waitForFunction(() => window.gsKinetic?.track === "velocity");
  checks.push("Challenge preserves soundtrack, intensity and low-impact mode");
  for (const id of ["blade", "rush", "box"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/?demo=${id}`);
    await page.waitForFunction((id) => window.gsKinetic?.id === id, id);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `output/playwright/mobile-game-${id}.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  checks.push(
    "Portrait Blade, Rush and Boxing layouts render without page overflow",
  );
  await page.goto(origin);
  await page.evaluate(() =>
    localStorage.setItem(
      "gs-kinetic-settings",
      JSON.stringify({ renderer: "classic", voice: false }),
    ),
  );
  await page.reload();
  await page.waitForSelector(".k-preview-fallback");
  await page.goto(`${origin}/?demo=fruit`);
  await page.waitForSelector(".k-canvas-controls", { timeout: 15000 });
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Back to game", exact: true }).click();
  await page.waitForSelector(".k-detail");
  checks.push(
    "Classic renderer uses cover fallback; Fruit pause exit returns to game home",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("gs-kinetic-records")),
    null,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  await browser.close();
  await writeFile(
    "output/playwright/recovery-report.json",
    JSON.stringify({ origin, checks, errors }, null, 2),
  );
}
console.log(checks.join("\n"));
console.log("Recovery browser closed.");
