// Coach renderer. Recreates the reference presentation: a big, centered,
// full-body dancer with a highly readable silhouette — neon rim light, flat
// stylized clothing, blank glowing face, one bright glove on the tracked hand.
// Poses come from the same move library the pictograms and scorer use, and
// transitions snap onto the beat with a springy ease.

import { MOVES, forward, lerpPose, snapEase, type Pose, type Skeleton } from './moves';
import { CLIPS, clipPose, transitionCost } from './motion';
import type { ChoreoMove } from './songs';
import type { Song } from './songs';

const IDLE = MOVES['idle'].pose;

/** target pose of a move id at its start (static pose or clip frame 0) */
function startPose(id: string): Pose {
  return MOVES[id]?.pose ?? (CLIPS[id] ? clipPose(CLIPS[id], 0) : IDLE);
}

export interface CoachState {
  pose: Pose;
  /** 0..1 flash amount on the glove (score feedback) */
  gloveFlash: number;
  goldHold: boolean;
}

export function choreoPose(choreo: ChoreoMove[], beat: number): { pose: Pose; current: ChoreoMove | null; goldHold: boolean; flowing: boolean } {
  if (choreo.length === 0 || beat < choreo[0].beat - 4) {
    return { pose: IDLE, current: null, goldHold: false, flowing: false };
  }
  let prevI = -1;
  for (let i = 0; i < choreo.length; i++) {
    if (choreo[i].beat <= beat) prevI = i; else break;
  }
  const prev = prevI >= 0 ? choreo[prevI] : null;
  const next = choreo[prevI + 1] ?? null;

  // motion clip playing: real captured dance — play it through, then blend
  // the last fraction of a beat into whatever comes next
  const clip = prev ? CLIPS[prev.move] : undefined;
  if (prev && clip) {
    const t = beat - prev.beat;
    let pose = clipPose(clip, Math.min(t, clip.b));
    if (next) {
      // adaptive crossfade: seamless cuts keep their snap, jarring ones get a
      // longer morph so the body travels instead of teleporting
      const lead = Math.min(0.6, 0.22 + transitionCost(prev.move, next.move) / 200);
      const tn = beat - (next.beat - lead);
      if (tn > 0) pose = lerpPose(pose, startPose(next.move), Math.min(1, tn / lead));
    }
    return { pose, current: prev, goldHold: false, flowing: true };
  }

  const prevPose = prev ? startPose(prev.move) : IDLE;
  if (!next) {
    return { pose: prevPose, current: prev, goldHold: !!prev?.gold && beat - (prev?.beat ?? 0) < 2.5, flowing: false };
  }
  const span = next.beat - (prev ? prev.beat : next.beat - 2);
  const t = (beat - (prev ? prev.beat : next.beat - 2)) / span;
  // hold the landed pose, then travel to the next one arriving exactly on its beat
  const hold = prev?.gold ? 0.75 : 0.4; // gold moves freeze longer, like the reference
  const eased = snapEase(Math.max(0, (t - hold) / (1 - hold)));
  return {
    pose: lerpPose(prevPose, startPose(next.move), eased),
    current: prev,
    goldHold: !!prev?.gold && t < 0.75,
    flowing: false,
  };
}

/** subtle whole-body bounce so the coach never stands still between moves */
export function addGroove(p: Pose, beat: number, energy = 1): Pose {
  const ph = (beat % 1);
  const bounce = Math.abs(Math.sin(ph * Math.PI)) * 0.045 * energy;
  return { ...p, crouch: p.crouch + bounce, lean: p.lean + Math.sin(beat * Math.PI) * 1.2 * energy };
}

