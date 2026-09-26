// Real-motion regression: each game is played by a recorded body instead of
// the demo autopilot. A fixture clip is served to Chrome as the webcam, and
// the run checks the setup pose, tracking, inference mode and frame pacing.
//
//   npm run dev -- --host 127.0.0.1 --port 5179
//   npm run qa:realmotion                      # all games
//   GROOVESTAR_QA_GAMES=blade,box npm run qa:realmotion
//
// Needs local Chrome and ffmpeg (fixtures are converted to .y4m once, in the
// OS temp folder). Fixture clips: tests/fixtures/motion/README.md.
import { chromium } from "playwright-core";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const only = process.env.GROOVESTAR_QA_GAMES?.split(",").map((s) => s.trim());
const CASES = [
  { game: "dance", clip: "dance", seconds: 20 },
  { game: "blade", clip: "slash", seconds: 25 },
  { game: "box", clip: "box", seconds: 25 },
  { game: "rush", clip: "rush", seconds: 25 },
  { game: "fruit", clip: "slash", seconds: 20 },
  { game: "tennis", clip: "swing", seconds: 20 },
  { game: "bowl", clip: "swing", seconds: 20 },
].filter((c) => !only || only.includes(c.game));
const KINETIC = new Set(["blade", "box", "rush", "tennis", "bowl"]);
const LOAD_LIMIT_MS = 120_000; // model download and compile on a cold cache
const POSE_LIMIT_MS = 45_000; // two loops of a 12-second clip once the camera is live
const gpuArgs =
  process.platform === "darwin"
    ? ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"]
    : [];

