// Beat Blade — the VR-benchmark pass. A near-black arena tinted by the
// song's own palette: laser rods radiating from the vanishing point, a neon
// highway with beat-grid lines rolling at you, the music video floating as a
// jumbotron above the horizon, glossy 3D note cubes with glowing arrows that
// split along your actual cut, lightsaber blades with hum and swept light
// planes, a floating multiplier ring, and strobes that go harder the longer
// your streak. Notes and cuts are matched to the mirrored hands: left saber
// cuts left-lane notes.

import { TUNING } from './tuning';
import { Juice, drawGlow } from './juice';
import { sfx } from './sfx';
import { Sabers } from './saber';
import { flashText, type Game, type Ctx, type TrackerLike } from './shared';
import type { HandRig } from '../pose/rig';

export interface BeatClockLike { beat(): number; readonly finished: boolean }

type Dir = 0 | 1 | 2 | 3;              // down, up, left, right
const DIR_VEC: [number, number][] = [[0, 1], [0, -1], [-1, 0], [1, 0]];

interface Note {
  beat: number;
  hand: 'L' | 'R';
  side: -1 | 1;
  high: boolean;
  dir: Dir;
  state: 'live' | 'hit' | 'miss';
  hitAt: number;
  perfect: boolean;
  cutAngle: number;
}

export interface BeatBladeOpts {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  tracker: TrackerLike;
  cameraOk: boolean;
  clock: BeatClockLike;
  totalBeats: number;
  seed: string;
  rig?: HandRig;
  /** environment tint from the video's palette; deep red fallback */
  accent?: string;
  onExit: (score: number, label?: string) => void;
}

const APPROACH = 4;
const WINDOW = 0.45;
const PERFECT = 0.18;
/** the floating video screen (fractions of view) — main.ts bounds must match */
export const VIDEO_WIN = { x: 0.30, y: 0.08, w: 0.40, h: 0.24 };

export class BeatBladeGame implements Game {
  private notes: Note[] = [];
  private juice = new Juice();
  private sabers: Sabers;
  private accent: string;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private hits = 0;
  private perfects = 0;
  private misses = 0;
  private hp = 0.7;
  private judg = { text: '', color: '#fff', t: 0 };
  private raf = 0;
  private over = false;
  private outroT = 0;
  private lastT = performance.now();
  private demo = { L: 0, R: Math.PI };

  constructor(private o: BeatBladeOpts) {
    this.sabers = new Sabers(this.juice);
    this.accent = o.accent ?? '#ff3b57';
    this.buildChart();
  }

