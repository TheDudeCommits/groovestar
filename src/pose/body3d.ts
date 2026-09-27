// A filtered 3D body from MediaPipe world landmarks, in the screen's frame.
//
// MediaPipe reports world landmarks in meters around the hip center, with x
// toward the raw image's right, y down and z growing away from the camera.
// The game shows the player mirrored, so here x is flipped: +x is the
// screen's right, +y up, +z toward the camera. Joint names follow the
// player's anatomy (L is the player's left), like HandRig. Characters decide
// how to map that onto their own bones: a character facing the player
// mirrors (the player's left drives its right), one facing away copies.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { OneEuro } from './rig';

export const BODY3D = {
  nose: 0, earL: 7, earR: 8,
  shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
  idxL: 19, idxR: 20,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankL: 27, ankR: 28, footL: 31, footR: 32,
} as const;
export type Body3DJoint = keyof typeof BODY3D;

export interface Joint3 { x: number; y: number; z: number; vx: number; vy: number; vz: number; vis: number }

export class Body3D {
  private filters = new Map<Body3DJoint, [OneEuro, OneEuro, OneEuro]>();
  private last: NormalizedLandmark[] | null = null;
  private seenAt = -Infinity;
  readonly joints = new Map<Body3DJoint, Joint3>();
  /** true on the frame a new camera result arrived */
  fresh = false;

  constructor(private minCutoff = 1.4, private beta = 1.2) {}

  update(world: NormalizedLandmark[] | null | undefined, now: number) {
    this.fresh = false;
    if (!world || world === this.last) return;
    this.last = world;
    this.seenAt = now;
    this.fresh = true;
    const t = now / 1000;
    for (const name of Object.keys(BODY3D) as Body3DJoint[]) {
      const lm = world[BODY3D[name]];
      if (!lm || !Number.isFinite(lm.x)) continue;
      let f = this.filters.get(name);
      if (!f) {
        f = [new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff * 0.7, this.beta)];
        this.filters.set(name, f);
      }
      const x = f[0].filter(-lm.x, t),
        y = f[1].filter(-lm.y, t),
        z = f[2].filter(-lm.z, t);
      this.joints.set(name, { x: x.v, y: y.v, z: z.v, vx: x.vel, vy: y.vel, vz: z.vel, vis: lm.visibility ?? 1 });
    }
  }

  /** Has a pose arrived recently? */
  live(now: number) {
    return now - this.seenAt < 300;
  }

  get(name: Body3DJoint, minVis = 0.4): Joint3 | null {
    const j = this.joints.get(name);
    return j && j.vis >= minVis ? j : null;
  }

  reset() {
    this.filters.clear();
    this.joints.clear();
    this.last = null;
  }
}
