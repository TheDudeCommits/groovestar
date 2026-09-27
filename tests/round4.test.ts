import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { bladeChart, CUT_VEC } from "../src/kinetic/games/blade-chart";
import { bowlingTotals } from "../src/kinetic/games/bowl-score";
import { solveShot, stepBall, NET_Z, NET_H, BALL_R, type Ball } from "../src/kinetic/games/tennis-ball";
import { encodeWorld, decodeWorld } from "../src/kinetic/games/boxing-net";
import { DanceSync } from "../src/dance/sync";
import { Body3D } from "../src/pose/body3d";

const SECTIONS = [
  { beat: 0, kind: "intro" as const },
  { beat: 16, kind: "verse" as const },
  { beat: 64, kind: "chorus" as const },
  { beat: 112, kind: "bridge" as const },
  { beat: 128, kind: "verse" as const },
  { beat: 144, kind: "chorus" as const },
  { beat: 172, kind: "outro" as const },
];

test("blade charts alternate each hand's swings, keep hands on their side, and repeat for a seed", () => {
  for (const diff of ["flow", "athlete", "expert"] as const) {
    const a = bladeChart(176, SECTIONS, "seed", diff);
    assert.deepEqual(a, bladeChart(176, SECTIONS, "seed", diff));
    assert.ok(a.length > 40, `${diff}: ${a.length} notes`);
    for (const hand of ["L", "R"] as const) {
      const mine = a.filter((n) => n.kind === "note" && n.hand === hand && n.dir !== 2 && n.dir !== 3 && n.dir !== 8);
      // parity: a down swing is followed by an up swing and vice versa
      let same = 0;
      for (let i = 1; i < mine.length; i++) {
        const up = (d: number) => CUT_VEC[d as keyof typeof CUT_VEC][1] < 0;
        if (up(mine[i].dir) === up(mine[i - 1].dir)) same++;
      }
      assert.ok(same <= mine.length * 0.12, `${diff} ${hand}: ${same} repeated swings in ${mine.length}`);
      // left notes in the left columns, right notes in the right
      assert.ok(mine.every((n) => (hand === "L" ? n.col <= 1 : n.col >= 2)));
    }
    if (diff === "flow") assert.ok(!a.some((n) => n.kind === "bomb"), "no bombs on flow");
  }
  assert.ok(bladeChart(176, SECTIONS, "s", "expert").length > bladeChart(176, SECTIONS, "s", "flow").length);
});

test("bowling scores strikes, spares and the tenth frame like a real alley", () => {
  const perfect = [...Array.from({ length: 9 }, () => [10]), [10, 10, 10]];
  assert.equal(bowlingTotals(perfect)[9], 300);
  const spares = [...Array.from({ length: 9 }, () => [5, 5]), [5, 5, 5]];
  assert.equal(bowlingTotals(spares)[9], 150);
  const open = Array.from({ length: 10 }, () => [3, 4]);
  assert.equal(bowlingTotals(open)[9], 70);
  // a strike waits for its two bonus balls before showing a total
  const pending = [[10], [3], [], [], [], [], [], [], [], []];
  assert.deepEqual(bowlingTotals(pending).slice(0, 2), [null, null]);
  const done = [[10], [3, 4], [], [], [], [], [], [], [], []];
  assert.deepEqual(bowlingTotals(done).slice(0, 2), [17, 24]);
});

test("a solved tennis shot clears the net and lands where it was aimed", () => {
  for (const [vh, spin] of [
    [14, 0],
    [22, 0.8],
    [16, -0.5],
  ] as const) {
    const start = new T.Vector3(0.8, 1.0, 3.8);
    const target = { x: -1.5, z: -15 };
    const b: Ball = { p: start.clone(), v: solveShot(start, target.x, target.z, vh, spin, 0.3), spin, bounces: 0, by: "you", box: null };
    let crossedAt: number | null = null;
    for (let i = 0; i < 4000 && b.p.y > BALL_R - 1e-6; i++) {
      const z0 = b.p.z;
      stepBall(b, 1 / 480);
      if (z0 > NET_Z && b.p.z <= NET_Z) crossedAt = b.p.y;
    }
    assert.ok(crossedAt !== null && crossedAt > NET_H, `vh ${vh}: net at ${crossedAt}`);
    assert.ok(Math.abs(b.p.z - target.z) < 0.9 && Math.abs(b.p.x - target.x) < 0.5, `vh ${vh}: landed ${b.p.x.toFixed(2)}, ${b.p.z.toFixed(2)}`);
  }
});