  private buildChart() {
    let a = 2166136261 >>> 0;
    for (const ch of this.o.seed) { a ^= ch.charCodeAt(0); a = Math.imul(a, 16777619); }
    let st = a >>> 0;
    const rnd = () => {
      st = (st + 0x6d2b79f5) >>> 0;
      let t = Math.imul(st ^ (st >>> 15), 1 | st);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const dirRun: Record<'L' | 'R', Dir> = { L: 0, R: 0 };
    const total = this.o.totalBeats;
    let lastHand: 'L' | 'R' = rnd() < 0.5 ? 'L' : 'R';
    for (let b = 8; b < total - 4; b++) {
      if (b % 16 === 15) continue;
      const prog = b / total;
      const density = 0.5 + prog * 0.34;
      if (rnd() > density) continue;
      lastHand = rnd() < 0.72 ? (lastHand === 'L' ? 'R' : 'L') : lastHand;
      const hand = lastHand;
      if (rnd() < 0.35) {
        const roll = rnd();
        dirRun[hand] = roll < 0.45 ? 0 : roll < 0.6 ? 1 : roll < 0.8 ? 2 : 3;
      }
      const cross = prog > 0.33 && rnd() < 0.12;
      const side: -1 | 1 = cross ? (hand === 'L' ? 1 : -1) : hand === 'L' ? -1 : 1;
      this.notes.push({ beat: b, hand, side, high: rnd() < 0.4, dir: dirRun[hand], state: 'live', hitAt: 0, perfect: false, cutAngle: 0 });
      if (b % 8 === 0 && prog > 0.15 && rnd() < 0.4) {
        const other = hand === 'L' ? 'R' : 'L';
        this.notes.push({ beat: b, hand: other, side: other === 'L' ? -1 : 1, high: rnd() < 0.4, dir: dirRun[hand], state: 'live', hitAt: 0, perfect: false, cutAngle: 0 });
      }
    }
  }

  start() {
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.sabers.dispose();
  }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private mult(): number { return 1 + Math.min(3, Math.floor(this.combo / 10)); }

  private frame() {
    const { ctx, tracker, clock } = this.o;
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const dt = this.juice.step(rawDt);
    const beat = clock.beat();
    tracker.update();
    this.readHands(now, dt, beat);

    if (this.outroT <= 0) {
      for (const n of this.notes) {
        if (n.state !== 'live') continue;
        const d = beat - n.beat;
        if (d > WINDOW) { this.missNote(n); continue; }
        if (d < -WINDOW) continue;
        this.tryHit(n, d, now);
      }
    }

    this.judg.t = Math.max(0, this.judg.t - rawDt);
    this.juice.update(dt);
    this.draw(ctx, beat, now);

    const done = beat > this.o.totalBeats || clock.finished;
    if (done && !this.over) {
      if (this.outroT === 0) {
        this.outroT = 1.6;
        this.juice.slowmo(0.35, 1000);
        sfx.resultsSting();
      }
      this.outroT = Math.max(0.0001, this.outroT - rawDt);
      if (this.outroT <= 0.001) {
        this.over = true;
        this.stop();
        const best = Number(localStorage.getItem('gs-blade-best') ?? 0);
        if (this.o.cameraOk && this.score > best) localStorage.setItem('gs-blade-best', String(this.score));
        const total = this.hits + this.misses;
        const acc = total ? Math.round((this.hits / total) * 100) : 0;
        const grade = this.misses === 0 && total > 0 ? 'FULL COMBO' : acc >= 95 ? 'GRADE S' : acc >= 85 ? 'GRADE A' : acc >= 70 ? 'GRADE B' : 'GRADE C';
        this.o.onExit(this.score, `${this.hits} of ${total} notes, ${acc} percent, ${grade.toLowerCase()}, best combo ${this.bestCombo}`);
      }
    }
  }

  private readHands(now: number, dt: number, beat: number) {
    const { rig, cameraOk, tracker } = this.o;
    const scale = this.bladeScale(beat);
    if (cameraOk && rig) {
      rig.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now, 4 / 3);
      for (const h of ['L', 'R'] as const) {
        const s = rig.hand(h);
        if (s && s.vis > 0.35) {
          const boost = TUNING.fruit.predictBoostMs / 1000;
          const px = (s.px + (s.vx / (4 / 3)) * boost) * this.W;
          const py = (s.py + s.vy * boost) * this.H;
          this.sabers.move(h, px, py, s.vx, s.vy, s.rel, now, dt, this.H, scale);
        } else {
          this.sabers.hide(h);
        }
      }
    } else {
      for (const h of ['L', 'R'] as const) {
        this.demo[h] += dt * 6;
        const next = this.notes.find((n) => n.state === 'live' && n.hand === h && n.beat - beat < 1.2 && n.beat - beat > -WINDOW);
        const [nx, ny] = next ? this.notePos(next, beat) : [this.W * (h === 'L' ? 0.32 : 0.68), this.H * 0.6];
        const bx = nx + Math.cos(this.demo[h]) * this.H * 0.025;
        const by = ny + Math.sin(this.demo[h]) * this.H * 0.045;
        const prev = this.sabers.data[h].hand ?? { x: bx, y: by };
        this.sabers.move(h, bx, by, (bx - prev.x) / Math.max(dt, 1e-3) / this.H, (by - prev.y) / Math.max(dt, 1e-3) / this.H, TUNING.fruit.sliceRel + 2, now, dt, this.H, scale);
      }
    }
  }

  private bladeScale(beat: number): number {
    const ease = (k: number) => k * k * (3 - 2 * k);
    const inK = beat < 0 ? Math.max(0.05, 1 + beat / 4) : 1;
    const outK = this.outroT > 0 ? Math.max(0, this.outroT / 1.6) : 1;
    return ease(inK) * ease(outK);
  }

  private tryHit(n: Note, d: number, now: number) {
    if (!this.o.cameraOk) { if (d >= -0.03) this.hitNote(n, d, now, true, Math.PI / 4); return; }
    const saber = this.sabers.data[n.hand];
    if (!saber.visible || !saber.hand) return;
    if (saber.rel < TUNING.fruit.sliceRel) return;
    const [x, y] = this.notePos(n, this.o.clock.beat());
    const r = this.H * 0.055;
    let crossed = segCircle(saber.hand.x, saber.hand.y, saber.tip.x, saber.tip.y, x, y, r);
    if (!crossed) {
      const pts = saber.tipPts;
      for (let i = pts.length - 1; i >= 1; i--) {
        if (now - pts[i].t > 90) break;
        if (segCircle(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, x, y, r)) { crossed = true; break; }
      }
    }
    if (!crossed) return;
    const want = DIR_VEC[n.dir];
    const dot = saber.dir[0] * want[0] + saber.dir[1] * want[1];
    if (dot < 0.2) return;
    this.hitNote(n, d, now, Math.abs(d) < PERFECT && dot > 0.7, Math.atan2(saber.dir[1], saber.dir[0]));
  }

