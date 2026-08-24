// Fruit Slice — the first game of the movement suite. Both wrists are glowing
// blades; fruit arcs up from the bottom and you slice it with fast hand
// sweeps. Bombs cost points. 60 seconds, combos for multi-fruit sweeps.
// All art is in-house vector in the house style.

type Ctx = CanvasRenderingContext2D;

/** minimal tracker surface — works with the webcam tracker and the phone cam */
export interface TrackerLike {
  update(): void;
  latest: { points: { x: number; y: number }[] | null };
}
type P2 = [number, number];

interface FruitKind {
  name: string;
  r: number;              // radius in vh units (fraction of height)
  body: string;           // flesh color
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

interface Fruit {
  kind: FruitKind;
  bomb: boolean;
  x: number; y: number;
  vx: number; vy: number;
  rot: number; vr: number;
  sliced: boolean;
  sliceAngle: number;
  halfSep: number;         // halves separation after slice
  dead: boolean;
}

interface Splash { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; color: string }
interface Pop { x: number; y: number; text: string; life: number; color: string }

interface Blade {
  pts: { x: number; y: number; t: number }[];
  speed: number;
}

export interface FruitGameOpts {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  tracker: TrackerLike;
  cameraOk: boolean;
  onExit: (score: number) => void;
}

const ROUND_SECS = 60;

export class FruitGame {
  private fruits: Fruit[] = [];
  private splashes: Splash[] = [];
  private pops: Pop[] = [];
  private blades: Record<'A' | 'B', Blade> = { A: { pts: [], speed: 0 }, B: { pts: [], speed: 0 } };
  private score = 0;
  private best = Number(localStorage.getItem('gs-fruit-best') ?? 0);
  private combo = 0;
  private comboAt = 0;
  private t0 = performance.now();
  private lastSpawn = 0;
  private spawnEvery = 1100;
  private raf = 0;
  private over = false;
  private shake = 0;
  private demoT = 0;

  constructor(private o: FruitGameOpts) {}

  start() {
    this.t0 = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private frame() {
    const { ctx, tracker } = this.o;
    const now = performance.now();
    const elapsed = (now - this.t0) / 1000;
    const left = Math.max(0, ROUND_SECS - elapsed);
    tracker.update();

    // ---- blades from wrists (or a demo sweep without a camera) -------------
    if (this.o.cameraOk) {
      const pts = tracker.latest.points;
      if (pts) {
        // preview points: [shL, shR, elL, elR, wrL, wrR, ...]
        this.feedBlade('A', pts[4].x * this.W, pts[4].y * this.H, now);
        this.feedBlade('B', pts[5].x * this.W, pts[5].y * this.H, now);
      }
    } else {
      this.demoT += 0.03;
      this.feedBlade('B', this.W * (0.5 + Math.sin(this.demoT) * 0.3), this.H * (0.5 + Math.cos(this.demoT * 1.7) * 0.25), now);
    }

    // ---- spawn --------------------------------------------------------------
    this.spawnEvery = Math.max(560, 1100 - elapsed * 9);
    if (now - this.lastSpawn > this.spawnEvery && left > 1.5) {
      this.lastSpawn = now;
      const n = 1 + (Math.random() < Math.min(0.6, elapsed / 45) ? 1 : 0) + (Math.random() < 0.22 ? 1 : 0);
      for (let i = 0; i < n; i++) this.spawn();
    }

    // ---- physics ------------------------------------------------------------
    const g = this.H * 0.55;
    const dt = 1 / 60;
    for (const f of this.fruits) {
      f.vy += g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.sliced) f.halfSep += this.H * 0.14 * dt;
      if (f.y > this.H + this.H * 0.15) f.dead = true;
    }
    this.fruits = this.fruits.filter((f) => !f.dead);

    // ---- slicing ------------------------------------------------------------
    for (const key of ['A', 'B'] as const) {
      const b = this.blades[key];
      const p = b.pts;
      if (p.length < 2) continue;
      const a = p[p.length - 2], c = p[p.length - 1];
      const speed = Math.hypot(c.x - a.x, c.y - a.y) / Math.max(8, c.t - a.t) * 1000;
      b.speed = speed;
      if (speed < this.H * 0.7) continue;      // must genuinely swipe
      let hitThisSweep = 0;
      for (const f of this.fruits) {
        if (f.sliced) continue;
        const r = f.kind.r * this.H;
        if (segCircle(a.x, a.y, c.x, c.y, f.x, f.y, r)) {
          if (f.bomb) {
            this.score = Math.max(0, this.score - 10);
            this.shake = 14;
            this.pops.push({ x: f.x, y: f.y, text: '-10', life: 1, color: '#ff5d5d' });
            this.boom(f.x, f.y);
            f.dead = true;
            continue;
          }
          f.sliced = true;
          f.sliceAngle = Math.atan2(c.y - a.y, c.x - a.x);
          f.vy -= this.H * 0.12;
          hitThisSweep++;
          this.juice(f);
          const nowS = performance.now();
          this.combo = nowS - this.comboAt < 450 ? this.combo + 1 : 1;
          this.comboAt = nowS;
          const pts = f.kind.points * (this.combo >= 3 ? 2 : 1);
          this.score += pts;
          this.pops.push({
            x: f.x, y: f.y - r,
            text: this.combo >= 3 ? `+${pts} x${this.combo}` : `+${pts}`,
            life: 1, color: this.combo >= 3 ? '#ffd23e' : '#ffffff',
          });
        }
      }
      if (hitThisSweep >= 3) this.score += 5;
    }

    // ---- draw ---------------------------------------------------------------
    ctx.save();
    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.86;
    }
    this.drawBackdrop(ctx);
    for (const f of this.fruits) this.drawFruit(ctx, f);
    this.drawSplashes(ctx, dt);
    this.drawBlades(ctx, now);
    this.drawPops(ctx, dt);
    this.drawHudBits(ctx, left);
    ctx.restore();

