import type { HandRig } from "../../pose/rig";
import type { Body3D, Joint3 } from "../../pose/body3d";

/**
 * What a boxer does in front of the camera: punches (straights, hooks,
 * uppercuts), a high guard, slips and ducks.
 *
 * Punches come from the 3D wrist (MediaPipe world landmarks, meters, +z
 * toward the camera): a straight drives at the camera, a hook sweeps across
 * at head height, an uppercut rises in front. Each fires once at the peak
 * of its speed, with power from how fast the fist was moving.
 *
 * Defense is about the head: slips and ducks are measured as the nose moving
 * away from its usual spot relative to the hips, in shoulder widths, so they
 * work at any distance from the camera. A guard is both fists up by the face.
 */

export type PunchKind = "jab" | "cross" | "hook" | "uppercut";

export interface Punch {
  hand: "L" | "R";
  kind: PunchKind;
  /** unit direction of the fist at its fastest (world, relative to the shoulder) */
  dir: [number, number, number];
  /** 0.3..1 */
  power: number;
  /** aimed at the head (true) or the body */
  high: boolean;
  t: number;
}

export interface Defense {
  guard: boolean;
  /** head offset from neutral in shoulder widths: -x left, +x right (screen), -y down */
  headX: number;
  headY: number;
  slip: -1 | 0 | 1;
  duck: boolean;
  t: number;
}

class FistWatch {
  private armed = -1;
  private peak = 0;
  private kind: PunchKind = "jab";
  private high = true;
  private dir: [number, number, number] = [0, 0, 1];
  private last = -9;
  constructor(readonly hand: "L" | "R") {}
  /**
   * A punch is the fist moving fast relative to its own shoulder (so ducks
   * and sways don't count), confirmed by the 2D image. The camera judges
   * depth poorly (a real jab straight at it often reads as sideways), so the
   * type comes from the elbow: a straight arm is a jab or cross, a bent
   * elbow sweeping in is a hook, a fist driving up is an uppercut.
   */
  feed(w: Joint3, el: Joint3, sh: Joint3, rel2d: number, t: number, minSpeed: number): Punch | null {
    if (t - this.last < 0.2) return null;
    const s = this.hand === "L" ? -1 : 1; // screen side of this fist
    const vx = w.vx - sh.vx,
      vy = w.vy - sh.vy,
      vz = w.vz - sh.vz;
    const speed = Math.hypot(vx, vy, vz);
    // a punch shows as 3D speed, 2D speed, or both; depth is the camera's
    // weak axis, so either strong cue alone also counts
    const moving = (speed > minSpeed && rel2d > 2.0) || speed > minSpeed * 1.3 || rel2d > 5.5;
    if (moving) {
      if (this.armed < 0) {
        this.armed = t;
        this.peak = 0;
      }
      if (speed > this.peak) {
        this.peak = speed;
        this.dir = [vx / speed, vy / speed, vz / speed];
        // elbow angle: straight arm near 180 degrees
        const ax = sh.x - el.x,
          ay = sh.y - el.y,
          az = sh.z - el.z,
          bx = w.x - el.x,
          by = w.y - el.y,
          bz = w.z - el.z;
        const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
        const elbow = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        const across = -s * vx; // toward the centerline
        if (vy > 0.62 * speed && w.y < sh.y + 0.2) this.kind = "uppercut";
        else if (elbow < 125 && across > 0.55 * speed) this.kind = "hook";
        else this.kind = this.hand === "L" ? "jab" : "cross";
        this.high = w.y > sh.y - 0.14;
      }
    }
    if (this.armed < 0) return null;
    if (!moving || speed < this.peak * 0.8 || t - this.armed > 0.2) {
      this.armed = -1;
      this.last = t;
      return { hand: this.hand, kind: this.kind, dir: this.dir, power: Math.max(0.3, Math.min(1, this.peak / 4)), high: this.high, t };
    }
    return null;
  }
}

export class FighterInput {
  private fists = { L: new FistWatch("L"), R: new FistWatch("R") };
  private neutral: { x: number; y: number } | null = null;
  private history: Defense[] = [];
  private pending: Punch[] = [];
  defense: Defense = { guard: false, headX: 0, headY: 0, slip: 0, duck: false, t: 0 };

  constructor(private rig: HandRig) {}