  private hitNote(n: Note, d: number, now: number, perfect: boolean, cutAngle: number) {
    n.state = 'hit';
    n.hitAt = now;
    n.perfect = perfect;
    n.cutAngle = cutAngle;
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (perfect) this.perfects++;
    this.hp = Math.min(1, this.hp + 0.02);
    const pts = (perfect ? 15 : 8) * this.mult();
    this.score += pts;
    const [x, y] = this.notePos(n, this.o.clock.beat());
    const col = n.hand === 'L' ? this.sabers.style.colL : this.sabers.style.colR;
    this.juice.burst({
      x, y, count: perfect ? 16 : 10, kind: 'shard', color: [col, '#fff7ee'],
      angle: cutAngle, spread: 0.9,
      speed: this.H * 0.5, gravity: this.H * 0.35, size: this.H * 0.009, life: 0.5,
    });
    this.juice.ring(x, y, col, this.H * (perfect ? 0.13 : 0.09), 0.3);
    this.juice.pop(x, y - this.H * 0.05, String(pts), perfect ? '#ffd23e' : 'rgba(255,247,238,0.85)', perfect ? 0.85 : 0.65);
    if (perfect) this.juice.hitStop(25);
    sfx.slice(this.combo);
    this.judge(perfect ? 'PERFECT' : 'GOOD', perfect ? '#ffd23e' : '#7cf95c');
    if (this.combo === 25 || this.combo === 50 || this.combo === 100) {
      this.juice.slowmo(0.45, 400);
      sfx.fanfare(this.combo >= 50);
      this.judge(`${this.combo} COMBO`, '#ff6ac1');
    }
  }

  private missNote(n: Note) {
    n.state = 'miss';
    this.misses++;
    this.combo = 0;
    this.hp = Math.max(0, this.hp - 0.07);
    this.judge('MISS', '#ff5d5d');
    sfx.miss();
  }

  private judge(text: string, color: string) { this.judg = { text, color, t: 0.55 }; }

  // ---- rendering ------------------------------------------------------------

  private vp(): [number, number] { return [this.W / 2, this.H * 0.37]; }

  private notePos(n: Note, beat: number): [number, number, number] {
    const w = this.W, h = this.H;
    const d = n.beat - beat;
    const z = Math.max(0, Math.min(1, d / APPROACH));
    const persp = 1 - 0.88 * z;
    const x = w / 2 + n.side * w * 0.17 * (0.3 + persp * 0.7) * 1.6;
    const rowY = n.high ? 0.5 : 0.68;
    const y = h * (0.37 + (rowY - 0.37) * persp);
    return [x, y, persp];
  }

