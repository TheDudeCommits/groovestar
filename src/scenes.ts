// Beat-reactive background scenes. Design rules lifted from the footage:
// backgrounds stay darker than the coach, react on the beat (light geysers,
// bokeh pulses, hue-shifting fog), evolve per section, and never occlude the
// dancer. Gold Moves fire a full-screen radial sunburst.

import type { Song, SectionDef } from './songs';

export interface SceneCtx {
  ctx: CanvasRenderingContext2D;
  w: number; h: number;
  beat: number;            // fractional beat
  section: SectionDef['kind'];
  song: Song;
  goldBurst: number;       // 0..1 decaying after a gold hit
}

interface Star { x: number; y: number; s: number; tw: number }
let stars: Star[] = [];
let seededFor = '';

function seed(song: Song, w: number, h: number) {
  if (seededFor === song.id + w + h) return;
  seededFor = song.id + w + h;
  stars = [];
  let r = 1234;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rnd() * w, y: rnd() * h * 0.65, s: 0.6 + rnd() * 1.8, tw: rnd() * 6.28 });
  }
}

const beatPulse = (beat: number, decay = 3.2) => Math.exp(-((beat % 1)) * decay);

export function drawScene(s: SceneCtx) {
  seed(s.song, s.w, s.h);
  switch (s.song.scene) {
    case 'city': city(s); break;
    case 'bokeh': bokeh(s); break;
    case 'disco': disco(s); break;
  }
  if (s.goldBurst > 0.01) sunburst(s);
}

// ---------------------------------------------------------------------------
function city(s: SceneCtx) {
  const { ctx, w, h, beat } = s;
  const pulse = beatPulse(beat);
  const chorus = s.section === 'chorus' || s.section === 'outro';
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#05030f');
  g.addColorStop(0.55, chorus ? '#1b0b33' : '#140a26');
  g.addColorStop(1, '#2b1145');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // stars twinkle
  ctx.fillStyle = '#cfd8ff';
  for (const st of stars) {
    ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(st.tw + beat * 0.8));
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
  ctx.globalAlpha = 1;

  // aurora ribbon in chorus
  if (chorus) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const y = h * 0.2 + Math.sin(x * 0.004 + beat * 0.9 + i * 1.7) * h * 0.05 + i * 26;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${60 + i * 30},240,${170 - i * 40},${0.05 + 0.05 * pulse})`;
      ctx.lineWidth = 26;
      ctx.stroke();
    }
    ctx.restore();
  }

  // distant city carpet
  const horizon = h * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  let r = 99;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const px = rnd() * w;
    const depth = rnd();
    const py = horizon + depth * h * 0.3;
    const warm = rnd() > 0.4;
    ctx.fillStyle = warm ? `rgba(255,190,90,${0.12 + depth * 0.3})` : `rgba(180,120,255,${0.1 + depth * 0.28})`;
    const sz = 1 + depth * 2.2;
    ctx.fillRect(px, py, sz, sz);
  }
  ctx.restore();

  // light geysers on downbeats (chorus)
  if (chorus) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cols = 5;
    for (let i = 0; i < cols; i++) {
      const gx = w * (0.12 + (i / (cols - 1)) * 0.76) + Math.sin(i * 5 + Math.floor(beat / 4)) * 30;
      const on = (Math.floor(beat) + i) % 2 === 0;
      if (!on) continue;
      const a = 0.16 * pulse;
      const gr = ctx.createLinearGradient(0, horizon, 0, h * 0.1);
      gr.addColorStop(0, `rgba(120,240,255,${a})`);
      gr.addColorStop(1, 'rgba(120,240,255,0)');
      ctx.fillStyle = gr;
      const wdt = 14 + 20 * pulse;
      ctx.fillRect(gx - wdt / 2, h * 0.1, wdt, horizon - h * 0.1);
    }
    ctx.restore();
  }

  stage(s, horizon);
}

function bokeh(s: SceneCtx) {
  const { ctx, w, h, beat } = s;
  const pulse = beatPulse(beat);
  const chorus = s.section === 'chorus' || s.section === 'outro';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d0508');
  g.addColorStop(1, chorus ? '#33170a' : '#1c0d14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    const drift = (beat * 8 + i * 40) % (h + 200) - 100;
    const y = h - drift;
    const rr = st.s * (chorus ? 26 : 14) * (0.7 + 0.3 * Math.sin(st.tw + beat * 0.5));
    const warm = i % 3 !== 0;
    const grad = ctx.createRadialGradient(st.x, y, 0, st.x, y, rr);
    const col = warm ? '255,190,70' : '90,140,255';
    grad.addColorStop(0, `rgba(${col},${0.10 + 0.06 * pulse})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(st.x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  stage(s, h * 0.64, '#ffb347');
}

