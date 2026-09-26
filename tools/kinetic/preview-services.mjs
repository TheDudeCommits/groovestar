import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.GROOVESTAR_QA_URL;
if (!origin) throw Error("Set GROOVESTAR_QA_URL to the preview being verified");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { origin, checks: [], errors: [] };
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  if (process.env.GROOVESTAR_QA_SHARE_FILE)
    await page.goto(
      JSON.parse(await readFile(process.env.GROOVESTAR_QA_SHARE_FILE, "utf8")),
    );
  await page.goto(origin);
  await page.waitForSelector(".k-game-tile");
  const ice = await page.evaluate(async () => {
    const r = await fetch("/api/ice");
    const d = await r.json();
    return { status: r.status, hasTurn: !!d.turn };
  });
  assert.equal(ice.status, 200);
  assert.equal(ice.hasTurn, true);
  report.checks.push({ endpoint: "/api/ice", ...ice });
  const search = await page.evaluate(async () => {
    const r = await fetch("/api/search?q=daft%20punk");
    const d = await r.json();
    return { status: r.status, results: d.results?.length ?? 0 };
  });
  assert.equal(search.status, 200);
  assert.ok(search.results > 0);
  report.checks.push({ endpoint: "/api/search", ...search });
  const meta = await page.evaluate(async () => {
    const r = await fetch("/api/songmeta");
    return { status: r.status };
  });
  assert.equal(meta.status, 400);
  report.checks.push({
    endpoint: "/api/songmeta",
    status: meta.status,
    configured: true,
    note: "Missing title validation reached; no paid generation called",
  });
  await page.locator('[data-game="dance"]').click();
  await page.waitForSelector(".classic-tile");
  report.checks.push({
    view: "Dance Classics",
    count: await page.locator(".classic-tile").count(),
  });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
} finally {
  await browser.close();
  await writeFile(
    "output/playwright/preview-services-report.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
