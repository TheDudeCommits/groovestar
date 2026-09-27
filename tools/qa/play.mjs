// Plays a game with a simulated body and reports how it went.
//
//   npx vite --host 127.0.0.1 --port 5179            (dev server; bots are dev-only)
//   node tools/qa/play.mjs blade 40                  play 40 s of Beat Blade
//   node tools/qa/play.mjs blade 40 --skill=0.5 --diff=expert --shots=out/dir --every=4
//   node tools/qa/play.mjs blade 20 --cam=/tmp/slash.y4m --film=out/dir   recorded webcam, filmed
//
// Prints one JSON line: hits, misses, score and the game's own diagnostics
// sampled each second. --min-hit-rate=0.8 turns it into a pass/fail check.
import { chromium } from "playwright-core";
import { mkdir, readdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const [game = "blade", secs = "30", ...rest] = process.argv.slice(2);
const flag = (k, d) => {
  const f = rest.find((a) => a.startsWith(`--${k}=`));
  return f ? f.slice(k.length + 3) : d;
};
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const skill = flag("skill", "0.75");
const bot = flag("bot", game);
const diff = flag("diff", "flow");
const shots = flag("shots", "");
const every = Number(flag("every", "5"));
const track = flag("track", "");
const minRate = flag("min-hit-rate", "");
const cam = flag("cam", "");
const film = flag("film", "");
const width = Number(flag("w", "1280")),
  height = Number(flag("h", "720"));
const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
const camArgs = cam ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${cam}`] : [];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...gpu, ...camArgs, "--autoplay-policy=no-user-gesture-required"] });
let exitCode = 0;
try {
  if (film) await mkdir(film, { recursive: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    permissions: cam ? ["camera"] : [],
    ...(film ? { recordVideo: { dir: film, size: { width, height } } } : {}),
  });
  const ctxStart = Date.now();
  await context.addInitScript(
    ([d]) => {
      const s = JSON.parse(localStorage.getItem("gs-kinetic-settings") ?? "{}");
      localStorage.setItem("gs-kinetic-settings", JSON.stringify({ ...s, difficulty: d, voice: false }));
    },
    [diff],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const simq = cam ? "" : `sim=${bot}&simskill=${skill}&`;
  await page.goto(`${origin}/?${simq}game=${game}`, { waitUntil: "domcontentloaded" });
  if (shots) await mkdir(shots, { recursive: true });
  if (game === "dance") {
    await page.waitForSelector("[data-original], button", { timeout: 20000 });
    await page.getByRole("button", { name: /PLAY AN ORIGINAL ROUTINE/i }).click();
  } else {
    await page.waitForSelector("[data-play]", { timeout: 20000 });
    if (track) await page.locator(`[data-track="${track}"]`).first().click().catch(() => {});
    await page.locator("[data-play]").first().click();
  }
  // setup screen: the sim raises both hands; wait for the countdown to finish
  const t0 = Date.now();
  await page.waitForFunction(() => !document.querySelector(".pt-setup") && (window.gsKinetic || window.gsGame), null, { timeout: 120000 });
  const setupMs = Date.now() - t0;
  const filmStart = (Date.now() - ctxStart) / 1000;
  const samples = [];
  for (let i = 0; i < Number(secs); i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const k = window.gsKinetic;
      if (!k) return null;
      const { id, elapsed, score, hits, misses, frameP95, poseAge, paused, ...rest } = k;
      return { id, elapsed: +elapsed.toFixed(1), score, hits, misses, p95: +(frameP95 ?? 0).toFixed(1), poseAge: poseAge === null || poseAge === undefined ? null : Math.round(poseAge), paused, ...rest };
    });
    samples.push(s);
    if (shots && (i + 1) % every === 0) await page.screenshot({ path: `${shots}/${game}-${String(i + 1).padStart(3, "0")}.png` });
    if (!s && i > 3) break;
  }
  const last = samples.filter(Boolean).at(-1) ?? {};
  const rate = last.hits + last.misses ? last.hits / (last.hits + last.misses) : null;
  const out = { game, diff, skill: +skill, setupMs, hits: last.hits, misses: last.misses, hitRate: rate === null ? null : +rate.toFixed(3), score: last.score, p95: last.p95, last, errors: errors.slice(0, 10) };
  if (film) {
    await context.close();
    const files = (await readdir(film)).filter((f) => f.endsWith(".webm") && f !== "film.webm");
    if (files.length) await rename(`${film}/${files[0]}`, `${film}/film.webm`);
    const skip = Math.max(0, filmStart + 2).toFixed(2);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", skip, "-i", `${film}/film.webm`, "-vf", `fps=4,scale=${Math.round(width / 3)}:-1,tile=6x4`, "-frames:v", "1", "-q:v", "3", `${film}/sheet.jpg`]);
    out.film = `${film}/film.webm`;
  }
  console.log(JSON.stringify(out));
  if (minRate && (rate === null || rate < Number(minRate))) exitCode = 1;
  if (errors.length) exitCode = 1;
} finally {
  await browser.close();
}
process.exitCode = exitCode;