  /** Call every frame; returns punches thrown (a frame late, see below). */
  update(body: Body3D, t: number, minSpeed = 2.0): Punch[] {
    this.updateDefense(t);
    const out: Punch[] = [];
    if (body.fresh) {
      for (const h of ["L", "R"] as const) {
        const w = body.get(h === "L" ? "wrL" : "wrR", 0.3),
          el = body.get(h === "L" ? "elL" : "elR", 0.3),
          sh = body.get(h === "L" ? "shL" : "shR", 0.3);
        if (!w || !el || !sh) continue;
        // on-screen speed of the fist relative to its shoulder, shoulder widths/s
        const r2 = this.rig.hand(h),
          s2 = this.rig.joint(h === "L" ? "shL" : "shR");
        const rel2d = r2 && s2 ? Math.hypot(r2.vx - s2.vx, r2.vy - s2.vy) / Math.max(0.04, this.rig.shoulderW) : 0;
        const p = this.fists[h].feed(w, el, sh, rel2d, t, minSpeed);
        if (p) out.push(p);
      }
    }
    // both fists moving the same way at once is the body moving, not two punches
    const recent = [...this.pending, ...out];
    const l = recent.find((p) => p.hand === "L"),
      r = recent.find((p) => p.hand === "R");
    if (l && r && Math.abs(l.t - r.t) < 0.09 && l.dir[0] * r.dir[0] + l.dir[1] * r.dir[1] + l.dir[2] * r.dir[2] > 0.6) {
      this.pending = [];
      return [];
    }
    // hold each punch briefly so a matching twin can still cancel it
    const ready = this.pending.filter((p) => t - p.t >= 0.06);
    this.pending = [...this.pending.filter((p) => t - p.t < 0.06), ...out];
    return ready;
  }

  private updateDefense(t: number) {
    const rig = this.rig;
    const nose = rig.joint("nose"),
      hl = rig.joint("hipL"),
      hr = rig.joint("hipR"),
      sl = rig.joint("shL"),
      sr = rig.joint("shR");
    const sw = Math.max(0.04, rig.shoulderW);
    if (!nose || !sl || !sr) return;
    // slips lean the head over the hips; a duck drops the head from its usual
    // height, however it's done (bending the knees or the waist)
    const hx = hl && hr ? (hl.x + hr.x) / 2 : (sl.x + sr.x) / 2;
    const x = ((nose.x - hx) * rig.aspect) / sw,
      y = -nose.y / sw;
    if (!this.neutral) this.neutral = { x, y };
    const dx = x - this.neutral.x,
      dy = y - this.neutral.y;
    const slip: -1 | 0 | 1 = dx < -0.5 ? -1 : dx > 0.5 ? 1 : 0;
    const duck = dy < -0.55;
    // relearn the neutral stance slowly while standing tall
    if (!slip && !duck) {
      this.neutral.x += (x - this.neutral.x) * 0.01;
      this.neutral.y += (y - this.neutral.y) * 0.01;
    }
    // guard: both fists up by the face
    const up = (h: "L" | "R") => {
      const w = rig.joint(h === "L" ? "wrL" : "wrR");
      if (!w || w.vis < 0.3) return false;
      const fx = ((w.x - nose.x) * rig.aspect) / sw,
        fy = (nose.y - w.y) / sw;
      return Math.abs(fx) < 1.15 && fy > -1.05 && fy < 0.7;
    };
    const guard = up("L") && up("R");
    this.defense = { guard, headX: dx, headY: dy, slip, duck, t };
    this.history.push(this.defense);
    while (this.history.length && t - this.history[0].t > 0.6) this.history.shift();
  }

  /**
   * The best defense the player showed in a recent window, so a slip or a
   * block made in time isn't lost to camera latency.
   */
  defenseAround(t: number, before = 0.32, after = 0.05): Defense {
    const d = this.history.filter((x) => x.t >= t - before && x.t <= t + after);
    if (!d.length) return this.defense;
    return {
      guard: d.some((x) => x.guard),
      slip: (d.find((x) => x.slip !== 0)?.slip ?? 0) as -1 | 0 | 1,
      duck: d.some((x) => x.duck),
      headX: this.defense.headX,
      headY: this.defense.headY,
      t,
    };
  }

  /** Re-center the stance (after a knockdown or between rounds). */
  recenter() {
    this.neutral = null;
  }
}
