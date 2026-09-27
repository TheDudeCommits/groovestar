// Runs the dance lab in bake mode and writes the raw analysis for
// tools/primetime/dance-data.mjs. Needs the Vite dev server on 5179.
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
const out = process.argv[2] ?? "tools/primetime/scratch/dance-bake.json";
const clips = process.argv[3] ?? "";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.goto(`http://127.0.0.1:5179/tools/primetime/lab/dance-lab.html?mode=bake&clips=${clips}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  const err = await page.evaluate(() => window.__err);
  if (err) throw new Error(err);
  const data = await page.evaluate(() => window.__bake);
  await writeFile(out, JSON.stringify(data));
  for (const c of data) console.log(c.name, c.dur.toFixed(2) + "s", "peaks", JSON.stringify(c.peaks));
} finally {
  await browser.close();
}
