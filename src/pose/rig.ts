// HandRig — the movement suite's input layer. The dance mode feels snappy
// because the avatar runs One-Euro filtering plus velocity extrapolation;
// the arcade games used to read raw landmarks and inherited every millimeter
// of MediaPipe jitter and all of the camera latency. The rig gives every game
// the same treatment, plus per-frame velocities so mechanics can be
// CONTINUOUS (racket glued to the hand) instead of event-based.
//
// Conventions:
// - Positions are mirrored viewer-space, normalized 0..1 (multiply by W/H).
// - "Viewer left" hand ('L') uses subject-left landmarks in the calibrated mirror mapping.
// - Velocities and speeds are isotropic height units/s (x scaled by aspect,
//   so a diagonal swipe measures the same as a vertical one).
// - `rel` speeds are in SHOULDER-WIDTHS PER SECOND: dividing by the player's
//   live on-screen shoulder width makes thresholds independent of body size
//   and distance from the camera. TUNING thresholds use these units.
// - World-space z velocity is meters/s, positive TOWARD the camera; null when
//   world landmarks are unavailable (older phone clients omit them).

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TUNING } from '../games/tuning';

/** One-Euro filter: heavy smoothing at rest, nearly none at speed */
export class OneEuro {
  private xf: number | null = null;
  private dxf = 0;
  private lastT = 0;
  constructor(private minCutoff = TUNING.rig.minCutoff, private beta = TUNING.rig.beta, private dCutoff = 1.0) {}
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x: number, tSec: number): { v: number; vel: number } {
    if (this.xf === null) { this.xf = x; this.lastT = tSec; return { v: x, vel: 0 }; }
    const dt = Math.max(1e-3, Math.min(0.1, tSec - this.lastT));
    this.lastT = tSec;
    const dx = (x - this.xf) / dt;
    this.dxf += (dx - this.dxf) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxf);
    this.xf += (x - this.xf) * OneEuro.alpha(cutoff, dt);
    return { v: this.xf, vel: this.dxf };
  }
  reset() { this.xf = null; this.dxf = 0; }
}

// MediaPipe indices per viewer-space joint. In MIRRORED view the player's
// anatomical left hand appears on the screen's left (like a mirror), so
// viewer-L maps to the subject's LEFT-side landmarks — a hand raised on
// your left is the 'L' hand. (An earlier swap here had the hands crossed.)
const JOINTS = {
  nose: 0,
  shL: 11, shR: 12,
  elL: 13, elR: 14,
  wrL: 15, wrR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, footL: 31, footR: 32,
} as const;
export type RigJoint = keyof typeof JOINTS;

export interface JointSample {
  x: number; y: number;      // filtered position, normalized viewer space
  px: number; py: number;    // predicted position (lookahead past latency)
  vx: number; vy: number;    // iso height units/s
  vis: number;
}

export interface HandSample extends JointSample {
  speed: number;             // iso height units/s
  rel: number;               // shoulder-widths/s
  dir: [number, number];     // unit motion vector in iso space ([0,0] at rest)
  extend: number;            // 2D arm length / shoulder width (foreshortening)
  zVel: number | null;       // m/s toward the camera, null without world lms
}

const CALIB_KEY = 'gs-bodyscale';

export interface BodyScale { shoulderW: number; torso: number }

export function loadBodyScale(): BodyScale | null {
  try {
    const raw = localStorage.getItem(CALIB_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.shoulderW === 'number' && typeof v.torso === 'number') return v;
  } catch { /* fall through */ }
  return null;
}

export function saveBodyScale(s: BodyScale) {
  localStorage.setItem(CALIB_KEY, JSON.stringify(s));
}

export class HandRig {
  private euro = new Map<RigJoint, { x: OneEuro; y: OneEuro }>();
  private joints = new Map<RigJoint, JointSample>();
  private zEuro: Record<'L' | 'R', OneEuro> = { L: new OneEuro(0.9, 0.6), R: new OneEuro(0.9, 0.6) };
  private zVel: Record<'L' | 'R', number | null> = { L: null, R: null };
  /** live shoulder width EMA, iso units (seeded from calibration if present) */
  shoulderW: number;
  /** live torso length EMA, iso units */
  torso: number;
  aspect = 16 / 9;
  hasPose = false;
  private lastSeen = -Infinity;
  private previousFrame: NormalizedLandmark[] | null = null;

