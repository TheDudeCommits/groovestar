// Shared gesture engine for the movement suite. Every game consumes the same
// detectors over the tracker's landmarks:
//   SwingDetector  — fast hand sweeps (tennis, bowling): peak speed + direction
//   PunchDetector  — punches TOWARD the camera (boxing): fuses z-velocity,
//                    2D arm foreshortening and wrist speed, since raw z alone
//                    is too noisy to trust
//   BodyDetector   — lane lean, jumps, ducks (runner): hip x, hip-y velocity,
//                    torso compression

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const LM = { nose: 0, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24 };

export interface SwingEvent { hand: 'L' | 'R'; speed: number; dir: [number, number]; at: number }
export interface PunchEvent { hand: 'L' | 'R'; strength: number; at: number }

/** mirrored image-space point for a landmark (viewer coordinates) */
function pt(lms: NormalizedLandmark[], i: number): [number, number] {
  return [1 - lms[i].x, lms[i].y];
}

export class SwingDetector {
  private hist: { p: [number, number]; t: number }[] = [];
  private lastFire = 0;
  constructor(private hand: 'L' | 'R', private threshold = 1.6) {}

  /** feed each detection; returns an event at the swing's peak */
  update(lms: NormalizedLandmark[] | null, t: number): SwingEvent | null {
    if (!lms) return null;
    const p = pt(lms, this.hand === 'L' ? LM.wrR : LM.wrL); // viewer-left = subject right
    this.hist.push({ p, t });
    while (this.hist.length > 6) this.hist.shift();
    if (this.hist.length < 3 || t - this.lastFire < 350) return null;
    const a = this.hist[0], b = this.hist[this.hist.length - 1];
    const dt = Math.max(0.02, (b.t - a.t) / 1000);
    const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1];
    const speed = Math.hypot(dx, dy) / dt;      // normalized units / s
    if (speed < this.threshold) return null;
    this.lastFire = t;
    const n = Math.hypot(dx, dy) || 1;
    return { hand: this.hand, speed, dir: [dx / n, dy / n], at: t };
  }
}

export class PunchDetector {
  private hist: { z: number; ext: number; p: [number, number]; t: number }[] = [];
  private lastFire = 0;
  constructor(private hand: 'L' | 'R') {}

  update(lms: NormalizedLandmark[] | null, world: NormalizedLandmark[] | null, t: number): PunchEvent | null {
    if (!lms) return null;
    const wrI = this.hand === 'L' ? LM.wrR : LM.wrL;
    const elI = this.hand === 'L' ? LM.elR : LM.elL;
    const shI = this.hand === 'L' ? LM.shR : LM.shL;
    const wr = pt(lms, wrI), el = pt(lms, elI), sh = pt(lms, shI);
    const shW = Math.abs(pt(lms, LM.shL)[0] - pt(lms, LM.shR)[0]) || 0.2;
    // 2D arm length relative to shoulder width: an arm aimed at the camera
    // foreshortens hard even when z is noisy
    const ext = (Math.hypot(el[0] - sh[0], el[1] - sh[1]) + Math.hypot(wr[0] - el[0], wr[1] - el[1])) / shW;
    const z = world ? world[wrI].z : lms[wrI].z ?? 0;
    this.hist.push({ z, ext, p: wr, t });
    while (this.hist.length > 7) this.hist.shift();
    if (this.hist.length < 4 || t - this.lastFire < 420) return null;
    const a = this.hist[0], b = this.hist[this.hist.length - 1];
    const dt = Math.max(0.02, (b.t - a.t) / 1000);
    const zVel = (a.z - b.z) / dt;              // toward camera = z decreasing
    const extDrop = (a.ext - b.ext) / dt;       // arm shortening on screen
    const speed2d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) / dt;
    // fusion score: any two strong signals fire it
    const score = Math.max(0, zVel) * 1.15 + Math.max(0, extDrop) * 0.85 + speed2d * 0.3;
    if (score < 1.35) return null;
    this.lastFire = t;
    return { hand: this.hand, strength: Math.min(1, score / 3.2), at: t };
  }
}

export class BodyDetector {
  private hipYHist: { y: number; t: number }[] = [];
  private baseHipY: number | null = null;
  jumping = false;
  ducking = false;
  /** -1..1 across the camera view */
  lane = 0;

  update(lms: NormalizedLandmark[] | null, t: number) {
    if (!lms) return;
    const hipL = pt(lms, LM.hipL), hipR = pt(lms, LM.hipR);
    const shL = pt(lms, LM.shL), shR = pt(lms, LM.shR);
    const hip: [number, number] = [(hipL[0] + hipR[0]) / 2, (hipL[1] + hipR[1]) / 2];
    const sh: [number, number] = [(shL[0] + shR[0]) / 2, (shL[1] + shR[1]) / 2];
    this.lane = Math.max(-1, Math.min(1, (hip[0] - 0.5) * 3.2));
    this.baseHipY = this.baseHipY === null ? hip[1] : this.baseHipY * 0.995 + hip[1] * 0.005;
    this.hipYHist.push({ y: hip[1], t });
    while (this.hipYHist.length > 8) this.hipYHist.shift();
    const a = this.hipYHist[0], b = this.hipYHist[this.hipYHist.length - 1];
    const vy = (b.y - a.y) / Math.max(0.02, (b.t - a.t) / 1000);   // + = sinking
    const torso = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    this.jumping = vy < -0.85 || (this.baseHipY !== null && hip[1] < this.baseHipY - 0.09);
    this.ducking = !this.jumping && (torso < 0.19 || (this.baseHipY !== null && hip[1] > this.baseHipY + 0.1));
  }
}
