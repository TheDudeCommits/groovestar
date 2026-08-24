// Fruit Slice — rebuilt on the Sprint 0 foundation. Both hands are always-
// visible glowing blades that ride the HandRig's filtered, predicted wrist
// positions; slicing tests the full swept blade path (no tunneling) gated by
// body-relative speed. A wave director replaces the random drip: authored
// patterns (crosses, fans, ladders, bomb traps, frenzy bursts) on an
// intensity curve, plus golden fruit, ice fruit (slow motion) and a fever
// meter. Juice everywhere: hit-stop, slow-mo, shake, persistent splatter,
// squash-free vector fruit in the house style. 60 seconds.

import { TUNING } from './tuning';
import { Juice, drawGlow } from './juice';
import { sfx } from './sfx';
import { drawSky, flashText, type Game, type GameOpts, type Ctx } from './shared';

type Special = 'none' | 'bomb' | 'gold' | 'ice';

interface FruitKind {
  name: string;
  r: number;               // radius as a fraction of view height
  body: string;            // flesh
  rind: string;
  seeds?: string;
  points: number;
}

const KINDS: FruitKind[] = [
  { name: 'melon', r: 0.062, body: '#ff5d73', rind: '#39b356', seeds: '#28203a', points: 3 },
  { name: 'orange', r: 0.046, body: '#ffa63e', rind: '#e8842a', points: 2 },
  { name: 'apple', r: 0.044, body: '#f8f4d8', rind: '#e8342e', seeds: '#3a2c20', points: 2 },
  { name: 'lime', r: 0.04, body: '#d6f78e', rind: '#57d95a', points: 2 },
  { name: 'berry', r: 0.034, body: '#b39dff', rind: '#7a3df0', points: 4 },
];
const GOLD: FruitKind = { name: 'gold', r: 0.048, body: '#ffe9a3', rind: '#ffd23e', points: 15 };
const ICE: FruitKind = { name: 'ice', r: 0.046, body: '#dff4ff', rind: '#6ee7ff', points: 5 };
const BOMB: FruitKind = { name: 'bomb', r: 0.048, body: '#2c2837', rind: '#43404d', points: 0 };

interface Fruit {
  kind: FruitKind;
  special: Special;
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number;
  sliced: boolean;
  sliceAngle: number;
  sliceAge: number;        // seconds since the cut
  halfSep: number;
  dead: boolean;
  wobble: number;
}

interface SliceFlash { x1: number; y1: number; x2: number; y2: number; life: number }

interface Blade {
  pts: { x: number; y: number; t: number }[];
  rel: number;             // body-relative hand speed this frame
  visible: boolean;
}

const ROUND_SECS = 60;
const FEVER_SECS = 8;

export class FruitGame implements Game {
  private fruits: Fruit[] = [];
  private flashes: SliceFlash[] = [];
  private blades: Record<'L' | 'R', Blade> = {
    L: { pts: [], rel: 0, visible: false },
    R: { pts: [], rel: 0, visible: false },
  };
  private juice = new Juice();
  private score = 0;
  private best = Number(localStorage.getItem('gs-fruit-best') ?? 0);
  private fruitCount = 0;
  private combo = 0;
  private bestCombo = 0;
  private lastSliceAt = 0;      // gameTime seconds
  private comboFlashT = 0;
  private fever = 0;            // meter 0..1
  private feverLeft = 0;        // seconds of active fever
  private goldSpawned = 0;
  private iceSpawned = 0;
  private iceT = 0;             // ice tint seconds remaining
  private bombFlash = 0;
  private centerMsg = { text: '', color: '#fff', t: 0 };
  private t0 = performance.now();
  private lastT = performance.now();
  private gameTime = 0;         // juiced seconds (physics clock)
  private pending: { at: number; fn: () => void }[] = [];
  private nextPatternAt = 0.8;
  private lastPattern = '';
  private lastTickSec = -1;
  private raf = 0;
  private over = false;
  private demo = { L: 0, R: Math.PI };
  private splat: HTMLCanvasElement = document.createElement('canvas');
  private splatCtx = this.splat.getContext('2d')!;

  constructor(private o: GameOpts) {}

