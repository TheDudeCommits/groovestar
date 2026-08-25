// Shared energy-saber rig: the vector katanas introduced in Fruit Slice,
// packaged for every blade game. Handles orientation-along-motion with a
// rest pose, ignite/retract scaling, comet trails (chunked polylines, no
// bead artifacts), style colors from progression, embers and throttled
// swing whooshes. Games feed hand positions; collision reads `hand`, `tip`
// and `tipPts`.

import { TUNING } from './tuning';
import { Juice, drawGlow } from './juice';
import { sfx } from './sfx';
import { saberStyle, type SaberStyle } from './progress';

type Ctx = CanvasRenderingContext2D;

export interface SaberState {
  hand: { x: number; y: number } | null;
  angle: number;
  rel: number;
  visible: boolean;
  tip: { x: number; y: number };
  tipPts: { x: number; y: number; t: number }[];
  /** unit motion direction of the hand (screen space), zero vector at rest */
  dir: [number, number];
}

const TRAIL_MS = 200;

export class Sabers {
  style: SaberStyle = saberStyle();
  data: Record<'L' | 'R', SaberState> = {
    L: { hand: null, angle: -Math.PI / 2 - 0.35, rel: 0, visible: false, tip: { x: 0, y: 0 }, tipPts: [], dir: [0, 0] },
    R: { hand: null, angle: -Math.PI / 2 + 0.35, rel: 0, visible: false, tip: { x: 0, y: 0 }, tipPts: [], dir: [0, 0] },
  };
  private lastWhoosh = { L: 0, R: 0 };

  constructor(private juice: Juice) {}

  hide(h: 'L' | 'R') {
    this.data[h].visible = false;
    this.data[h].rel = 0;
  }

  /** vx/vy in height units per second; scale is the ignite/retract factor */
  move(h: 'L' | 'R', x: number, y: number, vx: number, vy: number, rel: number, now: number, dt: number, H: number, scale = 1) {
    const s = this.data[h];
    s.visible = true;
    s.rel = rel;
    s.hand = { x, y };
    const speed = Math.hypot(vx, vy);
    s.dir = speed > 1e-4 ? [vx / speed, vy / speed] : [0, 0];
    const rest = -Math.PI / 2 + (h === 'L' ? -0.35 : 0.35) + Math.sin(now / 900 + (h === 'L' ? 0 : 2)) * 0.06;
    const want = speed > 0.8 ? Math.atan2(vy, vx) : rest;
    let d = want - s.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    s.angle += d * Math.min(1, dt * (speed > 0.8 ? 16 : 6));
    const len = H * 0.17 * Math.max(0.02, scale);
    s.tip = { x: x + Math.cos(s.angle) * len, y: y + Math.sin(s.angle) * len };
    s.tipPts.push({ ...s.tip, t: now });
    while (s.tipPts.length && now - s.tipPts[0].t > TRAIL_MS) s.tipPts.shift();

    if (rel > TUNING.fruit.sliceRel * 1.15 && now - this.lastWhoosh[h] > 380) {
      this.lastWhoosh[h] = now;
      sfx.whoosh();
    }
    if (rel > TUNING.fruit.sliceRel * 0.8) {
      const st = this.style;
      this.juice.burst({
        x: s.tip.x, y: s.tip.y, count: 1,
        kind: st.trail === 'star' ? 'shard' : st.trail === 'petal' ? 'dust' : 'spark',
        color: [h === 'L' ? st.colL : st.colR, ...st.ember],
        speed: H * (st.trail === 'star' ? 0.09 : 0.05),
        gravity: H * (st.trail === 'petal' ? 0.12 : 0.3),
        size: H * (st.trail === 'petal' ? 0.006 : 0.0045),
        life: st.trail === 'petal' ? 0.8 : 0.5,
      });
    }
  }

  draw(ctx: Ctx, H: number, now: number, scale = 1) {
    for (const key of ['L', 'R'] as const) {
      const s = this.data[key];
      if (!s.visible || !s.hand) continue;
      const col = key === 'L' ? this.style.colL : this.style.colR;
      const deep = key === 'L' ? this.style.deepL : this.style.deepR;
      const { x, y } = s.hand;
      const a = s.angle;
      const dx = Math.cos(a), dy = Math.sin(a);
      const len = H * 0.17 * Math.max(0.02, scale);
      const hot = Math.min(1, s.rel / (TUNING.fruit.sliceRel * 1.6));

      if (s.tipPts.length >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pts = s.tipPts;
        for (const [width, alpha, color] of [
          [0.022, 0.14, col],
          [0.011, 0.34, col],
          [0.0045, 0.7, '#ffffff'],
        ] as const) {
          for (let c = 0; c < 3; c++) {
            const i0 = Math.floor((c / 3) * (pts.length - 1));
            const i1 = Math.floor(((c + 1) / 3) * (pts.length - 1));
            if (i1 <= i0) continue;
            const k = (c + 1) / 3;
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha * (0.25 + 0.75 * k) * (0.35 + hot * 0.65);
            ctx.lineWidth = Math.max(1, H * width * (0.4 + 0.6 * k));
            ctx.beginPath();
            ctx.moveTo(pts[i0].x, pts[i0].y);
            for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#231b3d';
      ctx.lineWidth = H * 0.013;
      ctx.beginPath();
      ctx.moveTo(x - dx * H * 0.035, y - dy * H * 0.035);
      ctx.lineTo(x + dx * H * 0.012, y + dy * H * 0.012);
      ctx.stroke();
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = H * 0.007;
      ctx.beginPath();
      ctx.moveTo(x + dx * H * 0.014 - dy * H * 0.016, y + dy * H * 0.014 + dx * H * 0.016);
      ctx.lineTo(x + dx * H * 0.014 + dy * H * 0.016, y + dy * H * 0.014 - dx * H * 0.016);
      ctx.stroke();
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(x - dx * H * 0.038, y - dy * H * 0.038, H * 0.005, 0, Math.PI * 2);
      ctx.fill();

      const bx = x + dx * H * 0.02, by = y + dy * H * 0.02;
      for (const [frac, width, alpha, color] of [
        [1, 0.03, 0.16 + hot * 0.1, col],
        [1, 0.014, 0.55, col],
        [0.55, 0.011, 0.7, deep],
        [1, 0.005, 0.95, '#ffffff'],
      ] as const) {
        for (let seg = 0; seg < 3; seg++) {
          const f0 = (seg / 3) * frac, f1 = ((seg + 1) / 3) * frac;
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(1, H * width * (1 - seg * 0.24));
          ctx.beginPath();
          ctx.moveTo(bx + dx * (len - H * 0.02) * f0, by + dy * (len - H * 0.02) * f0);
          ctx.lineTo(bx + dx * (len - H * 0.02) * f1, by + dy * (len - H * 0.02) * f1);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      drawGlow(ctx, s.tip.x, s.tip.y, H * (0.02 + hot * 0.015), col, 0.6 + hot * 0.4);
      drawGlow(ctx, x + dx * len * 0.55, y + dy * len * 0.55, H * 0.028, col, 0.18 + hot * 0.15);
    }
  }
}
