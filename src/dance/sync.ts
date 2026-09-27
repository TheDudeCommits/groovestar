import * as T from "three";
import type { Body3D, Body3DJoint } from "../pose/body3d";
import type { Character } from "../kinetic/render/character";

/**
 * How closely the player is dancing with the coach, frame by frame.
 *
 * Both are compared as they appear on screen: the coach faces the player,
 * and the player mirrors her (their left arm copies her right, which is on
 * the same side of the screen). Two things are scored:
 *
 * - Shape: every arm segment is a 3D direction. A segment within 18 degrees
 *   of the coach's scores full, 60 degrees off scores nothing. Segments only
 *   count as much as the coach is using them: an arm hanging at her side is
 *   easy to match and says little, a raised or thrown-out arm says a lot.
 *   Legs join in only when she lifts or kicks them.
 * - Motion: while the coach's hands travel, the player's hands must travel
 *   the same way at a similar speed. Standing still never scores.
 *
 * The player sees the coach, then moves, so they trail her by a steady
 * reaction time. That lag is learned per player (the offset that has matched
 * best over the last seconds) instead of being picked afresh every frame,
 * which would let random poses find a match somewhere in the past.
 */

export type LimbId = "armL" | "foreL" | "armR" | "foreR" | "thighL" | "shinL" | "thighR" | "shinR";

/** Coach bone pairs per limb; L and R are screen sides. */
const COACH: Record<LimbId, [string, string]> = {
  // the coach faces the camera, so her right arm is on the screen's left
  armL: ["RightArm", "RightForeArm"],
  foreL: ["RightForeArm", "RightHand"],
  armR: ["LeftArm", "LeftForeArm"],
  foreR: ["LeftForeArm", "LeftHand"],
  thighL: ["RightUpLeg", "RightLeg"],
  shinL: ["RightLeg", "RightFoot"],
  thighR: ["LeftUpLeg", "LeftLeg"],
  shinR: ["LeftLeg", "LeftFoot"],
};
/** Player joints per limb; the player's left is the screen's left (mirror). */
const PLAYER: Record<LimbId, [Body3DJoint, Body3DJoint]> = {
  armL: ["shL", "elL"],
  foreL: ["elL", "wrL"],
  armR: ["shR", "elR"],
  foreR: ["elR", "wrR"],
  thighL: ["hipL", "kneeL"],
  shinL: ["kneeL", "ankL"],
  thighR: ["hipR", "kneeR"],
  shinR: ["kneeR", "ankR"],
};
const WEIGHT: Record<LimbId, number> = { armL: 1, foreL: 0.9, armR: 1, foreR: 0.9, thighL: 0.5, shinL: 0.35, thighR: 0.5, shinR: 0.35 };
export const LIMBS = Object.keys(COACH) as LimbId[];
const DEPTH = 0.55;
const DOWN = new T.Vector3(0, -1, 0);
const LAG_STEP = 50;
const LAGS = 13; // 0..600 ms

interface Snap {
  t: number;
  dirs: Map<LimbId, T.Vector3>;
  /** screen-left and screen-right hands (her right, her left) */
  hands: [T.Vector3, T.Vector3];
}

export interface SyncFrame {
  /** 0..1 overall match right now */
  score: number;
  pose: number;
  motion: number | null;
  /** 0..1 per limb (missing when untracked or not in play) */
  limbs: Partial<Record<LimbId, number>>;
  coachMotion: number;
  playerMotion: number;
  lagMs: number;
}

export class DanceSync {
  private history: Snap[] = [];
  private v = new T.Vector3();
  private w = new T.Vector3();
  private lagScore = new Float32Array(LAGS).fill(0.3);
  private coachMotion = 0;
  private playerMotion = 0;
  last: SyncFrame = { score: 0, pose: 0, motion: null, limbs: {}, coachMotion: 0, playerMotion: 0, lagMs: 250 };
  /** smoothed score, for meters and glows */
  meter = 0;

  /** Record the coach's current pose (call after she is posed each frame). */
  sampleCoach(coach: Character, now: number) {
    const dirs = new Map<LimbId, T.Vector3>();
    for (const id of LIMBS) {
      const [a, b] = COACH[id];
      const ba = coach.rigBone(a),
        bb = coach.rigBone(b);
      if (!ba || !bb) continue;
      dirs.set(id, bb.getWorldPosition(new T.Vector3()).sub(ba.getWorldPosition(new T.Vector3())));
    }
    const hl = coach.rigBone("RightHand")?.getWorldPosition(new T.Vector3()) ?? new T.Vector3();
    const hr = coach.rigBone("LeftHand")?.getWorldPosition(new T.Vector3()) ?? new T.Vector3();
    this.history.push({ t: now, dirs, hands: [hl, hr] });
    while (this.history.length && now - this.history[0].t > 1000) this.history.shift();
  }

  private norm(v: T.Vector3) {
    v.z *= DEPTH;
    return v.normalize();
  }

  /** The coach snapshot nearest to a time. */
  private at(t: number): Snap | null {
    let best: Snap | null = null,
      d = Infinity;
    for (const s of this.history) {
      const e = Math.abs(s.t - t);
      if (e < d) {
        d = e;
        best = s;
      }
    }
    return d < 60 ? best : null;
  }