  private draw(ctx: Ctx, beat: number, now: number) {
    const w = this.W, h = this.H;
    const [vpx, vpy] = this.vp();
    const heat = Math.min(1, this.combo / 40);
    const pulse = beat >= 0 ? Math.max(0, 1 - (beat % 1)) : 0;
    const bar = beat >= 0 && Math.floor(beat) % 4 === 0;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    this.juice.applyShake(ctx);

    // near-black world with the video window kept translucent (jumbotron)
    const vx = w * VIDEO_WIN.x, vy = h * VIDEO_WIN.y, vw = w * VIDEO_WIN.w, vh = h * VIDEO_WIN.h;
    ctx.fillStyle = '#060410';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(vx, vy, vw, vh);
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(6,4,16,0.22)';
    ctx.fillRect(vx, vy, vw, vh);

    // vanishing-point back glow, breathing with the beat
    drawGlow(ctx, vpx, vpy, h * (0.5 + pulse * 0.06 + heat * 0.12), this.accent, 0.3 + pulse * 0.14 + heat * 0.1);

    // laser rods radiating from the vanishing point
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2) / 5;
      const angBase = Math.PI / 2 + side * (0.5 + k * 1.75);
      const sway = Math.sin(now / 2600 + i) * 0.05 * (1 + heat);
      const ang = angBase + sway;
      const groupPulse = (Math.floor(beat) + i) % 2 === 0 ? pulse : 1 - pulse;
      const alpha = 0.06 + groupPulse * (0.14 + heat * 0.14);
      const x2 = vpx + Math.cos(ang) * h * 1.4;
      const y2 = vpy - Math.abs(Math.sin(ang)) * h * 1.1 + (i % 3) * h * 0.14;
      const sx = vpx + Math.cos(ang) * h * 0.03;
      const sy = vpy - Math.abs(Math.sin(ang)) * h * 0.03;
      for (const [lw, la] of [[0.012, alpha * 0.5], [0.004, alpha]] as const) {
        ctx.strokeStyle = this.accent;
        ctx.globalAlpha = la;
        ctx.lineWidth = h * lw;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // the highway: converging rails + rolling beat grid
    const spread = w * 0.30;
    const railTop = 0.06;
    ctx.save();
    // floor shade
    const floor = ctx.createLinearGradient(0, vpy, 0, h);
    floor.addColorStop(0, 'rgba(10,7,26,0)');
    floor.addColorStop(1, 'rgba(14,9,34,0.9)');
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.moveTo(vpx - spread * railTop, vpy);
    ctx.lineTo(vpx - spread, h);
    ctx.lineTo(vpx + spread, h);
    ctx.lineTo(vpx + spread * railTop, vpy);
    ctx.closePath();
    ctx.fill();
    // beat grid lines rolling at the player, brighter as they arrive
    for (let k = 0; k < APPROACH + 1; k++) {
      const bz = beat >= 0 ? k + 1 - (beat % 1) : k;
      const z = bz / APPROACH;
      if (z > 1 || z < 0) continue;
      const persp = 1 - 0.88 * z;
      const y = vpy + (h - vpy) * persp * 0.92;
      const half = spread * (railTop + (1 - railTop) * persp);
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = (1 - z) * (0.42 + heat * 0.25);
      ctx.lineWidth = Math.max(1, h * 0.0028 * (0.3 + persp));
      ctx.beginPath();
      ctx.moveTo(vpx - half, y);
      ctx.lineTo(vpx + half, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // rails: white core over accent glow
    for (const side of [-1, 1] as const) {
      for (const [lw, color, alpha] of [
        [0.014, this.accent, 0.35],
        [0.007, this.accent, 0.7],
        [0.0028, '#ffffff', 0.95],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = h * lw;
        ctx.beginPath();
        ctx.moveTo(vpx + side * spread * railTop, vpy);
        ctx.lineTo(vpx + side * spread, h);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // vertical light towers marching along the edges
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, group] of [[0.045, 0], [0.1, 1], [0.9, 1], [0.955, 0]] as const) {
      const tp = (Math.floor(beat) + group) % 2 === 0 ? pulse : 1 - pulse;
      const tx = w * fx;
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.12 + tp * (0.2 + heat * 0.2);
      ctx.lineWidth = h * 0.008;
      ctx.beginPath();
      ctx.moveTo(tx, h * (0.12 + 0.06 * group));
      ctx.lineTo(tx, h * (0.75 - 0.08 * group));
      ctx.stroke();
      ctx.globalAlpha = 0.5 + tp * 0.4;
      ctx.lineWidth = h * 0.0025;
      ctx.stroke();
    }
    ctx.restore();

    // jumbotron neon frame
    ctx.save();
    ctx.strokeStyle = this.accent;
    ctx.globalAlpha = 0.6 + pulse * 0.3;
    ctx.lineWidth = Math.max(1.5, h * 0.0035);
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.restore();
    drawGlow(ctx, vpx, vy + vh, vw * 0.35, this.accent, 0.1 + pulse * 0.08);

    // high-combo strobe on bar starts
    if (heat > 0.5 && bar && pulse > 0.85) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.accent;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // notes far to near
    const visible = this.notes
      .filter((n) => n.beat - beat > -0.9 && n.beat - beat < APPROACH)
      .sort((a, b) => b.beat - a.beat);
    for (const n of visible) this.drawNote(ctx, n, beat, now);

    this.juice.draw(ctx, h);
    this.sabers.draw(ctx, h, now, this.bladeScale(beat));
    ctx.restore();

    if (beat < 0) flashText(ctx, w, h, String(Math.max(1, Math.ceil(-beat))), '#ffd23e', 0.9, 0.9);
    if (this.judg.t > 0) flashText(ctx, w, h, this.judg.text, this.judg.color, Math.min(1, this.judg.t * 2.2), 0.6);
    if (this.o.cameraOk && this.o.rig && !this.o.rig.hasPose) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,247,238,0.7)';
      ctx.font = `700 ${h * 0.022}px 'Baloo 2', sans-serif`;
      ctx.fillText('Step back so the camera can see you', w / 2, h * 0.5);
      ctx.restore();
    }
    this.drawHud(ctx, w, h, beat);
  }

  /** glossy pseudo-3D cube with a glowing arrow; splits along the cut */
  private drawNote(ctx: Ctx, n: Note, beat: number, now: number) {
    const [x, y, p] = this.notePos(n, beat);
    const h = this.H;
    const s = h * 0.066 * (0.3 + p * 0.7);
    const col = n.hand === 'L' ? this.sabers.style.colL : this.sabers.style.colR;
    const deep = n.hand === 'L' ? this.sabers.style.deepL : this.sabers.style.deepR;
    const [vpx, vpy] = this.vp();

    if (n.state === 'miss') {
      ctx.save();
      ctx.globalAlpha = 0.18;
      this.cubeBody(ctx, x, y, s, col, deep, vpx, vpy, p);
      ctx.restore();
      return;
    }

    if (n.state === 'hit') {
      // two halves fly apart along the cut normal
      const k = Math.min(1, (now - n.hitAt) / 300);
      const nx = Math.cos(n.cutAngle + Math.PI / 2), ny = Math.sin(n.cutAngle + Math.PI / 2);
      for (const half of [-1, 1] as const) {
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.95;
        ctx.translate(nx * half * k * s * 1.6, ny * half * k * s * 1.6 + k * k * s * 0.9);
        ctx.translate(x, y);
        ctx.rotate(half * k * 0.35);
        ctx.translate(-x, -y);
        // clip to the half-plane on this side of the cut line
        ctx.beginPath();
        const big = s * 4;
        ctx.moveTo(x - Math.cos(n.cutAngle) * big + nx * half * 0.5, y - Math.sin(n.cutAngle) * big + ny * half * 0.5);
        ctx.lineTo(x + Math.cos(n.cutAngle) * big, y + Math.sin(n.cutAngle) * big);
        ctx.lineTo(x + Math.cos(n.cutAngle) * big + nx * half * big, y + Math.sin(n.cutAngle) * big + ny * half * big);
        ctx.lineTo(x - Math.cos(n.cutAngle) * big + nx * half * big, y - Math.sin(n.cutAngle) * big + ny * half * big);
        ctx.closePath();
        ctx.clip();
        this.cubeBody(ctx, x, y, s, col, deep, vpx, vpy, p);
        this.cubeArrow(ctx, x, y, s, n.dir);
        ctx.restore();
      }
      // white cut flash
      const fa = Math.max(0, 1 - k * 2.2);
      if (fa > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = fa;
        ctx.lineCap = 'round';
        ctx.lineWidth = h * 0.006;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(n.cutAngle) * s * 1.8, y - Math.sin(n.cutAngle) * s * 1.8);
        ctx.lineTo(x + Math.cos(n.cutAngle) * s * 1.8, y + Math.sin(n.cutAngle) * s * 1.8);
        ctx.stroke();
        ctx.restore();
        drawGlow(ctx, x, y, s * 2.4 * fa, col, fa * 0.5);
      }
      return;
    }

    // live note: materializes at the horizon, bloom grows as it arrives
    const born = Math.min(1, (p - 0.12) * 7);
    ctx.save();
    ctx.globalAlpha = Math.max(0, born);
    drawGlow(ctx, x, y, s * (1.6 + p * 1.2), col, (0.18 + p * 0.25) * born);
    this.cubeBody(ctx, x, y, s, col, deep, vpx, vpy, p);
    this.cubeArrow(ctx, x, y, s, n.dir);
    ctx.restore();
    // crossover warning rim
    if (n.side === (n.hand === 'L' ? 1 : -1)) {
      ctx.strokeStyle = '#fff7ee';
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.setLineDash([s * 0.3, s * 0.22]);
      ctx.strokeRect(x - s * 1.22, y - s * 1.22, s * 2.44, s * 2.44);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  private cubeBody(ctx: Ctx, x: number, y: number, s: number, col: string, deep: string, vpx: number, vpy: number, p: number) {
    // extrusion runs away from the viewer toward the vanishing point
    const ex = (vpx - x) * 0.085 * (1 - p * 0.45);
    const ey = (vpy - y) * 0.085 * (1 - p * 0.45);
    const r = s * 0.24;
    // back face extrusion (top/side)
    ctx.fillStyle = shade(deep, 0.55);
    ctx.beginPath();
    ctx.roundRect(x - s + ex, y - s + ey, s * 2, s * 2, r);
    ctx.fill();
    // connect edges
    ctx.fillStyle = shade(deep, 0.75);
    ctx.beginPath();
    if (ey < 0) {
      ctx.moveTo(x - s, y - s); ctx.lineTo(x - s + ex, y - s + ey);
      ctx.lineTo(x + s + ex, y - s + ey); ctx.lineTo(x + s, y - s);
    } else {
      ctx.moveTo(x - s, y + s); ctx.lineTo(x - s + ex, y + s + ey);
      ctx.lineTo(x + s + ex, y + s + ey); ctx.lineTo(x + s, y + s);
    }
    ctx.closePath();
    ctx.fill();
    // front face: glossy gradient
    const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
    g.addColorStop(0, lightenHex(col, 1.25));
    g.addColorStop(0.5, col);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x - s, y - s, s * 2, s * 2, r);
    ctx.fill();
    // specular streak
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - s, y - s, s * 2, s * 2, r);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.2);
    ctx.lineTo(x - s * 0.2, y - s);
    ctx.lineTo(x + s * 0.35, y - s);
    ctx.lineTo(x - s * 0.55, y + s * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  /** the glowing white direction arrow, drawn over the cube face */
  private cubeArrow(ctx: Ctx, x: number, y: number, s: number, dir: Dir) {
    const want = DIR_VEC[dir];
    const aa = Math.atan2(want[1], want[0]);
    drawGlow(ctx, x, y, s * 0.9, '#ffffff', 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aa - Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.52);
    ctx.lineTo(-s * 0.46, -s * 0.18);
    ctx.lineTo(-s * 0.16, -s * 0.18);
    ctx.lineTo(-s * 0.16, -s * 0.52);
    ctx.lineTo(s * 0.16, -s * 0.52);
    ctx.lineTo(s * 0.16, -s * 0.18);
    ctx.lineTo(s * 0.46, -s * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawHud(ctx: Ctx, w: number, h: number, beat: number) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), w * 0.045, h * 0.1);
    ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`BEST ${Math.max(Number(localStorage.getItem('gs-blade-best') ?? 0), this.score)}`, w * 0.046, h * 0.135);
    const bw = w * 0.1;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(w * 0.046, h * 0.155, bw, h * 0.007);
    ctx.fillStyle = this.hp > 0.35 ? '#7cf95c' : '#ff5d5d';
    ctx.fillRect(w * 0.046, h * 0.155, bw * this.hp, h * 0.007);

