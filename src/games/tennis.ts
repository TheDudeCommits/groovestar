// Tennis — rally against an AI that gets meaner every return. When the ball
// reaches your side, swing: timing decides contact, swing direction places
// the shot, swing speed powers it. First to 5 points.

import { SwingDetector } from '../pose/gestures';
import { drawSky, flashText, type Game, type GameOpts, type Ctx } from './shared';

const WIN_POINTS = 5;

export class TennisGame implements Game {
  private swingL = new SwingDetector('L', 1.3);
  private swingR = new SwingDetector('R', 1.3);
  private ball = { lx: 0, z: 0.9, vlx: 0, vz: -0.5, y: 0.5, vy: 0 };  // z: 0 player, 1 AI
  private ballLive = true;
  private me = 0;
  private ai = 0;
  private rally = 0;
  private aiX = 0;
  private msg = '';
  private msgT = 0;
  private hitFlash = 0;
  private playerX = 0;
  private over = false;
  private raf = 0;
  private lastT = performance.now();
  private demoT = 0;
  private trail: { x: number; y: number; a: number }[] = [];

  constructor(private o: GameOpts) {}

  start() {
    this.serve(1);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private serve(fromAi: number) {
    this.ball = {
      lx: (Math.random() - 0.5) * 0.5, z: fromAi ? 0.92 : 0.08,
      vlx: (Math.random() - 0.5) * 0.28,
      vz: fromAi ? -0.42 : 0.42,
      y: 0.32, vy: 0.16,
    };
    this.ballLive = true;
    this.rally = 0;
  }

  private frame() {
    const { ctx, tracker } = this.o;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    tracker.update();

    // player x follows body
    if (this.o.cameraOk) {
      const lms = tracker.latestLandmarks;
      if (lms) {
        const hx = 1 - (lms[23].x + lms[24].x) / 2;
        this.playerX += ((hx - 0.5) * 2.2 - this.playerX) * Math.min(1, dt * 9);
      }
    } else {
      this.demoT += dt;
      this.playerX += ((this.ball.lx * 1.6) - this.playerX) * Math.min(1, dt * 5);
    }

    if (this.ballLive && !this.over) {
      // physics
      this.ball.z += this.ball.vz * dt;
      this.ball.lx = Math.max(-0.95, Math.min(0.95, this.ball.lx + this.ball.vlx * dt));
      this.ball.y += this.ball.vy * dt;
      this.ball.vy -= 1.15 * dt;
      if (this.ball.y <= 0) { this.ball.y = 0; this.ball.vy = Math.abs(this.ball.vy) * 0.72 + 0.12; }

      // AI side
      this.aiX += (this.ball.lx - this.aiX) * Math.min(1, dt * (2.2 + this.rally * 0.25));
      this.aiX = Math.max(-0.9, Math.min(0.9, this.aiX));
      if (this.ball.z >= 0.94 && this.ball.vz > 0) {
        const reach = Math.abs(this.aiX - this.ball.lx) < 0.3 + Math.max(0, 0.25 - this.rally * 0.03);
        if (reach) {
          this.rally++;
          this.ball.vz = -(0.42 + Math.min(0.5, this.rally * 0.05));
          this.ball.vlx = (Math.random() - 0.5) * (0.4 + this.rally * 0.05);
          this.ball.vy = 0.22;
        } else {
          this.point(true);
        }
      }

      // player side: swing window
      if (this.ball.z <= 0.14 && this.ball.vz < 0) {
        let hit = false;
        if (this.o.cameraOk) {
          const ev = this.swingL.update(tracker.latestLandmarks, now) ?? this.swingR.update(tracker.latestLandmarks, now);
          if (ev && Math.abs(this.playerX - this.ball.lx * 1.6) < 0.9) {
            hit = true;
            this.returnBall(ev.speed, ev.dir[0]);
          }
        } else if (this.ball.z <= 0.1) {
          hit = true;
          this.returnBall(2.2 + Math.random(), (Math.random() - 0.5) * 1.2);
        }
        if (!hit && this.ball.z <= 0.015) this.point(false);
      }
      // swing detectors need constant feeding even outside the window
      if (this.o.cameraOk && this.ball.z > 0.14) {
        this.swingL.update(tracker.latestLandmarks, now);
        this.swingR.update(tracker.latestLandmarks, now);
      }
    }

    this.msgT = Math.max(0, this.msgT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.draw(ctx, now);
  }

  private returnBall(speed: number, dirX: number) {
    this.rally++;
    this.hitFlash = 1;
    this.ball.z = Math.max(this.ball.z, 0.06);
    this.ball.vz = 0.4 + Math.min(0.55, speed * 0.16);
    this.ball.vlx = Math.max(-0.7, Math.min(0.7, dirX * 1.4));
    this.ball.vy = 0.26;
  }

  private point(mine: boolean) {
    this.ballLive = false;
    if (mine) { this.me++; this.say('POINT'); } else { this.ai++; this.say('MISS'); }
    if (this.me >= WIN_POINTS || this.ai >= WIN_POINTS) {
      this.over = true;
      setTimeout(() => {
        this.stop();
        const best = Number(localStorage.getItem('gs-tennis-best') ?? 0);
        if (this.me > best) localStorage.setItem('gs-tennis-best', String(this.me));
        this.o.onExit(this.me, this.me > this.ai ? `You win ${this.me} to ${this.ai}` : `AI wins ${this.ai} to ${this.me}`);
      }, 1400);
      return;
    }
    setTimeout(() => this.serve(mine ? 0 : 1), 1200);
  }

  private say(m: string) { this.msg = m; this.msgT = 1.1; }

  // ---- rendering ------------------------------------------------------------

  private proj(lx: number, z: number, y = 0): [number, number, number] {
    const w = this.W, h = this.H;
    const t = 1 - z;                              // 1 near player, 0 far
    const persp = 0.16 + 0.84 * t * t;
    const groundY = h * 0.36 + (h * 0.9 - h * 0.36) * persp;
    const spread = w * (0.05 + 0.33 * persp);
    return [w / 2 + lx * spread * 1.7, groundY - y * h * 0.5 * persp, persp];
  }

  private draw(ctx: Ctx, now: number) {
    const w = this.W, h = this.H;
    drawSky(ctx, w, h, 1);
    // court
    ctx.fillStyle = '#2a5e8a';
    ctx.beginPath();
    const [ax, ay] = this.proj(-1.1, 0);
    const [bx] = this.proj(1.1, 0);
    const [cx2, cy2] = this.proj(-1.1, 1);
    const [dx2] = this.proj(1.1, 1);
    ctx.moveTo(ax, ay); ctx.lineTo(cx2, cy2); ctx.lineTo(dx2, cy2); ctx.lineTo(bx, ay);
    ctx.closePath(); ctx.fill();
    // lines
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = Math.max(1.5, h * 0.004);
    for (const lz of [0.02, 0.5, 0.98]) {
      const [x1, y1] = this.proj(-1.05, lz);
      const [x2] = this.proj(1.05, lz);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
    }
    for (const ll of [-1.05, 0, 1.05]) {
      const [x1, y1] = this.proj(ll, 0.02);
      const [x2, y2] = this.proj(ll, 0.98);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // net
    const [nl, ny] = this.proj(-1.1, 0.5);
    const [nr] = this.proj(1.1, 0.5);
    const netH = h * 0.085;
    ctx.fillStyle = 'rgba(20,16,44,0.55)';
    ctx.fillRect(nl, ny - netH, nr - nl, netH);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(nl, ny - netH, nr - nl, netH);
    ctx.beginPath(); ctx.moveTo(nl, ny - netH); ctx.lineTo(nr, ny - netH); ctx.stroke();

    // AI paddle figure
    {
      const [x, y, p] = this.proj(this.aiX, 0.97);
      const s = h * 0.09 * p;
      ctx.fillStyle = '#ff5d73';
      ctx.beginPath(); ctx.roundRect(x - s * 0.4, y - s * 1.6, s * 0.8, s * 1.3, s * 0.3); ctx.fill();
      ctx.fillStyle = '#fff7ee';
      ctx.beginPath(); ctx.arc(x, y - s * 1.85, s * 0.3, 0, Math.PI * 2); ctx.fill();
    }

    // ball + trail
    if (this.ballLive || this.msgT > 0) {
      const [x, y, p] = this.proj(this.ball.lx, Math.max(0.01, Math.min(0.99, this.ball.z)), this.ball.y);
      this.trail.push({ x, y, a: 1 });
      if (this.trail.length > 12) this.trail.shift();
      for (const t of this.trail) {
        t.a *= 0.86;
        ctx.fillStyle = `rgba(214,247,142,${t.a * 0.5})`;
        ctx.beginPath(); ctx.arc(t.x, t.y, h * 0.012 * p, 0, Math.PI * 2); ctx.fill();
      }
      const r = h * 0.019 * (0.5 + p);
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
      g.addColorStop(0, '#eaffb0');
      g.addColorStop(1, '#a8d92e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // shadow
      const [sx2, sy2, sp2] = this.proj(this.ball.lx, Math.max(0.01, Math.min(0.99, this.ball.z)), 0);
      ctx.fillStyle = 'rgba(0,0,20,0.3)';
      ctx.beginPath(); ctx.ellipse(sx2, sy2, h * 0.016 * sp2, h * 0.005 * sp2, 0, 0, Math.PI * 2); ctx.fill();
    }

    // player racket marker
    {
      const [x, y] = this.proj(this.playerX * 0.62, 0.05);
      const glow = this.hitFlash;
      ctx.save();
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = h * 0.009;
      ctx.shadowColor = '#ffd23e';
      ctx.shadowBlur = 12 + glow * 30;
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.1, h * 0.036, h * 0.05, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + h * 0.014, y - h * 0.055);
      ctx.lineTo(x + h * 0.03, y - h * 0.005);
      ctx.stroke();
      ctx.restore();
      // hit window ring
      if (this.ballLive && this.ball.z < 0.3 && this.ball.vz < 0) {
        ctx.strokeStyle = `rgba(255,210,62,${0.6 - this.ball.z})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.arc(x, y - h * 0.08, h * 0.1 * (0.4 + this.ball.z * 2), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (this.msgT > 0) flashText(ctx, w, h, this.msg, this.msg === 'POINT' ? '#ffd23e' : '#ff5d5d', Math.min(1, this.msgT * 2));
    if (this.over) flashText(ctx, w, h, this.me > this.ai ? 'MATCH!' : 'AI TAKES IT', this.me > this.ai ? '#ffd23e' : '#ff5d5d', 1);

    // score
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `400 ${h * 0.045}px 'Lilita One', sans-serif`;
    ctx.fillStyle = '#fff7ee';
    ctx.fillText(`${this.me}  ${this.ai}`, w / 2, h * 0.08);
    ctx.font = `700 ${h * 0.015}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`YOU  VS  AI, rally ${this.rally}`, w / 2, h * 0.108);
    ctx.restore();
    void now;
  }
}
