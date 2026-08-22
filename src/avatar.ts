// Player avatar: the center dancer IS the player. MediaPipe landmarks are
// mirrored (webcam-mirror style), smoothed, re-anchored to the stage and
// rendered in the same stylized language as the reference coaches — neon rim,
// readable silhouette, blank glowing face — wearing the StyleProfile captured
// from the player's own appearance.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { StyleProfile } from './appearance';

interface Pt { x: number; y: number }
type Named =
  | 'nose' | 'earA' | 'earB'
  | 'shA' | 'elA' | 'wrA' | 'shB' | 'elB' | 'wrB'
  | 'hipA' | 'hipB' | 'kneeA' | 'ankA' | 'kneeB' | 'ankB';

// mirrored: landmark person-left (11,13,…) lands on screen side A (viewer left)
const MAP: Record<Named, number> = {
  nose: 0, earA: 8, earB: 7,
  shA: 12, elA: 14, wrA: 16, shB: 11, elB: 13, wrB: 15,
  hipA: 24, kneeA: 26, ankA: 28, hipB: 23, kneeB: 25, ankB: 27,
};

interface Trail { pts: { x: number; y: number; t: number }[] }

export class PlayerAvatar {
  private sm: Partial<Record<Named, Pt>> = {};
  private vis: Partial<Record<Named, number>> = {};
  private torsoEMA = 0.22;
  private baseHip: Pt | null = null;
  private trails: Record<'A' | 'B', Trail> = { A: { pts: [] }, B: { pts: [] } };
  private lastSeen = 0;
  hasPose = false;

  /** feed raw landmarks (unmirrored); aspect = videoWidth/videoHeight */
  update(lms: NormalizedLandmark[] | null, aspect: number, now: number) {
    if (!lms) { this.hasPose = now - this.lastSeen < 600; return; }
    this.lastSeen = now;
    this.hasPose = true;
    const A = 0.45; // smoothing
    for (const key of Object.keys(MAP) as Named[]) {
      const lm = lms[MAP[key]];
      const p = { x: (1 - lm.x) * aspect, y: lm.y };
      const prev = this.sm[key];
      this.sm[key] = prev ? { x: prev.x + (p.x - prev.x) * A, y: prev.y + (p.y - prev.y) * A } : p;
      this.vis[key] = lm.visibility ?? 1;
    }
    const midSh = this.mid('shA', 'shB'), midHip = this.mid('hipA', 'hipB');
    const torso = Math.hypot(midSh.x - midHip.x, midSh.y - midHip.y);
    if (torso > 0.05) this.torsoEMA += (torso - this.torsoEMA) * 0.06;
    // slow baseline for hip position → crouch/jump/sway offsets
    this.baseHip = this.baseHip
      ? { x: this.baseHip.x + (midHip.x - this.baseHip.x) * 0.012, y: this.baseHip.y + (midHip.y - this.baseHip.y) * 0.012 }
      : { ...midHip };
  }

