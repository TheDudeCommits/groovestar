// Shared gesture engine for the movement suite, rebuilt on filtered signals.
//
//   SwingDetector — fast hand sweeps (tennis, bowling). One-Euro-filtered
//                   wrist velocity with PEAK detection: fires at the swing's
//                   fastest instant instead of averaging six frames of
//                   history, so swings read crisp and follow-ups aren't
//                   swallowed by a long refractory.
//   PunchDetector — punches TOWARD the camera (boxing). Uses worldLandmarks
//                   exclusively when available (meters/s, real physics);
//                   falls back to 2D arm-foreshortening rate when the source
//                   sends no world landmarks (phone camera link). The two
//                   paths never mix units.
//   BodyDetector  — lane lean, jumps, ducks (runner). All thresholds are
//                   body-relative (shoulder widths, torso lengths) so they
//                   hold at any distance from the camera, with a slowly
//                   adapting neutral center and latched jump/duck states.
//
// Every threshold lives in TUNING (src/games/tuning.ts) and is read at use
// time, so gsTune() changes apply mid-game.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { OneEuro } from './rig';
import { TUNING } from '../games/tuning';

const LM = { nose: 0, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24 };
/** camera frames are 4:3; scale x into isotropic height units */
const ASPECT = 4 / 3;

export interface SwingEvent { hand: 'L' | 'R'; speed: number; dir: [number, number]; at: number }
export interface PunchEvent { hand: 'L' | 'R'; strength: number; at: number }

/** mirrored viewer-space point for a landmark */
function pt(lms: NormalizedLandmark[], i: number): [number, number] {
  return [1 - lms[i].x, lms[i].y];
}

/** filtered wrist + live shoulder width, shared by both hand detectors */
class HandSignal {
  private fx = new OneEuro();
  private fy = new OneEuro();
  shoulderW = 0.16;
  x = 0; y = 0; vx = 0; vy = 0;
  /** shoulder-widths/s */
  rel = 0;
  /** 2D arm length / shoulder width (foreshortens toward the camera) */
  extend = 1.5;
  private extPrev: number | null = null;
  /** shoulder-widths/s of arm shortening (positive = punching out) */
  extDropRate = 0;

  feed(lms: NormalizedLandmark[], wrI: number, elI: number, shI: number, t: number) {
    const tSec = t / 1000;
    const [wx, wy] = pt(lms, wrI);
    const rx = this.fx.filter(wx, tSec);
    const ry = this.fy.filter(wy, tSec);
    this.x = rx.v; this.y = ry.v;
    this.vx = rx.vel * ASPECT; this.vy = ry.vel;
    const [sLx, sLy] = pt(lms, LM.shL);
    const [sRx, sRy] = pt(lms, LM.shR);
    const sw = Math.hypot((sLx - sRx) * ASPECT, sLy - sRy);
    if (sw > 0.02) this.shoulderW += (sw - this.shoulderW) * 0.04;
    this.rel = Math.hypot(this.vx, this.vy) / Math.max(0.04, this.shoulderW);
    const [ex, ey] = pt(lms, elI);
    const [shx, shy] = pt(lms, shI);
    const arm = Math.hypot((ex - shx) * ASPECT, ey - shy) + Math.hypot((this.x - ex) * ASPECT, this.y - ey);
    const extend = arm / Math.max(0.04, this.shoulderW);
    if (this.extPrev !== null) {
      const dt = Math.max(1e-3, tSec - this.extT);
      const rate = (this.extPrev - extend) / dt;
      this.extDropRate += (rate - this.extDropRate) * 0.5;
    }
    this.extPrev = extend;
    this.extT = tSec;
    this.extend = extend;
  }
  private extT = 0;
}

export class SwingDetector {
  private sig = new HandSignal();
  private lastFire = 0;
  private armedAt = 0;
  private peak = 0;
  private peakDir: [number, number] = [0, 0];

  /** `_threshold` is the old normalized-units argument — deprecated and
   *  ignored; thresholds now come from TUNING in shoulder-widths/s */
  constructor(private hand: 'L' | 'R', _threshold?: number) { void _threshold; }

  update(lms: NormalizedLandmark[] | null, t: number): SwingEvent | null {
    if (!lms) return null;
    const s = this.sig;
    s.feed(
      lms,
      this.hand === 'L' ? LM.wrR : LM.wrL,   // viewer-left = subject right
      this.hand === 'L' ? LM.elR : LM.elL,
      this.hand === 'L' ? LM.shR : LM.shL,
      t,
    );
    const { minSpeed, peakHoldMs, refractoryMs } = TUNING.swing;
    if (t - this.lastFire < refractoryMs) { this.armedAt = 0; return null; }
    if (s.rel >= minSpeed) {
      if (!this.armedAt) { this.armedAt = t; this.peak = 0; }
      if (s.rel > this.peak) {
        this.peak = s.rel;
        const n = Math.hypot(s.vx, s.vy) || 1;
        this.peakDir = [s.vx / n, s.vy / n];
      }
    }
    if (!this.armedAt) return null;
    // fire once the swing passes its peak, or after the hold window
    const past = s.rel < this.peak * 0.7 || t - this.armedAt > peakHoldMs;
    if (!past) return null;
    this.armedAt = 0;
    this.lastFire = t;
    return { hand: this.hand, speed: this.peak, dir: this.peakDir, at: t };
  }
}

