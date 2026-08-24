// Player avatar: the center dancer IS the player. MediaPipe landmarks are
// mirrored, smoothed, re-anchored to the stage and rendered in the stylized
// reference language — neon rim, readable silhouette, blank glowing face —
// wearing the StyleProfile captured from the player's own appearance.
//
// Presentation systems layered on top:
//  - verlet-ish springs: hair strands, hood and jacket hem lag the body
//  - tracked hands (pose index/pinky/thumb landmarks → open / fist / point)
//  - cel-shading pass (side shade + top light) on an offscreen canvas
//  - reactive face states (smile on PERFECT, stars on YEAH, wobble on X)
//  - gold afterimage clones frozen behind the pose on YEAH
//  - star-gated cosmetics: aura color, jacket trim, glow tattoos, kicks

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { StyleProfile } from './appearance';
import type { Judgment } from './pose/scorer';
import { SpriteRig } from './rig';

export type SkinId = 'toon' | 'sprite' | 'wire';

interface Pt { x: number; y: number }
type Named =
  | 'nose' | 'earA' | 'earB'
  | 'shA' | 'elA' | 'wrA' | 'shB' | 'elB' | 'wrB'
  | 'pinkyA' | 'indexA' | 'thumbA' | 'pinkyB' | 'indexB' | 'thumbB'
  | 'hipA' | 'hipB' | 'kneeA' | 'ankA' | 'kneeB' | 'ankB';

// mirrored: person-left landmarks land on screen side B (viewer right)
const MAP: Record<Named, number> = {
  nose: 0, earA: 8, earB: 7,
  shA: 12, elA: 14, wrA: 16, shB: 11, elB: 13, wrB: 15,
  pinkyA: 18, indexA: 20, thumbA: 22, pinkyB: 17, indexB: 19, thumbB: 21,
  hipA: 24, kneeA: 26, ankA: 28, hipB: 23, kneeB: 25, ankB: 27,
};

export interface Cosmetics {
  aura: string | null;      // resolved color, null = song accent
  trim: string | null;      // jacket piping color
  tattoo: 'none' | 'circuit' | 'royal';
  kicks: 'default' | 'neon' | 'gold';
}
export const DEFAULT_COSMETICS: Cosmetics = { aura: null, trim: null, tattoo: 'none', kicks: 'default' };

interface Trail { pts: { x: number; y: number; t: number }[] }

class Spring {
  p: Pt = { x: 0, y: 0 };
  v: Pt = { x: 0, y: 0 };
  private init = false;
  follow(target: Pt, dt: number, stiffness = 90, damp = 12) {
    if (!this.init) { this.p = { ...target }; this.init = true; return; }
    const ax = (target.x - this.p.x) * stiffness - this.v.x * damp;
    const ay = (target.y - this.p.y) * stiffness - this.v.y * damp;
    this.v.x += ax * dt; this.v.y += ay * dt;
    this.p.x += this.v.x * dt; this.p.y += this.v.y * dt;
  }
}

interface Ghost {
  t: number;
  segs: [number, number][][];
  head: [number, number, number];
}

type HandState = 'open' | 'fist' | 'point' | 'relaxed';

export class PlayerAvatar {
  private sm: Partial<Record<Named, Pt>> = {};
  private vis: Partial<Record<Named, number>> = {};
  private torsoEMA = 0.22;
  private baseHip: Pt | null = null;
  private trails: Record<'A' | 'B', Trail> = { A: { pts: [] }, B: { pts: [] } };
  private lastSeen = 0;
  hasPose = false;

  // springs
  private hairSprings = [new Spring(), new Spring(), new Spring()];
  private hoodSpring = new Spring();
  private hemSprings = [new Spring(), new Spring()];
  private lastDraw = 0;

  // face / ghosts
  private faceState: 'idle' | 'smile' | 'stars' | 'wobble' = 'idle';
  private faceT = 0;
  private ghosts: Ghost[] = [];
  private pendingGhost = false;

  // judgment rim: the neon outline IS the score feedback
  private rimNow: [number, number, number] = [255, 255, 255];
  private rimTarget: [number, number, number] = [255, 255, 255];

  // depth (MediaPipe z, smoothed), sprite rig, particles, anime-mode gating
  private zr: Partial<Record<Named, number>> = {};
  private rig = new SpriteRig();
  private particles: { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; kind: 'dust' | 'spark' | 'flame'; color: string }[] = [];
  private prevJoint: Partial<Record<string, [number, number]>> = {};
  /** screen-space ankle positions + speeds from the last draw (floor tiles read these) */
  feet: { x: number; y: number; v: number }[] = [];
  /** 12fps stepped-pose mode */
  anime = false;
  private lastAccept = 0;

  // offscreen for the cel pass
  private off = document.createElement('canvas');
  private offCtx = this.off.getContext('2d')!;
  // offscreen for the floor reflection (flipped body + fade mask)
  private refl = document.createElement('canvas');
  private reflCtx = this.refl.getContext('2d')!;
  // offscreen for the white sticker-outline silhouette (the Just Dance look)
  private sil = document.createElement('canvas');
  private silCtx = this.sil.getContext('2d')!;

  update(lms: NormalizedLandmark[] | null, aspect: number, now: number) {
    if (!lms) { this.hasPose = now - this.lastSeen < 600; return; }
    this.lastSeen = now;
    this.hasPose = true;
    // anime mode: hold the pose between 12fps steps for a hand-animated feel
    if (this.anime && now - this.lastAccept < 83) return;
    this.lastAccept = now;
    const A = 0.45;
    for (const key of Object.keys(MAP) as Named[]) {
      const lm = lms[MAP[key]];
      const p = { x: (1 - lm.x) * aspect, y: lm.y };
      const prev = this.sm[key];
      this.sm[key] = prev ? { x: prev.x + (p.x - prev.x) * A, y: prev.y + (p.y - prev.y) * A } : p;
      this.vis[key] = lm.visibility ?? 1;
      const z = (lm as { z?: number }).z ?? 0;
      this.zr[key] = (this.zr[key] ?? z) * 0.6 + z * 0.4;
    }
    const midSh = this.mid('shA', 'shB'), midHip = this.mid('hipA', 'hipB');
    const torso = Math.hypot(midSh.x - midHip.x, midSh.y - midHip.y);
    if (torso > 0.05) this.torsoEMA += (torso - this.torsoEMA) * 0.06;
    this.baseHip = this.baseHip
      ? { x: this.baseHip.x + (midHip.x - this.baseHip.x) * 0.012, y: this.baseHip.y + (midHip.y - this.baseHip.y) * 0.012 }
      : { ...midHip };
  }

