// Two simulated fighters box each other online through a real room.
//   node tools/qa/online-box.mjs [seconds]
import { chromium } from "playwright-core";
const secs = Number(process.argv[2] ?? 40);
const origin = process.env.GROOVESTAR_QA_URL ?? "http://127.0.0.1:5179";
const gpu = ["--use-angle=metal", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...gpu, "--autoplay-policy=no-user-gesture-required"] });
const open = async (q) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript(() => localStorage.setItem("gs-kinetic-settings", JSON.stringify({ difficulty: "flow", voice: false })));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${origin}/?sim=box&simskill=0.7&game=box&${q}`);
  await page.waitForSelector("[data-online]", { timeout: 30000 });
  await page.locator("[data-online]").click();
  return page;
};
try {
  const host = await open("bxroom=create");
  await host.waitForFunction(() => /Room \d{4}/.test(document.querySelector("#bx-status")?.textContent ?? ""), null, { timeout: 30000 });
  const code = (await host.textContent("#bx-status")).match(/Room (\d{4})/)[1];
  console.log("room", code);
  const guest = await open(`bxroom=${code}`);
  await host.waitForSelector("#bx-start:visible", { timeout: 30000 });
  await host.click("#bx-start");
  for (const p of [host, guest]) await p.waitForFunction(() => !document.querySelector(".pt-setup") && window.gsKinetic, null, { timeout: 90000 });
  console.log("both in the ring");
  for (let i = 0; i < secs; i += 5) {
    await host.waitForTimeout(5000);
    const snap = async (p) => p.evaluate(() => { const k = window.gsKinetic; return k ? { phase: k.phase, round: k.round, hp: Object.fromEntries(Object.entries(k.hp).map(([a, b]) => [a, Math.round(b)])), thrown: k.thrown, landed: k.landed, downs: k.downs } : null; });
    console.log(i + 5, "host", JSON.stringify(await snap(host)), "guest", JSON.stringify(await snap(guest)));
  }
  await host.screenshot({ path: "output/qa/online-host.png" });
  await guest.screenshot({ path: "output/qa/online-guest.png" });
  console.log("errors", host.errors.slice(0, 3), guest.errors.slice(0, 3));
} finally {
  await browser.close();
}