    if (left <= 0 && !this.over) {
      this.over = true;
      this.stop();
      if (this.score > this.best) localStorage.setItem('gs-fruit-best', String(this.score));
      this.o.onExit(this.score);
    }
  }

  private feedBlade(key: 'A' | 'B', x: number, y: number, t: number) {
    const b = this.blades[key];
    b.pts.push({ x, y, t });
    while (b.pts.length && t - b.pts[0].t > 160) b.pts.shift();
  }

  private spawn() {
    const bomb = Math.random() < 0.14;
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    const fromX = this.W * (0.18 + Math.random() * 0.64);
    this.fruits.push({
      kind, bomb,
      x: fromX, y: this.H + this.H * 0.08,
      vx: (this.W * 0.5 - fromX) * (0.25 + Math.random() * 0.5) + (Math.random() - 0.5) * this.W * 0.12,
      vy: -(this.H * (1.02 + Math.random() * 0.24)),
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 5,
      sliced: false, sliceAngle: 0, halfSep: 0, dead: false,
    });
  }

  private juice(f: Fruit) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.H * (0.1 + Math.random() * 0.35);
      this.splashes.push({
        x: f.x, y: f.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - this.H * 0.1,
        r: this.H * (0.004 + Math.random() * 0.008),
        life: 0, max: 0.5 + Math.random() * 0.4,
        color: Math.random() < 0.7 ? f.kind.body : f.kind.rind,
      });
    }
  }

  private boom(x: number, y: number) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.H * (0.2 + Math.random() * 0.6);
      this.splashes.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: this.H * (0.004 + Math.random() * 0.01),
        life: 0, max: 0.4 + Math.random() * 0.3,
        color: i % 3 === 0 ? '#ffd23e' : i % 3 === 1 ? '#ff8a2e' : '#43404d',
      });
    }
  }

  // ---- rendering ------------------------------------------------------------

  private drawBackdrop(ctx: Ctx) {
    const w = this.W, h = this.H;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2a1a5e');
    sky.addColorStop(0.55, '#3c1e63');
    sky.addColorStop(1, '#1b1140');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // warm glow pools
    for (const [gx, gy, gr, col] of [
      [0.12, 0.06, 0.5, 'rgba(255,106,193,0.16)'],
      [0.9, 0.16, 0.55, 'rgba(101,90,255,0.2)'],
      [0.5, 1.05, 0.6, 'rgba(255,170,64,0.14)'],
    ] as const) {
      const g = ctx.createRadialGradient(w * gx, h * gy, 0, w * gx, h * gy, h * gr);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private fruitPath(ctx: Ctx, f: Fruit, half: -1 | 0 | 1) {
    const r = f.kind.r * this.H;
    ctx.beginPath();
    if (half === 0) ctx.arc(0, 0, r, 0, Math.PI * 2);
    else ctx.arc(0, 0, r, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
    ctx.closePath();
  }

  private drawFruit(ctx: Ctx, f: Fruit) {
    const r = f.kind.r * this.H;
    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.bomb) {
      ctx.rotate(f.rot);
      // bomb: dark sphere, gold fuse spark
      ctx.fillStyle = '#2c2837';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#43404d';
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a8694';
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.4, -r * 1.4, r * 0.7, -r * 1.2); ctx.stroke();
      const tw = 0.7 + Math.sin(performance.now() / 60) * 0.3;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(r * 0.7, -r * 1.2, r * 0.22 * tw, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (!f.sliced) {
      ctx.rotate(f.rot);
      this.drawWhole(ctx, f, r);
    } else {
      for (const half of [-1, 1] as const) {
        ctx.save();
        const off = f.halfSep * half;
        ctx.translate(Math.cos(f.sliceAngle + Math.PI / 2) * off, Math.sin(f.sliceAngle + Math.PI / 2) * off);
        ctx.rotate(f.sliceAngle + half * 0.14);
        // flesh face
        this.fruitPath(ctx, f, half);
        ctx.fillStyle = f.kind.body;
        ctx.fill();
        // rind edge
        ctx.lineWidth = r * 0.16;
        ctx.strokeStyle = f.kind.rind;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
        ctx.stroke();
        // seeds on the cut face
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
    // rind sphere with a soft light
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.2, 0, 0, r * 1.05);
    g.addColorStop(0, lighten(f.kind.rind, 1.25));
    g.addColorStop(1, f.kind.rind);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // leaf + stem
    ctx.fillStyle = '#2f9e39';
    ctx.beginPath();
    ctx.ellipse(r * 0.25, -r * 0.95, r * 0.3, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#28203a';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, -r * 1.15); ctx.stroke();
    // melon stripes
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
  }

  private drawSplashes(ctx: Ctx, dt: number) {
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life += dt;
      if (s.life >= s.max) { this.splashes.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += this.H * 0.5 * dt;
      const a = 1 - s.life / s.max;
      ctx.fillStyle = s.color;
      ctx.globalAlpha = a * 0.9;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 + s.life * 2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBlades(ctx: Ctx, now: number) {
    for (const key of ['A', 'B'] as const) {
      const p = this.blades[key].pts;
      if (p.length < 2) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const col = key === 'A' ? '#6ee7ff' : '#ffd23e';
      for (let i = 1; i < p.length; i++) {
        const age = (now - p[i].t) / 160;
        ctx.strokeStyle = col;
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.lineWidth = (1 - age) * this.H * 0.014 + 1.5;
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(p[i - 1].x, p[i - 1].y);
        ctx.lineTo(p[i].x, p[i].y);
        ctx.stroke();
      }
      // blade tip glow
      const tip = p[p.length - 1];
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, this.H * 0.007, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  private drawPops(ctx: Ctx, dt: number) {
    ctx.save();
    ctx.textAlign = 'center';
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt * 1.1;
      if (p.life <= 0) { this.pops.splice(i, 1); continue; }
      p.y -= this.H * 0.06 * dt;
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${this.H * 0.032}px 'Baloo 2', sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  private drawHudBits(ctx: Ctx, left: number) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${this.H * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), this.W * 0.045, this.H * 0.1);
    ctx.font = `700 ${this.H * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`BEST ${Math.max(this.best, this.score)}`, this.W * 0.046, this.H * 0.135);
    // timer: thin arc top center
    const cx = this.W / 2, cy = this.H * 0.085, r = this.H * 0.038;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = this.H * 0.008;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = left < 10 ? '#ff5d5d' : '#ffd23e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / ROUND_SECS));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${this.H * 0.026}px 'Lilita One', sans-serif`;
    ctx.fillText(String(Math.ceil(left)), cx, cy + this.H * 0.01);
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