export function drawCoach(
  ctx: CanvasRenderingContext2D,
  song: Song,
  pose: Pose,
  cx: number, groundY: number, height: number,
  opts: { gloveFlash?: number; goldHold?: boolean; alpha?: number; palette?: Song['coach'] } = {},
) {
  const sk = forward(pose);
  const scale = height / 2.7;
  const P = (p: [number, number]): [number, number] => [cx + p[0] * scale, groundY + (p[1] - 1.06) * scale];
  const c = opts.palette ?? song.coach;
  const lw = (u: number) => u * scale;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opts.alpha ?? 1;

  // torso quad corners (hips → shoulders), used for rim + fill
  const pel = P(sk.pelvis), nk = P(sk.neck);
  const ux = nk[0] - pel[0], uy = nk[1] - pel[1];
  const un = Math.hypot(ux, uy) || 1;
  const px = -uy / un, py = ux / un; // perpendicular
  const hw = lw(0.24), sw = lw(0.31);
  const hipY = 0.06, shY = 0.1;
  const torsoQuad: [number, number][] = [
    [pel[0] - px * hw, pel[1] - py * hw - lw(hipY)],
    [nk[0] - px * sw, nk[1] - py * sw + lw(shY)],
    [nk[0] + px * sw, nk[1] + py * sw + lw(shY)],
    [pel[0] + px * hw, pel[1] + py * hw - lw(hipY)],
  ];
  const torsoPath = () => {
    ctx.beginPath();
    ctx.moveTo(torsoQuad[0][0], torsoQuad[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(torsoQuad[i][0], torsoQuad[i][1]);
    ctx.closePath();
  };
  const hd0 = P(sk.head);
  const hr0 = lw(0.23);

  // --- neon rim: limbs, torso shape and head, blurred + bright ---
  ctx.save();
  ctx.shadowColor = opts.goldHold ? '#ffd23e' : song.accent;
  ctx.shadowBlur = lw(0.3);
  ctx.strokeStyle = opts.goldHold ? 'rgba(255,220,110,0.95)' : 'rgba(255,255,255,0.92)';
  silhouette(ctx, sk, P, lw, true);
  ctx.lineWidth = lw(0.09);
  torsoPath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(hd0[0], hd0[1], hr0 + lw(0.045), 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // --- legs ---
  limb(ctx, P(sk.hipL), P(sk.kneeL), P(sk.ankL), c.pants, lw(0.17));
  limb(ctx, P(sk.hipR), P(sk.kneeR), P(sk.ankR), c.pants, lw(0.17));
  boot(ctx, P(sk.kneeL), P(sk.ankL), c.boots, lw);
  boot(ctx, P(sk.kneeR), P(sk.ankR), c.boots, lw);
  // hip block so the torso sits on the pants
  ctx.fillStyle = c.pants;
  ctx.beginPath();
  ctx.moveTo(pel[0] - px * hw * 1.02, pel[1] - py * hw - lw(0.1));
  ctx.lineTo(pel[0] + px * hw * 1.02, pel[1] + py * hw - lw(0.1));
  ctx.lineTo(P(sk.hipR)[0] + lw(0.08), P(sk.hipR)[1] + lw(0.12));
  ctx.lineTo(P(sk.hipL)[0] - lw(0.08), P(sk.hipL)[1] + lw(0.12));
  ctx.closePath(); ctx.fill();

  // --- torso: glowing top + vest side panels ---
  torsoPath();
  ctx.fillStyle = c.top;
  ctx.save(); ctx.shadowColor = c.top; ctx.shadowBlur = lw(0.16); ctx.fill(); ctx.restore();
  // vest: darker panels hugging the sides of the quad
  ctx.strokeStyle = c.vest;
  ctx.lineWidth = lw(0.13);
  for (const [a, b] of [[torsoQuad[0], torsoQuad[1]], [torsoQuad[3], torsoQuad[2]]] as const) {
    ctx.beginPath();
    ctx.moveTo(a[0] * 0.9 + b[0] * 0.1, a[1] * 0.9 + b[1] * 0.1);
    ctx.lineTo(a[0] * 0.12 + b[0] * 0.88, a[1] * 0.12 + b[1] * 0.88);
    ctx.stroke();
  }

  // --- arms: short sleeve + skin forearm; viewer-right hand wears the glove ---
  const armSeg = (a: [number, number], b: [number, number], color: string, w: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  armSeg(P(sk.shL), P(sk.elL), c.top, lw(0.15));
  armSeg(P(sk.shR), P(sk.elR), c.top, lw(0.15));
  armSeg(P(sk.elL), P(sk.wrL), c.skin, lw(0.12));
  armSeg(P(sk.elR), P(sk.wrR), c.skin, lw(0.12));
  hand(ctx, P(sk.wrL), c.skin, lw(0.1), 0);
  const flash = opts.gloveFlash ?? 0;
  hand(ctx, P(sk.wrR), flash > 0.05 ? blend(c.glove, '#ffffff', flash) : c.glove, lw(0.13), flash);

  // --- head: skin + hair cap + blank glow face ---
  const hd = P(sk.head);
  const hr = lw(0.23);
  ctx.fillStyle = c.skin;
  ctx.beginPath(); ctx.arc(hd[0], hd[1], hr, 0, Math.PI * 2); ctx.fill();
  // blank face glow
  const g = ctx.createRadialGradient(hd[0], hd[1] + hr * 0.1, hr * 0.1, hd[0], hd[1] + hr * 0.1, hr * 0.85);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(hd[0], hd[1] + hr * 0.1, hr * 0.85, 0, Math.PI * 2); ctx.fill();
  // hair: cap + swoop
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(hd[0], hd[1] - hr * 0.15, hr * 1.02, Math.PI * 0.95, Math.PI * 2.05);
  ctx.quadraticCurveTo(hd[0] + hr * 0.9, hd[1] - hr * 0.9, hd[0] - hr * 0.2, hd[1] - hr * 0.75);
  ctx.closePath(); ctx.fill();

  ctx.restore();
}

function silhouette(ctx: CanvasRenderingContext2D, sk: Skeleton, P: (p: [number, number]) => [number, number], lw: (u: number) => number, stroke: boolean) {
  const seg = (...pts: [number, number][]) => {
    ctx.beginPath();
    const p0 = P(pts[0]);
    ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < pts.length; i++) { const p = P(pts[i]); ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  };
  ctx.lineWidth = lw(0.24);
  seg(sk.shL, sk.elL, sk.wrL);
  seg(sk.shR, sk.elR, sk.wrR);
  ctx.lineWidth = lw(0.26);
  seg(sk.hipL, sk.kneeL, sk.ankL);
  seg(sk.hipR, sk.kneeR, sk.ankR);
}

function limb(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], cPt: [number, number], color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(cPt[0], cPt[1]);
  ctx.stroke();
}

function boot(ctx: CanvasRenderingContext2D, knee: [number, number], ank: [number, number], color: string, lw: (u: number) => number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw(0.18);
  const dx = ank[0] - knee[0], dy = ank[1] - knee[1];
  const len = Math.hypot(dx, dy) || 1;
  const bx = ank[0] - (dx / len) * lw(0.3), by = ank[1] - (dy / len) * lw(0.3);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ank[0], ank[1]); ctx.stroke();
  // foot nub
  ctx.beginPath(); ctx.moveTo(ank[0], ank[1]); ctx.lineTo(ank[0] + lw(0.14) * Math.sign(dx || 1), ank[1] + lw(0.02)); ctx.stroke();
}

function hand(ctx: CanvasRenderingContext2D, wr: [number, number], color: string, r: number, flash: number) {
  ctx.save();
  if (flash > 0.05) { ctx.shadowColor = '#ffd23e'; ctx.shadowBlur = r * 6 * flash; }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(wr[0], wr[1], r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function blend(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ---------------------------------------------------------------------------
// Choreography-driven characters rendered with the full BodyArt anatomy —
// the same construction the player's avatar uses, so backup crew, the mini
// guide coach, menu and results dancers all match. Instances are pooled per
// call-site key (springs and blink clocks need continuity between frames).

import { BodyArt } from './body';
import type { StyleProfile } from './appearance';

const artPool = new Map<string, { art: BodyArt; lastNow: number }>();

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  key: string,
  pose: Pose,
  style: StyleProfile,
  cx: number, groundY: number, height: number,
  opts: { alpha?: number; goldHold?: boolean; gloveFlash?: number; beat?: number; faceState?: 'idle' | 'smile' | 'stars' | 'wobble' } = {},
) {
  let slot = artPool.get(key);
  if (!slot) { slot = { art: new BodyArt(), lastNow: performance.now() }; artPool.set(key, slot); }
  const now = performance.now();
  const dt = Math.min(0.05, (now - slot.lastNow) / 1000 || 0.016);
  slot.lastNow = now;

  const sk = forward(pose);
  const scale = height / 2.7;
  const P = (p: [number, number]): [number, number] => [cx + p[0] * scale, groundY + (p[1] - 1.06) * scale];
  const torsoPx = scale;
  const hr = torsoPx * 0.23 * style.body.headScale;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  slot.art.render(ctx, {
    pelvis: P(sk.pelvis), midSh: P(sk.neck), head: P(sk.head), hr,
    shA: P(sk.shL), elA: P(sk.elL), wrA: P(sk.wrL),
    shB: P(sk.shR), elB: P(sk.elR), wrB: P(sk.wrR),
    hipA: P(sk.hipL), kneeA: P(sk.kneeL), ankA: P(sk.ankL),
    hipB: P(sk.hipR), kneeB: P(sk.kneeR), ankB: P(sk.ankR),
    torsoPx, groundY,
    dz: () => 1, frontA: true, frontB: true,
  }, style, {
    beat: opts.beat ?? 0, now, dt,
    gloveFlash: opts.gloveFlash ?? 0,
    goldHold: !!opts.goldHold,
    faceState: opts.faceState ?? (opts.goldHold ? 'stars' : 'idle'),
  });
  ctx.restore();
}

/** StyleProfile for a song's built-in coach palette (menu, guide, demo mode) */
export function coachStyleOf(song: Song): StyleProfile {
  return {
    skin: song.coach.skin, hair: song.coach.hair,
    top: song.coach.top, topDeep: song.coach.vest,
    bottom: song.coach.pants, boots: song.coach.boots, glove: song.coach.glove,
    longSleeves: false, hairIsSkin: false,
    body: { headScale: 1, buildScale: 1 },
    look: { hair: 'swoop', shades: false, pattern: 'solid', skirt: false },
  };
}
