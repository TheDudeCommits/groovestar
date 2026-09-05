import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
await mkdir("output/playwright", { recursive: true });
await mkdir("public/kinetic/covers", { recursive: true });
await mkdir("public/kinetic/cast", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const game of [
    "dance",
    "blade",
    "box",
    "rush",
    "fruit",
    "tennis",
    "bowl",
  ]) {
    await page.goto(`${origin}/?asset=${game}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1100);
    const png = `output/playwright/cover-${game}.png`;
    await page.screenshot({ path: png });
    await sharp(png)
      .webp({ quality: 86 })
      .toFile(`public/kinetic/covers/${game}.webp`);
    console.log("Cover", game);
  }
  await page.setViewportSize({ width: 480, height: 560 });
  for (const id of [
    "nova",
    "blaze",
    "luna",
    "kiko",
    "rex",
    "velvet",
    "midnight",
    "sol",
  ]) {
    await page.goto(`${origin}/?asset=cast&cast=${id}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);
    const png = `output/playwright/cast-${id}.png`;
    await page.screenshot({ path: png });
    await sharp(png)
      .webp({ quality: 86 })
      .toFile(`public/kinetic/cast/${id}.webp`);
    console.log("Cast", id);
  }
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
}
