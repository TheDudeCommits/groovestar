// Real dance motion, sourced from the AIST++ Dance Motion Dataset
// (Li et al., google.github.io/aistplusplus_dataset, CC BY 4.0).
// Each clip is a beat-aligned 2-beat slice of a professional dancer's motion
// (10 genres), converted offline into the game's FK pose parameters as 16
// keyframes. At runtime we Catmull-Rom through the keyframes, so the coach
// dances the actual captured movement — weight shifts, bounce and all.

import clipsData from './data/clips.json';
import type { Pose } from './moves';

export interface Clip {
  id: string;
  g: string;               // genre
  e: number;               // energy 0..1 (normalized within genre)
  b: number;               // length in beats
  pk: number;              // peak keyframe index (pictogram pose)
  f: number[][];           // keyframes × [lean,crouch,aL0,aL1,aR0,aR1,lL0,lL1,lR0,lR1]
}

export const CLIPS: Record<string, Clip> = {};
export const CLIP_GENRES: string[] = [];
for (const c of (clipsData as { clips: Clip[] }).clips) {
  CLIPS[c.id] = c;
  if (!CLIP_GENRES.includes(c.g)) CLIP_GENRES.push(c.g);
}

const KF = (clipsData as { kf: number }).kf;

function cr(p0: number, p1: number, p2: number, p3: number, u: number): number {
  // Catmull-Rom spline
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
    + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

function frameToPose(row: number[]): Pose {
  return {
    lean: row[0], crouch: row[1],
    armL: [row[2], row[3]], armR: [row[4], row[5]],
    legL: [row[6], row[7]], legR: [row[8], row[9]],
  };
}

/** sample the clip at t beats (0..clip.b), smooth spline through keyframes */
export function clipPose(clip: Clip, t: number): Pose {
  const x = Math.max(0, Math.min(0.9999, t / clip.b)) * (KF - 1);
  const i = Math.floor(x), u = x - i;
  const at = (k: number) => clip.f[Math.max(0, Math.min(KF - 1, k))];
  const row = new Array(10);
  for (let p = 0; p < 10; p++) {
    row[p] = cr(at(i - 1)[p], at(i)[p], at(i + 1)[p], at(i + 2)[p], u);
  }
  row[1] = Math.max(0, row[1]); // crouch can't overshoot negative
  return frameToPose(row);
}

/** the clip's most expressive keyframe — used for its pictogram */
export function clipPeakPose(clip: Clip): Pose {
  return frameToPose(clip.f[clip.pk]);
}

/** pose lookup that spans both static moves and motion clips */
export function poseForId(id: string, movesPose: Pose | undefined, t = 0): Pose | null {
  if (movesPose) return movesPose;
  const c = CLIPS[id];
  return c ? clipPose(c, t) : null;
}

// ---------------------------------------------------------------------------
// Transition analysis: how far apart is the END pose of clip A from the START
// pose of clip B? Used to chain clips into fluid phrases (choreographer picks
// low-cost successors; playback stretches the blend for high-cost cuts).

const TW = [1.2, 1.5, 1.0, 0.7, 1.0, 0.7, 0.9, 0.6, 0.9, 0.6]; // lean,crouch,arms,legs

/** weighted mean pose discontinuity in degrees (~0 seamless, 90+ jarring); 0 if either isn't a clip */
export function transitionCost(aId: string, bId: string): number {
  const a = CLIPS[aId], b = CLIPS[bId];
  if (!a || !b) return 0;
  const ea = a.f[a.f.length - 1], sb = b.f[0];
  let acc = 0, ws = 0;
  for (let i = 0; i < 10; i++) {
    let d = Math.abs(ea[i] - sb[i]);
    if (i === 1) d *= 90;                 // crouch is in body-lengths → degrees-comparable
    else { d = d % 360; if (d > 180) d = 360 - d; }
    acc += d * TW[i]; ws += TW[i];
  }
  return acc / ws;
}
