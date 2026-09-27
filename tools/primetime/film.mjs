// Records a page for visual review: node tools/primetime/film.mjs <url> <out-dir> [seconds] [w] [h]
// Writes film.webm, a contact sheet (sheet.jpg, one frame every 1/3 s) and
// prints frame pacing measured in the page. CAM=<y4m> serves a fake webcam.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
const [url, dir, secs = "6", w = "1280", h = "720"] = process.argv.slice(2);
await mkdir(dir, { recursive: true });
const gpu = ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"];
const cam = process.env.CAM ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${process.env.CAM}`] : [];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...gpu, ...cam, "--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await browser.newContext({
    viewport: { width: +w, height: +h },
    recordVideo: { dir, size: { width: +w, height: +h } },
    permissions: process.env.CAM ? ["camera"] : [],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(+(process.env.WAIT ?? 4000));
  const pacing = await page.evaluate(async (ms) => {
    const t = [];
    const t0 = performance.now();
    await new Promise((res) => {
      const f = (now) => {
        t.push(now);
        if (now - t0 < ms) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    return { frames: d.length, p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] };
  }, +secs * 1000);
  await context.close();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".webm") && f !== "film.webm");
  if (files.length) await rename(`${dir}/${files[0]}`, `${dir}/film.webm`);
  const skip = (+(process.env.WAIT ?? 4000) / 1000).toFixed(2);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", skip, "-i", `${dir}/film.webm`, "-vf", `fps=3,scale=${Math.round(+w / 3)}:-1,tile=6x${Math.ceil((+secs * 3) / 6)}`, "-frames:v", "1", "-q:v", "3", `${dir}/sheet.jpg`]);
  console.log(JSON.stringify({ dir, pacing, errors: errors.slice(0, 5) }));
} finally {
  await browser.close();
}
