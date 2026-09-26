import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 650 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:5179/?asset=cast");
  await page.waitForLoadState("networkidle");
  const report = await page.evaluate(async () => {
    const { Stage } = await import("/src/kinetic/render/stage.ts"),
      { Character } = await import("/src/kinetic/render/character.ts"),
      { HandRig } = await import("/src/pose/rig.ts");
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    const stage = new Stage(host);
    stage.camera.position.set(0, 1.4, 6);
    stage.camera.lookAt(0, 1.0, 0);
    stage.floor();
    const cases = ["neutral", "left", "right", "cross", "occluded"],
      results = [];
    for (let i = 0; i < cases.length; i++) {
      const c = new Character();
      c.group.position.x = (i - 2) * 1.8;
      stage.scene.add(c.group);
      await c.load("nova");
      const rig = new HandRig();
      for (let j = 0; j < 25; j++) {
        const p = Array.from({ length: 33 }, () => ({
          x: 0.5,
          y: 0.2,
          z: 0,
          visibility: 1,
        }));
        for (const [idx, x, y] of [
          [11, 0.6, 0.3],
          [12, 0.4, 0.3],
          [13, 0.64, 0.43],
          [14, 0.36, 0.43],
          [15, 0.65, 0.55],
          [16, 0.35, 0.55],
          [23, 0.57, 0.58],
          [24, 0.43, 0.58],
          [25, 0.57, 0.75],
          [26, 0.43, 0.75],
          [27, 0.57, 0.94],
          [28, 0.43, 0.94],
        ])
          Object.assign(p[idx], { x, y });
        if (cases[i] === "left") {
          Object.assign(p[13], { x: 0.65, y: 0.2 });
          Object.assign(p[15], { x: 0.7, y: 0.08 });
        }
        if (cases[i] === "right") {
          Object.assign(p[14], { x: 0.35, y: 0.2 });
          Object.assign(p[16], { x: 0.3, y: 0.08 });
        }
        if (cases[i] === "cross") {
          Object.assign(p[13], { x: 0.5, y: 0.4 });
          Object.assign(p[15], { x: 0.33, y: 0.3 });
        }
        if (cases[i] === "occluded") p[15].visibility = 0;
        rig.update(p, null, 1000 + j * 33, 4 / 3);
        c.tracked(rig);
      }
      c.group.updateWorldMatrix(true, true);
      const left = c.group.getObjectByName("HandR"),
        right = c.group.getObjectByName("HandL");
      const THREE = await import("/node_modules/.vite/deps/three.js");
      const lp = left.getWorldPosition(new THREE.Vector3()),
        rp = right.getWorldPosition(new THREE.Vector3());
      results.push({
        pose: cases[i],
        left: [lp.x - c.group.position.x, lp.y, lp.z],
        right: [rp.x - c.group.position.x, rp.y, rp.z],
      });
    }
    stage.render();
    return results;
  });
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/motion-fixtures.png" });
  await writeFile(
    "output/playwright/motion-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  assert.ok(report[1].left[1] > report[0].left[1] + 0.4);
  assert.ok(report[1].left[0] < 0);
  assert.ok(report[2].right[1] > report[0].right[1] + 0.4);
  assert.ok(report[2].right[0] > 0);
  assert.ok(report[3].left[0] > report[0].left[0]);
} finally {
  await browser.close();
}