  start() {
    this.t0 = this.lastT = performance.now();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  // ---- main loop ------------------------------------------------------------

  private frame() {
    const { ctx } = this.o;
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const left = Math.max(0, ROUND_SECS - (now - this.t0) / 1000);
    const dt = this.juice.step(rawDt);
    this.gameTime += dt;

    this.readHands(now, dt);
    this.director(left);
    this.physics(dt);
    this.slicing();
    this.timers(dt, rawDt, left);
    this.draw(ctx, now, left);

    if (left <= 0 && !this.over) {
      this.over = true;
      this.stop();
      if (this.score > this.best) localStorage.setItem('gs-fruit-best', String(this.score));
      this.o.onExit(this.score, `${this.fruitCount} fruit sliced, best combo ${this.bestCombo}`);
    }
  }

  // ---- input ----------------------------------------------------------------

  private readHands(now: number, dt: number) {
    const { tracker, rig, cameraOk } = this.o;
    tracker.update();
    if (cameraOk && rig) {
      rig.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now, 4 / 3);
      for (const h of ['L', 'R'] as const) {
        const s = rig.hand(h);
        const b = this.blades[h];
        if (s && s.vis > 0.35) {
          b.visible = true;
          b.rel = s.rel;
          this.feed(b, s.px * this.W, s.py * this.H, now);
        } else {
          b.visible = false;
          b.rel = 0;
        }
      }
    } else {
      // demo: each blade chases the nearest live fruit on its half
      for (const h of ['L', 'R'] as const) {
        const b = this.blades[h];
        b.visible = true;
        b.rel = TUNING.fruit.sliceRel + 2;
        this.demo[h] += dt * 5.2;
        const targets = this.fruits.filter((f) => !f.sliced && !f.dead && f.special !== 'bomb' && f.y < this.H * 0.95);
        const mine = targets.filter((f) => (h === 'L' ? f.x < this.W * 0.55 : f.x >= this.W * 0.45));
        const tgt = mine.sort((a, c) => a.y - c.y)[0];
        const bx = tgt ? tgt.x + Math.cos(this.demo[h]) * this.H * 0.09 : this.W * (h === 'L' ? 0.3 : 0.7) + Math.cos(this.demo[h]) * this.W * 0.12;
        const by = tgt ? tgt.y + Math.sin(this.demo[h]) * this.H * 0.09 : this.H * 0.5 + Math.sin(this.demo[h] * 1.6) * this.H * 0.2;
        this.feed(b, bx, by, now);
      }
    }
  }

  private feed(b: Blade, x: number, y: number, t: number) {
    b.pts.push({ x, y, t });
    while (b.pts.length && t - b.pts[0].t > TUNING.fruit.trailMs) b.pts.shift();
  }

  // ---- wave director --------------------------------------------------------

