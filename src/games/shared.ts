// Shared bits for the movement suite games.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type Ctx = CanvasRenderingContext2D;

/** what every game needs from a camera source (webcam tracker or phone cam) */
export interface TrackerLike {
  update(): void;
  latest: { points: { x: number; y: number }[] | null; energy: number };
  latestLandmarks: NormalizedLandmark[] | null;
  latestWorld?: NormalizedLandmark[] | null;
}

export interface GameOpts {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  tracker: TrackerLike;
  cameraOk: boolean;
  onExit: (score: number, label?: string) => void;
}

export interface Game {
  start(): void;
  stop(): void;
}

/** the suite's warm sky backdrop */
export function drawSky(ctx: Ctx, w: number, h: number, hueShift = 0) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, hueShift ? '#1c2a5e' : '#2a1a5e');
  sky.addColorStop(0.55, hueShift ? '#23336b' : '#3c1e63');
  sky.addColorStop(1, '#1b1140');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  for (const [gx, gy, gr, col] of [
    [0.12, 0.06, 0.5, 'rgba(255,106,193,0.14)'],
    [0.9, 0.16, 0.55, 'rgba(101,90,255,0.18)'],
    [0.5, 1.05, 0.6, 'rgba(255,170,64,0.12)'],
  ] as const) {
    const g = ctx.createRadialGradient(w * gx, h * gy, 0, w * gx, h * gy, h * gr);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

export function hudScore(ctx: Ctx, w: number, h: number, score: number, sub: string) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff7ee';
  ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
  ctx.fillText(String(score), w * 0.045, h * 0.1);
  ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
  ctx.fillStyle = 'rgba(255,247,238,0.55)';
  ctx.fillText(sub, w * 0.046, h * 0.135);
  ctx.restore();
}

export function hudTimer(ctx: Ctx, w: number, h: number, left: number, total: number) {
  const cx = w / 2, cy = h * 0.085, r = h * 0.038;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = h * 0.008;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = left < 10 ? '#ff5d5d' : '#ffd23e';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / total));
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff7ee';
  ctx.font = `400 ${h * 0.026}px 'Lilita One', sans-serif`;
  ctx.fillText(String(Math.ceil(left)), cx, cy + h * 0.01);
  ctx.restore();
}

/** big center flash text (cue words, judgments) */
export function flashText(ctx: Ctx, w: number, h: number, text: string, color: string, a: number, scale = 1) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.font = `400 ${h * 0.07 * scale}px 'Lilita One', sans-serif`;
  ctx.fillText(text, w / 2, h * 0.3);
  ctx.restore();
}
