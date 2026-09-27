// Screenshot helper for visual iteration: node tools/primetime/shot.mjs <url> <out.png> [waitMs] [w] [h] [evalJs]
import { chromium } from "playwright-core";
const [url, out, wait = "4000", w = "1600", h = "900", js] = process.argv.slice(2);
const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
const cam = process.env.CAM ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${process.env.CAM}`] : [];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...gpu, ...cam, "--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, permissions: process.env.CAM ? ["camera"] : [] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (js) await page.evaluate(js);
  await page.waitForTimeout(+wait);
  const burst = +(process.env.SHOTS ?? 1);
  for (let i = 0; i < burst; i++) {
    await page.screenshot({ path: burst > 1 ? out.replace(/\.png$/, `-${i}.png`) : out });
    if (i < burst - 1) await page.waitForTimeout(+(process.env.INTERVAL ?? 250));
  }
  const k = await page.evaluate(() => window.gsKinetic ? { p95: window.gsKinetic.frameP95, draws: window.gsKinetic.drawCalls, score: window.gsKinetic.score } : null);
  console.log(JSON.stringify({ out, k, errors: errors.slice(0, 8) }));
} finally {
  await browser.close();
}