    // floating multiplier ring, like the reference
    const mx = w * 0.86, my = h * 0.3, mr = h * 0.045;
    const mult = this.mult();
    const toNext = mult >= 4 ? 1 : (this.combo % 10) / 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = h * 0.005;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = mult >= 4 ? '#ffd23e' : '#fff7ee';
    ctx.beginPath(); ctx.arc(mx, my, mr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * toNext); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.03}px 'Lilita One', sans-serif`;
    ctx.fillText(`x${mult}`, mx, my + h * 0.011);
    // song progress under the ring
    const prog = Math.max(0, Math.min(1, beat / this.o.totalBeats));
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(mx - mr, my + mr + h * 0.02, mr * 2, h * 0.005);
    ctx.fillStyle = '#fff7ee';
    ctx.fillRect(mx - mr, my + mr + h * 0.02, mr * 2 * prog, h * 0.005);

    if (this.combo >= 5) {
      ctx.fillStyle = this.combo >= 25 ? '#ffd23e' : '#fff7ee';
      ctx.font = `400 ${h * 0.036}px 'Lilita One', sans-serif`;
      ctx.fillText(String(this.combo), mx, my - mr - h * 0.028);
      ctx.font = `700 ${h * 0.013}px 'Baloo 2', sans-serif`;
      ctx.fillStyle = 'rgba(255,247,238,0.55)';
      ctx.fillText('COMBO', mx, my - mr - h * 0.008);
    }
    ctx.restore();
  }
}

function segCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(cx - x1, cy - y1) <= r;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) <= r;
}

function lightenHex(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (sh: number) => Math.round(Math.min(255, ((v >> sh) & 255) * f));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function shade(hex: string, f: number): string {
  return lightenHex(hex, f);
}
