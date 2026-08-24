// Rush — the endless runner. Step left/right to change lanes, jump real
// jumps over hurdles, duck under bars, grab coins. Speed climbs forever;
// three hearts. Whole-body cardio.

import { BodyDetector } from '../pose/gestures';
import { drawSky, hudScore, flashText, type Game, type GameOpts, type Ctx } from './shared';

type Ob = {
  kind: 'block' | 'bar' | 'hurdle' | 'coin';
  lane: number;        // -1 0 1 (bar/hurdle span all lanes)
  z: number;           // 1 far → 0 at player
  done: boolean;
};

export class RushGame implements Game {
  private det = new BodyDetector();
  private obs: Ob[] = [];
  private lane = 0;             // smooth position -1..1
  private targetLane = 0;
  private jumpT = 0;            // >0 while airborne (seconds remaining)
  private duckT = 0;
  private speed = 0.42;         // z units per second
  private dist = 0;
  private coins = 0;
  private hearts = 3;
  private hurt = 0;
  private lastSpawnZ = 0;
  private raf = 0;
  private over = false;
  private t0 = performance.now();
  private lastT = performance.now();
  private demoT = 0;

  constructor(private o: GameOpts) {}

  start() {
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private frame() {
    const { ctx, tracker } = this.o;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    tracker.update();

    // ---- input --------------------------------------------------------------
    if (this.o.cameraOk) {
      this.det.update(tracker.latestLandmarks, now);
      this.targetLane = this.det.lane < -0.4 ? -1 : this.det.lane > 0.4 ? 1 : 0;
      if (this.det.jumping && this.jumpT <= 0 && this.duckT <= 0) this.jumpT = 0.62;
      this.duckT = this.det.ducking ? 0.3 : Math.max(0, this.duckT - dt);
    } else {
      // demo autopilot: dodge whatever's nearest
      this.demoT += dt;
      const near = this.obs.filter((ob) => !ob.done && ob.z < 0.42).sort((a, b) => a.z - b.z)[0];
      if (near) {
        if (near.kind === 'block' && near.lane === this.targetLane) this.targetLane = near.lane === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        if (near.kind === 'hurdle' && near.z < 0.2 && this.jumpT <= 0) this.jumpT = 0.62;
        if (near.kind === 'bar' && near.z < 0.22) this.duckT = 0.3;
        if (near.kind === 'coin') this.targetLane = near.lane;
      }
    }
    this.lane += (this.targetLane - this.lane) * Math.min(1, dt * 10);
    if (this.jumpT > 0) this.jumpT -= dt;

    // ---- world --------------------------------------------------------------
    if (!this.over) {
      this.speed = Math.min(1.05, 0.42 + this.dist * 0.004);
      this.dist += this.speed * dt * 10;
      for (const ob of this.obs) ob.z -= this.speed * dt;
      this.lastSpawnZ -= this.speed * dt;
      if (this.lastSpawnZ <= 0) {
        this.spawnWave();
        this.lastSpawnZ = 0.34 + Math.random() * 0.22;
      }
      // collisions at the player plane
      for (const ob of this.obs) {
        if (ob.done || ob.z > 0.085 || ob.z < 0.02) continue;
        const inLane = ob.kind === 'bar' || ob.kind === 'hurdle' ? true : Math.abs(this.lane - ob.lane) < 0.55;
        if (!inLane) continue;
        if (ob.kind === 'coin') {
          ob.done = true; this.coins++; this.dist += 2;
          continue;
        }
        const avoided =
          (ob.kind === 'hurdle' && this.jumpT > 0.12) ||
          (ob.kind === 'bar' && this.duckT > 0) ||
          (ob.kind === 'block' && false);
        if (!avoided) {
          ob.done = true;
          this.hearts--;
          this.hurt = 1;
          if (this.hearts <= 0) this.finish();
        } else {
          ob.done = true;
          this.dist += 3;
        }
      }
      this.obs = this.obs.filter((ob) => ob.z > -0.05);
    }
    this.hurt = Math.max(0, this.hurt - dt * 1.4);

    // ---- draw ---------------------------------------------------------------
    this.draw(ctx, now);
  }

  private spawnWave() {
    const r = Math.random();
    if (r < 0.34) {
      // blocks in 1-2 lanes, always leaving an opening
      const open = Math.floor(Math.random() * 3) - 1;
      for (const l of [-1, 0, 1]) {
        if (l !== open && Math.random() < 0.75) this.obs.push({ kind: 'block', lane: l, z: 1, done: false });
      }
    } else if (r < 0.52) {
      this.obs.push({ kind: 'hurdle', lane: 0, z: 1, done: false });
    } else if (r < 0.68) {
      this.obs.push({ kind: 'bar', lane: 0, z: 1, done: false });
    } else {
      const l = Math.floor(Math.random() * 3) - 1;
      for (let i = 0; i < 3; i++) this.obs.push({ kind: 'coin', lane: l, z: 1 + i * 0.09, done: false });
    }
  }

  private finish() {
    if (this.over) return;
    this.over = true;
    setTimeout(() => {
      this.stop();
      const score = Math.round(this.dist) + this.coins * 5;
      const best = Number(localStorage.getItem('gs-rush-best') ?? 0);
      if (score > best) localStorage.setItem('gs-rush-best', String(score));
      this.o.onExit(score, `${Math.round(this.dist)} m, ${this.coins} coins`);
    }, 900);
  }

  // ---- rendering ------------------------------------------------------------

  /** perspective: lane x (-1..1) + depth z (0 player .. 1 horizon) → screen */
  private proj(lx: number, z: number): [number, number, number] {
    const w = this.W, h = this.H;
    const horizonY = h * 0.34;
    const t = 1 - z;                          // 0 far → 1 near
    const persp = 0.12 + 0.88 * t * t;        // nonlinear approach
    const y = horizonY + (h * 0.92 - horizonY) * persp;
    const spread = w * 0.055 + w * 0.36 * persp;
    return [w / 2 + lx * spread, y, persp];
  }

  private draw(ctx: Ctx, now: number) {
    const w = this.W, h = this.H;
    drawSky(ctx, w, h, 1);

    // road
    const [, hy] = this.proj(0, 1);
    ctx.fillStyle = '#241a4e';
    ctx.beginPath();
    const [lx0, ly0] = this.proj(-1.55, 0);
    const [rx0] = this.proj(1.55, 0);
    const [lxH] = this.proj(-1.55, 1);
    const [rxH] = this.proj(1.55, 1);
    ctx.moveTo(lx0, ly0);
    ctx.lineTo(lxH, hy);
    ctx.lineTo(rxH, hy);
    ctx.lineTo(rx0, ly0);
    ctx.closePath();
    ctx.fill();
    // lane lines scrolling
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1.5, h * 0.004);
    for (const ll of [-0.5, 0.5]) {
      const phase = (this.dist * 0.13) % 0.12;
      for (let z = -phase; z < 1; z += 0.12) {
        if (z < 0.02) continue;
        const [x1, y1] = this.proj(ll, z);
        const [x2, y2] = this.proj(ll, Math.min(1, z + 0.05));
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    // edge glow
    for (const e of [-1.55, 1.55]) {
      const [x1, y1] = this.proj(e, 0.02);
      const [x2, y2] = this.proj(e, 1);
      ctx.strokeStyle = 'rgba(255,210,62,0.5)';
      ctx.lineWidth = h * 0.006;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // obstacles far → near
    const sorted = [...this.obs].sort((a, b) => b.z - a.z);
    for (const ob of sorted) {
      if (ob.done && ob.kind === 'coin') continue;
      const [x, y, p] = this.proj(ob.lane, Math.max(0.02, ob.z));
      const s = p;
      if (ob.kind === 'coin') {
        const r = h * 0.028 * s;
        const bob = Math.sin(now / 180 + ob.z * 20) * r * 0.25;
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.05 * s + bob, r * (0.65 + 0.35 * Math.abs(Math.sin(now / 300))), r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b8921f';
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.05 * s + bob, r * 0.4, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      } else if (ob.kind === 'block') {
        const bw = w * 0.13 * s, bh = h * 0.34 * s;
        const grad = ctx.createLinearGradient(x, y - bh, x, y);
        grad.addColorStop(0, '#ff5d73');
        grad.addColorStop(1, '#c23a54');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh, bw, bh, bw * 0.12); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x - bw / 2, y - bh, bw, bh * 0.08);
      } else if (ob.kind === 'hurdle') {
        const bw = w * 0.44 * s, bh = h * 0.1 * s;
        ctx.fillStyle = '#ffa63e';
        ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh, bw, bh, bh * 0.3); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * bw * 0.18 - bw * 0.02, y - bh, bw * 0.04, bh);
      } else {
        // bar: duck under
        const bw = w * 0.5 * s;
        const topY = y - h * 0.42 * s;
        ctx.fillStyle = '#6ee7ff';
        ctx.beginPath(); ctx.roundRect(x - bw / 2, topY, bw, h * 0.07 * s, h * 0.02 * s); ctx.fill();
        ctx.strokeStyle = 'rgba(110,231,255,0.4)';
        ctx.lineWidth = h * 0.008 * s;
        ctx.beginPath(); ctx.moveTo(x - bw / 2, topY + h * 0.035 * s); ctx.lineTo(x - bw / 2, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + bw / 2, topY + h * 0.035 * s); ctx.lineTo(x + bw / 2, y); ctx.stroke();
      }
    }

