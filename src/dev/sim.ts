// Dev and QA only: plays GrooveStar with a simulated body (see sim-body.ts).
//
//   ?sim=blade        the Beat Blade bot plays whatever Beat Blade session starts
//   ?sim=idle         a body that stands, breathes and raises its hands for setup
//   &simskill=0.6     0..1, how precise the bot is (timing and aim noise)
//
// Bots read `window.gsGame.botView()`, which a game exposes in dev builds.
// They see what a player sees (targets, their timing) and move a body, and
// the body goes through the same camera model and input chain as a person.

import { SimBody, SimSource, lerp3, type V3 } from "./sim-body";
import type { PoseTracker } from "../pose/tracker";

export interface BotCtx {
  t: number;
  body: SimBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any;
  skill: number;
  rand: () => number;
  gauss: () => number;
}
export type Bot = (ctx: BotCtx) => void;

const ARM = 0.545;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Relaxed stance with a little life in it. */
export function idle(body: SimBody, t: number) {
  const s = t / 1000;
  body.leanSide = Math.sin(s * 0.9) * 0.02;
  body.crouch = 0.01 + Math.sin(s * 2.1) * 0.006;
  body.hand.L = body.chestPoint(0.24, -0.5, 0.12);
  body.hand.R = body.chestPoint(-0.24, -0.5, 0.12);
  body.elbow.L = body.elbow.R = null;
}

/** The setup screen's calibration: both hands straight up. */
export function handsUp(body: SimBody, t: number) {
  idle(body, t);
  body.hand.L = body.chestPoint(0.2, 0.52, 0.02);
  body.hand.R = body.chestPoint(-0.2, 0.52, 0.02);
}

/**
 * Wrist position in subject space for a reach-space point. Reach space is
 * mirrored (+u is the screen's right, which is the player's right hand
 * side, subject -X) and measured in arm lengths from the shoulder center.
 */
export function fromReach(body: SimBody, u: number, v: number, fwd = 0.22): V3 {
  const l = body.shoulder("L"),
    r = body.shoulder("R");
  const c = lerp3(l, r, 0.5);
  return [c[0] - u * ARM, c[1] + v * ARM, c[2] + fwd];
}

// ---- Beat Blade --------------------------------------------------------

interface Swing {
  id: number;
  hand: "L" | "R";
  at: number;
  from: [number, number];
  to: [number, number];
}

const CUT: Record<number, [number, number]> = {
  0: [0, -1], 1: [0, 1], 2: [-1, 0], 3: [1, 0],
  4: [-0.707, -0.707], 5: [0.707, -0.707], 6: [-0.707, 0.707], 7: [0.707, 0.707], 8: [0, -1],
};

function bladeBot(): Bot {
  const swings: Swing[] = [];
  const planned = new Set<number>();
  const rest = { L: [-0.45, -0.35] as [number, number], R: [0.45, -0.35] as [number, number] };
  const last: Record<"L" | "R", [number, number]> = { L: [...rest.L], R: [...rest.R] };
  return ({ t, body, view, skill, gauss }) => {
    idle(body, t);
    const map = view.map;
    for (const n of view.notes) {
      if (n.kind !== "note" || planned.has(n.id)) continue;
      planned.add(n.id);
      // aim: where the note is in reach space, less half a blade (the blade
      // points up out of the fist, so the fist passes below the block)
      const tu = n.x / map.gx,
        tv = (n.y - map.y0) / map.gy - 0.42;
      const d = CUT[n.dir];
      const err = (1 - skill) * 0.22;
      const cu = tu + gauss() * err,
        cv = tv + gauss() * err;
      const len = 0.62;
      swings.push({
        id: n.id,
        hand: n.hand,
        at: n.at + gauss() * (1 - skill) * 70 - 15,
        from: [cu - d[0] * len, cv - d[1] * len],
        to: [cu + d[0] * len, cv + d[1] * len],
      });
    }
    for (const hand of ["L", "R"] as const) {
      const mine = swings.filter((s) => s.hand === hand && s.at > t - 260).sort((a, b) => a.at - b.at);
      const s = mine[0];
      let p: [number, number] = last[hand];
      if (s) {
        const dur = 230;
        const k = (t - (s.at - dur / 2)) / dur;
        if (k < 0) {
          // move to the wind-up point in good time
          const lead = Math.min(1, Math.max(0, 1 + k * 1.1));
          p = [last[hand][0] + (s.from[0] - last[hand][0]) * lead, last[hand][1] + (s.from[1] - last[hand][1]) * lead];
          if (lead >= 1) p = s.from;
        } else if (k <= 1) {
          const e = k * k * (3 - 2 * k);
          p = [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e];
        } else p = s.to;
        if (k >= 1) last[hand] = s.to;
      } else {
        // drift back toward a ready stance
        p = [last[hand][0] + (rest[hand][0] - last[hand][0]) * 0.02, last[hand][1] + (rest[hand][1] - last[hand][1]) * 0.02];
        last[hand] = p;
      }
      body.hand[hand] = fromReach(body, p[0], p[1], 0.2);
    }
    // drop old plans
    while (swings.length && swings[0].at < t - 1000) swings.shift();
  };
}