  private mid(a: Named, b: Named): Pt {
    const pa = this.sm[a]!, pb = this.sm[b]!;
    return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    style: StyleProfile,
    cx: number, groundY: number, height: number,
    opts: { beat: number; accent: string; gloveFlash?: number; goldGlow?: boolean; w: number },
  ) {
    if (!this.sm.shA || !this.baseHip) return;
    const torsoPx = height / 2.7;
    const scale = torsoPx / Math.max(0.08, this.torsoEMA);
    const midHip = this.mid('hipA', 'hipB');
    // stage anchor + player-relative offsets (sway, crouch, jump)
    const swayX = Math.max(-opts.w * 0.18, Math.min(opts.w * 0.18, (midHip.x - this.baseHip.x) * scale * 0.7));
    const liftY = Math.max(-torsoPx * 1.1, Math.min(torsoPx * 0.6, (midHip.y - this.baseHip.y) * scale * 0.85));
    const pelvis: Pt = { x: cx + swayX, y: groundY - 1.06 * torsoPx + liftY };
    const P = (k: Named): [number, number] => {
      const p = this.sm[k]!;
      return [pelvis.x + (p.x - midHip.x) * scale, pelvis.y + (p.y - midHip.y) * scale];
    };

    // --- legs: tracked if visible, synthesized stance otherwise ---
    const legsTracked = Math.min(this.vis.kneeA ?? 0, this.vis.kneeB ?? 0, this.vis.ankA ?? 0, this.vis.ankB ?? 0) > 0.45;
    const hipA = P('hipA'), hipB = P('hipB');
    let kneeA: [number, number], ankA: [number, number], kneeB: [number, number], ankB: [number, number];
    if (legsTracked) {
      kneeA = P('kneeA'); ankA = P('ankA'); kneeB = P('kneeB'); ankB = P('ankB');
    } else {
      const midSh = this.mid('shA', 'shB');
      const leanPush = (midSh.x - midHip.x) * scale * 0.35;
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
    // head center from ears when visible, else extrapolate above the nose
    let head: [number, number];
    if ((this.vis.earA ?? 0) > 0.5 && (this.vis.earB ?? 0) > 0.5) {
      const eA = P('earA'), eB = P('earB');
      head = [(eA[0] + eB[0]) / 2, (eA[1] + eB[1]) / 2 - torsoPx * 0.04];
    } else {
      const n = P('nose');
      head = [n[0], n[1] - torsoPx * 0.1];
    }
    const hr = torsoPx * 0.23;
    const lw = (u: number) => u * torsoPx;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- soft shadow on the stage ---
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,10,0.45)';
    ctx.beginPath();
    ctx.ellipse(pelvis.x, groundY + torsoPx * 0.04, torsoPx * 0.85, torsoPx * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- beat aura behind the dancer ---
    const pulse = Math.exp(-((opts.beat % 1)) * 3.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aur = ctx.createRadialGradient(pelvis.x, pelvis.y - torsoPx * 0.4, 0, pelvis.x, pelvis.y - torsoPx * 0.4, torsoPx * 2.1);
    const ac = opts.goldGlow ? '255,210,80' : hexToRgb(opts.accent);
    aur.addColorStop(0, `rgba(${ac},${0.10 + 0.10 * pulse})`);
    aur.addColorStop(1, `rgba(${ac},0)`);
    ctx.fillStyle = aur;
    ctx.beginPath(); ctx.arc(pelvis.x, pelvis.y - torsoPx * 0.4, torsoPx * 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // --- motion trails from the wrists ---
    this.pushTrail('A', wrA, performance.now());
    this.pushTrail('B', wrB, performance.now());
    this.drawTrail(ctx, this.trails.A, opts.accent, lw(0.09));
    this.drawTrail(ctx, this.trails.B, style.glove, lw(0.1));

    // --- torso quad from real shoulders/hips (slightly widened) ---
    const widen = (a: [number, number], b: [number, number], f: number): [number, number] =>
      [a[0] + (a[0] - b[0]) * f, a[1] + (a[1] - b[1]) * f];
    const q0 = widen(shA, shB, 0.18), q1 = widen(shB, shA, 0.18);
    const q2 = widen(hipB, hipA, 0.12), q3 = widen(hipA, hipB, 0.12);
    const torsoPath = () => {
      ctx.beginPath();
      ctx.moveTo(q0[0], q0[1] - lw(0.06));
      ctx.lineTo(q1[0], q1[1] - lw(0.06));
      ctx.lineTo(q2[0], q2[1] + lw(0.08));
      ctx.lineTo(q3[0], q3[1] + lw(0.08));
      ctx.closePath();
    };

    // --- neon rim silhouette ---
    ctx.save();
    ctx.shadowColor = opts.goldGlow ? '#ffd23e' : opts.accent;
    ctx.shadowBlur = lw(0.3);
    ctx.strokeStyle = opts.goldGlow ? 'rgba(255,222,120,0.95)' : 'rgba(255,255,255,0.92)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = lw(0.26);
    for (const [a, b, c2] of [[shA, elA, wrA], [shB, elB, wrB]] as const) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
    }
    ctx.lineWidth = lw(0.28);
    for (const [a, b, c2] of [[hipA, kneeA, ankA], [hipB, kneeB, ankB]] as const) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
    }
    ctx.lineWidth = lw(0.1);
    torsoPath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(head[0], head[1], hr + lw(0.05), 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // --- legs ---
    const legSeg = (a: [number, number], b: [number, number], c2: [number, number]) => {
      ctx.strokeStyle = style.bottom; ctx.lineWidth = lw(0.18);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
      // boot
      ctx.strokeStyle = style.boots; ctx.lineWidth = lw(0.19);
      const dx = c2[0] - b[0], dy = c2[1] - b[1]; const n = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(c2[0] - (dx / n) * lw(0.3), c2[1] - (dy / n) * lw(0.3));
      ctx.lineTo(c2[0], c2[1]);
      ctx.stroke();
    };
    legSeg(hipA, kneeA, ankA);
    legSeg(hipB, kneeB, ankB);

    // --- neck (drawn early so torso/hood cover its base) ---
    ctx.strokeStyle = style.skin;
    ctx.lineWidth = lw(0.11);
    ctx.beginPath(); ctx.moveTo(midShPx[0], midShPx[1]); ctx.lineTo(head[0], head[1] + hr * 0.6); ctx.stroke();

    // --- hood behind the head (long sleeves → hoodie treatment) ---
    const headUpright = head[1] < midShPx[1] - hr * 0.5;
    if (style.longSleeves && headUpright) {
      ctx.fillStyle = style.topDeep;
      ctx.beginPath();
      ctx.arc(head[0], head[1] + hr * 0.2, hr * 1.18, Math.PI * 0.9, Math.PI * 2.1);
      ctx.quadraticCurveTo(head[0] + hr * 0.95, head[1] + hr * 1.35, midShPx[0] + hr * 0.5, midShPx[1]);
      ctx.lineTo(midShPx[0] - hr * 0.5, midShPx[1]);
      ctx.quadraticCurveTo(head[0] - hr * 0.95, head[1] + hr * 1.35, head[0] - hr * 1.18, head[1] + hr * 0.2);
      ctx.closePath(); ctx.fill();
    }

    // --- torso fill: vertical gradient + glow ---
    const tg = ctx.createLinearGradient(midShPx[0], midShPx[1], pelvis.x, pelvis.y + lw(0.1));
    tg.addColorStop(0, style.top);
    tg.addColorStop(1, style.topDeep);
    ctx.save();
    ctx.shadowColor = style.top; ctx.shadowBlur = lw(0.14);
    ctx.fillStyle = tg;
    torsoPath(); ctx.fill();
    ctx.restore();
    if (style.longSleeves) {
      // kangaroo pocket near the bottom of the torso quad + drawstrings
      const bx = (q2[0] + q3[0]) / 2, by = (q2[1] + q3[1]) / 2;
      const tx = (q0[0] + q1[0]) / 2, ty = (q0[1] + q1[1]) / 2;
      const px1 = bx + (tx - bx) * 0.22, py1 = by + (ty - by) * 0.22;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = lw(0.045);
      ctx.beginPath();
      ctx.moveTo(px1 - lw(0.2), py1 - lw(0.08));
      ctx.quadraticCurveTo(px1, py1 + lw(0.08), px1 + lw(0.2), py1 - lw(0.08));
      ctx.stroke();
      if (headUpright) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = lw(0.03);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(head[0] + s * hr * 0.35, head[1] + hr * 0.95);
          ctx.lineTo(head[0] + s * hr * 0.5, head[1] + hr * 0.95 + lw(0.3));
          ctx.stroke();
        }
      }
    }

    // --- arms ---
    const armSeg = (sh: [number, number], el: [number, number], wr: [number, number]) => {
      if (style.longSleeves) {
        ctx.strokeStyle = style.top; ctx.lineWidth = lw(0.16);
        ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(el[0], el[1]); ctx.stroke();
        ctx.lineWidth = lw(0.14);
        ctx.beginPath(); ctx.moveTo(el[0], el[1]); ctx.lineTo(wr[0], wr[1]); ctx.stroke();
      } else {
        ctx.strokeStyle = style.top; ctx.lineWidth = lw(0.17);
        ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(sh[0] + (el[0] - sh[0]) * 0.35, sh[1] + (el[1] - sh[1]) * 0.35); ctx.stroke();
        ctx.strokeStyle = style.skin; ctx.lineWidth = lw(0.13);
        ctx.beginPath(); ctx.moveTo(sh[0] + (el[0] - sh[0]) * 0.3, sh[1] + (el[1] - sh[1]) * 0.3); ctx.lineTo(el[0], el[1]); ctx.lineTo(wr[0], wr[1]); ctx.stroke();
      }
    };
    armSeg(shA, elA, wrA);
    armSeg(shB, elB, wrB);
    // hands: screen-right (B) wears the glove
    const flash = opts.gloveFlash ?? 0;
    ctx.fillStyle = style.skin;
    ctx.beginPath(); ctx.arc(wrA[0], wrA[1], lw(0.1), 0, Math.PI * 2); ctx.fill();
    ctx.save();
    if (flash > 0.05) { ctx.shadowColor = '#ffd23e'; ctx.shadowBlur = lw(0.5) * flash; }
    ctx.fillStyle = flash > 0.05 ? '#ffe9a0' : style.glove;
    ctx.beginPath(); ctx.arc(wrB[0], wrB[1], lw(0.13), 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // --- head ---
    ctx.fillStyle = style.skin;
    ctx.beginPath(); ctx.arc(head[0], head[1], hr, 0, Math.PI * 2); ctx.fill();
    // blank glowing face — the signature look
    const fg = ctx.createRadialGradient(head[0], head[1] + hr * 0.1, hr * 0.1, head[0], head[1] + hr * 0.1, hr * 0.85);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(head[0], head[1] + hr * 0.1, hr * 0.85, 0, Math.PI * 2); ctx.fill();
    // hair swoop (skip if shaved/bald/hat-colored-like-skin)
    if (!style.hairIsSkin) {
      ctx.fillStyle = style.hair;
      ctx.beginPath();
      ctx.arc(head[0], head[1] - hr * 0.12, hr * 1.03, Math.PI * 0.93, Math.PI * 2.07);
      ctx.quadraticCurveTo(head[0] + hr * 0.95, head[1] - hr * 0.85, head[0] - hr * 0.15, head[1] - hr * 0.72);
      ctx.closePath(); ctx.fill();
    }

    ctx.restore();
  }

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
    // only show when the hand is actually travelling
    const head = tr.pts[tr.pts.length - 1], tail = tr.pts[0];
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < width * 3) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const rgb = color.startsWith('#') ? hexToRgb(color) : color.replace(/rgb\(|\)/g, '');
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

function hexToRgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}
