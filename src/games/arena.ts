// Arena — the movement suite's living backdrop. A dusk valley in the house
// palette: banded synth sun low on the horizon, two drifting mountain
// silhouette layers, twinkling stars, rising lanterns and falling petals.
// The sun and horizon breathe on the music's beat; fever warms and gilds
// everything. Pure vector, no assets, cheap to draw (glow via sprites).

import { drawGlow } from './juice';

type Ctx = CanvasRenderingContext2D;

interface Petal { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number }
interface Lantern { x: number; y: number; v: number; s: number; phase: number }

/** deterministic hash noise for star placement and ridge shapes */
function n1(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Arena {
  private petals: Petal[] = [];
  private lanterns: Lantern[] = [];
  private t = 0;

  update(dt: number, w: number, h: number) {
    this.t += dt;
    if (this.petals.length === 0) {
      for (let i = 0; i < 22; i++) this.petals.push(this.newPetal(w, h, true));
      for (let i = 0; i < 5; i++) {
        this.lanterns.push({ x: (0.1 + n1(i * 7) * 0.8) * w, y: h * (0.2 + n1(i * 13) * 0.7), v: h * (0.008 + n1(i * 3) * 0.01), s: h * (0.006 + n1(i * 5) * 0.005), phase: n1(i) * 7 });
      }
    }
    for (const p of this.petals) {
      p.x += (p.vx + Math.sin(this.t * 1.3 + p.rot) * h * 0.02) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + 20 || p.x < -30 || p.x > w + 30) Object.assign(p, this.newPetal(w, h, false));
    }
    for (const l of this.lanterns) {
      l.y -= l.v * dt * 60 * 0.016;
      l.x += Math.sin(this.t * 0.7 + l.phase) * h * 0.01 * dt;
      if (l.y < -h * 0.05) { l.y = h * 1.05; l.x = (0.08 + Math.random() * 0.84) * w; }
    }
  }

  private newPetal(w: number, h: number, anywhere: boolean): Petal {
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -h * 0.03,
      vx: h * (0.01 + Math.random() * 0.03) * (Math.random() < 0.5 ? -1 : 1),
      vy: h * (0.03 + Math.random() * 0.05),
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 2.4,
      s: h * (0.005 + Math.random() * 0.005),
    };
  }

  /** beat is fractional song beats; fever 0..1 warms the palette */
  draw(ctx: Ctx, w: number, h: number, beat: number, fever: number) {
    const pulse = Math.max(0, 1 - (beat % 1));            // 1 at each beat, decays
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, blend('#241454', '#3a1a54', fever * 0.7));
    sky.addColorStop(0.5, blend('#3c1e63', '#5e2560', fever * 0.7));
    sky.addColorStop(0.82, blend('#552458', '#84393f', fever * 0.7));
    sky.addColorStop(1, '#1b1140');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // stars, twinkling on a hash
    ctx.fillStyle = '#fff7ee';
    for (let i = 0; i < 46; i++) {
      const sx = n1(i * 3.7) * w;
      const sy = n1(i * 9.1) * h * 0.45;
      const tw = 0.25 + 0.75 * Math.abs(Math.sin(this.t * (0.4 + n1(i) * 0.8) + i));
      ctx.globalAlpha = tw * 0.5;
      const r = (0.6 + n1(i * 1.3)) * h * 0.0016;
      ctx.fillRect(sx, sy, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // banded synth sun on the horizon
    const sunX = w * 0.5, sunY = h * 0.62, sunR = h * 0.21 * (1 + pulse * 0.012);
    drawGlow(ctx, sunX, sunY, sunR * 2.4, blend('#ff8a2e', '#ff6ac1', 0.4), 0.35 + pulse * 0.1 + fever * 0.2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sun.addColorStop(0, blend('#ffd23e', '#ffe9a3', fever));
    sun.addColorStop(0.55, '#ff8a2e');
    sun.addColorStop(1, '#ff6ac1');
    ctx.fillStyle = sun;
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
    // slats widen toward the bottom
    ctx.fillStyle = 'rgba(27,17,64,0.9)';
    for (let i = 0; i < 6; i++) {
      const y = sunY - sunR * 0.15 + i * sunR * 0.2;
      ctx.fillRect(sunX - sunR, y, sunR * 2, sunR * (0.02 + i * 0.016));
    }
    ctx.restore();

    // mountain silhouettes, two parallax layers
    for (const [speed, base, amp, col] of [
      [0.004, 0.72, 0.09, '#2b1a55'],
      [0.009, 0.8, 0.12, '#221244'],
    ] as const) {
      const off = this.t * speed;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * w;
        const k = i / 40 + off;
        const y = h * (base - amp * ridge(k * 6));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    // horizon haze pulsing gently with the beat
    const haze = ctx.createLinearGradient(0, h * 0.6, 0, h);
    haze.addColorStop(0, 'rgba(255,138,46,0)');
    haze.addColorStop(1, `rgba(255,138,46,${0.1 + pulse * 0.05 + fever * 0.12})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);

    // lanterns rising
    for (const l of this.lanterns) {
      drawGlow(ctx, l.x, l.y, l.s * 4, '#ffb14e', 0.5);
      ctx.fillStyle = '#ffd8a1';
      ctx.beginPath();
      ctx.ellipse(l.x, l.y, l.s * 0.7, l.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // petals, gilded during fever
    for (const p of this.petals) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = fever > 0.3 ? 'rgba(255,210,62,0.75)' : 'rgba(255,106,193,0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s * 1.5, p.s * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** layered sine ridge in 0..1 */
function ridge(k: number): number {
  return 0.5 + 0.28 * Math.sin(k) + 0.16 * Math.sin(k * 2.7 + 1.3) + 0.06 * Math.sin(k * 6.1 + 4);
}

function blend(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => {
    const va = (pa >> s) & 255, vb = (pb >> s) & 255;
    return Math.round(va + (vb - va) * Math.max(0, Math.min(1, k)));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