function disco(s: SceneCtx) {
  const { ctx, w, h, beat } = s;
  const pulse = beatPulse(beat);
  const bar = Math.floor(beat / 4);
  const hues = [265, 130, 320, 45, 190];
  const hue = hues[bar % hues.length];
  const chorus = s.section === 'chorus' || s.section === 'outro';

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#08050f');
  g.addColorStop(1, `hsl(${hue} 60% ${chorus ? 16 : 10}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // colored fog blobs
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const fx = w * (0.1 + 0.8 * ((i * 0.37 + Math.sin(beat * 0.12 + i) * 0.08) % 1));
    const fy = h * (0.2 + 0.32 * Math.sin(i * 2.2 + beat * 0.18));
    const rr = w * 0.16;
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, rr);
    grad.addColorStop(0, `hsla(${(hue + i * 40) % 360} 90% 55% / ${0.07 + 0.05 * pulse})`);
    grad.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(fx, fy, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // giant neon letters G R V (Y.M.C.A.-style set piece)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.font = `900 ${h * 0.34}px 'Arial Black', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letters = ['G', 'R', 'V'];
  const lcols = ['#ff5ad2', '#7cf95c', '#37e0ff'];
  letters.forEach((L, i) => {
    const lx = w * (0.22 + i * 0.28);
    const ly = h * 0.3 + Math.sin(beat * 0.5 + i) * 6;
    const on = chorus || (Math.floor(beat) % 3) === i;
    ctx.strokeStyle = lcols[i];
    ctx.globalAlpha = on ? 0.35 + 0.3 * pulse : 0.12;
    ctx.lineWidth = 5;
    ctx.shadowColor = lcols[i];
    ctx.shadowBlur = 26;
    ctx.strokeText(L, lx, ly);
  });
  ctx.restore();

  // mirror floor tiles
  const horizon = h * 0.62;
  ctx.save();
  const rows = 5, cols = 10;
  for (let rI = 0; rI < rows; rI++) {
    const t0 = rI / rows, t1 = (rI + 1) / rows;
    const y0 = horizon + t0 * t0 * (h - horizon), y1 = horizon + t1 * t1 * (h - horizon);
    for (let cI = 0; cI < cols; cI++) {
      const spread0 = 0.5 + t0 * 0.9, spread1 = 0.5 + t1 * 0.9;
      const x00 = w / 2 + (cI - cols / 2) * (w / cols) * spread0;
      const x01 = w / 2 + (cI + 1 - cols / 2) * (w / cols) * spread0;
      const x10 = w / 2 + (cI - cols / 2) * (w / cols) * spread1;
      const x11 = w / 2 + (cI + 1 - cols / 2) * (w / cols) * spread1;
      const lit = (rI + cI + Math.floor(beat)) % 4 === 0;
      const tileHue = (hue + (rI * 3 + cI * 7) * 12) % 360;
      ctx.fillStyle = lit
        ? `hsla(${tileHue} 85% ${38 + 22 * pulse}% / ${0.5 + 0.3 * pulse})`
        : `hsla(${tileHue} 40% 14% / 0.85)`;
      ctx.beginPath();
      ctx.moveTo(x00, y0); ctx.lineTo(x01, y0); ctx.lineTo(x11, y1); ctx.lineTo(x10, y1);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

/** glowing platform anchoring the coach (flower-shaped, like the reference) */
function stage(s: SceneCtx, horizon: number, color?: string) {
  const { ctx, w, h, beat } = s;
  const pulse = beatPulse(beat);
  const cx = w / 2, cy = h * 0.9;
  const R = Math.min(w * 0.34, h * 0.42);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.24);
  const col = color ?? s.song.accent;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3 + 3 * pulse;
  ctx.shadowColor = col;
  ctx.shadowBlur = 18 + 22 * pulse;
  ctx.beginPath();
  const lobes = 8;
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
    const rr = R * (0.82 + 0.18 * Math.cos(a * lobes + beat * 0.4));
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.1 + 0.08 * pulse;
  ctx.fillStyle = col;
  ctx.fill();
  ctx.restore();
}

/** full-screen gold radial rays — the Gold Move payoff */
function sunburst(s: SceneCtx) {
  const { ctx, w, h, goldBurst } = s;
  const cx = w / 2, cy = h * 0.42;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rays = 26;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + goldBurst * 0.35;
    const len = Math.max(w, h) * 1.2;
    const wdt = 0.055 + 0.05 * Math.sin(i * 3.7);
    ctx.fillStyle = `rgba(255,${200 - i % 3 * 30},60,${0.16 * goldBurst})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - wdt) * len, cy + Math.sin(a - wdt) * len);
    ctx.lineTo(cx + Math.cos(a + wdt) * len, cy + Math.sin(a + wdt) * len);
    ctx.closePath();
    ctx.fill();
  }
  // center bloom
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.5);
  g.addColorStop(0, `rgba(255,230,140,${0.5 * goldBurst})`);
  g.addColorStop(1, 'rgba(255,230,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