// ---- Dance ----------------------------------------------------------------

/**
 * Mirrors the coach like a player: her right hand becomes the bot's left
 * (same side of the screen), seen through a reaction delay. `mode` "still"
 * just stands there and "random" dances without looking, for calibration.
 */
function danceBot(mode: "copy" | "still" | "random" = "copy"): Bot {
  const hist: { t: number; v: { handL: number[]; handR: number[]; elbowL: number[] | null; elbowR: number[] | null } }[] = [];
  let wander: [number, number, number][] = [
    [0.3, 0.2, 0.2],
    [-0.3, 0.2, 0.2],
  ];
  return ({ t, body, view, skill, gauss, rand }) => {
    idle(body, t);
    if (!view.handL || !view.handR) return;
    hist.push({ t, v: { handL: view.handL, handR: view.handR, elbowL: view.elbowL, elbowR: view.elbowR } });
    while (hist.length > 90) hist.shift();
    if (mode === "still") return;
    if (mode === "random") {
      if (rand() < 0.05) wander = [0, 1].map(() => [(rand() - 0.5) * 1.2, rand() * 1.1 - 0.35, rand() * 0.3]) as [number, number, number][];
      const hc = body.hipCenter();
      body.hand.L = [hc[0] + 0.15 + Math.abs(wander[0][0]), hc[1] + wander[0][1] + Math.sin(t / 180) * 0.1, hc[2] + wander[0][2]];
      body.hand.R = [hc[0] - 0.15 - Math.abs(wander[1][0]), hc[1] + wander[1][1] + Math.cos(t / 170) * 0.1, hc[2] + wander[1][2]];
      return;
    }
    const delay = 260 + (1 - skill) * 220;
    let v = hist[0].v;
    for (const h of hist) if (h.t <= t - delay) v = h.v;
    const hc = body.hipCenter();
    const k = 0.98,
      err = (1 - skill) * 0.12;
    // mirror: the coach's right hand (screen left, her x < 0) is the bot's left (+X)
    body.hand.L = [hc[0] - v.handR[0] * k + gauss() * err, hc[1] + v.handR[1] * k + gauss() * err, hc[2] + v.handR[2] * k];
    body.hand.R = [hc[0] - v.handL[0] * k + gauss() * err, hc[1] + v.handL[1] * k + gauss() * err, hc[2] + v.handL[2] * k];
    const e = (x: number[] | null): [number, number, number] | null => (x ? [hc[0] - x[0] * k, hc[1] + x[1] * k, hc[2] + x[2] * k] : null);
    body.elbow.L = e(v.elbowR);
    body.elbow.R = e(v.elbowL);
  };
}

const BOTS: Record<string, () => Bot> = {
  idle: () => ({ t, body }) => idle(body, t),
  blade: bladeBot,
  dance: () => danceBot("copy"),
  dancestill: () => danceBot("still"),
  dancerandom: () => danceBot("random"),
};

export function installSim(tracker: PoseTracker, name: string, skill = 0.75) {
  const body = new SimBody();
  const make = BOTS[name] ?? BOTS.idle;
  const bot = make();
  const rand = rng(11);
  const gauss = () => {
    const u = Math.max(1e-9, rand()),
      v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const source = new SimSource(body, undefined, undefined, (t) => {
    if (document.querySelector(".pt-setup")) {
      handsUp(body, t);
      return;
    }
    const game = (window as unknown as { gsGame?: { botView?: () => unknown; stopped?: boolean } }).gsGame;
    const view = game && !game.stopped ? game.botView?.() : null;
    if (!view) {
      idle(body, t);
      return;
    }
    bot({ t, body, view, skill, rand, gauss });
  });
  tracker.attach(source);
  (window as unknown as { gsSim: unknown }).gsSim = { body, source, name, skill };
  return source;
}