  /** Coach hand velocity (m/s) around a snapshot time. */
  private coachVel(t: number, hand: 0 | 1): T.Vector3 | null {
    const a = this.at(t - 90),
      b = this.at(t);
    if (!a || !b || b.t - a.t < 30) return null;
    return b.hands[hand].clone().sub(a.hands[hand]).multiplyScalar(1000 / (b.t - a.t));
  }

  private scoreAt(player: Map<LimbId, T.Vector3>, pv: [T.Vector3 | null, T.Vector3 | null], t: number) {
    const snap = this.at(t);
    if (!snap) return null;
    let acc = 0,
      wsum = 0;
    const limbs: Partial<Record<LimbId, number>> = {};
    for (const [id, pd] of player) {
      const cd = snap.dirs.get(id);
      if (!cd) continue;
      const c = this.norm(this.v.copy(cd));
      // how much the coach is using this limb: hanging down says little
      const use = Math.min(1, (c.angleTo(DOWN) * 180) / Math.PI / 55);
      const leg = id.startsWith("thigh") || id.startsWith("shin");
      if (leg && use < 0.45) continue;
      const w = WEIGHT[id] * (leg ? use : 0.3 + 0.7 * use);
      const ang = (Math.acos(Math.max(-1, Math.min(1, c.dot(this.w.copy(pd))))) * 180) / Math.PI;
      const s = Math.max(0, Math.min(1, 1 - (ang - 18) / 42));
      limbs[id] = s;
      acc += s * w;
      wsum += w;
    }
    if (!wsum) return null;
    const pose = acc / wsum;
    // motion: follow the coach's hands when they travel
    let mAcc = 0,
      mW = 0;
    for (const h of [0, 1] as const) {
      const vc = this.coachVel(t, h),
        vp = pv[h];
      if (!vc || !vp) continue;
      const sc = vc.length();
      if (sc < 0.35) continue;
      const along = vp.dot(vc) / sc; // player's speed along the coach's direction
      const m = Math.max(0, Math.min(1, along / (sc * 0.7)));
      const wgt = Math.min(1, sc / 1.2);
      mAcc += m * wgt;
      mW += wgt;
    }
    const motion = mW > 0.25 ? mAcc / mW : null;
    const score = motion === null ? pose : pose * 0.55 + motion * 0.45;
    return { score, pose, motion, limbs };
  }

  /** Match the player's pose against the coach, at the player's own reaction lag. */
  compare(body: Body3D, now: number): SyncFrame {
    const player = new Map<LimbId, T.Vector3>();
    for (const id of LIMBS) {
      const [a, b] = PLAYER[id];
      const leg = id.startsWith("thigh") || id.startsWith("shin");
      const ja = body.get(a, leg ? 0.6 : 0.45),
        jb = body.get(b, leg ? 0.6 : 0.45);
      if (!ja || !jb) continue;
      player.set(id, this.norm(new T.Vector3(jb.x - ja.x, jb.y - ja.y, jb.z - ja.z)));
    }
    const wl = body.get("wrL"),
      wr = body.get("wrR");
    const pv: [T.Vector3 | null, T.Vector3 | null] = [wl ? new T.Vector3(wl.vx, wl.vy, wl.vz * DEPTH) : null, wr ? new T.Vector3(wr.vx, wr.vy, wr.vz * DEPTH) : null];
    if (wl && wr) this.playerMotion += (Math.min(4, (pv[0]!.length() + pv[1]!.length()) / 2) - this.playerMotion) * 0.15;
    const hc = this.coachVel(now, 0),
      hr = this.coachVel(now, 1);
    if (hc && hr) this.coachMotion += (Math.min(4, (hc.length() + hr.length()) / 2) - this.coachMotion) * 0.15;
    if (player.size < 2) {
      this.last = { ...this.last, score: 0, pose: 0, motion: null, limbs: {} };
      this.meter += (0 - this.meter) * 0.08;
      return this.last;
    }
    // learn the reaction lag: every candidate keeps a running score
    let bestBin = 0,
      bestVal = -1;
    const results: (ReturnType<DanceSync["scoreAt"]> | null)[] = [];
    for (let b = 0; b < LAGS; b++) {
      const r = this.scoreAt(player, pv, now - b * LAG_STEP);
      results.push(r);
      if (r) this.lagScore[b] += (r.score - this.lagScore[b]) * 0.04;
      // a mild preference for reacting quickly
      const val = this.lagScore[b] - b * 0.004;
      if (val > bestVal) {
        bestVal = val;
        bestBin = b;
      }
    }
    // score at the learned lag, allowing one step either side for jitter
    let pick = results[bestBin];
    for (const b of [bestBin - 1, bestBin + 1]) {
      const r = results[b];
      if (r && (!pick || r.score > pick.score)) pick = r;
    }
    const score = pick ? pick.score : 0;
    this.meter += (score - this.meter) * 0.1;
    this.last = {
      score,
      pose: pick?.pose ?? 0,
      motion: pick?.motion ?? null,
      limbs: pick?.limbs ?? {},
      coachMotion: this.coachMotion,
      playerMotion: this.playerMotion,
      lagMs: bestBin * LAG_STEP,
    };
    return this.last;
  }
}