test("online boxing poses survive the wire", () => {
  const world = Array.from({ length: 33 }, (_, i) => ({ x: i * 0.01 - 0.1, y: -0.3 + i * 0.02, z: 0.05 * (i % 3), visibility: 0.9 }));
  const back = decodeWorld(encodeWorld(world))!;
  for (const i of [0, 11, 12, 15, 16, 23, 28]) {
    assert.ok(Math.abs(back[i].x - world[i].x) < 0.001 && Math.abs(back[i].y - world[i].y) < 0.001 && Math.abs(back[i].z - world[i].z) < 0.001);
  }
  assert.equal(decodeWorld([1, 2, 3]), null);
});

/** A coach stand-in: bones at fixed positions, from a limb direction table. */
function coachAt(arms: { L: [number, number, number]; R: [number, number, number] }) {
  const pos: Record<string, T.Vector3> = {
    RightArm: new T.Vector3(-0.2, 1.45, 0),
    LeftArm: new T.Vector3(0.2, 1.45, 0),
    RightUpLeg: new T.Vector3(-0.1, 0.95, 0),
    LeftUpLeg: new T.Vector3(0.1, 0.95, 0),
  };
  pos.RightForeArm = pos.RightArm.clone().add(new T.Vector3(...arms.R).multiplyScalar(0.28));
  pos.RightHand = pos.RightForeArm.clone().add(new T.Vector3(...arms.R).multiplyScalar(0.25));
  pos.LeftForeArm = pos.LeftArm.clone().add(new T.Vector3(...arms.L).multiplyScalar(0.28));
  pos.LeftHand = pos.LeftForeArm.clone().add(new T.Vector3(...arms.L).multiplyScalar(0.25));
  pos.RightLeg = pos.RightUpLeg.clone().add(new T.Vector3(0, -0.45, 0));
  pos.RightFoot = pos.RightLeg.clone().add(new T.Vector3(0, -0.43, 0));
  pos.LeftLeg = pos.LeftUpLeg.clone().add(new T.Vector3(0, -0.45, 0));
  pos.LeftFoot = pos.LeftLeg.clone().add(new T.Vector3(0, -0.43, 0));
  return { rigBone: (n: string) => (pos[n] ? { getWorldPosition: (v: T.Vector3) => v.copy(pos[n]) } : undefined) } as never;
}

/** A player whose arms point along the given screen directions (MediaPipe world, unmirrored). */
function playerWorld(arms: { L: [number, number, number]; R: [number, number, number] }) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
  // MediaPipe: x toward image right (the player's left side), y down, z away from the camera
  const put = (i: number, x: number, y: number, z: number) => (w[i] = { x: -x, y: -y, z: -z, visibility: 0.95 });
  const sh = { L: [-0.2, 0.5, 0], R: [0.2, 0.5, 0] } as const; // screen-left is the player's left
  for (const s of ["L", "R"] as const) {
    const [ax, ay, az] = arms[s];
    const e = [sh[s][0] + ax * 0.28, sh[s][1] + ay * 0.28, az * 0.28];
    const h = [e[0] + ax * 0.25, e[1] + ay * 0.25, e[2] + az * 0.25];
    const i = s === "L" ? 0 : 1;
    put(11 + i, sh[s][0], sh[s][1], 0);
    put(13 + i, e[0], e[1], e[2]);
    put(15 + i, h[0], h[1], h[2]);
    put(23 + i, s === "L" ? -0.1 : 0.1, 0, 0);
  }
  return w;
}

test("dancing with the coach scores high, a different pose scores low", () => {
  // the coach's right arm (on the screen's left) raised, her left arm out to the side
  const coachArms = { R: [0, 1, 0] as [number, number, number], L: [1, 0, 0] as [number, number, number] };
  const coach = coachAt(coachArms);
  const run = (arms: { L: [number, number, number]; R: [number, number, number] }) => {
    const sync = new DanceSync();
    const body = new Body3D();
    let now = 1000;
    let last = 0;
    for (let i = 0; i < 60; i++) {
      now += 33;
      sync.sampleCoach(coach, now);
      body.update(playerWorld(arms) as never, now);
      last = sync.compare(body, now).score;
    }
    return last;
  };
  // mirroring: the player's left arm copies her right (same side of the screen)
  const match = run({ L: [0, 1, 0], R: [1, 0, 0] });
  const off = run({ L: [0, -1, 0], R: [0, -1, 0] });
  assert.ok(match > 0.85, `match ${match}`);
  assert.ok(off < 0.35, `off ${off}`);
});