    // runner
    this.drawRunner(ctx, now);

    // hurt flash
    if (this.hurt > 0) {
      ctx.fillStyle = `rgba(255,60,60,${this.hurt * 0.28})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.over) flashText(ctx, w, h, 'WIPEOUT', '#ff5d5d', 1);

    // hud
    hudScore(ctx, w, h, Math.round(this.dist) + this.coins * 5, `BEST ${Math.max(Number(localStorage.getItem('gs-rush-best') ?? 0), Math.round(this.dist) + this.coins * 5)}`);
    // hearts
    ctx.save();
    ctx.fillStyle = '#ff5d73';
    for (let i = 0; i < this.hearts; i++) {
      const hx = w - w * 0.04 - i * h * 0.045, hy2 = h * 0.075, r = h * 0.014;
      ctx.beginPath();
      ctx.arc(hx - r * 0.55, hy2, r * 0.62, 0, Math.PI * 2);
      ctx.arc(hx + r * 0.55, hy2, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - r * 1.1, hy2 + r * 0.2);
      ctx.lineTo(hx, hy2 + r * 1.5);
      ctx.lineTo(hx + r * 1.1, hy2 + r * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRunner(ctx: Ctx, now: number) {
    const h = this.H;
    const [x, y] = this.proj(this.lane, 0.06);
    const air = this.jumpT > 0 ? Math.sin(Math.min(1, (0.62 - this.jumpT) / 0.62) * Math.PI) : 0;
    const duck = this.duckT > 0 ? 1 : 0;
    const lift = air * h * 0.16;
    const scale = h * 0.0022;
    const bodyH = (duck ? 60 : 110) * scale;
    const py = y - lift;
    ctx.save();
    // shadow
    ctx.fillStyle = `rgba(0,0,10,${0.4 - air * 0.25})`;
    ctx.beginPath(); ctx.ellipse(x, y + 6, 46 * scale * (1 + air * 0.3), 12 * scale, 0, 0, Math.PI * 2); ctx.fill();
    // legs scissor
    const run = Math.sin(now / 90) * (duck ? 0.3 : 1);
    ctx.strokeStyle = '#2a2144';
    ctx.lineWidth = 16 * scale;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, py - bodyH * 0.3);
      ctx.lineTo(x + s * run * 26 * scale, py - bodyH * 0.05 + Math.abs(run) * 6 * scale);
      ctx.stroke();
    }
    // body
    const grad = ctx.createLinearGradient(x, py - bodyH, x, py);
    grad.addColorStop(0, '#ffd23e');
    grad.addColorStop(1, '#ff8a2e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - 26 * scale, py - bodyH, 52 * scale, bodyH * 0.78, 22 * scale);
    ctx.fill();
    // arms pump
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 13 * scale;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * 24 * scale, py - bodyH * 0.62);
      ctx.lineTo(x + s * 40 * scale, py - bodyH * 0.62 + s * run * 22 * scale);
      ctx.stroke();
    }
    // head
    ctx.fillStyle = '#fff7ee';
    ctx.beginPath();
    ctx.arc(x, py - bodyH - 18 * scale * (duck ? 0.4 : 1), 20 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