  private director(left: number) {
    // run due spawns
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.gameTime >= this.pending[i].at) {
        this.pending[i].fn();
        this.pending.splice(i, 1);
      }
    }
    if (left < 1.6 || this.gameTime < this.nextPatternAt) return;

    const elapsed = ROUND_SECS - left;
    const feverOn = this.feverLeft > 0;
    // authored beats: two frenzies mid-round, everything else weighted
    if (!this.frenzyDone1 && elapsed > 24) { this.frenzyDone1 = true; this.patternFrenzy(); }
    else if (!this.frenzyDone2 && elapsed > 47) { this.frenzyDone2 = true; this.patternFrenzy(); }
    else this.pickPattern(elapsed, feverOn);

    const base = Math.max(0.9, 1.6 - elapsed * 0.012);
    this.nextPatternAt = this.gameTime + base * (feverOn ? 0.55 : 1);
  }

  private frenzyDone1 = false;
  private frenzyDone2 = false;

  private pickPattern(elapsed: number, feverOn: boolean) {
    const table: [string, number, () => void][] = [
      ['single', 3, () => this.launch(0.2 + Math.random() * 0.6)],
      ['double', elapsed > 6 ? 3 : 0, () => this.patternCross()],
      ['fan', elapsed > 10 ? 2.5 : 0, () => this.patternFan(3 + Math.floor(Math.random() * 2))],
      ['ladder', elapsed > 14 ? 2 : 0, () => this.patternLadder()],
      ['bomb', elapsed > 10 && !feverOn ? 1.6 : 0, () => this.patternBombTrap()],
      ['gold', this.goldSpawned < 2 && elapsed > 12 ? 0.5 : 0, () => { this.goldSpawned++; this.launch(0.3 + Math.random() * 0.4, 'gold'); }],
      ['ice', this.iceSpawned < 2 && elapsed > 16 ? 0.5 : 0, () => { this.iceSpawned++; this.launch(0.3 + Math.random() * 0.4, 'ice'); }],
    ];
    const live = table.filter(([name, w]) => w > 0 && name !== this.lastPattern);
    let total = live.reduce((a, [, w]) => a + w, 0);
    let roll = Math.random() * total;
    for (const [name, w, fn] of live) {
      roll -= w;
      if (roll <= 0) { this.lastPattern = name; fn(); return; }
    }
  }

  private patternCross() {
    this.launch(0.16, 'none', 0.55);      // left fruit arcs right
    this.pend(0.12, () => this.launch(0.84, 'none', -0.55));
  }

  private patternFan(n: number) {
    for (let i = 0; i < n; i++) {
      const fr = 0.5 + (i - (n - 1) / 2) * 0.16;
      this.pend(i * 0.07, () => this.launch(0.5, 'none', (fr - 0.5) * 1.3));
    }
  }

  private patternLadder() {
    for (let i = 0; i < 4; i++) this.pend(i * 0.14, () => this.launch(0.2 + i * 0.18));
  }

  private patternBombTrap() {
    const at = 0.25 + Math.random() * 0.5;
    this.launch(at);
    this.pend(0.06, () => this.launch(at + (Math.random() < 0.5 ? -0.11 : 0.11), 'bomb'));
  }

  private patternFrenzy() {
    this.say('FRENZY', '#ffd23e');
    sfx.whoosh();
    for (let i = 0; i < 12; i++) {
      this.pend(i * 0.15, () => this.launch(0.15 + Math.random() * 0.7));
    }
    this.lastPattern = 'frenzy';
  }

  private pend(delay: number, fn: () => void) {
    this.pending.push({ at: this.gameTime + delay, fn });
  }

  private launch(xFrac: number, special: Special = 'none', vxBias = 0) {
    const h = this.H, w = this.W;
    const kind = special === 'bomb' ? BOMB : special === 'gold' ? GOLD : special === 'ice' ? ICE : KINDS[Math.floor(Math.random() * KINDS.length)];
    const g = h * 1.1;                          // matches physics gravity
    const peak = h * (0.55 + Math.random() * 0.25);
    const x = w * Math.max(0.08, Math.min(0.92, xFrac));
    this.fruits.push({
      kind, special,
      x, y: h + kind.r * h,
      vx: (w * 0.5 - x) * 0.35 + vxBias * w * 0.35 + (Math.random() - 0.5) * w * 0.08,
      vy: -Math.sqrt(2 * g * peak),
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 4.5,
      sliced: false, sliceAngle: 0, sliceAge: 0, halfSep: 0, dead: false,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  // ---- physics --------------------------------------------------------------

  private physics(dt: number) {
    const g = this.H * 1.1;
    for (const f of this.fruits) {
      f.vy += g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.sliced) {
        f.sliceAge += dt;
        f.halfSep += this.H * 0.35 * dt;
        if (f.sliceAge > 0.9) f.dead = true;
      }
      if (f.y > this.H + this.H * 0.18) f.dead = true;
    }
    this.fruits = this.fruits.filter((f) => !f.dead);
  }

  // ---- slicing --------------------------------------------------------------

  private slicing() {
    let slicedThisFrame = 0;
    let cx = 0, cy = 0;
    for (const key of ['L', 'R'] as const) {
      const b = this.blades[key];
      if (b.pts.length < 2 || b.rel < TUNING.fruit.sliceRel) continue;
      for (const f of this.fruits) {
        if (f.sliced || f.dead) continue;
        const r = f.kind.r * this.H;
        // full swept path, newest segments first
        for (let i = b.pts.length - 1; i >= 1; i--) {
          const p1 = b.pts[i - 1], p2 = b.pts[i];
          if (!segCircle(p1.x, p1.y, p2.x, p2.y, f.x, f.y, r)) continue;
          this.slice(f, Math.atan2(p2.y - p1.y, p2.x - p1.x), p1, p2);
          if (f.special === 'none' || f.special === 'gold') {
            slicedThisFrame++;
            cx += f.x; cy += f.y;
          }
          break;
        }
      }
    }
    if (slicedThisFrame >= 3) {
      const label = slicedThisFrame === 3 ? 'TRIPLE' : slicedThisFrame === 4 ? 'QUAD' : 'WILD';
      const bonus = 5 * this.mult();
      this.score += bonus;
      this.say(label, '#ffd23e');
      this.juice.hitStop(60);
      this.juice.ring(cx / slicedThisFrame, cy / slicedThisFrame, '#ffd23e', this.H * 0.16);
      this.juice.pop(cx / slicedThisFrame, cy / slicedThisFrame - this.H * 0.07, `+${bonus}`, '#ffd23e', 1.2);
      sfx.hit(0.85);
    }
  }

  private mult(): number {
    const m = this.combo >= 12 ? 4 : this.combo >= 8 ? 3 : this.combo >= 4 ? 2 : 1;
    return m * (this.feverLeft > 0 ? 2 : 1);
  }

  private slice(f: Fruit, angle: number, p1: { x: number; y: number }, p2: { x: number; y: number }) {
    if (f.special === 'bomb') return this.hitBomb(f);
    f.sliced = true;
    f.sliceAngle = angle;
    f.vy -= this.H * 0.12;
    this.fruitCount++;

    // combo chain
    this.combo = this.gameTime - this.lastSliceAt < TUNING.fruit.chainMs / 1000 ? this.combo + 1 : 1;
    this.lastSliceAt = this.gameTime;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.combo === 4 || this.combo === 8 || this.combo === 12) {
      this.say(`COMBO X${this.combo >= 12 ? 4 : this.combo >= 8 ? 3 : 2}`, '#ffd23e');
      sfx.pop(this.combo / 4 + 4);
      this.comboFlashT = 0.5;
    }

    const mult = this.mult();
    const pts = f.kind.points * mult;
    this.score += pts;

    const r = f.kind.r * this.H;
    this.flashes.push({
      x1: f.x - Math.cos(angle) * r * 1.6, y1: f.y - Math.sin(angle) * r * 1.6,
      x2: f.x + Math.cos(angle) * r * 1.6, y2: f.y + Math.sin(angle) * r * 1.6,
      life: 0.15,
    });
    this.stampSplat(f, angle);
    this.juice.burst({
      x: f.x, y: f.y, count: 12, color: [f.kind.body, f.kind.rind],
      speed: this.H * 0.35, gravity: this.H * 0.6, size: this.H * 0.007, life: 0.55,
    });
    this.juice.pop(f.x, f.y - r * 1.3, `+${pts}`, mult > 1 ? '#ffd23e' : '#ffffff', mult > 2 ? 1.15 : 1);
    sfx.slice(this.combo);

    if (f.special === 'gold') {
      this.juice.ring(f.x, f.y, '#ffd23e', this.H * 0.2);
      this.juice.burst({ x: f.x, y: f.y, count: 22, color: ['#ffd23e', '#fff7ee'], speed: this.H * 0.5, size: this.H * 0.006, life: 0.7 });
      this.say('GOLDEN', '#ffd23e');
      sfx.fanfare(false);
      this.fever = Math.min(1, this.fever + 0.3);
    } else if (f.special === 'ice') {
      this.iceT = 2.0;
      this.juice.slowmo(0.45, 2000);
      this.juice.ring(f.x, f.y, '#6ee7ff', this.H * 0.24);
      this.juice.burst({ x: f.x, y: f.y, count: 16, kind: 'shard', color: ['#dff4ff', '#6ee7ff'], speed: this.H * 0.4, gravity: this.H * 0.5, size: this.H * 0.012, life: 0.8 });
      this.say('FREEZE', '#6ee7ff');
      sfx.pop(9);
    } else {
      this.fever = Math.min(1, this.fever + 0.055);
    }
    void p1; void p2;

    if (this.fever >= 1 && this.feverLeft <= 0) {
      this.feverLeft = FEVER_SECS;
      this.say('FEVER', '#ff6ac1');
      sfx.fanfare(true);
    }
  }

  private hitBomb(f: Fruit) {
    f.dead = true;
    this.score = Math.max(0, this.score - 10);
    this.combo = 0;
    this.fever *= 0.5;
    this.bombFlash = 0.5;
    this.juice.hitStop(90);
    this.juice.shake(16, 340);
    this.juice.ring(f.x, f.y, '#ff8a2e', this.H * 0.3, 0.5);
    this.juice.burst({ x: f.x, y: f.y, count: 26, color: ['#ffd23e', '#ff8a2e', '#43404d'], speed: this.H * 0.6, gravity: this.H * 0.4, size: this.H * 0.008, life: 0.6 });
    this.juice.pop(f.x, f.y, '-10', '#ff5d5d', 1.2);
    sfx.bomb();
  }

  private stampSplat(f: Fruit, angle: number) {
    const c = this.splatCtx;
    const r = f.kind.r * this.H;
    c.save();
    c.translate(f.x, f.y);
    c.rotate(angle);
    c.fillStyle = f.kind.body;
    c.globalAlpha = 0.26;
    c.beginPath();
    c.ellipse(0, 0, r * 1.3, r * 0.42, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.2;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.7 + Math.random() * 0.9);
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d * 0.5, r * (0.1 + Math.random() * 0.16), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  // ---- timers ---------------------------------------------------------------

  private timers(dt: number, rawDt: number, left: number) {
    if (this.combo > 0 && this.gameTime - this.lastSliceAt > TUNING.fruit.chainMs / 1000) this.combo = 0;
    if (this.feverLeft > 0) this.feverLeft = Math.max(0, this.feverLeft - rawDt);
    if (this.feverLeft === 0 && this.fever >= 1) this.fever = 0;
    this.iceT = Math.max(0, this.iceT - rawDt);
    this.bombFlash = Math.max(0, this.bombFlash - rawDt * 1.6);
    this.comboFlashT = Math.max(0, this.comboFlashT - rawDt);
    this.centerMsg.t = Math.max(0, this.centerMsg.t - rawDt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= rawDt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }
    this.juice.update(dt);
    // urgency ticks in the last ten seconds
    const sec = Math.ceil(left);
    if (left < 10 && sec !== this.lastTickSec) { this.lastTickSec = sec; sfx.tick(); }
    // splatter slowly fades
    if (this.splat.width) {
      this.splatCtx.save();
      this.splatCtx.globalCompositeOperation = 'destination-out';
      this.splatCtx.globalAlpha = 0.035;
      this.splatCtx.fillRect(0, 0, this.splat.width, this.splat.height);
      this.splatCtx.restore();
    }
  }

  private say(text: string, color: string) {
    this.centerMsg = { text, color, t: 0.9 };
  }

  // ---- rendering ------------------------------------------------------------

  private draw(ctx: Ctx, now: number, left: number) {
    const w = this.W, h = this.H;
    if (this.splat.width !== w || this.splat.height !== h) {
      this.splat.width = w; this.splat.height = h;
    }

    ctx.save();
    this.juice.applyShake(ctx);

    drawSky(ctx, w, h);
    // fever warms and brightens the whole sky
    if (this.feverLeft > 0) {
      const a = Math.min(1, this.feverLeft) * 0.16;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(255,106,193,${a})`);
      g.addColorStop(1, `rgba(255,170,64,${a * 1.4})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(this.splat, 0, 0);

    for (const f of this.fruits) this.drawFruit(ctx, f, now);
    for (const fl of this.flashes) {
      ctx.strokeStyle = '#fff7ee';
      ctx.globalAlpha = fl.life / 0.15;
      ctx.lineWidth = h * 0.006;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fl.x1, fl.y1); ctx.lineTo(fl.x2, fl.y2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.juice.draw(ctx, h);
    this.drawBlades(ctx, now);
    ctx.restore();

    // overlays that must not shake
    if (this.iceT > 0) {
      ctx.fillStyle = `rgba(110,231,255,${Math.min(0.35, this.iceT) * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.bombFlash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${this.bombFlash * 0.3})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.centerMsg.t > 0) {
      flashText(ctx, w, h, this.centerMsg.text, this.centerMsg.color, Math.min(1, this.centerMsg.t * 2.2), 0.9 + (0.9 - this.centerMsg.t) * 0.2);
    }
    if (this.o.cameraOk && this.o.rig && !this.o.rig.hasPose) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,247,238,0.7)';
      ctx.font = `700 ${h * 0.022}px 'Baloo 2', sans-serif`;
      ctx.fillText('Step back so the camera can see you', w / 2, h * 0.5);
      ctx.restore();
    }
    this.drawHud(ctx, left);
  }

  private drawFruit(ctx: Ctx, f: Fruit, now: number) {
    const r = f.kind.r * this.H;
    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.special === 'bomb') {
      ctx.rotate(f.rot * 0.4);
      ctx.fillStyle = '#2c2837';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#43404d';
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a8694';
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.4, -r * 1.4, r * 0.7, -r * 1.2); ctx.stroke();
      const tw = 0.7 + Math.sin(now / 55) * 0.3;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(r * 0.7, -r * 1.2, r * 0.2 * tw, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // fuse tip glow at the rotated spark position
      const th = f.rot * 0.4;
      const gx = f.x + r * 0.7 * Math.cos(th) + r * 1.2 * Math.sin(th);
      const gy = f.y + r * 0.7 * Math.sin(th) - r * 1.2 * Math.cos(th);
      drawGlow(ctx, gx, gy, r * 0.5 * tw, '#ffd23e', 0.9);
      return;
    }
    if (!f.sliced) {
      if (f.special === 'gold') {
        ctx.restore();
        drawGlow(ctx, f.x, f.y, r * 2.4, '#ffd23e', 0.5 + Math.sin(now / 130) * 0.2);
        ctx.save();
        ctx.translate(f.x, f.y);
      }
      if (f.special === 'ice') {
        ctx.restore();
        drawGlow(ctx, f.x, f.y, r * 2, '#6ee7ff', 0.4);
        ctx.save();
        ctx.translate(f.x, f.y);
      }
      ctx.rotate(f.rot);
      this.drawWhole(ctx, f, r);
    } else {
      for (const half of [-1, 1] as const) {
        ctx.save();
        const off = f.halfSep * half;
        const nx = Math.cos(f.sliceAngle + Math.PI / 2), ny = Math.sin(f.sliceAngle + Math.PI / 2);
        ctx.translate(nx * off, ny * off);
        ctx.rotate(f.sliceAngle + half * (0.14 + f.sliceAge * 0.8));
        ctx.globalAlpha = Math.max(0, 1 - f.sliceAge * 1.15);
        ctx.beginPath();
        ctx.arc(0, 0, r, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
        ctx.closePath();
        ctx.fillStyle = f.kind.body;
        ctx.fill();
        ctx.lineWidth = r * 0.16;
        ctx.strokeStyle = f.kind.rind;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
        ctx.stroke();
        if (f.kind.seeds) {
          ctx.fillStyle = f.kind.seeds;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(i * r * 0.3, half * r * 0.22, r * 0.05, r * 0.09, i * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawWhole(ctx: Ctx, f: Fruit, r: number) {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.2, 0, 0, r * 1.05);
    g.addColorStop(0, lighten(f.kind.rind, 1.3));
    g.addColorStop(1, f.kind.rind);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // rim light, warm side
    ctx.strokeStyle = 'rgba(255,247,238,0.5)';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, -2.4, -1.2); ctx.stroke();
    if (f.special === 'ice') {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = r * 0.06;
      for (const a of [0.4, 1.6, 2.9]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a + 2.3) * r * 0.5, Math.sin(a + 2.3) * r * 0.5);
        ctx.stroke();
      }
      return;
    }
    if (f.special === 'gold') {
      ctx.fillStyle = 'rgba(255,247,238,0.9)';
      for (const [sx, sy, sr] of [[-0.3, -0.42, 0.1], [0.35, 0.15, 0.07], [0.05, 0.4, 0.05]] as const) {
        ctx.beginPath(); ctx.arc(sx * r, sy * r, sr * r, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    // leaf + stem
    ctx.fillStyle = '#2f9e39';
    ctx.beginPath();
    ctx.ellipse(r * 0.25, -r * 0.95, r * 0.3, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#28203a';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, -r * 1.15); ctx.stroke();
    if (f.kind.name === 'melon') {
      ctx.strokeStyle = 'rgba(20,80,40,0.5)';
      ctx.lineWidth = r * 0.1;
      for (const sx of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(sx * r, -r * 0.85);
        ctx.quadraticCurveTo(sx * r * 1.8, 0, sx * r, r * 0.85);
        ctx.stroke();
      }
    }
    if (f.kind.name === 'orange') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (f.kind.name === 'lime') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBlades(ctx: Ctx, now: number) {
    const h = this.H;
    for (const key of ['L', 'R'] as const) {
      const b = this.blades[key];
      const col = key === 'L' ? '#6ee7ff' : '#ffd23e';
      if (!b.visible || b.pts.length === 0) continue;
      const tip = b.pts[b.pts.length - 1];
      // ribbon trail: three passes, wide soft -> narrow core
      if (b.pts.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const [width, alpha, color] of [
          [0.02, 0.28, col],
          [0.011, 0.6, col],
          [0.0045, 0.95, '#ffffff'],
        ] as const) {
          for (let i = 1; i < b.pts.length; i++) {
            const age = (now - b.pts[i].t) / TUNING.fruit.trailMs;
            ctx.strokeStyle = color;
            ctx.globalAlpha = Math.max(0, (1 - age)) * alpha;
            ctx.lineWidth = Math.max(1, (1 - age * 0.7) * h * width);
            ctx.beginPath();
            ctx.moveTo(b.pts[i - 1].x, b.pts[i - 1].y);
            ctx.lineTo(b.pts[i].x, b.pts[i].y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      // the hand itself is ALWAYS visible: glow orb + ring, brighter when fast
      const hot = Math.min(1, b.rel / (TUNING.fruit.sliceRel * 1.6));
      drawGlow(ctx, tip.x, tip.y, h * (0.03 + hot * 0.02), col, 0.55 + hot * 0.45);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, h * 0.007, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, h * (0.016 + hot * 0.006), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawHud(ctx: Ctx, left: number) {
    const w = this.W, h = this.H;
    ctx.save();
    // score
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), w * 0.045, h * 0.1);
    ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`BEST ${Math.max(this.best, this.score)}`, w * 0.046, h * 0.135);
    // timer arc
    const cx = w / 2, cy = h * 0.085, r = h * 0.038;
    const urgent = left < 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = h * 0.008;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = urgent ? '#ff5d5d' : '#ffd23e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / ROUND_SECS));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7ee';
    const pulse = urgent ? 1 + Math.max(0, Math.sin((left % 1) * Math.PI)) * 0.15 : 1;
    ctx.font = `400 ${h * 0.026 * pulse}px 'Lilita One', sans-serif`;
    ctx.fillText(String(Math.ceil(left)), cx, cy + h * 0.01);
    // fever meter, thin bar under the timer
    const bw = w * 0.11;
    const lvl = this.feverLeft > 0 ? this.feverLeft / FEVER_SECS : this.fever;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(cx - bw / 2, cy + r + h * 0.02, bw, h * 0.006);
    ctx.fillStyle = this.feverLeft > 0 ? '#ff6ac1' : '#ffd23e';
    ctx.fillRect(cx - bw / 2, cy + r + h * 0.02, bw * Math.min(1, lvl), h * 0.006);
    if (this.feverLeft > 0) {
      ctx.fillStyle = '#ff6ac1';
      ctx.font = `700 ${h * 0.015}px 'Baloo 2', sans-serif`;
      ctx.fillText('FEVER, DOUBLE POINTS', cx, cy + r + h * 0.045);
    }
    // combo, top right
    if (this.combo >= 2) {
      ctx.textAlign = 'right';
      const grow = 1 + this.comboFlashT * 0.5;
      ctx.fillStyle = this.mult() > 1 ? '#ffd23e' : '#fff7ee';
      ctx.font = `400 ${h * 0.042 * grow}px 'Lilita One', sans-serif`;
      ctx.fillText(`x${this.combo}`, w * 0.96, h * 0.11);
      ctx.font = `700 ${h * 0.014}px 'Baloo 2', sans-serif`;
      ctx.fillStyle = 'rgba(255,247,238,0.55)';
      ctx.fillText('COMBO', w * 0.958, h * 0.135);
    }
    ctx.restore();
  }
}

// ---- helpers ----------------------------------------------------------------

function segCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(cx - x1, cy - y1) <= r;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) <= r;
}

function lighten(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, ((v >> s) & 255) * f));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
