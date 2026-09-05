// Boxing — fitness pad work. Pads light up left/right, high/low: punch them
// with the matching hand before the ring runs out. DODGE cues make you lean.
// Punches are detected by depth fusion (z-velocity + arm foreshortening),
// not just 2D speed, so you really have to throw them at the camera.

import { PunchDetector, BodyDetector } from '../pose/gestures';
import { drawSky, hudScore, hudTimer, flashText, type Game, type GameOpts, type Ctx } from './shared';

const ROUND_SECS = 60;

interface Pad {
  hand: 'L' | 'R';
  high: boolean;
  born: number;
  ttl: number;          // ms lifespan
  hit: boolean;
  hitAt: number;
  dead: boolean;
}

interface Cue { kind: 'dodgeL' | 'dodgeR'; born: number; ttl: number; ok: boolean; dead: boolean }

export class BoxGame implements Game {
  private punchL = new PunchDetector('L');
  private punchR = new PunchDetector('R');
  private body = new BodyDetector();
  private pads: Pad[] = [];
  private cues: Cue[] = [];
  private score = 0;
  private punches = 0;
  private combo = 0;
  private judg = { text: '', color: '#fff', t: 0 };
  private t0 = performance.now();
  private lastSpawn = 0;
  private raf = 0;
  private over = false;
  private lastT = performance.now();
  private demoT = 0;

  constructor(private o: GameOpts) {}

