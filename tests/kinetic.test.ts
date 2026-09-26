import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HandRig } from "../src/pose/rig";
import {
  MotionInput,
  punchContact,
  cutContact,
} from "../src/kinetic/core/input";
import { chart, course, combinations } from "../src/kinetic/games/charts";
import {
  saveRun,
  ledger,
  bestGhost,
  challengeUrl,
  type RunRecord,
} from "../src/kinetic/core/records";
import { decodeCameraPacket } from "../src/net/camera-packet";
const data = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, String(v)),
    removeItem: (k: string) => data.delete(k),
  },
  location: { origin: "https://groovestar.example" },
});
beforeEach(() => data.clear());
const pose = () =>
  Array.from({ length: 33 }, (_, i) => ({
    x: [11, 13, 15, 23, 25, 27].includes(i) ? 0.6 : 0.4,
    y: i < 13 ? 0.3 : i < 17 ? 0.5 : i < 25 ? 0.58 : i < 27 ? 0.75 : 0.94,
    z: 0,
    visibility: 1,
  }));
test("the raised subject-left wrist stays on the left side of the mirror", () => {
  const r = new HandRig(),
    p = pose();
  p[15].x = 0.75;
  p[15].y = 0.14;
  p[16].x = 0.28;
  p[16].y = 0.58;
  r.update(p, null, 1000, 4 / 3);
  assert.equal(r.hand("L")!.x, 0.25);
  assert.equal(r.hand("L")!.y, 0.14);
  assert.equal(r.hand("R")!.x, 0.72);
});
test("a repeated frame cannot generate new velocity and expires after 240ms", () => {
  const r = new HandRig(),
    p = pose();
  r.update(p, null, 1000);
  const h = r.hand("L");
  r.update(p, null, 1100);
  assert.deepEqual(r.hand("L"), h);
  r.update(p, null, 1241);
  assert.equal(r.hand("L"), null);
  assert.equal(r.hasPose, false);
});
test("missing and malformed joints cannot leave a scoreable old hand", () => {
  const r = new HandRig(),
    p = pose();
  r.update(p, null, 1000);
  const p2 = pose();
  p2[15].x = NaN;
  r.update(p2, null, 1033);
  assert.equal(r.hand("L"), null);
  r.update([], null, 1100);
  assert.equal(r.hasPose, false);
});
test("phone frame interpolation does not invent fresh input", () => {
  const p = pose(),
    tracker = {
      update() {},
      latestLandmarks: p,
      latestWorld: null,
      latest: { energy: 0, points: null },
      aspect: 4 / 3,
    };
  const input = new MotionInput(tracker);
  assert.equal(input.update(1000).fresh, true);
  assert.equal(input.update(1016).fresh, false);
  assert.equal(input.update(1250).tracked, false);
  tracker.latestLandmarks = pose();
  assert.equal(input.update(1283).tracked, true);
});
const punch = {
  hand: { x: 0.4, y: 0.35, vis: 1, rel: 0.15, zVel: 0.5 },
  side: "L" as const,
  expected: "L" as const,
  target: { x: 0.4, y: 0.35, r: 0.075 },
  aspect: 16 / 9,
  armed: true,
  fresh: true,
  delta: 0,
};
test("a real depth extension at the matching pad counts, even with little sideways motion", () =>
  assert.equal(punchContact(punch), true));