async function cameraFile(clip) {
  const dir = join(tmpdir(), "groovestar-realmotion");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${clip}.y4m`);
  try {
    await stat(out);
    return out;
  } catch {}
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `tests/fixtures/motion/${clip}.mp4`, "-vf", "fps=30", "-pix_fmt", "yuv420p", out]);
  return out;
}

async function runCase(c) {
  const result = { game: c.game, clip: c.clip, checks: [], warnings: [] };
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      ...gpuArgs,
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${await cameraFile(c.clip)}`,
    ],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ["camera"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector(".k-game-tile");
    await page.locator(`[data-game="${c.game}"]`).first().click();
    if (c.game === "dance") await page.getByRole("button", { name: /PLAY AN ORIGINAL ROUTINE/i }).click();
    else await page.locator("[data-play]").first().click();

    const t0 = Date.now();
    let cameraAt = 0,
      countdownAt = 0,
      last = "";
    const statuses = [];
    for (;;) {
      const status = await page.evaluate(() => document.querySelector(".k-setup [data-status]")?.textContent ?? null);
      if (status === null) break;
      if (status !== last) {
        statuses.push([Date.now() - t0, status]);
        last = status;
      }
      if (!cameraAt && /frame|hands|Hold/i.test(status)) cameraAt = Date.now();
      if (!countdownAt && /^READY/.test(status)) countdownAt = Date.now();
      if (!cameraAt && Date.now() - t0 > LOAD_LIMIT_MS) break;
      if (cameraAt && !countdownAt && Date.now() - cameraAt > POSE_LIMIT_MS) break;
      await page.waitForTimeout(200);
    }
    result.setup = {
      passed: !!countdownAt,
      cameraReadyMs: cameraAt ? cameraAt - t0 : null,
      poseMs: countdownAt ? countdownAt - cameraAt : null,
      statuses,
    };
    if (!countdownAt) {
      result.checks.push("setup pose was not recognized");
      await page.screenshot({ path: `output/playwright/realmotion-${c.game}-setup.png` });
      result.errors = errors;
      return result;
    }
    await page.waitForFunction(() => !document.querySelector(".k-setup"), null, { timeout: 10_000 });

    await page.evaluate(() => {
      const w = window;
      w.__jank = { n: 0, long: 0, times: [] };
      let prev = performance.now();
      const tick = (t) => {
        const j = w.__jank;
        j.n++;
        if (t - prev > 20) j.long++;
        j.times.push(t - prev);
        prev = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const samples = [];
    for (let i = 0; i < c.seconds; i++) {
      await page.waitForTimeout(1000);
      samples.push(
        await page.evaluate(() => {
          const k = window.gsKinetic;
          return k ? { poseAge: k.poseAge, inference: k.inference, frameP95: k.frameP95, hits: k.hits, misses: k.misses, score: k.score, paused: k.paused } : null;
        }),
      );
    }
    result.jank = await page.evaluate(() => {
      const j = window.__jank;
      const t = j.times.slice(30).sort((a, b) => a - b);
      return { frames: j.n, droppedPct: +((100 * j.long) / Math.max(1, j.n)).toFixed(1), p99: t.length ? +t[Math.floor(t.length * 0.99)].toFixed(1) : null };
    });
    await page.screenshot({ path: `output/playwright/realmotion-${c.game}.png` });
    result.errors = errors;

    const k = samples.filter(Boolean);
    const lastSample = k.at(-1) ?? null;
    Object.assign(result, {
      trackedShare: k.length ? +(k.filter((s) => s.poseAge !== null && s.poseAge < 250).length / k.length).toFixed(2) : null,
      inference: lastSample?.inference ?? null,
      frameP95: lastSample ? +lastSample.frameP95.toFixed(1) : null,
      hits: lastSample?.hits ?? null,
      misses: lastSample?.misses ?? null,
      score: lastSample?.score ?? null,
    });
    if (errors.length) result.checks.push(`${errors.length} page error(s)`);
    if (KINETIC.has(c.game)) {
      if (!k.length) result.checks.push("no session diagnostics");
      if ((result.trackedShare ?? 0) < 0.5) result.checks.push(`tracked in only ${Math.round((result.trackedShare ?? 0) * 100)}% of samples`);
      if (result.inference?.mode !== "worker") result.checks.push(`inference ran on the ${result.inference?.mode ?? "unknown"} thread`);
      if ((result.frameP95 ?? 0) > 20) result.warnings.push(`frame p95 ${result.frameP95} ms`);
      if ((result.hits ?? 0) + (result.misses ?? 0) === 0) result.warnings.push("no targets reached the player");
      else if (!result.hits) result.warnings.push("no hits from the fixture movement");
    }
    if ((result.jank?.droppedPct ?? 0) > 5) result.warnings.push(`${result.jank.droppedPct}% frames over 20 ms`);
    return result;
  } catch (e) {
    result.checks.push(`crashed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  } finally {
    await browser.close();
  }
}

await mkdir("output/playwright", { recursive: true });
await mkdir("docs/qa", { recursive: true });
const results = [];
for (const c of CASES) {
  const r = await runCase(c);
  results.push(r);
  const verdict = r.checks.length ? `FAIL (${r.checks.join("; ")})` : "pass";
  console.log(
    `${c.game.padEnd(6)} ${verdict}` +
      ` · camera ${r.setup?.cameraReadyMs ?? "-"} ms · pose ${r.setup?.poseMs ?? "-"} ms` +
      (r.inference ? ` · ${r.inference.mode} ${r.inference.ms} ms` : "") +
      (r.frameP95 !== undefined && r.frameP95 !== null ? ` · p95 ${r.frameP95} ms` : "") +
      (r.hits !== undefined && r.hits !== null ? ` · ${r.hits} hits / ${r.misses} misses` : "") +
      (r.warnings.length ? ` · warn: ${r.warnings.join("; ")}` : ""),
  );
}
const failed = results.filter((r) => r.checks.length);
await writeFile(
  "docs/qa/realmotion-report.json",
  JSON.stringify({ origin, date: new Date().toISOString(), passed: !failed.length, results }, null, 2),
);
if (failed.length) process.exitCode = 1;
