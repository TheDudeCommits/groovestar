// Beat Blade — notes fly down a runway on the beat of any YouTube song; slice
// them with the matching hand as they cross the hit line. Left hand cyan,
// right hand gold. Uses the same beat clock as the dance mode.

import { drawSky, flashText, type Game, type Ctx, type TrackerLike } from './shared';

export interface BeatClockLike { beat(): number; readonly finished: boolean }

interface Note {
  beat: number;
  hand: 'L' | 'R';
  high: boolean;
  state: 'live' | 'hit' | 'miss';
  hitAt: number;
}

export interface BeatBladeOpts {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  tracker: TrackerLike;
  cameraOk: boolean;
  clock: BeatClockLike;
  totalBeats: number;
  seed: string;
  onExit: (score: number, label?: string) => void;
}

const APPROACH = 5;         // beats visible ahead
const WINDOW = 0.42;        // hit window in beats

export class BeatBladeGame implements Game {
  private notes: Note[] = [];
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private hits = 0;
  private judg = { text: '', color: '#fff', t: 0 };
  private blades: Record<'L' | 'R', { pts: { x: number; y: number; t: number }[] }> = { L: { pts: [] }, R: { pts: [] } };
  private raf = 0;
  private over = false;
  private lastT = performance.now();

  constructor(private o: BeatBladeOpts) {
    // seeded chart: one note most beats, doubles on every 8th, rests each 16th
    let a = 0;
    for (const ch of o.seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    for (let b = 8; b < o.totalBeats - 4; b++) {
      const inBar = b % 16;
      if (inBar === 15) continue;                       // breathing room
      if (rnd() < 0.22) continue;
      const hand: 'L' | 'R' = rnd() < 0.5 ? 'L' : 'R';
      this.notes.push({ beat: b, hand, high: rnd() < 0.45, state: 'live', hitAt: 0 });
      if (inBar % 8 === 0 && rnd() < 0.5) {
        this.notes.push({ beat: b, hand: hand === 'L' ? 'R' : 'L', high: rnd() < 0.45, state: 'live', hitAt: 0 });
      }
    }
  }

  start() {
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private frame() {
    const { ctx, tracker, clock } = this.o;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const beat = clock.beat();
    tracker.update();

    // blades
    if (this.o.cameraOk) {
      const pts = tracker.latest.points;
      if (pts) {
        this.feed('L', pts[4].x * this.W, pts[4].y * this.H, now);
        this.feed('R', pts[5].x * this.W, pts[5].y * this.H, now);
      }
    }

    // hit detection: blade speed + position near the note's lane row when in window
    for (const n of this.notes) {
      if (n.state !== 'live') continue;
      const d = beat - n.beat;
      if (d > WINDOW) { n.state = 'miss'; this.combo = 0; this.judge('MISS', '#ff5d5d'); continue; }
      if (d < -WINDOW) continue;
      if (this.o.cameraOk) {
        const b = this.blades[n.hand].pts;
        if (b.length >= 2) {
          const p1 = b[b.length - 2], p2 = b[b.length - 1];
          const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y) / Math.max(8, p2.t - p1.t) * 1000;
          const [nx, ny] = this.notePos(n, beat);
          const distOk = Math.hypot(p2.x - nx, p2.y - ny) < this.H * 0.16;
          if (speed > this.H * 0.55 && distOk) this.hit(n, d);
        }
      } else if (d >= -0.05) {
        this.hit(n, d);   // demo: perfect autoplay
      }
    }
    this.judg.t = Math.max(0, this.judg.t - dt);

    this.draw(ctx, beat, now);

    if ((beat > this.o.totalBeats || clock.finished) && !this.over) {
      this.over = true;
      this.stop();
      const best = Number(localStorage.getItem('gs-blade-best') ?? 0);
      if (this.score > best) localStorage.setItem('gs-blade-best', String(this.score));
      const total = this.notes.length;
      this.o.onExit(this.score, `${this.hits} of ${total} notes, best combo ${this.bestCombo}`);
    }
  }

  private feed(k: 'L' | 'R', x: number, y: number, t: number) {
    const b = this.blades[k].pts;
    b.push({ x, y, t });
    while (b.length && t - b[0].t > 150) b.shift();
  }

  private hit(n: Note, d: number) {
    n.state = 'hit';
    n.hitAt = performance.now();
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const perfect = Math.abs(d) < 0.15;
    this.score += (perfect ? 15 : 8) + Math.min(15, this.combo);
    this.judge(perfect ? 'PERFECT' : 'GOOD', perfect ? '#ffd23e' : '#7cf95c');
  }

  private judge(text: string, color: string) { this.judg = { text, color, t: 0.6 }; }

  /** note position on the runway for the current beat */
  private notePos(n: Note, beat: number): [number, number, number] {
    const w = this.W, h = this.H;
    const d = n.beat - beat;                    // beats until hit
    const z = Math.max(0, Math.min(1, d / APPROACH));
    const persp = 1 - 0.88 * z;
    const laneX = n.hand === 'L' ? -0.5 : 0.5;
    const x = w / 2 + laneX * w * 0.19 * (0.25 + persp * 0.75) * 2;
    const rowY = n.high ? 0.42 : 0.62;
    const y = h * (0.3 + (rowY - 0.3) * persp);
    return [x, y, persp];
  }

  private draw(ctx: Ctx, beat: number, now: number) {
    const w = this.W, h = this.H;
    drawSky(ctx, w, h);
    // runway
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    for (const lx of [-2, -0.9, 0.9, 2]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + lx * w * 0.04, h * 0.3);
      ctx.lineTo(w / 2 + lx * w * 0.24, h * 0.95);
      ctx.stroke();
    }
    // beat pulse rings on the hit line
    const pulse = 1 - (beat % 1);
    const hitY = h * 0.62;
    for (const laneX of [-1, 1]) {
      const x = w / 2 + laneX * w * 0.19;
      ctx.strokeStyle = laneX < 0 ? 'rgba(110,231,255,0.5)' : 'rgba(255,210,62,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, hitY, h * 0.055, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = laneX < 0 ? `rgba(110,231,255,${pulse * 0.35})` : `rgba(255,210,62,${pulse * 0.35})`;
      ctx.beginPath(); ctx.arc(x, hitY, h * 0.055 + pulse * h * 0.02, 0, Math.PI * 2); ctx.stroke();
    }

    // notes far → near
    const visible = this.notes
      .filter((n) => n.beat - beat > -0.8 && n.beat - beat < APPROACH)
      .sort((a, b) => b.beat - a.beat);
    for (const n of visible) {
      const [x, y, p] = this.notePos(n, beat);
      const s = h * 0.052 * (0.35 + p * 0.65);
      ctx.save();
      if (n.state === 'hit') {
        const k = Math.min(1, (now - n.hitAt) / 260);
        ctx.globalAlpha = 1 - k;
        ctx.translate(x, y);
        ctx.rotate(k * 0.9);
        ctx.scale(1 + k, 1 + k);
        ctx.translate(-x, -y);
      } else if (n.state === 'miss') {
        ctx.globalAlpha = 0.25;
      }
      const col = n.hand === 'L' ? '#6ee7ff' : '#ffd23e';
      const grad = ctx.createLinearGradient(x, y - s, x, y + s);
      grad.addColorStop(0, col);
      grad.addColorStop(1, n.hand === 'L' ? '#2a8ab8' : '#d9861f');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.3);
      ctx.fill();
      // arrow: high notes point up, low notes point down
      ctx.fillStyle = 'rgba(20,14,40,0.75)';
      ctx.beginPath();
      if (n.high) {
        ctx.moveTo(x, y - s * 0.45);
        ctx.lineTo(x - s * 0.42, y + s * 0.3);
        ctx.lineTo(x + s * 0.42, y + s * 0.3);
      } else {
        ctx.moveTo(x, y + s * 0.45);
        ctx.lineTo(x - s * 0.42, y - s * 0.3);
        ctx.lineTo(x + s * 0.42, y - s * 0.3);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // blades
    for (const k of ['L', 'R'] as const) {
      const p = this.blades[k].pts;
      if (p.length < 2) continue;
      const col = k === 'L' ? '#6ee7ff' : '#ffd23e';
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < p.length; i++) {
        const age = (now - p[i].t) / 150;
        ctx.strokeStyle = col;
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.lineWidth = (1 - age) * h * 0.013 + 1.5;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(p[i - 1].x, p[i - 1].y);
        ctx.lineTo(p[i].x, p[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.judg.t > 0) flashText(ctx, w, h, this.judg.text, this.judg.color, Math.min(1, this.judg.t * 2), 0.7);
    if (this.combo >= 5) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd23e';
      ctx.font = `400 ${h * 0.04}px 'Lilita One', sans-serif`;
      ctx.fillText(`x${this.combo}`, w * 0.96, h * 0.16);
      ctx.restore();
    }
    // score
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), w * 0.045, h * 0.1);
    ctx.restore();
  }
}
