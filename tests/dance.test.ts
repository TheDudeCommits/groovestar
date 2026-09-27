import { test } from "node:test";
import assert from "node:assert/strict";
import { novaRoutine, coachLayers, NOVA, parseSlice, clipsFor } from "../src/dance/nova-routine";
import { CLIPS } from "../src/motion";
import { computeFrame } from "../src/pose/tracker";
import { SONGS } from "../src/songs";

const song = SONGS[0];
const routine = () => novaRoutine({ sections: song.sections, totalBeats: song.beats, bpm: song.bpm, seed: song.id, difficulty: 2 });

test("a Nova routine fills every section but the intro with registered two-beat slices", () => {
  const r = routine();
  assert.ok(r.length > 40, `only ${r.length} moves`);
  const firstBody = song.sections.find((s) => s.kind !== "intro")!.beat;
  for (const m of r) {
    assert.ok(m.beat >= firstBody, `move at ${m.beat} lands in the intro`);
    assert.ok(parseSlice(m.move), `${m.move} is not a Nova slice`);
    assert.ok(CLIPS[m.move], `${m.move} was not registered for scoring`);
    assert.equal(CLIPS[m.move].f.length, 16);
  }
  assert.ok(r.some((m) => m.gold), "no gold move");
});

test("every chorus repeats the same phrases so the routine can be learned", () => {
  const r = routine();
  const choruses = song.sections.filter((s) => s.kind === "chorus");
  assert.ok(choruses.length >= 2);
  const at = (start: number) => r.filter((m) => m.beat >= start && m.beat < start + 16).map((m) => m.move);
  assert.deepEqual(at(choruses[0].beat), at(choruses[1].beat));
});

test("the coach plays the move's clip at the matching time, blending only across cuts", () => {
  const r = routine();
  const m = r[10];
  const s = parseSlice(m.move)!;
  const layers = coachLayers(r, m.beat + 1, "Dance3");
  const top = layers.reduce((a, b) => (b[2] > a[2] ? b : a));
  assert.equal(top[0], s.clip.id);
  const want = s.clip.phase + ((s.start + 1) * 60) / s.clip.bpm;
  assert.ok(Math.abs(top[1] - want) < 1e-6, `time ${top[1]} vs ${want}`);
  assert.ok(Object.values(NOVA).length >= 10);
  assert.ok(clipsFor(120).every((c) => 120 / c.bpm >= 0.8 && 120 / c.bpm <= 1.25));
});

test("a mirrored T-pose reads as both arms straight out, like the move library", () => {
  const lm = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lms = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  // raw camera frame: the player's left side appears on the image's right
  lms[11] = lm(0.6, 0.4);
  lms[13] = lm(0.72, 0.4);
  lms[15] = lm(0.84, 0.4);
  lms[12] = lm(0.4, 0.4);
  lms[14] = lm(0.28, 0.4);
  lms[16] = lm(0.16, 0.4);
  lms[23] = lm(0.56, 0.7);
  lms[24] = lm(0.44, 0.7);
  const f = computeFrame(lms, 1000, { lastWrists: null, energy: 0 }, 0).features!;
  for (const a of f.slice(0, 4)) assert.ok(Math.abs(a - 90) < 1, `arm angle ${a}`);
  assert.ok(Math.abs(f[4]) < 1);
});
