import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { ShowDirector } from "../src/kinetic/render/pt/show";
import { keepAlpha, HYPE_LEVELS } from "../src/kinetic/render/pt/palette";
import { MotionInput } from "../src/kinetic/core/input";

test("clean hits climb the hype levels once each, and a slump drops back", () => {
  const show = new ShowDirector();
  const ups: number[] = [];
  show.onLevel((level, up) => up && ups.push(level));
  let beat = 0;
  for (let i = 0; i < 200; i++) {
    show.hit(1);
    show.update(0.25, (beat += 0.5));
  }
  assert.equal(show.level, HYPE_LEVELS.length - 1);
  assert.deepEqual(ups, [1, 2, 3, 4]);
  for (let i = 0; i < 40; i++) {
    show.miss();
    show.update(0.25, (beat += 0.5));
  }
  assert.ok(show.level < 4, `level stayed at ${show.level}`);
});

test("the beat pulse peaks on the beat and fades before the next one", () => {
  const show = new ShowDirector();
  show.update(0.016, 3.0);
  const onBeat = show.pulse;
  show.update(0.016, 3.6);
  assert.ok(onBeat > 0.95);
  assert.ok(show.pulse < 0.1);
});

test("additive effects keep the frame alpha so the video wall stays open", () => {
  const glow = new T.MeshBasicMaterial({ blending: T.AdditiveBlending, transparent: true });
  keepAlpha(glow);
  assert.equal(glow.blending, T.CustomBlending);
  assert.equal(glow.blendSrc, T.SrcAlphaFactor);
  assert.equal(glow.blendDst, T.OneFactor);
  assert.equal(glow.blendSrcAlpha, T.ZeroFactor);
  assert.equal(glow.blendDstAlpha, T.OneFactor);
  const solid = new T.MeshBasicMaterial();
  keepAlpha(solid);
  assert.equal(solid.blending, T.NormalBlending);
});

test("arm games keep tracking a seated player whose hips are out of frame", () => {
  const seated = Array.from({ length: 33 }, (_, i) => ({ x: 0.5 + (i % 2 ? 0.08 : -0.08), y: 0.3 + i * 0.01, visibility: i >= 23 ? 0.1 : 1 }));
  const tracker = { latestLandmarks: seated, latestWorld: null, aspect: 4 / 3, latest: { energy: 0 }, update() {} };
  const arms = new MotionInput(tracker as never, false, false);
  const body = new MotionInput(tracker as never, false, true);
  assert.equal(arms.update(1000).tracked, true);
  assert.equal(body.update(1000).tracked, false);
});
