import type { HandRig, RigJoint } from "../../pose/rig";

/**
 * Body-relative hand space. Games used to read raw camera coordinates, so a
 * target at a fixed spot on screen was only reachable by someone standing in
 * the middle of the frame at one particular distance. Here every hand is
 * measured from the player's own shoulders in units of their own arm length,
 * so the same reach lands on the same target wherever and however far away
 * the player stands.
 *
 * Axes: +u toward the screen's right (mirrored view, so the player's left
 * hand works the left side), +v up. A relaxed arm hangs near v = -0.95, an
 * arm straight overhead reads v = +1, straight out to the side |u| = 1.3.
 */
export interface ReachSample {
  u: number;
  v: number;
  /** velocity, arm lengths per second */
  du: number;
  dv: number;
  speed: number;
  /** forearm direction (elbow to wrist), unit, same axes */
  fx: number;
  fy: number;
  /** how much of the forearm is visible (1 = in the image plane, 0 = pointing at the camera) */
  flen: number;
  vis: number;
}

export class ReachSpace {
  /** 2D shoulder-to-wrist length in iso units, learned from the longest reach seen */
  armLen: number;
  private seenLong = 0;
  constructor(readonly rig: HandRig) {
    this.armLen = rig.shoulderW * 1.6;
  }

  /** Call once per frame after the rig updates. */
  update() {
    const rig = this.rig;
    const floor = rig.shoulderW * 1.3,
      ceil = rig.shoulderW * 2.3;
    for (const s of ["L", "R"] as const) {
      const sh = rig.joint(`sh${s}` as RigJoint),
        el = rig.joint(`el${s}` as RigJoint),
        wr = rig.joint(`wr${s}` as RigJoint);
      if (!sh || !el || !wr || Math.min(sh.vis, el.vis, wr.vis) < 0.6) continue;
      const a = Math.hypot((el.x - sh.x) * rig.aspect, el.y - sh.y) + Math.hypot((wr.x - el.x) * rig.aspect, wr.y - el.y);
      // the longest recent reach is the true length; foreshortening only shortens
      if (a > this.armLen) this.armLen += (a - this.armLen) * 0.25;
      this.seenLong = Math.max(this.seenLong * 0.999, a);
    }
    // forget an old overestimate slowly, never below a plausible arm
    if (this.seenLong > 0 && this.armLen > this.seenLong * 1.08) this.armLen *= 0.9995;
    this.armLen = Math.max(floor, Math.min(ceil, this.armLen || rig.shoulderW * 1.6));
  }

  /** Shoulder center in normalized viewer space. */
  center() {
    const a = this.rig.joint("shL"),
      b = this.rig.joint("shR");
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 };
  }

  /**
   * Hand in reach space. `predict` uses the rig's look-ahead position, which
   * hides most of the camera latency for things drawn on screen.
   */
  hand(side: "L" | "R", predict = true): ReachSample | null {
    const rig = this.rig;
    const c = this.center();
    const wr = rig.joint(`wr${side}` as RigJoint),
      el = rig.joint(`el${side}` as RigJoint);
    if (!c || !wr || !el) return null;
    const L = Math.max(0.05, this.armLen);
    const wx = predict ? wr.px : wr.x,
      wy = predict ? wr.py : wr.y;
    const cx = predict ? c.px : c.x,
      cy = predict ? c.py : c.y;
    const u = ((wx - cx) * rig.aspect) / L,
      v = (cy - wy) / L;
    const du = wr.vx / L,
      dv = -wr.vy / L;
    let fx = (wr.x - el.x) * rig.aspect,
      fy = el.y - wr.y;
    const f = Math.hypot(fx, fy);
    const flen = Math.min(1, f / (L * 0.46));
    if (f > 1e-5) {
      fx /= f;
      fy /= f;
    } else {
      fx = 0;
      fy = 1;
    }
    return { u, v, du, dv, speed: Math.hypot(du, dv), fx, fy, flen, vis: Math.min(wr.vis, el.vis) };
  }

  /** Head (nose) offset from the shoulder center, in shoulder widths (+x right, +y up). */
  head() {
    const n = this.rig.joint("nose"),
      c = this.center();
    if (!n || !c) return null;
    const sw = Math.max(0.04, this.rig.shoulderW);
    return { x: ((n.x - c.x) * this.rig.aspect) / sw, y: (c.y - n.y) / sw, vis: n.vis };
  }
}
