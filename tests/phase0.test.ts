import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { bodyInFrame, handRaised, starPose } from "../src/kinetic/core/setup-pose";
import { RibbonTrail } from "../src/kinetic/render/trail";
import { fetchRoutineIndex, loadRoutine } from "../src/routines";

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
  },
});

const HANDS = [11, 12, 13, 14, 15, 16, 23, 24];
/** Standing pose in raw image coordinates, arms down. */
const standing = () =>
  Array.from({ length: 33 }, (_, i) => ({
    x: [11, 13, 15, 23, 25, 27].includes(i) ? 0.58 : 0.42,
    y: i < 11 ? 0.2 : i < 13 ? 0.3 : i < 15 ? 0.42 : i < 17 ? 0.54 : i < 25 ? 0.58 : i < 27 ? 0.75 : 0.92,
    visibility: 1,
  }));
const raise = (p: ReturnType<typeof standing>, wrist: 15 | 16) => {
  p[wrist - 2].y = 0.2;
  p[wrist].y = 0.08;
};

test("both hands above the shoulders make the setup pose; one hand does not", () => {
  const p = standing();
  assert.equal(starPose(p), false);
  raise(p, 15);
  assert.equal(starPose(p), false);
  raise(p, 16);
  assert.equal(starPose(p), true);
  assert.equal(bodyInFrame(p, HANDS), true);
});

test("a hand raised past the top edge still counts when its elbow is up", () => {
  const p = standing();
  raise(p, 15);
  raise(p, 16);
  p[16].y = -0.03;
  p[16].visibility = 0.2;
  assert.equal(handRaised(p, 16), true);
  assert.equal(bodyInFrame(p, HANDS), true);
  assert.equal(starPose(p), true);
});

test("a wrist lost at the side or below a lowered elbow is not in frame", () => {
  const p = standing();
  p[15].x = 1.02;
  p[15].visibility = 0.3;
  assert.equal(handRaised(p, 15), false);
  assert.equal(bodyInFrame(p, HANDS), false);
});

test("ribbon trails grow with the blade and restart after a tracking jump", () => {
  const trail = new RibbonTrail(0xffffff, 6, 0.9);
  const fade = trail.mesh.geometry.getAttribute("fade") as T.BufferAttribute;
  for (let i = 0; i < 4; i++) trail.push(new T.Vector3(i * 0.1, 0, 0), new T.Vector3(i * 0.1, 0.8, 0));
  assert.equal(fade.getX(0), 1, "newest sample is fully opaque");
  assert.equal(fade.getX(3 * 2), 0, "oldest of four samples has faded out");
  trail.push(new T.Vector3(3, 0, 0), new T.Vector3(3, 0.8, 0));
  assert.equal(fade.getX(0), 0, "a single sample after a jump draws nothing");
  assert.equal(fade.getX(2), 0);
});

test("extracted routines never load outside development builds", async () => {
  let fetched = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("[]");
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchRoutineIndex(), []);
    assert.equal(await loadRoutine("bMZAuhadz2Y"), null);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a bowling pin is a single draw call", async () => {
  const { pin } = await import("../src/kinetic/render/sports");
  const meshes: T.Object3D[] = [];
  pin().traverse((o) => {
    if (o instanceof T.Mesh) meshes.push(o);
  });
  assert.equal(meshes.length, 1);
});