test("wrong hand, wrong height, stale input, early/late contact and no guard recovery fail", () => {
  for (const change of [
    { side: "R" as const },
    { hand: { ...punch.hand, y: 0.7 } },
    { fresh: false },
    { armed: false },
    { delta: -0.5 },
    { delta: 0.8 },
    { hand: { ...punch.hand, vis: 0.2 } },
    { hand: { ...punch.hand, zVel: -0.3 } },
  ])
    assert.equal(
      punchContact({ ...punch, ...change }),
      false,
      JSON.stringify(change),
    );
});
test("image-only phone fallback requires a deliberate moving hand on the pad", () => {
  assert.equal(
    punchContact({ ...punch, hand: { ...punch.hand, zVel: null, rel: 2 } }),
    true,
  );
  assert.equal(
    punchContact({ ...punch, hand: { ...punch.hand, zVel: null, rel: 0.2 } }),
    false,
  );
});
const cut = {
  base: { x: 0.6, y: 0.7 },
  tip: { x: 0.6, y: 0.3 },
  previous: { x: 0.3, y: 0.3 },
  target: { x: 0.45, y: 0.3 },
  aspect: 16 / 9,
  dir: 2,
  vx: 2,
  vy: 0,
  speed: 3,
  visibility: 1,
  fresh: true,
  delta: 0,
};
test("a fast blade sweep can cross the note between captured frames", () =>
  assert.equal(cutContact(cut), true));
test("a cut in the wrong direction or outside the visible blade path fails", () => {
  assert.equal(cutContact({ ...cut, dir: 3 }), false);
  assert.equal(cutContact({ ...cut, target: { x: 0.2, y: 0.9 } }), false);
  assert.equal(cutContact({ ...cut, fresh: false }), false);
});
test("all three tracks are deterministic and contain no simultaneous same-hand duplicates", () => {
  for (const track of [0, 1, 2])
    for (const level of ["flow", "athlete", "expert"] as const) {
      const a = chart(192, "test-seed", level, track);
      assert.deepEqual(a, chart(192, "test-seed", level, track));
      assert.equal(new Set(a.map((n) => `${n.beat}/${n.side}`)).size, a.length);
      assert.ok(a.every((n) => n.beat >= 8 && n.beat < 192));
    }
});
test("100 course seeds per difficulty keep an adjacent route and separated movement demands", () => {
  for (const level of ["flow", "athlete", "expert"] as const)
    for (let seed = 0; seed < 100; seed++) {
      const obs = course(String(seed), 90, level);
      let previous = 0,
        last = 0;
      for (const at of new Set(
        obs
          .filter((o) => o.kind !== "coin" && o.kind !== "shield")
          .map((o) => o.at),
      )) {
        const group = obs.filter((o) => o.at === at);
        assert.ok(at - last >= 2.39);
        last = at;
        const blocks = group.filter((o) => o.kind === "block");
        if (blocks.length) {
          const open = [-1, 0, 1].find(
            (l) => !blocks.some((o) => o.lane === l),
          );
          assert.notEqual(open, undefined);
          assert.ok(Math.abs(open! - previous) <= 1);
          previous = open!;
        } else {
          assert.equal(group.length, 1);
          assert.equal(group[0].lane, previous);
        }
      }
    }
});
test("boxing intensity changes work density while keeping anticipation gaps", () => {
  assert.ok(
    combinations("a", 60, "expert").length >
      combinations("a", 60, "flow").length,
  );
  assert.deepEqual(combinations("a"), combinations("a"));
});
const record: RunRecord = {
  version: 2,
  id: "blade",
  score: 600,
  seconds: 90,
  activeSeconds: 30,
  hits: 10,
  misses: 1,
  combo: 5,
  seed: "s",
  difficulty: "flow",
  lowImpact: false,
  camera: false,
  track: 2,
  date: "2026-09-05T00:00:00Z",
  replay: [{ t: 1, x: 0, y: 0, score: 10 }],
};
test("demo completion earns no records, medals, minutes or old best writes", () => {
  data.set("gs-blade-best", "123");
  assert.equal(saveRun(record), false);
  assert.equal(ledger().runs.length, 0);
  assert.equal(data.get("gs-blade-best"), "123");
  assert.equal(data.size, 1);
});
test("verified runs preserve legacy stats and count observed active time", () => {
  data.set("gs-stars", "77");
  saveRun({ ...record, camera: true });
  assert.equal(ledger().activeSeconds, 30);
  assert.equal(ledger().medals, 1);
  assert.equal(data.get("gs-stars"), "77");
  assert.equal(data.get("gs-blade-best"), "600");
  assert.ok(bestGhost("blade", "s", "flow", false));
  assert.equal(bestGhost("blade", "s", "expert", false), undefined);
});
test("challenge URLs carry track, difficulty, impact and version", () => {
  const u = new URL(challengeUrl({ ...record, lowImpact: true }));
  assert.equal(u.searchParams.get("track"), "2");
  assert.equal(u.searchParams.get("impact"), "low");
  assert.equal(u.searchParams.get("v"), "2");
  assert.equal(u.searchParams.get("challenge"), "s");
});
const packet = {
  t: "pose",
  v: 2,
  seq: 2,
  capturedAt: 10,
  aspect: 16 / 9,
  points: pose().map((p) => [p.x, p.y, p.z, p.visibility]),
  world: pose().map((p) => [p.x, p.y, p.z, p.visibility]),
};
test("phone v2 carries full lower-body points and optional world data", () => {
  const p = decodeCameraPacket(packet, 1)!;
  assert.equal(p.landmarks.length, 33);
  assert.equal(p.landmarks[32].visibility, 1);
  assert.equal(p.world?.length, 33);
  assert.equal(p.aspect, 16 / 9);
});
test("phone rejects reordered, unknown-version and non-finite packets", () => {
  assert.equal(decodeCameraPacket(packet, 2), null);
  assert.equal(decodeCameraPacket({ ...packet, v: 3 }), null);
  assert.equal(
    decodeCameraPacket({ ...packet, points: [[NaN, 0, 0, 1]] }),
    null,
  );
  assert.ok(decodeCameraPacket({ ...packet, seq: 0 }, -1));
});
test("legacy camera packets remain explicit image-only input", () => {
  const p = decodeCameraPacket({ t: "pose", d: Array(84).fill(0) })!;
  assert.equal(p.version, 1);
  assert.equal(p.world, null);
  assert.equal(p.landmarks[32].visibility, 0);
});

