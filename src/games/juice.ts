// Juice — the shared feel toolkit for the movement suite: hit-stop, slow-mo,
// screen shake with rotation, a pooled particle system (sparks, shards,
// shockwave rings, dust), floating score pops, squash-and-stretch, and
// pre-rendered glow sprites that replace canvas shadowBlur (the single
// slowest thing a 2D canvas can do — glow sprites are one drawImage).
//
// Usage per game:
//   const juice = new Juice();
//   const dt = juice.step(rawDt);          // scaled dt: freezes + slow-mo
//   juice.shake(10, 220); juice.hitStop(60);
//   ctx.save(); juice.applyShake(ctx);     // ...draw world... ctx.restore()
//   juice.update(dt); juice.draw(ctx, h);  // particles + pops on top

type Ctx = CanvasRenderingContext2D;

export type ParticleKind = 'spark' | 'dust' | 'shard' | 'ring';

interface Particle {
  kind: ParticleKind;
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number;
  size: number; life: number; max: number;
  gravity: number; color: string;
  alive: boolean;
}

interface Pop { x: number; y: number; text: string; color: string; size: number; life: number; max: number }

const MAX_PARTICLES = 600;

export class Juice {
  private freezeLeft = 0;                       // seconds of hit-stop left
  private slowScale = 1;
  private slowLeft = 0;
  private shakePow = 0;
  private shakeLeft = 0;
  private shakeDur = 1;
  private pool: Particle[] = [];
  private pops: Pop[] = [];
  private dtEma = 1 / 60;
  /** adaptive quality 0.4..1 — burst counts scale with it so heavy frames
   *  shed particles before they shed frames */
  q = 1;

  /** freeze the world briefly on impact — 40-80ms reads as weight */
  hitStop(ms: number) { this.freezeLeft = Math.max(this.freezeLeft, ms / 1000); }

  /** slow the world (0.2-0.5) for a moment — combo peaks, match point */
  slowmo(scale: number, ms: number) { this.slowScale = scale; this.slowLeft = ms / 1000; }

  shake(power: number, ms: number) {
    this.shakePow = Math.max(this.shakePow, power);
    this.shakeLeft = this.shakeDur = ms / 1000;
  }

  /** convert raw frame dt into gameplay dt (consumes freeze, applies slow-mo) */
  step(rawDt: number): number {
    this.dtEma = this.dtEma * 0.95 + rawDt * 0.05;
    if (this.dtEma > 0.0185 && this.q > 0.4) this.q = Math.max(0.4, this.q - 0.02);
    else if (this.dtEma < 0.0155 && this.q < 1) this.q = Math.min(1, this.q + 0.004);
    if (this.shakeLeft > 0) this.shakeLeft = Math.max(0, this.shakeLeft - rawDt);
    if (this.freezeLeft > 0) {
      this.freezeLeft = Math.max(0, this.freezeLeft - rawDt);
      return 0;
    }
    if (this.slowLeft > 0) {
      this.slowLeft = Math.max(0, this.slowLeft - rawDt);
      if (this.slowLeft === 0) this.slowScale = 1;
      return rawDt * this.slowScale;
    }
    return rawDt;
  }

  get timeScale(): number { return this.freezeLeft > 0 ? 0 : this.slowLeft > 0 ? this.slowScale : 1; }

  /** call between ctx.save() and drawing the world */
  applyShake(ctx: Ctx) {
    if (this.shakeLeft <= 0) return;
    const k = this.shakeLeft / this.shakeDur;
    const p = this.shakePow * k * k;
    ctx.translate((Math.random() - 0.5) * p * 2, (Math.random() - 0.5) * p * 2);
    ctx.rotate((Math.random() - 0.5) * p * 0.0016);
  }

  burst(opts: {
    x: number; y: number; count: number; kind?: ParticleKind;
    color: string | string[]; speed: number; spread?: number; angle?: number;
    size?: number; life?: number; gravity?: number;
  }) {
    const { x, y } = opts;
    const count = Math.max(1, Math.round(opts.count * this.q));
    const kind = opts.kind ?? 'spark';
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color];
    for (let i = 0; i < count; i++) {
      const a = (opts.angle ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
      const sp = opts.speed * (0.4 + Math.random() * 0.9);
      const p = this.alloc();
      if (!p) return;
      p.kind = kind;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 9;
      p.size = (opts.size ?? 5) * (0.6 + Math.random() * 0.8);
      p.max = p.life = (opts.life ?? 0.5) * (0.7 + Math.random() * 0.6);
      p.gravity = opts.gravity ?? 0;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.alive = true;
    }
  }

  /** one expanding shockwave ring */
  ring(x: number, y: number, color: string, size = 60, life = 0.35) {
    const p = this.alloc();
    if (!p) return;
    Object.assign(p, { kind: 'ring', x, y, vx: 0, vy: 0, rot: 0, vr: 0, size, life, max: life, gravity: 0, color, alive: true });
  }

  pop(x: number, y: number, text: string, color: string, size = 1) {
    this.pops.push({ x, y, text, color, size, life: 0.9, max: 0.9 });
    if (this.pops.length > 24) this.pops.shift();
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.rot += p.vr * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - (p.gravity ? 0 : 1.6) * dt;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const q = this.pops[i];
      q.life -= dt;
      q.y -= 40 * dt * q.size;
      if (q.life <= 0) this.pops.splice(i, 1);
    }
  }

  draw(ctx: Ctx, h: number) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const a = p.life / p.max;
      if (p.kind === 'ring') {
        const k = 1 - a;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = a * 0.8;
        ctx.lineWidth = Math.max(1.5, p.size * 0.08 * a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.25 + k * 0.75), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * (p.kind === 'dust' ? 0.5 : 0.95);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1 + (1 - a) : a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.textAlign = 'center';
    for (const q of this.pops) {
      const a = q.life / q.max;
      const grow = 1 + (1 - Math.min(1, a * 3)) * 0.3;    // spawn punch-in
      ctx.globalAlpha = Math.min(1, a * 2.5);
      ctx.fillStyle = q.color;
      ctx.font = `800 ${h * 0.032 * q.size * grow}px 'Baloo 2', sans-serif`;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private alloc(): Particle | null {
    for (const p of this.pool) if (!p.alive) return p;
    if (this.pool.length >= MAX_PARTICLES) return null;
    const p = {} as Particle;
    this.pool.push(p);
    return p;
  }
}

// ---- glow sprites (shadowBlur replacement) ---------------------------------

const glowCache = new Map<string, HTMLCanvasElement>();

export function glowSprite(color: string): HTMLCanvasElement {
  let cv = glowCache.get(color);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = 0.9;
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  glowCache.set(color, cv);
  return cv;
}

/** additive glow at (x, y) with radius r — one drawImage, no shadowBlur */
export function drawGlow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** squash-and-stretch scales for an impact phase 0..1 (0 = moment of impact) */
export function squash(phase: number): { sx: number; sy: number } {
  const k = Math.max(0, 1 - phase);
  const s = Math.sin(k * Math.PI) * 0.25 * k;
  return { sx: 1 + s, sy: 1 - s };
}
