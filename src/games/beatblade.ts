// Beat Blade — rebuilt on the saber stack. Notes fly down a neon runway on
// the beat of any YouTube song; you cut them with the MATCHING saber in the
// MARKED direction as they cross the hit line. Continuous detection: the
// blade's swept path must cross the note while the hand moves the right way
// at speed — no gesture events, no refractory. Pattern-grammar charts
// (streams, doubles, crossovers, rests) generated from the song's seed with
// an intensity ramp, an energy meter, milestone slow-mo, and a letter grade.

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
  side: -1 | 1;                        // runway lane; opposite of hand = crossover
  high: boolean;
  dir: Dir;
  state: 'live' | 'hit' | 'miss';
  hitAt: number;
  perfect: boolean;
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
  onExit: (score: number, label?: string) => void;
}

const APPROACH = 4;                    // beats of visibility
const WINDOW = 0.45;                   // hit window in beats
const PERFECT = 0.18;

export class BeatBladeGame implements Game {
  private notes: Note[] = [];
  private juice = new Juice();
  private sabers = new Sabers(this.juiceRef());
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private hits = 0;
  private perfects = 0;
  private misses = 0;
  private hp = 0.7;
  private judg = { text: '', color: '#fff', t: 0 };
  private milestone = 0;
  private raf = 0;
  private over = false;
  private outroT = 0;
  private lastT = performance.now();
  private demo = { L: 0, R: Math.PI };

  private juiceRef(): Juice { return (this.juice ??= new Juice()); }

  constructor(private o: BeatBladeOpts) {
    this.buildChart();
  }