// Storage migration must retain history once, including older movement days.
test("legacy movement minutes migrate once without rewriting the old record", () => {
  const old = JSON.stringify({
    secs: 420,
    kcal: 30,
    days: { "2026-09-03": 10 },
  });
  data.set("gs-fit", old);
  assert.equal(ledger().activeSeconds, 420);
  saveRun({ ...record, camera: true });
  assert.equal(ledger().activeSeconds, 450);
  assert.deepEqual(ledger().legacyDays, ["2026-09-03"]);
  assert.equal(data.get("gs-fit"), old);
});
test("ghosts require matching route mode and requested soundtrack", () => {
  saveRun({ ...record, id: "rush", camera: true, endless: true });
  assert.equal(bestGhost("rush", "s", "flow", false), undefined);
  assert.ok(bestGhost("rush", "s", "flow", false, true, 2));
  assert.equal(bestGhost("rush", "s", "flow", false, true, 1), undefined);
});
import { settings } from "../src/kinetic/core/settings";
import { outfit, equippedSaber } from "../src/kinetic/core/equipment";
test("malformed saved settings cannot enable video sharing or invalid rendering", () => {
  data.set(
    "gs-kinetic-settings",
    JSON.stringify({
      quality: "ultra",
      renderer: "unknown",
      volume: 10,
      shareVideo: "yes",
    }),
  );
  assert.equal(settings().quality, "auto");
  assert.equal(settings().renderer, "3d");
  assert.equal(settings().volume, 1);
  assert.equal(settings().shareVideo, false);
});
test("locked outfit and blade selections fall back to earned equipment", () => {
  data.set("gs-kinetic-outfit", "team");
  data.set("gs-saber", "ember");
  assert.equal(outfit().id, "studio");
  assert.equal(equippedSaber().need, 0);
});