  constructor() {
    const cal = loadBodyScale();
    this.shoulderW = cal?.shoulderW ?? 0.16;
    this.torso = cal?.torso ?? 0.24;
  }

  update(lms: NormalizedLandmark[] | null, world: NormalizedLandmark[] | null, now: number, aspect = 16 / 9) {
    this.aspect = aspect;
    if (!lms || lms === this.previousFrame) { this.hasPose = !!lms && now - this.lastSeen < 240; return; }
    this.previousFrame = lms;
    this.lastSeen = now;
    this.hasPose = true;
    const tSec = now / 1000;
    const look = TUNING.rig.lookaheadMs / 1000;
    for (const key of Object.keys(JOINTS) as RigJoint[]) {
      const lm = lms[JOINTS[key]];
      if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) { this.joints.delete(key); continue; }
      let f = this.euro.get(key);
      if (!f) { f = { x: new OneEuro(), y: new OneEuro() }; this.euro.set(key, f); }
      const fx = f.x.filter(1 - lm.x, tSec);
      const fy = f.y.filter(lm.y, tSec);
      // clamp so a tracking spike can't fling a prediction across the screen
      const cl = (v: number) => Math.max(-3, Math.min(3, v));
      this.joints.set(key, {
        x: fx.v, y: fy.v,
        px: fx.v + cl(fx.vel) * look, py: fy.v + cl(fy.vel) * look,
        vx: fx.vel * aspect, vy: fy.vel,
        vis: lm.visibility ?? 1,
      });
    }
    const shL = this.joints.get('shL')!, shR = this.joints.get('shR')!;
    const hipL = this.joints.get('hipL')!, hipR = this.joints.get('hipR')!;
    if (!shL || !shR || !hipL || !hipR) { this.hasPose = false; return; }
    const sw = Math.hypot((shL.x - shR.x) * aspect, shL.y - shR.y);
    if (sw > 0.02) this.shoulderW += (sw - this.shoulderW) * 0.04;
    const to = Math.hypot(
      ((shL.x + shR.x) / 2 - (hipL.x + hipR.x) / 2) * aspect,
      (shL.y + shR.y) / 2 - (hipL.y + hipR.y) / 2,
    );
    if (to > 0.03) this.torso += (to - this.torso) * 0.04;

    for (const h of ['L', 'R'] as const) {
      if (world?.[JOINTS[h === 'L' ? 'wrL' : 'wrR']] && Number.isFinite(world[JOINTS[h === 'L' ? 'wrL' : 'wrR']].z)) {
        const wz = world[JOINTS[h === 'L' ? 'wrL' : 'wrR']].z;
        // z shrinks toward the camera, so toward-camera velocity is -dz/dt
        this.zVel[h] = -this.zEuro[h].filter(wz, tSec).vel;
      } else {
        this.zVel[h] = null;
      }
    }
  }

  joint(name: RigJoint): JointSample | null {
    return this.hasPose ? this.joints.get(name) ?? null : null;
  }

  hand(h: 'L' | 'R'): HandSample | null {
    const wr = this.joint(h === 'L' ? 'wrL' : 'wrR');
    const el = this.joint(h === 'L' ? 'elL' : 'elR');
    const sh = this.joint(h === 'L' ? 'shL' : 'shR');
    if (!wr || !el || !sh) return null;
    const speed = Math.hypot(wr.vx, wr.vy);
    const arm =
      Math.hypot((el.x - sh.x) * this.aspect, el.y - sh.y) +
      Math.hypot((wr.x - el.x) * this.aspect, wr.y - el.y);
    return {
      ...wr,
      speed,
      rel: speed / Math.max(0.04, this.shoulderW),
      dir: speed > 1e-4 ? [wr.vx / speed, wr.vy / speed] : [0, 0],
      extend: arm / Math.max(0.04, this.shoulderW),
      zVel: this.zVel[h],
    };
  }

  /** hip center: position, velocity, plus offsets in body-relative units */
  hips(): { x: number; y: number; vx: number; vy: number } | null {
    const a = this.joint('hipL'), b = this.joint('hipR');
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2 };
  }
}