export class PunchDetector {
  private sig = new HandSignal();
  private zf = new OneEuro(0.9, 0.6);
  private lastFire = 0;

  constructor(private hand: 'L' | 'R') {}

  update(lms: NormalizedLandmark[] | null, world: NormalizedLandmark[] | null, t: number): PunchEvent | null {
    if (!lms) return null;
    const wrI = this.hand === 'L' ? LM.wrR : LM.wrL;
    const shI = this.hand === 'L' ? LM.shR : LM.shL;
    this.sig.feed(lms, wrI, this.hand === 'L' ? LM.elR : LM.elL, shI, t);
    const P = TUNING.punch;
    if (t - this.lastFire < P.refractoryMs) return null;

    if (world) {
      // meters and meters/s only — never fused with normalized units
      const zVel = -this.zf.filter(world[wrI].z, t / 1000).vel;   // + = toward camera
      const inFront = world[shI].z - world[wrI].z > P.frontMargin;
      if (zVel > P.minZVel && inFront) {
        this.lastFire = t;
        return { hand: this.hand, strength: Math.min(1, zVel / P.fullStrength), at: t };
      }
      return null;
    }
    // no world landmarks (phone camera): a punch at the camera foreshortens
    // the 2D arm hard and fast — detect the shortening rate instead
    if (this.sig.extDropRate > P.fallbackExtRate && this.sig.extend < P.fallbackShort) {
      this.lastFire = t;
      return { hand: this.hand, strength: Math.min(1, this.sig.extDropRate / (P.fallbackExtRate * 2)), at: t };
    }
    return null;
  }
}

export class BodyDetector {
  private fx = new OneEuro(0.8, 1.5);
  private fy = new OneEuro(0.8, 1.5);
  private center: number | null = null;
  private baseHipY: number | null = null;
  private baseTorso: number | null = null;
  private lastT = 0;
  private jumpUntil = 0;
  private duckUntil = 0;
  jumping = false;
  ducking = false;
  /** -1..1 across the play space, relative to the calibrated standing spot */
  lane = 0;

  update(lms: NormalizedLandmark[] | null, t: number) {
    if (!lms) return;
    const B = TUNING.body;
    const tSec = t / 1000;
    const dt = this.lastT ? Math.max(1e-3, Math.min(0.1, tSec - this.lastT)) : 1 / 30;
    this.lastT = tSec;
    const hipL = pt(lms, LM.hipL), hipR = pt(lms, LM.hipR);
    const shL = pt(lms, LM.shL), shR = pt(lms, LM.shR);
    const rx = this.fx.filter((hipL[0] + hipR[0]) / 2, tSec);
    const ry = this.fy.filter((hipL[1] + hipR[1]) / 2, tSec);
    const hipX = rx.v, hipY = ry.v;
    const shoulderW = Math.max(0.04, Math.hypot((shL[0] - shR[0]) * ASPECT, shL[1] - shR[1]));
    const torso = Math.hypot(
      ((shL[0] + shR[0]) / 2 - hipX) * ASPECT,
      (shL[1] + shR[1]) / 2 - hipY,
    );

    // neutral center re-finds the player's standing spot slowly
    this.center = this.center === null ? hipX : this.center + (hipX - this.center) * B.centerAdaptPerSec * dt;
    this.lane = Math.max(-1, Math.min(1, ((hipX - this.center) * ASPECT) / (shoulderW * B.laneFullSW)));

    const torsoLen = this.baseTorso ?? torso;
    const riseVel = -ry.vel / Math.max(0.05, torsoLen);          // + = rising, torso-lengths/s
    const above = this.baseHipY !== null ? (this.baseHipY - hipY) / Math.max(0.05, torsoLen) : 0;
    const squash = this.baseTorso ? torso / this.baseTorso : 1;

    if (riseVel > B.jumpVel || above > B.jumpRise) this.jumpUntil = Math.max(this.jumpUntil, t + B.jumpHoldMs);
    this.jumping = t < this.jumpUntil && above > -0.05;
    if (!this.jumping && (above < -B.duckDrop || squash < B.duckSquash)) this.duckUntil = t + B.duckHoldMs;
    this.ducking = !this.jumping && t < this.duckUntil;

    // baselines only learn a neutral stance
    if (!this.jumping && !this.ducking) {
      this.baseHipY = this.baseHipY === null ? hipY : this.baseHipY + (hipY - this.baseHipY) * 0.02;
      this.baseTorso = this.baseTorso === null ? torso : this.baseTorso + (torso - this.baseTorso) * 0.02;
    }
  }
}
