// Shared energy-saber rig — the lightsaber pass. A brilliant white core
// inside a saturated color sheath and a wide additive bloom, a metallic
// segmented hilt with an emitter flare, a swept light-plane trail (the arc
// your cut just carved), long thin tip streaks, embers, throttled swing
// whooshes and a live hum that rises with swing speed. Games feed hand
// positions; collision reads `hand`, `tip` and `tipPts`.

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

const TIP_TRAIL_MS = 260;
const PLANE_MS = 130;
export const BLADE_LEN = 0.21;         // fraction of view height

interface PlaneSeg { hx: number; hy: number; tx: number; ty: number; t: number }

export class Sabers {
  style: SaberStyle = saberStyle();
  data: Record<'L' | 'R', SaberState> = {
    L: { hand: null, angle: -Math.PI / 2 - 0.35, rel: 0, visible: false, tip: { x: 0, y: 0 }, tipPts: [], dir: [0, 0] },
    R: { hand: null, angle: -Math.PI / 2 + 0.35, rel: 0, visible: false, tip: { x: 0, y: 0 }, tipPts: [], dir: [0, 0] },
  };
  private plane: Record<'L' | 'R', PlaneSeg[]> = { L: [], R: [] };
  private lastWhoosh = { L: 0, R: 0 };

  constructor(private juice: Juice) {}

  hide(h: 'L' | 'R') {
    this.data[h].visible = false;
    this.data[h].rel = 0;
    sfx.saberHum(h, 0);
  }

  dispose() {
    sfx.saberHumStop();
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
    const len = H * BLADE_LEN * Math.max(0.02, scale);
    s.tip = { x: x + Math.cos(s.angle) * len, y: y + Math.sin(s.angle) * len };
    s.tipPts.push({ ...s.tip, t: now });
    while (s.tipPts.length && now - s.tipPts[0].t > TIP_TRAIL_MS) s.tipPts.shift();
    this.plane[h].push({ hx: x, hy: y, tx: s.tip.x, ty: s.tip.y, t: now });
    while (this.plane[h].length && now - this.plane[h][0].t > PLANE_MS) this.plane[h].shift();

    sfx.saberHum(h, Math.min(1, rel / 8) * Math.min(1, scale * 2));

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
      const { x, y } = s.hand;
      const a = s.angle;
      const dx = Math.cos(a), dy = Math.sin(a);
      const len = H * BLADE_LEN * Math.max(0.02, scale);
      const hot = Math.min(1, s.rel / (TUNING.fruit.sliceRel * 1.6));

      // swept light plane: the arc the blade just carved, brightest at the
      // newest edge — this is what makes fast cuts read as sheets of light
      const plane = this.plane[key];
      if (plane.length >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 1; i < plane.length; i++) {
          const p0 = plane[i - 1], p1 = plane[i];
          const age = (now - p1.t) / PLANE_MS;
          ctx.globalAlpha = Math.max(0, 1 - age) * 0.24 * (0.3 + hot * 0.7);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(p0.hx, p0.hy);
          ctx.lineTo(p0.tx, p0.ty);
          ctx.lineTo(p1.tx, p1.ty);
          ctx.lineTo(p1.hx, p1.hy);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // long thin tip streaks, like the reference's persisting light lines
      if (s.tipPts.length >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pts = s.tipPts;
        for (const [width, alpha, color] of [
          [0.008, 0.3, col],
          [0.0032, 0.8, '#ffffff'],
        ] as const) {
          for (let c = 0; c < 3; c++) {
            const i0 = Math.floor((c / 3) * (pts.length - 1));
            const i1 = Math.floor(((c + 1) / 3) * (pts.length - 1));
            if (i1 <= i0) continue;
            const k = (c + 1) / 3;
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha * (0.2 + 0.8 * k) * (0.3 + hot * 0.7);
            ctx.lineWidth = Math.max(1, H * width * (0.5 + 0.5 * k));
            ctx.beginPath();
            ctx.moveTo(pts[i0].x, pts[i0].y);
            for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // ---- the blade: bloom sheath around a white-hot core ----------------
      const bx = x + dx * H * 0.024, by = y + dy * H * 0.024;
      const blade = (frac: number, width: number, alpha: number, color: string, cap: CanvasLineCap = 'round') => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(1, H * width);
        ctx.lineCap = cap;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + dx * (len - H * 0.024) * frac, by + dy * (len - H * 0.024) * frac);
        ctx.stroke();
      };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      blade(1, 0.055, 0.1 + hot * 0.08, col);      // outer bloom
      blade(1, 0.028, 0.22 + hot * 0.1, col);      // mid bloom
      ctx.restore();
      ctx.save();
      blade(1, 0.014, 0.85, col);                   // saturated sheath
      blade(0.985, 0.0068, 0.95, '#ffffff');        // white-hot core
      // core tapers into the tip
      blade(1, 0.003, 1, '#ffffff');
      ctx.restore();
      ctx.globalAlpha = 1;
      // emitter flare + tip glow
      drawGlow(ctx, bx, by, H * (0.022 + hot * 0.008), '#ffffff', 0.5);
      drawGlow(ctx, bx, by, H * 0.036, col, 0.4 + hot * 0.2);
      drawGlow(ctx, s.tip.x, s.tip.y, H * (0.02 + hot * 0.018), col, 0.55 + hot * 0.45);
      drawGlow(ctx, x + dx * len * 0.5, y + dy * len * 0.5, H * 0.05, col, 0.12 + hot * 0.14);

      // ---- metallic hilt ---------------------------------------------------
      ctx.save();
      ctx.lineCap = 'round';
      const hb = 0.052;                             // hilt length (fraction of H)
      const grad = ctx.createLinearGradient(x - dy * H * 0.008, y + dx * H * 0.008, x + dy * H * 0.008, y - dx * H * 0.008);
      grad.addColorStop(0, '#e8ecf4');
      grad.addColorStop(0.5, '#9aa2b4');
      grad.addColorStop(1, '#565e70');
      ctx.strokeStyle = grad;
      ctx.lineWidth = H * 0.014;
      ctx.beginPath();
      ctx.moveTo(x - dx * H * hb, y - dy * H * hb);
      ctx.lineTo(x + dx * H * 0.018, y + dy * H * 0.018);
      ctx.stroke();
      // grip bands
      ctx.strokeStyle = '#231b2d';
      ctx.lineWidth = H * 0.0145;
      for (const g of [0.018, 0.032, 0.046] as const) {
        ctx.beginPath();
        ctx.moveTo(x - dx * H * g, y - dy * H * g);
        ctx.lineTo(x - dx * H * (g + 0.005), y - dy * H * (g + 0.005));
        ctx.stroke();
      }
      // activation stud
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(x - dx * H * 0.008 - dy * H * 0.009, y - dy * H * 0.008 + dx * H * 0.009, H * 0.0032, 0, Math.PI * 2);
      ctx.fill();
      // pommel
      ctx.fillStyle = '#2c2837';
      ctx.beginPath();
      ctx.arc(x - dx * H * (hb + 0.004), y - dy * H * (hb + 0.004), H * 0.0075, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
