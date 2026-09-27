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

// ---- Tennis ---------------------------------------------------------------

/** Plays a racket hand like a person: take it back, swing through on time. */
function tennisBot(): Bot {
  let swingAt = -1,
    fore = true,
    serveAt = -1,
    lastContact = -1;
  const ease = (k: number) => k * k * (3 - 2 * k);
  return ({ t, body, view, skill, gauss }) => {
    idle(body, t);
    const H = view.hand === "L" ? "L" : "R";
    const s = H === "R" ? -1 : 1; // subject x of the racket side
    // serving: raise the racket to toss, then hit near the top
    if (view.server === "you" && view.phase === "serve") {
      body.hand[H] = body.chestPoint(s * 0.25, 0.45, 0.05);
      return;
    }
    if (view.tossTopAt && serveAt < view.tossTopAt - 2000) serveAt = view.tossTopAt - 40 + gauss() * (1 - skill) * 120;
    if (serveAt > 0 && Math.abs(t - serveAt) < 260) {
      const k = Math.max(0, Math.min(1, (t - serveAt + 130) / 260));
      const e = ease(k);
      body.hand[H] = body.chestPoint(s * (0.3 - 0.4 * e), 0.5 - 0.95 * e, -0.2 + 0.6 * e);
      return;
    }
    if (view.contactAt && Math.abs(view.contactAt - lastContact) > 250) {
      lastContact = view.contactAt;
      swingAt = view.contactAt + gauss() * (1 - skill) * 110;
      fore = view.forehand;
    }
    if (swingAt > 0) {
      const k = (t - (swingAt - 140)) / 280;
      if (k > -2.2 && k < 1.3) {
        // take the racket back smoothly well before, then swing across and up
        const rest: [number, number, number] = [s * 0.24, -0.5, 0.12];
        const back: [number, number, number] = fore ? [s * 0.6, -0.38, -0.25] : [-s * 0.55, -0.3, -0.2];
        const thru: [number, number, number] = fore ? [-s * 0.3, -0.02, 0.4] : [s * 0.45, 0.02, 0.35];
        let p: [number, number, number];
        if (k < 0) {
          const e = ease(Math.max(0, Math.min(1, (k + 2.2) / 1.4)));
          p = rest.map((r, i) => r + (back[i] - r) * e) as [number, number, number];
        } else {
          const e = ease(Math.min(1, k));
          p = back.map((b, i) => b + (thru[i] - b) * e) as [number, number, number];
        }
        body.hand[H] = body.chestPoint(p[0], p[1], p[2]);
        return;
      }
    }
  };
}

// ---- Bowling ----------------------------------------------------------------

/** Push away, swing back behind the hip, swing through and release low. */
function bowlBot(): Bot {
  let plan: { start: number; x: number; power: number; curve: number } | null = null;
  const keys: [number, [number, number, number]][] = [
    [0, [-0.15, -0.22, 0.22]],
    [0.3, [-0.17, -0.28, 0.42]],
    [0.55, [-0.2, -0.62, 0.05]],
    [0.8, [-0.22, -0.38, -0.46]],
    [1.12, [-0.2, -0.64, 0.12]],
    [1.36, [-0.14, 0.04, 0.5]],
  ];
  return ({ t, body, view, skill, gauss, rand }) => {
    idle(body, t);
    if (view.phase !== "aim" || !view.live) {
      plan = null;
      return;
    }
    // a throw that didn't take: settle, then bowl again
    if (plan && (t - plan.start) / 1000 / plan.power > 2.6) plan = null;
    if (!plan) plan = { start: t + 900 + rand() * 900, x: gauss() * 0.1, power: 0.85 + skill * 0.3 + gauss() * 0.08, curve: gauss() * (1.2 - skill) * 0.12 };
    body.root = [plan.x, 0, 0];
    const k = (t - plan.start) / 1000 / plan.power;
    if (k < 0) {
      body.hand.R = body.chestPoint(-0.15, -0.22, 0.22);
      return;
    }
    let p = keys[keys.length - 1][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, a] = keys[i],
        [tb, b] = keys[i + 1];
      if (k >= ta && k <= tb) {
        const e = (k - ta) / (tb - ta);
        const s = e * e * (3 - 2 * e);
        p = a.map((v, j) => v + (b[j] - v) * s) as [number, number, number];
        if (i >= 3) p[0] += plan.curve * s;
        break;
      }
    }
    body.hand.R = body.chestPoint(p[0], p[1], p[2]);
  };
}