  start() {
    this.t0 = performance.now();
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
    const elapsed = (now - this.t0) / 1000;
    const left = Math.max(0, ROUND_SECS - elapsed);
    tracker.update();

    // spawn rhythm speeds up
    const every = Math.max(700, 1400 - elapsed * 11);
    if (now - this.lastSpawn > every && left > 2) {
      this.lastSpawn = now;
      if (Math.random() < 0.16 && elapsed > 8) {
        this.cues.push({ kind: Math.random() < 0.5 ? 'dodgeL' : 'dodgeR', born: now, ttl: 1500, ok: false, dead: false });
      } else {
        this.pads.push({
          hand: Math.random() < 0.5 ? 'L' : 'R',
          high: Math.random() < 0.6,
          born: now, ttl: Math.max(950, 1700 - elapsed * 9),
          hit: false, hitAt: 0, dead: false,
        });
      }
    }

    // detection
    let evs: { hand: 'L' | 'R'; strength: number }[] = [];
    if (this.o.cameraOk) {
      this.body.update(tracker.latestLandmarks, now);
      const l = this.punchL.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now);
      const r = this.punchR.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now);
      if (l) evs.push(l);
      if (r) evs.push(r);
    } else {
      this.demoT += dt;
      const active = this.pads.find((p) => !p.hit && !p.dead);
      if (active && now - active.born > 420) evs.push({ hand: active.hand, strength: 0.7 + Math.random() * 0.3 });
      for (const c of this.cues) if (!c.ok && !c.dead) c.ok = true;
    }

    // resolve punches against pads
    for (const ev of evs) {
      const pad = this.pads.find((p) => !p.hit && !p.dead && p.hand === ev.hand);
      if (pad) {
        pad.hit = true;
        pad.hitAt = now;
        this.punches++;
        this.combo++;
        const fast = (now - pad.born) < pad.ttl * 0.55;
        const pts = (fast ? 10 : 6) + Math.round(ev.strength * 5) + Math.min(10, this.combo);
        this.score += pts;
        this.judge(fast ? 'PERFECT' : 'GOOD', fast ? '#ffd23e' : '#7cf95c');
      }
    }

    // dodge cues resolved by lean
    for (const c of this.cues) {
      if (c.dead) continue;
      if (this.o.cameraOk) {
        if ((c.kind === 'dodgeL' && this.body.lane < -0.5) || (c.kind === 'dodgeR' && this.body.lane > 0.5)) c.ok = true;
      }
      if (now - c.born > c.ttl) {
        c.dead = true;
        if (c.ok) { this.score += 8; this.judge('DODGED', '#6ee7ff'); }
        else { this.combo = 0; this.judge('TOO SLOW', '#ff5d5d'); }
      }
    }
    // expire pads
    for (const p of this.pads) {
      if (!p.hit && !p.dead && now - p.born > p.ttl) {
        p.dead = true;
        this.combo = 0;
        this.judge('MISS', '#ff5d5d');
      }
      if (p.hit && now - p.hitAt > 350) p.dead = true;
    }
    this.pads = this.pads.filter((p) => !p.dead || now - p.born < p.ttl + 600);
    this.cues = this.cues.filter((c) => !c.dead || now - c.born < c.ttl + 400);
    this.judg.t = Math.max(0, this.judg.t - dt);

    this.draw(ctx, now, left);

    if (left <= 0 && !this.over) {
      this.over = true;
      this.stop();
      const best = Number(localStorage.getItem('gs-box-best') ?? 0);
      if (this.o.cameraOk && this.score > best) localStorage.setItem('gs-box-best', String(this.score));
      this.o.onExit(this.score, `${this.punches} punches in ${ROUND_SECS} seconds`);
    }
  }

  private judge(text: string, color: string) { this.judg = { text, color, t: 0.8 }; }

  private draw(ctx: Ctx, now: number, left: number) {
    const w = this.W, h = this.H;
    drawSky(ctx, w, h);
    // ring floor + ropes
    ctx.fillStyle = '#2a2154';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    for (let i = 0; i < 3; i++) {
      const y = h * (0.36 + i * 0.09);
      ctx.strokeStyle = i === 1 ? 'rgba(255,93,115,0.7)' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = h * 0.009;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(w / 2, y + h * 0.02, w, y);
      ctx.stroke();
    }

    // pads
    for (const p of this.pads) {
      const x = w * (p.hand === 'L' ? 0.3 : 0.7);
      const y = h * (p.high ? 0.34 : 0.56);
      const r = h * 0.085;
      const lifeFrac = Math.max(0, 1 - (now - p.born) / p.ttl);
      ctx.save();
      if (p.hit) {
        const k = Math.min(1, (now - p.hitAt) / 300);
        ctx.globalAlpha = 1 - k;
        ctx.translate(x, y);
        ctx.scale(1 + k * 0.7, 1 + k * 0.7);
        ctx.translate(-x, -y);
      }
      // mitt
      const col = p.hand === 'L' ? '#6ee7ff' : '#ffd23e';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
      // countdown ring
      if (!p.hit) {
        ctx.strokeStyle = lifeFrac < 0.35 ? '#ff5d5d' : '#ffffff';
        ctx.lineWidth = h * 0.008;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeFrac);
        ctx.stroke();
        // hand tag
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `400 ${h * 0.028}px 'Lilita One', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.hand, x, y - r * 1.45);
      }
      ctx.restore();
    }

    // dodge cues: incoming glove from the side
    for (const c of this.cues) {
      if (c.dead) continue;
      const k = Math.min(1, (now - c.born) / c.ttl);
      const fromL = c.kind === 'dodgeR';       // glove comes from the left → dodge right
      const x = fromL ? w * (0.05 + k * 0.4) : w * (0.95 - k * 0.4);
      const y = h * 0.4;
      const r = h * 0.11;
      ctx.fillStyle = '#ff5d73';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff7ee';
      ctx.font = `400 ${h * 0.034}px 'Lilita One', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(c.kind === 'dodgeL' ? 'DODGE LEFT' : 'DODGE RIGHT', w / 2, h * 0.22);
    }

    // judgment
    if (this.judg.t > 0) flashText(ctx, w, h, this.judg.text, this.judg.color, Math.min(1, this.judg.t * 2), 0.8);
    // combo
    if (this.combo >= 3) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd23e';
      ctx.font = `400 ${h * 0.04}px 'Lilita One', sans-serif`;
      ctx.fillText(`x${this.combo}`, w * 0.96, h * 0.16);
      ctx.restore();
    }

    hudScore(ctx, w, h, this.score, `${this.punches} PUNCHES`);
    hudTimer(ctx, w, h, left, ROUND_SECS);
  }
}