  /** pattern grammar: density ramps through the song, direction runs per
   *  hand, doubles on bar starts, crossovers after the first third, one
   *  breathing rest each 16 beats */
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
      if (b % 16 === 15) continue;                       // breathing room
      const prog = b / total;
      const density = 0.5 + prog * 0.34;
      if (rnd() > density) continue;
      lastHand = rnd() < 0.72 ? (lastHand === 'L' ? 'R' : 'L') : lastHand;
      const hand = lastHand;
      // direction runs: mostly keep the current run, down-weighted new picks
      if (rnd() < 0.35) {
        const roll = rnd();
        dirRun[hand] = roll < 0.45 ? 0 : roll < 0.6 ? 1 : roll < 0.8 ? 2 : 3;
      }
      const cross = prog > 0.33 && rnd() < 0.12;
      const side: -1 | 1 = cross ? (hand === 'L' ? 1 : -1) : hand === 'L' ? -1 : 1;
      this.notes.push({ beat: b, hand, side, high: rnd() < 0.4, dir: dirRun[hand], state: 'live', hitAt: 0, perfect: false });
      // doubles on bar starts, both hands, mirrored directions
      if (b % 8 === 0 && prog > 0.15 && rnd() < 0.4) {
        const other = hand === 'L' ? 'R' : 'L';
        this.notes.push({ beat: b, hand: other, side: other === 'L' ? -1 : 1, high: rnd() < 0.4, dir: dirRun[hand], state: 'live', hitAt: 0, perfect: false });
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
    const rawDt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const dt = this.juice.step(rawDt);
    const beat = clock.beat();
    tracker.update();
    this.readHands(now, dt, beat);

    // judge notes
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
        sfx.bell();
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
      // demo: sabers sweep through upcoming notes
      for (const h of ['L', 'R'] as const) {
        this.demo[h] += dt * 6;
        const next = this.notes.find((n) => n.state === 'live' && n.hand === h && n.beat - beat < 1.2 && n.beat - beat > -WINDOW);
        const [nx, ny] = next ? this.notePos(next, beat) : [this.W * (h === 'L' ? 0.32 : 0.68), this.H * 0.55];
        const bx = nx + Math.cos(this.demo[h]) * this.H * 0.06;
        const by = ny + Math.sin(this.demo[h]) * this.H * 0.06;
        const prev = this.sabers.data[h].hand ?? { x: bx, y: by };
        this.sabers.move(h, bx, by, (bx - prev.x) / Math.max(dt, 1e-3) / this.H, (by - prev.y) / Math.max(dt, 1e-3) / this.H, TUNING.fruit.sliceRel + 2, now, dt, this.H, scale);
      }
    }
  }

  /** blades ignite over the count-in and retract during the outro */
  private bladeScale(beat: number): number {
    const ease = (k: number) => k * k * (3 - 2 * k);
    const inK = beat < 0 ? Math.max(0.05, 1 + beat / 4) : 1;
    const outK = this.outroT > 0 ? Math.max(0, this.outroT / 1.6) : 1;
    return ease(inK) * ease(outK);
  }

  private tryHit(n: Note, d: number, now: number) {
    const saber = this.sabers.data[n.hand];
    if (!saber.visible || !saber.hand) {
      if (!this.o.cameraOk && d >= -0.03) this.hitNote(n, d, now, true);
      return;
    }
    if (!this.o.cameraOk) { if (d >= -0.03) this.hitNote(n, d, now, true); return; }
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
    if (dot < 0.2) return;                          // cut the marked way
    this.hitNote(n, d, now, Math.abs(d) < PERFECT && dot > 0.7);
  }

  private hitNote(n: Note, d: number, now: number, perfect: boolean) {
    n.state = 'hit';
    n.hitAt = now;
    n.perfect = perfect;
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (perfect) this.perfects++;
    this.hp = Math.min(1, this.hp + 0.02);
    this.score += (perfect ? 15 : 8) + Math.min(15, this.combo);
    const [x, y] = this.notePos(n, this.o.clock.beat());
    const col = n.hand === 'L' ? this.sabers.style.colL : this.sabers.style.colR;
    const want = DIR_VEC[n.dir];
    this.juice.burst({
      x, y, count: perfect ? 14 : 9, kind: 'shard', color: [col, '#fff7ee'],
      angle: Math.atan2(want[1], want[0]), spread: 1.1,
      speed: this.H * 0.45, gravity: this.H * 0.35, size: this.H * 0.009, life: 0.5,
    });
    this.juice.ring(x, y, col, this.H * (perfect ? 0.12 : 0.08), 0.3);
    if (perfect) this.juice.hitStop(25);
    sfx.slice(this.combo);
    this.judge(perfect ? 'PERFECT' : 'GOOD', perfect ? '#ffd23e' : '#7cf95c');
    // milestone celebrations
    if (this.combo === 25 || this.combo === 50 || this.combo === 100) {
      this.milestone = this.combo;
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

  /** runway position: side lane, high/low row, perspective approach */
  private notePos(n: Note, beat: number): [number, number, number] {
    const w = this.W, h = this.H;
    const d = n.beat - beat;
    const z = Math.max(0, Math.min(1, d / APPROACH));
    const persp = 1 - 0.88 * z;
    const x = w / 2 + n.side * w * 0.17 * (0.3 + persp * 0.7) * 1.6;
    const rowY = n.high ? 0.46 : 0.64;
    const y = h * (0.32 + (rowY - 0.32) * persp);
    return [x, y, persp];
  }

  private draw(ctx: Ctx, beat: number, now: number) {
    const w = this.W, h = this.H;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    this.juice.applyShake(ctx);

    // vignette over the video backdrop, heavier at the bottom playfield
    const veil = ctx.createLinearGradient(0, 0, 0, h);
    veil.addColorStop(0, 'rgba(20,12,44,0.35)');
    veil.addColorStop(0.55, 'rgba(20,12,44,0.62)');
    veil.addColorStop(1, 'rgba(16,10,38,0.9)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);

    // combo heat: the runway glows warmer the longer the streak
    const heat = Math.min(1, this.combo / 40);

    // runway rails
    ctx.lineWidth = Math.max(1.5, h * 0.003);
    for (const side of [-1, 1] as const) {
      for (const edge of [0.09, 0.28] as const) {
        ctx.strokeStyle = `rgba(255,255,255,${0.08 + heat * 0.1})`;
        ctx.beginPath();
        ctx.moveTo(w / 2 + side * w * edge * 0.32, h * 0.32);
        ctx.lineTo(w / 2 + side * w * edge * 1.55, h * 0.98);
        ctx.stroke();
      }
    }
    // beat pulse on the hit line rings
    const pulse = Math.max(0, 1 - (beat % 1));
    for (const side of [-1, 1] as const) {
      const x = w / 2 + side * w * 0.17 * 1.6;
      const col = side < 0 ? this.sabers.style.colL : this.sabers.style.colR;
      for (const row of [0.46, 0.64] as const) {
        const y = h * row;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35 + heat * 0.25;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, h * 0.055, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = pulse * 0.3;
        ctx.beginPath(); ctx.arc(x, y, h * 0.055 + pulse * h * 0.018, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (heat > 0.4) drawGlow(ctx, x, h * 0.55, h * 0.2 * heat, col, 0.12 * heat);
    }

    // notes far to near
    const visible = this.notes
      .filter((n) => n.beat - beat > -0.9 && n.beat - beat < APPROACH)
      .sort((a, b) => b.beat - a.beat);
    for (const n of visible) this.drawNote(ctx, n, beat, now);

    this.juice.draw(ctx, h);
    this.sabers.draw(ctx, h, now, this.bladeScale(beat));
    ctx.restore();

    // count-in
    if (beat < 0) {
      flashText(ctx, w, h, String(Math.max(1, Math.ceil(-beat))), '#ffd23e', 0.9, 0.9);
    }
    if (this.judg.t > 0) flashText(ctx, w, h, this.judg.text, this.judg.color, Math.min(1, this.judg.t * 2.2), 0.65);
    if (this.o.cameraOk && this.o.rig && !this.o.rig.hasPose) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,247,238,0.7)';
      ctx.font = `700 ${h * 0.022}px 'Baloo 2', sans-serif`;
      ctx.fillText('Step back so the camera can see you', w / 2, h * 0.5);
      ctx.restore();
    }
    this.drawHud(ctx, w, h);
    void this.milestone;
  }

  private drawNote(ctx: Ctx, n: Note, beat: number, now: number) {
    const [x, y, p] = this.notePos(n, beat);
    const h = this.H;
    const s = h * 0.052 * (0.35 + p * 0.65);
    ctx.save();
    if (n.state === 'hit') {
      const k = Math.min(1, (now - n.hitAt) / 240);
      ctx.globalAlpha = 1 - k;
      ctx.translate(x, y);
      ctx.scale(1 + k * 0.8, 1 + k * 0.8);
      ctx.translate(-x, -y);
    } else if (n.state === 'miss') {
      ctx.globalAlpha = 0.22;
    }
    const col = n.hand === 'L' ? this.sabers.style.colL : this.sabers.style.colR;
    const deep = n.hand === 'L' ? this.sabers.style.deepL : this.sabers.style.deepR;
    if (n.state === 'live' && p > 0.85) drawGlow(ctx, x, y, s * 2, col, 0.3);
    const grad = ctx.createLinearGradient(x, y - s, x, y + s);
    grad.addColorStop(0, col);
    grad.addColorStop(1, deep);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.32);
    ctx.fill();
    // crossover notes get a warning rim
    if (n.side === (n.hand === 'L' ? 1 : -1)) {
      ctx.strokeStyle = '#fff7ee';
      ctx.lineWidth = Math.max(1.5, s * 0.09);
      ctx.setLineDash([s * 0.3, s * 0.2]);
      ctx.beginPath();
      ctx.roundRect(x - s * 1.14, y - s * 1.14, s * 2.28, s * 2.28, s * 0.4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // direction chevron
    const want = DIR_VEC[n.dir];
    const aa = Math.atan2(want[1], want[0]);
    ctx.translate(x, y);
    ctx.rotate(aa + Math.PI / 2);
    ctx.fillStyle = 'rgba(20,14,40,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5);
    ctx.lineTo(-s * 0.44, -s * 0.28);
    ctx.lineTo(0, -s * 0.06);
    ctx.lineTo(s * 0.44, -s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawHud(ctx: Ctx, w: number, h: number) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), w * 0.045, h * 0.1);
    ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`BEST ${Math.max(Number(localStorage.getItem('gs-blade-best') ?? 0), this.score)}`, w * 0.046, h * 0.135);
    // energy meter
    const bw = w * 0.1;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(w * 0.046, h * 0.155, bw, h * 0.007);
    ctx.fillStyle = this.hp > 0.35 ? '#7cf95c' : '#ff5d5d';
    ctx.fillRect(w * 0.046, h * 0.155, bw * this.hp, h * 0.007);
    if (this.combo >= 5) {
      ctx.textAlign = 'right';
      ctx.fillStyle = this.combo >= 25 ? '#ffd23e' : '#fff7ee';
      ctx.font = `400 ${h * 0.042}px 'Lilita One', sans-serif`;
      ctx.fillText(`x${this.combo}`, w * 0.96, h * 0.11);
      ctx.font = `700 ${h * 0.014}px 'Baloo 2', sans-serif`;
      ctx.fillStyle = 'rgba(255,247,238,0.55)';
      ctx.fillText('COMBO', w * 0.958, h * 0.135);
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