// ---- Boxing ------------------------------------------------------------

/** Guard up, jab-cross when she's open, and read her tells to defend. */
function boxBot(): Bot {
  let punchAt = -1,
    punchHand: "L" | "R" = "L",
    kind: "straight" | "hook" = "straight",
    defendUntil = -1,
    defense: "guard" | "slipL" | "slipR" | "duck" = "guard",
    lastImpact = -1,
    nextPunch = 0;
  return ({ t, body, view, skill, rand }) => {
    idle(body, t);
    body.leanSide = 0;
    body.crouch = 0.03;
    // guard: fists at the chin
    const guard = () => {
      body.hand.L = body.chestPoint(0.12, 0.08, 0.22);
      body.hand.R = body.chestPoint(-0.12, 0.08, 0.22);
    };
    guard();
    if (!view.live) return;
    // down: punch like mad to beat the count
    if (view.down === "you") {
      const k = Math.sin(t / 60);
      body.hand.L = body.chestPoint(0.1, 0.05, 0.2 + Math.max(0, k) * 0.45);
      body.hand.R = body.chestPoint(-0.1, 0.05, 0.2 + Math.max(0, -k) * 0.45);
      return;
    }
    // defend: react to her tell
    if (view.attack?.impactAt && view.attack.impactAt !== lastImpact) {
      lastImpact = view.attack.impactAt;
      if (rand() < skill) {
        const a = view.attack;
        const r = rand();
        defense = a.kind === "straight" ? (r < 0.5 ? "guard" : r < 0.75 ? "slipL" : "slipR") : a.kind === "hook" ? (r < 0.5 ? "duck" : a.from > 0 ? "slipL" : "slipR") : r < 0.5 ? "guard" : "slipR";
        defendUntil = a.impactAt + 260;
        punchAt = -1;
      }
    }
    if (t < defendUntil && t > lastImpact - 420) {
      if (defense === "slipL") body.leanSide = 0.34; // player's left is screen left: lean toward +X
      if (defense === "slipR") body.leanSide = -0.34;
      if (defense === "duck") body.crouch = 0.34;
      guard();
      return;
    }
    // offense: punches, faster when she's open
    if (punchAt < 0 && t > nextPunch) {
      punchAt = t;
      punchHand = rand() < 0.5 ? "L" : "R";
      kind = rand() < 0.75 ? "straight" : "hook";
      nextPunch = t + (view.open ? 300 : 900 + rand() * 900);
    }
    if (punchAt > 0) {
      const k = (t - punchAt) / 240;
      if (k > 1) punchAt = -1;
      else {
        const e = Math.sin(Math.min(1, k) * Math.PI);
        const s = punchHand === "L" ? 1 : -1;
        // a real jab also travels in toward the centerline, not only at the camera
        body.hand[punchHand] = kind === "straight" ? body.chestPoint(s * (0.14 - e * 0.14), 0.06 + e * 0.04, 0.22 + e * 0.45) : body.chestPoint(s * (0.42 - e * 0.5), 0.05, 0.25 + e * 0.12);
      }
    }
  };
}

const BOTS: Record<string, () => Bot> = {
  idle: () => ({ t, body }) => idle(body, t),
  blade: bladeBot,
  tennis: tennisBot,
  bowl: bowlBot,
  box: boxBot,
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
