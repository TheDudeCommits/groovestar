// Visual tour of the Primetime menus and venues: one screenshot per screen.
//   node tools/primetime/tour.mjs [outDir] [width] [height]
// Needs the dev server on 127.0.0.1:5179 (or GROOVESTAR_QA_URL).
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const [out = "output/primetime-tour", w = "1600", h = "900"] = process.argv.slice(2);
const only = process.env.TOUR?.split(",");
await mkdir(out, { recursive: true });
const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...gpu, "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name, wait = 1500) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
const want = (n) => !only || only.includes(n);
try {
  await page.goto(origin);
  await page.waitForSelector(".pt-card");
  if (want("home")) await shot("home", 5000);
  if (want("home-rush")) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await shot("home-rush", 1200);
  }
  if (want("crew")) {
    await page.getByRole("button", { name: "THE CREW", exact: true }).click();
    await shot("crew", 3500);
    await page.getByRole("button", { name: "Close character selection" }).click();
  }
  if (want("settings")) {
    await page.getByRole("button", { name: "Movement and display settings" }).click();
    await shot("settings", 800);
    await page.getByRole("button", { name: "Close settings" }).click();
  }
  for (const id of ["blade", "box", "rush", "fruit", "tennis", "bowl"]) {
    if (!want(`detail-${id}`)) continue;
    await page.goto(origin);
    await page.waitForSelector(".pt-card");
    await page.locator(`[data-game="${id}"]`).click();
    await page.waitForSelector(".pt-detail");
    await shot(`detail-${id}`, 1500);
  }
  if (want("dance-home")) {
    await page.goto(origin);
    await page.waitForSelector(".pt-card");
    await page.locator('[data-game="dance"]').click();
    await page.waitForSelector(".pt-dance-hero");
    await shot("dance-home", 1500);
  }
  if (want("progress")) {
    await page.goto(origin);
    await page.waitForSelector(".pt-card");
    await page.locator("[data-progress]").click();
    await shot("progress", 800);
  }
} finally {
  await browser.close();
}
if (errors.length) console.log("page errors:", errors);