  /** judgment feedback → rim color + face state + gold afterimages
   *  gold = perfect · green = good · blue = okay · red = missed */
  react(j: Judgment) {
    if (j === 'YEAH') { this.faceState = 'stars'; this.faceT = 1.4; this.pendingGhost = true; }
    else if (j === 'PERFECT' || j === 'SUPER') { this.faceState = 'smile'; this.faceT = 0.9; }
    else if (j === 'X') { this.faceState = 'wobble'; this.faceT = 0.8; }
    const RIM: Record<Judgment, [number, number, number]> = {
      YEAH: [255, 210, 62], PERFECT: [255, 210, 62],
      SUPER: [87, 249, 107], GOOD: [87, 249, 107],
      OK: [63, 141, 255],
      X: [255, 77, 77],
    };
    this.rimTarget = RIM[j];
  }

  private mid(a: Named, b: Named): Pt {
    const pa = this.sm[a]!, pb = this.sm[b]!;
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    style: StyleProfile,
    cx: number, groundY: number, height: number,
    opts: {
      beat: number; accent: string; gloveFlash?: number; goldGlow?: boolean; w: number;
      cosmetics?: Cosmetics;
      skin?: SkinId;
      /** stage key light (beam) — x position on screen + beam color */
      light?: { x: number; color: string };
      /** combo multiplier level 0-3 (×1..×4) — ≥1 ignites the flame aura */
      comboLevel?: number;
      /** glossy floor reflection under the dancer */
      reflect?: boolean;
    },
  ) {
    if (!this.sm.shA || !this.baseHip) return;
    const cos = opts.cosmetics ?? DEFAULT_COSMETICS;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastDraw) / 1000 || 0.016);
    this.lastDraw = now;
    if (this.faceT > 0) { this.faceT -= dt; if (this.faceT <= 0) this.faceState = 'idle'; }

    const torsoPx = height / 2.7;
    const scale = torsoPx / Math.max(0.08, this.torsoEMA);
    const midHip = this.mid('hipA', 'hipB');
    const swayX = Math.max(-opts.w * 0.18, Math.min(opts.w * 0.18, (midHip.x - this.baseHip.x) * scale * 0.7));
    const liftY = Math.max(-torsoPx * 1.1, Math.min(torsoPx * 0.6, (midHip.y - this.baseHip.y) * scale * 0.85));
    const pelvis: Pt = { x: cx + swayX, y: groundY - 1.06 * torsoPx + liftY };
    const P = (k: Named): [number, number] => {
      const p = this.sm[k]!;
      return [pelvis.x + (p.x - midHip.x) * scale, pelvis.y + (p.y - midHip.y) * scale];
    };

    // legs: tracked or synthesized
    const legsTracked = Math.min(this.vis.kneeA ?? 0, this.vis.kneeB ?? 0, this.vis.ankA ?? 0, this.vis.ankB ?? 0) > 0.45;
    const hipA = P('hipA'), hipB = P('hipB');
    let kneeA: [number, number], ankA: [number, number], kneeB: [number, number], ankB: [number, number];
    if (legsTracked) {
      kneeA = P('kneeA'); ankA = P('ankA'); kneeB = P('kneeB'); ankB = P('ankB');
    } else {
      const midShN = this.mid('shA', 'shB');
      const leanPush = (midShN.x - midHip.x) * scale * 0.35;
      const spread = torsoPx * 0.34;
      const crouchBend = Math.max(0, liftY) * 0.7 + torsoPx * 0.06;
      const bounce = Math.abs(Math.sin(opts.beat * Math.PI)) * torsoPx * 0.03;
      ankA = [pelvis.x - spread - leanPush * 0.4, groundY - bounce];
      ankB = [pelvis.x + spread - leanPush * 0.4, groundY - bounce];
      kneeA = [(hipA[0] + ankA[0]) / 2 - crouchBend * 0.25, (hipA[1] + ankA[1]) / 2 + crouchBend * 0.12];
      kneeB = [(hipB[0] + ankB[0]) / 2 + crouchBend * 0.25, (hipB[1] + ankB[1]) / 2 + crouchBend * 0.12];
    }

    const shA = P('shA'), shB = P('shB'), elA = P('elA'), elB = P('elB'), wrA = P('wrA'), wrB = P('wrB');
    const midShPx: [number, number] = [(shA[0] + shB[0]) / 2, (shA[1] + shB[1]) / 2];
    let head: [number, number];
    if ((this.vis.earA ?? 0) > 0.5 && (this.vis.earB ?? 0) > 0.5) {
      const eA = P('earA'), eB = P('earB');
      head = [(eA[0] + eB[0]) / 2, (eA[1] + eB[1]) / 2 - torsoPx * 0.04];
    } else {
      const n = P('nose');
      head = [n[0], n[1] - torsoPx * 0.1];
    }
    const hr = torsoPx * 0.23 * style.body.headScale;
    const build = style.body.buildScale;
    const lw = (u: number) => u * torsoPx * build;
    const lwT = (u: number) => u * torsoPx; // thickness-independent (layout)
    const skin = opts.skin ?? 'sprite';

    // pseudo-3D: MediaPipe z scales limbs as they come toward the camera and
    // decides whether each arm passes in front of or behind the body
    const hipZ = ((this.zr.hipA ?? 0) + (this.zr.hipB ?? 0)) / 2;
    const dz = (k: string) => {
      const z = this.zr[k as Named];
      if (z === undefined) return 1;
      return Math.max(0.84, Math.min(1.3, 1 + (hipZ - z) * 0.9));
    };
    const armZ = (el: Named, wr: Named) => ((this.zr[el] ?? hipZ) + (this.zr[wr] ?? hipZ)) / 2;
    const frontA = armZ('elA', 'wrA') < hipZ - 0.03;
    const frontB = armZ('elB', 'wrB') < hipZ - 0.03;

    // ---------------- main-canvas layers (behind the body) ----------------
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,10,0.45)';
    ctx.beginPath();
    ctx.ellipse(pelvis.x, groundY + torsoPx * 0.04, torsoPx * 0.85, torsoPx * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // aura
    const auraColor = opts.goldGlow ? '#ffd23e' : (cos.aura ?? opts.accent);
    const pulse = Math.exp(-((opts.beat % 1)) * 3.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ac = hexToRgbStr(auraColor);
    const aur = ctx.createRadialGradient(pelvis.x, pelvis.y - torsoPx * 0.4, 0, pelvis.x, pelvis.y - torsoPx * 0.4, torsoPx * 2.1);
    aur.addColorStop(0, `rgba(${ac},${0.10 + 0.10 * pulse})`);
    aur.addColorStop(1, `rgba(${ac},0)`);
    ctx.fillStyle = aur;
    ctx.beginPath(); ctx.arc(pelvis.x, pelvis.y - torsoPx * 0.4, torsoPx * 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // gold afterimage clones (behind the live body)
    this.drawGhosts(ctx, now);

    // wrist trails
    this.pushTrail('A', wrA, now);
    this.pushTrail('B', wrB, now);
    this.drawTrail(ctx, this.trails.A, auraColor, lwT(0.09));
    this.drawTrail(ctx, this.trails.B, style.glove, lwT(0.1));

    // ---------------- body → offscreen (for the cel pass) ----------------
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (this.off.width !== cw || this.off.height !== ch) { this.off.width = cw; this.off.height = ch; }
    const o = this.offCtx;
    o.setTransform(ctx.getTransform());
    o.clearRect(0, 0, cw, ch);
    o.lineCap = 'round';
    o.lineJoin = 'round';

    // squash & stretch: a quick vertical squash right on each beat landing
    const sq = 0.045 * Math.exp(-((opts.beat % 1)) * 7);
    o.save();
    o.translate(pelvis.x, groundY);
    o.scale(1 + sq * 0.55, 1 - sq);
    o.translate(-pelvis.x, -groundY);

    // torso quad corners (used to build the smooth torso path)
    const widen = (a: [number, number], b: [number, number], f: number): [number, number] =>
      [a[0] + (a[0] - b[0]) * f, a[1] + (a[1] - b[1]) * f];
    const q0 = widen(shA, shB, 0.14 + 0.08 * build), q1 = widen(shB, shA, 0.14 + 0.08 * build);
    const q2 = widen(hipB, hipA, 0.1 + 0.06 * build), q3 = widen(hipA, hipB, 0.1 + 0.06 * build);
    const center: [number, number] = [(q0[0] + q1[0] + q2[0] + q3[0]) / 4, (q0[1] + q1[1] + q2[1] + q3[1]) / 4];
    // curved torso: rounded shoulders, waist pinch, rounded hips
    const torsoPath = (c: CanvasRenderingContext2D, grow = 0) => {
      const g = (p: [number, number]): [number, number] => {
        const dx = p[0] - center[0], dy = p[1] - center[1];
        const n = Math.hypot(dx, dy) || 1;
        return [p[0] + (dx / n) * grow, p[1] + (dy / n) * grow];
      };
      const a0 = g(q0), a1 = g(q1), a2 = g(q2), a3 = g(q3);
      const waist = (s: [number, number], h: [number, number]): [number, number] => [
        (s[0] + h[0]) / 2 + (center[0] - (s[0] + h[0]) / 2) * 0.14,
        (s[1] + h[1]) / 2 + (center[1] - (s[1] + h[1]) / 2) * 0.14,
      ];
      const top: [number, number] = [midShPx[0], midShPx[1] - lwT(0.16) - grow];
      const bot: [number, number] = [pelvis.x, pelvis.y + lwT(0.12) + grow];
      c.beginPath();
      c.moveTo(a3[0], a3[1]);
      c.quadraticCurveTo(...waist(a0, a3), a0[0], a0[1]);
      c.quadraticCurveTo(top[0], top[1], a1[0], a1[1]);
      c.quadraticCurveTo(...waist(a1, a2), a2[0], a2[1]);
      c.quadraticCurveTo(bot[0], bot[1], a3[0], a3[1]);
      c.closePath();
    };

    // limb widths (tapered capsules)
    const W_UARM = lw(0.085), W_FARM = lw(0.065), W_WR = lw(0.05);
    const W_THIGH = lw(0.105), W_KNEE = lw(0.08), W_ANK = lw(0.055);
    const OUTLINE = 'rgba(12,10,26,0.55)';
    const ol = lwT(0.028);

    const bodyCapsules: [[number, number], [number, number], number, number][] = [
      [shA, elA, W_UARM, W_FARM], [elA, wrA, W_FARM, W_WR],
      [shB, elB, W_UARM, W_FARM], [elB, wrB, W_FARM, W_WR],
      [hipA, kneeA, W_THIGH, W_KNEE], [kneeA, ankA, W_KNEE, W_ANK],
      [hipB, kneeB, W_THIGH, W_KNEE], [kneeB, ankB, W_KNEE, W_ANK],
    ];

    // neon rim: padded copies of every body shape, glowing.
    // The rim color IS the judgment feedback — it eases toward the color of
    // the last scored move (gold/green/blue/red) and holds until the next.
    for (let i = 0; i < 3; i++) {
      this.rimNow[i] += (this.rimTarget[i] - this.rimNow[i]) * Math.min(1, dt * 9);
    }
    const rim = opts.goldGlow
      ? 'rgba(255,222,120,0.95)'
      : `rgba(${this.rimNow.map(Math.round).join(',')},0.94)`;
    // (non-wire skins get their rim as the judgment-tinted sticker outline —
    // one element, drawn around the finished silhouette after the cel pass)

    if (skin === 'wire') {
      // NEON WIREFRAME skin: glowing strokes only — pure light
      o.save();
      o.strokeStyle = rim;
      o.shadowColor = rim;
      o.shadowBlur = lwT(0.28);
      o.lineWidth = lwT(0.035);
      for (const [a, b] of bodyCapsules) {
        o.beginPath(); o.moveTo(a[0], a[1]); o.lineTo(b[0], b[1]); o.stroke();
      }
      torsoPath(o); o.stroke();
      o.beginPath(); o.arc(head[0], head[1], hr, 0, Math.PI * 2); o.stroke();
      // joint nodes
      o.fillStyle = rim;
      for (const j of [shA, shB, elA, elB, wrA, wrB, hipA, hipB, kneeA, kneeB, ankA, ankB]) {
        o.beginPath(); o.arc(j[0], j[1], lwT(0.035), 0, Math.PI * 2); o.fill();
      }
      // minimal face: two eye nodes
      for (const s of [-1, 1]) {
        o.beginPath(); o.arc(head[0] + s * hr * 0.32, head[1] - hr * 0.05, lwT(0.028), 0, Math.PI * 2); o.fill();
      }
      o.restore();
    } else if (skin === 'sprite') {
      // SPRITE RIG skin: baked illustrated parts stamped onto the bones
      this.rig.render(o, {
        T: torsoPx, pelvis: [pelvis.x, pelvis.y], midSh: midShPx, head, hr,
        shA, elA, wrA, shB, elB, wrB, hipA, kneeA, ankA, hipB, kneeB, ankB,
        dz, frontA, frontB,
      }, style);
      const flashS = opts.gloveFlash ?? 0;
      this.drawHand(o, 'A', wrA, elA, style.skin, lw(0.1) * dz('wrA'), 0, P);
      this.drawHand(o, 'B', wrB, elB, flashS > 0.05 ? '#ffe9a0' : style.glove, lw(0.115) * dz('wrB'), flashS, P);
      this.drawFace(o, head, hr, now);
    }

    if (skin === 'toon') {
    // dark outline pass — makes the body read as one cohesive figure
    for (const [a, b, w1, w2] of bodyCapsules) {
      capsulePath(o, a, b, w1 + ol, w2 + ol); o.fillStyle = OUTLINE; o.fill();
    }
    torsoPath(o, ol); o.fillStyle = OUTLINE; o.fill();

    // legs: tapered capsules + shoes
    const bootColor = cos.kicks === 'gold' ? '#ffd23e' : cos.kicks === 'neon' ? opts.accent : style.boots;
    const legSeg = (hip: [number, number], knee: [number, number], ank: [number, number], side: number) => {
      capsulePath(o, hip, knee, W_THIGH, W_KNEE); o.fillStyle = style.bottom; o.fill();
      capsulePath(o, knee, ank, W_KNEE, W_ANK); o.fill();
      o.beginPath(); o.arc(knee[0], knee[1], W_KNEE, 0, Math.PI * 2); o.fill();
      // shoe: points away from the body's midline, hugging the ground
      const fx = Math.sign(ank[0] - pelvis.x) || side;
      const heel: [number, number] = [ank[0] - fx * lwT(0.04), ank[1] + lwT(0.02)];
      const toe: [number, number] = [ank[0] + fx * lwT(0.24), ank[1] + lwT(0.055)];
      o.save();
      if (cos.kicks !== 'default') { o.shadowColor = bootColor; o.shadowBlur = lwT(0.22); }
      capsulePath(o, heel, toe, lw(0.085), lw(0.07)); o.fillStyle = bootColor; o.fill();
      o.restore();
      // sole highlight
      capsulePath(o, [heel[0], heel[1] + lwT(0.05)], [toe[0], toe[1] + lwT(0.03)], lw(0.03), lw(0.028));
      o.fillStyle = 'rgba(255,255,255,0.35)'; o.fill();
    };
    legSeg(hipA, kneeA, ankA, -1);
    legSeg(hipB, kneeB, ankB, 1);

    // neck (drawn early so torso/hood cover its base)
    capsulePath(o, [midShPx[0], midShPx[1] + lwT(0.02)], [head[0], head[1] + hr * 0.55], lw(0.07), lw(0.06));
    o.fillStyle = style.skin; o.fill();

    // hood (spring-drooped) behind the head
    const headUpright = head[1] < midShPx[1] - hr * 0.5;
    if (style.longSleeves && headUpright) {
      this.hoodSpring.follow({ x: head[0], y: head[1] + hr * 0.35 }, dt, 60, 9);
      const hx = this.hoodSpring.p.x, hy = Math.max(head[1] + hr * 0.1, this.hoodSpring.p.y);
      o.fillStyle = style.topDeep;
      o.beginPath();
      o.arc(hx, hy, hr * 1.18, Math.PI * 0.9, Math.PI * 2.1);
      o.quadraticCurveTo(hx + hr * 0.95, hy + hr * 1.15, midShPx[0] + hr * 0.5, midShPx[1]);
      o.lineTo(midShPx[0] - hr * 0.5, midShPx[1]);
      o.quadraticCurveTo(hx - hr * 0.95, hy + hr * 1.15, hx - hr * 1.18, hy);
      o.closePath(); o.fill();
    }

    // torso fill + jacket hem springs
    const tg = o.createLinearGradient(midShPx[0], midShPx[1], pelvis.x, pelvis.y + lwT(0.1));
    tg.addColorStop(0, style.top);
    tg.addColorStop(1, style.topDeep);
    o.save();
    o.shadowColor = style.top; o.shadowBlur = lwT(0.14);
    o.fillStyle = tg;
    torsoPath(o); o.fill();
    o.restore();
    // hem flaps lag behind hip corners (subtle cloth follow-through)
    for (let i = 0; i < 2; i++) {
      const corner = i === 0 ? q3 : q2;
      this.hemSprings[i].follow({ x: corner[0], y: corner[1] + lwT(0.1) }, dt, 110, 11);
      const hp = this.hemSprings[i].p;
      o.fillStyle = style.topDeep;
      o.beginPath();
      o.moveTo(corner[0] + (i === 0 ? 1 : -1) * lwT(0.02), corner[1] - lwT(0.02));
      o.lineTo(hp.x, hp.y + lwT(0.05));
      o.lineTo(corner[0] + (i === 0 ? 1 : -1) * lwT(0.13), corner[1] + lwT(0.02));
      o.closePath(); o.fill();
    }
    // jacket trim piping (cosmetic)
    if (cos.trim) {
      o.save();
      o.strokeStyle = cos.trim;
      o.shadowColor = cos.trim; o.shadowBlur = lwT(0.12);
      o.lineWidth = lwT(0.035);
      o.beginPath(); o.moveTo(q3[0], q3[1]); o.lineTo(q0[0], q0[1]); o.stroke();
      o.beginPath(); o.moveTo(q2[0], q2[1]); o.lineTo(q1[0], q1[1]); o.stroke();
      o.restore();
    }
    if (style.longSleeves) {
      const bx = (q2[0] + q3[0]) / 2, by = (q2[1] + q3[1]) / 2;
      const tx = (q0[0] + q1[0]) / 2, ty = (q0[1] + q1[1]) / 2;
      const px1 = bx + (tx - bx) * 0.22, py1 = by + (ty - by) * 0.22;
      o.strokeStyle = 'rgba(0,0,0,0.28)';
      o.lineWidth = lwT(0.045);
      o.beginPath();
      o.moveTo(px1 - lwT(0.2), py1 - lwT(0.08));
      o.quadraticCurveTo(px1, py1 + lwT(0.08), px1 + lwT(0.2), py1 - lwT(0.08));
      o.stroke();
      if (headUpright) {
        o.strokeStyle = 'rgba(255,255,255,0.45)';
        o.lineWidth = lwT(0.03);
        for (const s of [-1, 1]) {
          o.beginPath();
          o.moveTo(head[0] + s * hr * 0.35, head[1] + hr * 0.95);
          o.lineTo(head[0] + s * hr * 0.5, head[1] + hr * 0.95 + lwT(0.3));
          o.stroke();
        }
      }
    }

    // arms (+ tattoos) — tapered capsules with elbow joints
    const armSeg = (sh: [number, number], el: [number, number], wr: [number, number]) => {
      if (style.longSleeves) {
        capsulePath(o, sh, el, W_UARM, W_FARM); o.fillStyle = style.top; o.fill();
        capsulePath(o, el, wr, W_FARM, W_WR); o.fill();
        o.beginPath(); o.arc(el[0], el[1], W_FARM, 0, Math.PI * 2); o.fill();
      } else {
        // short sleeve cap + skin arm
        const cap: [number, number] = [sh[0] + (el[0] - sh[0]) * 0.38, sh[1] + (el[1] - sh[1]) * 0.38];
        capsulePath(o, cap, el, lw(0.07), W_FARM); o.fillStyle = style.skin; o.fill();
        capsulePath(o, el, wr, W_FARM, W_WR); o.fill();
        o.beginPath(); o.arc(el[0], el[1], W_FARM, 0, Math.PI * 2); o.fill();
        capsulePath(o, sh, cap, W_UARM, lw(0.075)); o.fillStyle = style.top; o.fill();
      }
      if (cos.tattoo !== 'none') {
        o.save();
        o.strokeStyle = auraColor;
        o.shadowColor = auraColor; o.shadowBlur = lwT(0.14);
        o.lineWidth = lwT(0.035);
        if (cos.tattoo === 'circuit') {
          o.setLineDash([lwT(0.08), lwT(0.06)]);
          o.beginPath(); o.moveTo(el[0], el[1]); o.lineTo(wr[0], wr[1]); o.stroke();
          o.setLineDash([]);
        } else {
          // royal: rings on the upper arm
          for (const f of [0.45, 0.6]) {
            const rx = sh[0] + (el[0] - sh[0]) * f, ry = sh[1] + (el[1] - sh[1]) * f;
            o.beginPath(); o.arc(rx, ry, lw(0.1), 0, Math.PI * 2); o.stroke();
          }
        }
        o.restore();
      }
    };
    armSeg(shA, elA, wrA);
    armSeg(shB, elB, wrB);

    // hands: tracked landmarks → open / fist / point cartoon hands
    const flash = opts.gloveFlash ?? 0;
    this.drawHand(o, 'A', wrA, elA, style.skin, lw(0.1), 0, P);
    this.drawHand(o, 'B', wrB, elB, flash > 0.05 ? '#ffe9a0' : style.glove, lw(0.115), flash, P);

    // head + face
    o.fillStyle = style.skin;
    o.beginPath(); o.arc(head[0], head[1], hr, 0, Math.PI * 2); o.fill();
    const fg = o.createRadialGradient(head[0], head[1] + hr * 0.1, hr * 0.1, head[0], head[1] + hr * 0.1, hr * 0.85);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    o.fillStyle = fg;
    o.beginPath(); o.arc(head[0], head[1] + hr * 0.1, hr * 0.85, 0, Math.PI * 2); o.fill();
    this.drawFace(o, head, hr, now);

    // hair: cap + springy strands
    if (!style.hairIsSkin) {
      o.fillStyle = style.hair;
      o.beginPath();
      o.arc(head[0], head[1] - hr * 0.12, hr * 1.03, Math.PI * 0.93, Math.PI * 2.07);
      o.quadraticCurveTo(head[0] + hr * 0.95, head[1] - hr * 0.85, head[0] - hr * 0.15, head[1] - hr * 0.72);
      o.closePath(); o.fill();
      const angles = [-2.35, -1.85, -1.2];
      o.strokeStyle = style.hair;
      // no loose strands when the hood is up — they'd poke through it
      for (let i = 0; i < (style.longSleeves && headUpright ? 0 : 3); i++) {
        const a = angles[i];
        const anchor = { x: head[0] + Math.cos(a) * hr * 0.95, y: head[1] + Math.sin(a) * hr * 0.95 };
        const rest = { x: head[0] + Math.cos(a) * hr * 1.5, y: head[1] + Math.sin(a) * hr * 1.5 - hr * 0.1 };
        this.hairSprings[i].follow(rest, dt, 130, 9);
        const sp = this.hairSprings[i].p;
        o.lineWidth = hr * (0.24 - i * 0.045);
        o.beginPath();
        o.moveTo(anchor.x, anchor.y);
        o.quadraticCurveTo((anchor.x + sp.x) / 2, (anchor.y + sp.y) / 2 - hr * 0.12, sp.x, sp.y);
        o.stroke();
      }
    }

    } // end toon skin

    o.restore(); // squash & stretch transform

    // ---------------- cel-shading pass on the offscreen body ----------------
    // Key light follows the actual stage beam when one is shining (YouTube
    // stage mode); otherwise it drifts gently with the beat. (The 3D skin has
    // real lighting — no cel pass.)
    if (skin !== 'wire') {
      const bboxX = pelvis.x;
      const keyLight = opts.light
        ? Math.max(-torsoPx * 1.2, Math.min(torsoPx * 1.2, (opts.light.x - pelvis.x) * 0.4))
        : Math.sin(opts.beat * Math.PI * 0.5) * torsoPx * 0.6;
      const litColor = opts.light ? `rgba(${hexToRgbStr(opts.light.color)},0.16)` : 'rgba(255,245,235,0.10)';
      o.save();
      o.globalCompositeOperation = 'source-atop';
      const sg = o.createLinearGradient(bboxX + keyLight - torsoPx * 1.4, 0, bboxX + keyLight + torsoPx * 1.4, 0);
      sg.addColorStop(0, litColor);
      sg.addColorStop(0.55, 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(8,4,38,0.30)');
      o.fillStyle = sg;
      o.fillRect(bboxX - torsoPx * 2.5, pelvis.y - torsoPx * 2.6, torsoPx * 5, torsoPx * 4.5);
      const tl = o.createLinearGradient(0, head[1] - hr * 1.4, 0, pelvis.y + torsoPx);
      tl.addColorStop(0, 'rgba(255,255,255,0.12)');
      tl.addColorStop(0.4, 'rgba(255,255,255,0)');
      o.fillStyle = tl;
      o.fillRect(bboxX - torsoPx * 2.5, head[1] - hr * 2, torsoPx * 5, torsoPx * 5);
      o.restore();
    }

    // glossy floor reflection: the body layer flipped about the ground line,
    // squashed, faded out with distance — drawn UNDER the real body
    if (opts.reflect) {
      const m = ctx.getTransform();
      const gDev = groundY * m.d + m.f;          // ground line in device pixels
      const fadePx = height * 0.42 * m.d;
      if (this.refl.width !== cw || this.refl.height !== ch) { this.refl.width = cw; this.refl.height = ch; }
      const rc = this.reflCtx;
      rc.setTransform(1, 0, 0, 1, 0, 0);
      rc.clearRect(0, 0, cw, ch);
      rc.save();
      rc.translate(0, gDev);
      rc.scale(1, -0.5);
      rc.translate(0, -gDev);
      rc.drawImage(this.off, 0, 0);
      rc.restore();
      rc.save();
      rc.globalCompositeOperation = 'destination-in';
      const fade = rc.createLinearGradient(0, gDev, 0, gDev + fadePx);
      fade.addColorStop(0, 'rgba(255,255,255,0.8)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      rc.fillStyle = fade;
      rc.fillRect(0, gDev, cw, fadePx + 2);
      rc.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.refl, 0, 0);
      ctx.restore();
    }

    // sticker outline around the whole silhouette — the JD coach look. This
    // IS the judgment rim: one element, tinted by the last score's color
    // (white until the first move), with a soft matching glow.
    if (skin !== 'wire') {
      if (this.sil.width !== cw || this.sil.height !== ch) { this.sil.width = cw; this.sil.height = ch; }
      const sc = this.silCtx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, cw, ch);
      sc.drawImage(this.off, 0, 0);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = rim;
      sc.fillRect(0, 0, cw, ch);
      sc.globalCompositeOperation = 'source-over';
      const m2 = ctx.getTransform();
      const rOut = Math.max(2, torsoPx * 0.045 * m2.a);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // glow: one shadow-only stamp (image drawn far off-canvas, shadow lands here)
      ctx.shadowColor = rim;
      ctx.shadowBlur = torsoPx * 0.4 * m2.a;
      ctx.shadowOffsetX = cw + 200;
      ctx.drawImage(this.sil, -(cw + 200), 0);
      ctx.shadowColor = 'transparent';
      ctx.shadowOffsetX = 0;
      ctx.shadowBlur = 0;
      // crisp colored outline: offset stamps in a ring
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.drawImage(this.sil, Math.cos(a) * rOut, Math.sin(a) * rOut);
      }
      ctx.restore();
    }

    // composite the shaded body onto the main canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.off, 0, 0);
    ctx.restore();

    // publish ankle positions + speeds for the light-up floor tiles
    const footV = (key: string, p: [number, number]) => {
      const prev = this.prevJoint[key];
      this.prevJoint[key] = p;
      return prev ? Math.hypot(p[0] - prev[0], p[1] - prev[1]) / Math.max(0.008, dt) : 0;
    };
    this.feet = [
      { x: ankA[0], y: ankA[1], v: footV('ftA', ankA) },
      { x: ankB[0], y: ankB[1], v: footV('ftB', ankB) },
    ];

    // ---------------- limb particles: foot dust + hand sparks ----------------
    this.spawnParticles(wrA, wrB, ankA, ankB, groundY, torsoPx, dt, style.glove, auraColor);
    // combo flames: the hotter the multiplier, the fiercer the burn
    const comboLv = opts.comboLevel ?? 0;
    if (comboLv >= 1 && this.particles.length < 90) {
      const FLAME = ['#ffd23e', '#ff9d2e', '#ff5d3e'];
      for (let i = 0; i < comboLv; i++) {
        if (Math.random() > 0.45) continue;
        const sx2 = pelvis.x + (Math.random() - 0.5) * torsoPx * 1.5;
        this.particles.push({
          x: sx2, y: pelvis.y + (Math.random() - 0.7) * torsoPx,
          vx: (Math.random() - 0.5) * torsoPx * 0.25,
          vy: -torsoPx * (0.9 + Math.random() * 0.9 + comboLv * 0.25),
          r: torsoPx * (0.05 + Math.random() * 0.05 + comboLv * 0.012),
          life: 0, max: 0.45 + Math.random() * 0.3,
          kind: 'flame', color: FLAME[Math.min(2, Math.floor(Math.random() * (comboLv + 1)))],
        });
      }
    }
    this.renderParticles(ctx, dt);

    // capture a ghost snapshot right after a YEAH
    if (this.pendingGhost) {
      this.pendingGhost = false;
      this.ghosts.push({
        t: now,
        segs: [
          [shA, elA, wrA], [shB, elB, wrB],
          [hipA, kneeA, ankA], [hipB, kneeB, ankB],
          [q0, q1, q2, q3],
        ],
        head: [head[0], head[1], hr],
      });
      if (this.ghosts.length > 3) this.ghosts.shift();
    }

    ctx.restore();
  }

  // ---- limb particles ------------------------------------------------------
  private spawnParticles(
    wrA: [number, number], wrB: [number, number],
    ankA: [number, number], ankB: [number, number],
    groundY: number, torsoPx: number, dt: number,
    glove: string, aura: string,
  ) {
    const speedOf = (key: string, p: [number, number]) => {
      const prev = this.prevJoint[key];
      this.prevJoint[key] = p;
      if (!prev) return 0;
      return Math.hypot(p[0] - prev[0], p[1] - prev[1]) / Math.max(0.008, dt);
    };
    // hand sparks on fast swings
    for (const [key, wr, col] of [['wrA', wrA, aura], ['wrB', wrB, glove]] as const) {
      const v = speedOf(key, wr);
      if (v > torsoPx * 7 && this.particles.length < 70 && Math.random() < 0.55) {
        this.particles.push({
          x: wr[0] + (Math.random() - 0.5) * torsoPx * 0.1,
          y: wr[1] + (Math.random() - 0.5) * torsoPx * 0.1,
          vx: (Math.random() - 0.5) * torsoPx * 0.8,
          vy: (Math.random() - 0.5) * torsoPx * 0.8,
          r: torsoPx * (0.03 + Math.random() * 0.03),
          life: 0, max: 0.4 + Math.random() * 0.25, kind: 'spark', color: col,
        });
      }
    }
    // foot dust when a fast-moving foot is near the floor
    for (const [key, ank] of [['ankA', ankA], ['ankB', ankB]] as const) {
      const v = speedOf(key, ank);
      if (v > torsoPx * 3.4 && ank[1] > groundY - torsoPx * 0.14 && this.particles.length < 70 && Math.random() < 0.5) {
        for (let i = 0; i < 2; i++) {
          this.particles.push({
            x: ank[0] + (Math.random() - 0.5) * torsoPx * 0.14,
            y: groundY - torsoPx * 0.02,
            vx: (Math.random() - 0.5) * torsoPx * 0.9,
            vy: -Math.random() * torsoPx * 0.35,
            r: torsoPx * (0.05 + Math.random() * 0.05),
            life: 0, max: 0.5 + Math.random() * 0.3, kind: 'dust', color: '',
          });
        }
      }
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.particles.length) return;
    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      const a = 1 - p.life / p.max;
      if (p.kind === 'dust') {
        const r = p.r * (1 + 2.2 * (p.life / p.max));
        ctx.fillStyle = `rgba(205,195,185,${0.2 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'flame') {
        // rising teardrops that shrink and wobble as they burn out
        p.x += Math.sin((p.life * 17) + p.y * 0.05) * p.r * 0.35;
        ctx.globalCompositeOperation = 'lighter';
        const r = p.r * (1 - 0.6 * (p.life / p.max));
        const fg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
        fg.addColorStop(0, `rgba(${hexToRgbStr(p.color)},${0.5 * a})`);
        fg.addColorStop(1, `rgba(${hexToRgbStr(p.color)},0)`);
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${hexToRgbStr(p.color)},${0.75 * a})`;
        star(ctx, p.x, p.y, p.r * (0.6 + a));
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
  }

  // ---- hands ---------------------------------------------------------------
  private drawHand(
    o: CanvasRenderingContext2D, side: 'A' | 'B',
    wr: [number, number], el: [number, number],
    color: string, r: number, flash: number,
    P: (k: Named) => [number, number],
  ) {
    const idx = this.sm[('index' + side) as Named], pky = this.sm[('pinky' + side) as Named];
    const vIdx = this.vis[('index' + side) as Named] ?? 0, vPky = this.vis[('pinky' + side) as Named] ?? 0;
    let state: HandState = 'relaxed';
    let dir = Math.atan2(wr[1] - el[1], wr[0] - el[0]); // fallback: along forearm
    if (idx && pky && vIdx > 0.5 && vPky > 0.5) {
      const ip = P(('index' + side) as Named), pp = P(('pinky' + side) as Named);
      const mx = (ip[0] + pp[0]) / 2, my = (ip[1] + pp[1]) / 2;
      dir = Math.atan2(my - wr[1], mx - wr[0]);
      const handLen = Math.hypot(mx - wr[0], my - wr[1]);
      const spreadRel = Math.hypot(ip[0] - pp[0], ip[1] - pp[1]) / Math.max(1, handLen);
      const idxLen = Math.hypot(ip[0] - wr[0], ip[1] - wr[1]);
      const pkyLen = Math.hypot(pp[0] - wr[0], pp[1] - wr[1]);
      if (handLen < r * 1.4) state = 'fist';
      else if (idxLen > pkyLen * 1.5) state = 'point';
      else if (spreadRel > 0.55) state = 'open';
      else state = 'relaxed';
    }
    o.save();
    if (flash > 0.05) { o.shadowColor = '#ffd23e'; o.shadowBlur = r * 6 * flash; }
    o.fillStyle = color;
    o.strokeStyle = color;
    o.lineCap = 'round';
    const px = wr[0], py = wr[1];
    if (state === 'fist') {
      o.beginPath(); o.arc(px, py, r * 1.05, 0, Math.PI * 2); o.fill();
      // knuckle notch
      o.strokeStyle = 'rgba(0,0,0,0.25)';
      o.lineWidth = r * 0.22;
      o.beginPath(); o.arc(px, py, r * 0.6, dir - 0.7, dir + 0.7); o.stroke();
    } else if (state === 'point') {
      o.beginPath(); o.arc(px, py, r * 0.95, 0, Math.PI * 2); o.fill();
      o.lineWidth = r * 0.5;
      o.beginPath();
      o.moveTo(px, py);
      o.lineTo(px + Math.cos(dir) * r * 2.1, py + Math.sin(dir) * r * 2.1);
      o.stroke();
    } else if (state === 'open') {
      o.beginPath(); o.arc(px, py, r * 0.95, 0, Math.PI * 2); o.fill();
      o.lineWidth = r * 0.42;
      for (const spread of [-0.55, -0.18, 0.18, 0.55]) {
        o.beginPath();
        o.moveTo(px, py);
        o.lineTo(px + Math.cos(dir + spread) * r * 1.8, py + Math.sin(dir + spread) * r * 1.8);
        o.stroke();
      }
      // thumb
      o.beginPath();
      o.moveTo(px, py);
      o.lineTo(px + Math.cos(dir + 1.4) * r * 1.3, py + Math.sin(dir + 1.4) * r * 1.3);
      o.stroke();
    } else {
      // relaxed mitt: 3 soft fingers
      o.beginPath(); o.arc(px, py, r, 0, Math.PI * 2); o.fill();
      o.lineWidth = r * 0.5;
      for (const spread of [-0.3, 0, 0.3]) {
        o.beginPath();
        o.moveTo(px, py);
        o.lineTo(px + Math.cos(dir + spread) * r * 1.25, py + Math.sin(dir + spread) * r * 1.25);
        o.stroke();
      }
    }
    o.restore();
  }

  // ---- face states ---------------------------------------------------------
  private drawFace(o: CanvasRenderingContext2D, head: [number, number], hr: number, now: number) {
    const [hx, hy] = head;
    if (this.faceState === 'smile') {
      o.strokeStyle = 'rgba(30,20,50,0.75)';
      o.lineWidth = hr * 0.13;
      o.lineCap = 'round';
      o.beginPath();
      o.arc(hx, hy + hr * 0.08, hr * 0.42, Math.PI * 0.2, Math.PI * 0.8);
      o.stroke();
    } else if (this.faceState === 'stars') {
      o.save();
      o.fillStyle = '#ffd23e';
      o.shadowColor = '#ffd23e'; o.shadowBlur = hr * 0.5;
      const tw = 1 + Math.sin(now / 60) * 0.15;
      for (const sx of [-0.38, 0.38]) star(o, hx + sx * hr, hy - hr * 0.08, hr * 0.26 * tw);
      o.restore();
      o.strokeStyle = 'rgba(30,20,50,0.75)';
      o.lineWidth = hr * 0.12;
      o.beginPath();
      o.arc(hx, hy + hr * 0.18, hr * 0.4, Math.PI * 0.15, Math.PI * 0.85);
      o.stroke();
    } else if (this.faceState === 'wobble') {
      o.strokeStyle = 'rgba(30,20,50,0.6)';
      o.lineWidth = hr * 0.11;
      o.lineCap = 'round';
      o.beginPath();
      const y0 = hy + hr * 0.28;
      o.moveTo(hx - hr * 0.4, y0);
      for (let i = 1; i <= 4; i++) {
        o.lineTo(hx - hr * 0.4 + (hr * 0.8 * i) / 4, y0 + (i % 2 === 0 ? hr * 0.09 : -hr * 0.09));
      }
      o.stroke();
    }
  }

  // ---- ghosts --------------------------------------------------------------
  private drawGhosts(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.ghosts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let g = this.ghosts.length - 1; g >= 0; g--) {
      const ghost = this.ghosts[g];
      const age = (now - ghost.t) / 1100;
      if (age >= 1) { this.ghosts.splice(g, 1); continue; }
      const a = (1 - age) * 0.4;
      const off = (1 - Math.pow(1 - Math.min(1, age * 3), 2)) * 26 * (g % 2 === 0 ? -1 : 1);
      ctx.strokeStyle = `rgba(255,205,80,${a})`;
      ctx.lineWidth = 7;
      for (const seg of ghost.segs) {
        ctx.beginPath();
        ctx.moveTo(seg[0][0] + off, seg[0][1]);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0] + off, seg[i][1]);
        if (seg.length === 4) ctx.closePath();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ghost.head[0] + off, ghost.head[1], ghost.head[2], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- trails --------------------------------------------------------------
  private pushTrail(side: 'A' | 'B', p: [number, number], t: number) {
    const tr = this.trails[side];
    const last = tr.pts[tr.pts.length - 1];
    if (!last || Math.hypot(p[0] - last.x, p[1] - last.y) > 3) {
      tr.pts.push({ x: p[0], y: p[1], t });
    }
    while (tr.pts.length && t - tr.pts[0].t > 360) tr.pts.shift();
    if (tr.pts.length > 18) tr.pts.shift();
  }

  private drawTrail(ctx: CanvasRenderingContext2D, tr: Trail, color: string, width: number) {
    if (tr.pts.length < 3) return;
    const now = performance.now();
    const head = tr.pts[tr.pts.length - 1], tail = tr.pts[0];
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < width * 3) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const rgb = color.startsWith('#') ? hexToRgbStr(color) : color.replace(/rgb\(|\)/g, '');
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1], b = tr.pts[i];
      const age = 1 - (now - b.t) / 380;
      if (age <= 0) continue;
      ctx.strokeStyle = `rgba(${rgb},${0.35 * age})`;
      ctx.lineWidth = width * age;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }
}

/** tapered capsule path between two points (round caps, different end widths) */
function capsulePath(
  o: CanvasRenderingContext2D,
  a: [number, number], b: [number, number],
  w1: number, w2: number,
) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  o.beginPath();
  o.arc(a[0], a[1], Math.max(0.5, w1), ang + Math.PI / 2, ang - Math.PI / 2);
  o.arc(b[0], b[1], Math.max(0.5, w2), ang - Math.PI / 2, ang + Math.PI / 2);
  o.closePath();
}

function star(o: CanvasRenderingContext2D, x: number, y: number, r: number) {
  o.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i === 0 ? o.moveTo(px, py) : o.lineTo(px, py);
  }
  o.closePath();
  o.fill();
}

function hexToRgbStr(hex: string): string {
  if (!hex.startsWith('#')) return '255,210,80';
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}
