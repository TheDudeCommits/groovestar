// Bowling — Wii Sports formula. Stand where you want to bowl from (your body
// position aims), then swing your arm: speed is power, a curved wrist path
// hooks the ball. Five frames, two throws each, strikes and spares pay.
// Two-player pass-and-play.

import { SwingDetector } from '../pose/gestures';
import { drawSky, flashText, type Game, type GameOpts, type Ctx } from './shared';

interface Pin { lx: number; z: number; up: boolean; fallA: number; fallT: number }

const FRAMES = 5;

export class BowlGame implements Game {
  private swingL = new SwingDetector('L', 1.15);
  private swingR = new SwingDetector('R', 1.15);
  private pins: Pin[] = [];
  private phase: 'aim' | 'roll' | 'settle' | 'done' = 'aim';
  private aimX = 0;                 // -1..1
  private ball = { lx: 0, z: 0, vz: 0, curve: 0, t: 0 };
  private frame = 0;
  private throwN = 0;
  private scores: number[][] = [];  // per player, per frame pinfall
  private player = 0;
  private msg = '';
  private msgT = 0;
  private raf = 0;
  private lastT = performance.now();
  private demoT = 0;

  constructor(private o: GameOpts, private players: number) {
    for (let p = 0; p < players; p++) this.scores.push([]);
    this.rack();
  }

  start() {
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frameFn(); };
    loop();
  }
  stop() { cancelAnimationFrame(this.raf); }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  private rack() {
    this.pins = [];
    const rows = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];
    rows.forEach((row, ri) => {
      for (const lx of row) this.pins.push({ lx: lx * 0.16, z: 0.86 + ri * 0.045, up: true, fallA: 0, fallT: 0 });
    });
  }

  private frameFn() {
    const { ctx, tracker } = this.o;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    tracker.update();

    if (this.phase === 'aim') {
      if (this.o.cameraOk) {
        const lms = tracker.latestLandmarks;
        if (lms) {
          const hx = 1 - (lms[23].x + lms[24].x) / 2;
          this.aimX += ((hx - 0.5) * 2.6 - this.aimX) * Math.min(1, dt * 8);
          this.aimX = Math.max(-0.9, Math.min(0.9, this.aimX));
        }
        const ev = this.swingL.update(lms, now) ?? this.swingR.update(lms, now);
        if (ev && Math.abs(ev.dir[1]) > 0.25) this.release(ev.speed, ev.dir[0]);
      } else {
        this.demoT += dt;
        this.aimX = Math.sin(this.demoT * 0.7) * 0.4;
        if (this.demoT > 2.4) { this.demoT = 0; this.release(2.2 + Math.random(), (Math.random() - 0.5) * 0.4); }
      }
    } else if (this.phase === 'roll') {
      this.ball.t += dt;
      this.ball.z += this.ball.vz * dt;
      this.ball.lx += this.ball.curve * dt * Math.min(1, this.ball.z * 2.2);
      // pin impact
      for (const pin of this.pins) {
        if (!pin.up) continue;
        if (Math.abs(this.ball.z - pin.z) < 0.035 && Math.abs(this.ball.lx - pin.lx) < 0.075) {
          this.knock(pin, this.ball.lx, 1);
        }
      }
      if (this.ball.z > 1.02) {
        this.phase = 'settle';
        setTimeout(() => this.scoreThrow(), 900);
      }
    }
    for (const pin of this.pins) if (!pin.up && pin.fallT < 1) pin.fallT = Math.min(1, pin.fallT + dt * 3);
    this.msgT = Math.max(0, this.msgT - dt);

    this.draw(ctx);
  }

  private release(speed: number, sideDir: number) {
    this.phase = 'roll';
    this.ball = {
      lx: this.aimX * 0.28, z: 0.04,
      vz: 0.55 + Math.min(0.75, speed * 0.22),
      curve: sideDir * 0.55,
      t: 0,
    };
  }

  private knock(pin: Pin, fromLx: number, power: number) {
    pin.up = false;
    pin.fallA = (pin.lx - fromLx) * 18 + (Math.random() - 0.5) * 1.4;
    // chain to close neighbours
    if (power > 0.4) {
      for (const p2 of this.pins) {
        if (!p2.up || p2 === pin) continue;
        const d = Math.hypot(p2.lx - pin.lx, (p2.z - pin.z) * 2.2);
        if (d < 0.09 && Math.random() < 0.82 * power) this.knock(p2, pin.lx, power * 0.72);
      }
    }
  }

  private scoreThrow() {
    const down = this.pins.filter((p) => !p.up).length;
    const prevDown = this.scores[this.player][this.frame] ?? 0;
    const gained = down - prevDown;
    this.scores[this.player][this.frame] = down;
    this.throwN++;
    if (down === 10 && this.throwN === 1) {
      this.say('STRIKE');
      this.scores[this.player][this.frame] = 15;    // simplified bonus
      this.nextFrame();
    } else if (this.throwN >= 2) {
      if (down === 10) { this.say('SPARE'); this.scores[this.player][this.frame] = 12; }
      else this.say(`${gained > 0 ? down : down} DOWN`);
      this.nextFrame();
    } else {
      this.say(`${down} DOWN`);
      this.phase = 'aim';
    }
  }

  private nextFrame() {
    this.throwN = 0;
    if (this.players === 2 && this.player === 0) {
      this.player = 1;
    } else {
      this.player = 0;
      this.frame++;
    }
    if (this.frame >= FRAMES) {
      this.phase = 'done';
      setTimeout(() => {
        this.stop();
        const totals = this.scores.map((s) => s.reduce((a, b) => a + b, 0));
        const best = Number(localStorage.getItem('gs-bowl-best') ?? 0);
        if (totals[0] > best) localStorage.setItem('gs-bowl-best', String(totals[0]));
        const label = this.players === 2
          ? (totals[0] === totals[1] ? 'Tied game' : `Player ${totals[0] > totals[1] ? 1 : 2} wins ${Math.max(...totals)} to ${Math.min(...totals)}`)
          : `${FRAMES} frames`;
        this.o.onExit(totals[0], label);
      }, 1400);
      return;
    }
    setTimeout(() => { this.rack(); this.phase = 'aim'; }, 1100);
  }

  private say(m: string) { this.msg = m; this.msgT = 1.4; }

  // ---- rendering ------------------------------------------------------------

  private proj(lx: number, z: number): [number, number, number] {
    const w = this.W, h = this.H;
    const horizonY = h * 0.3;
    const t = z;                               // 0 near player, 1 pins
    const persp = 1 - 0.86 * t;
    const y = h * 0.9 - (h * 0.9 - horizonY) * t * (2 - t) * 0.72;
    const spread = w * (0.06 + 0.36 * persp);
    return [w / 2 + lx * spread * 2.4, y, persp];
  }

  private draw(ctx: Ctx) {
    const w = this.W, h = this.H;
    drawSky(ctx, w, h);
    // lane
    ctx.fillStyle = '#3a2a6e';
    ctx.beginPath();
    const [l0x, l0y] = this.proj(-0.42, 0);
    const [r0x] = this.proj(0.42, 0);
    const [l1x, l1y] = this.proj(-0.42, 1);
    const [r1x] = this.proj(0.42, 1);
    ctx.moveTo(l0x, l0y); ctx.lineTo(l1x, l1y); ctx.lineTo(r1x, l1y); ctx.lineTo(r0x, l0y);
    ctx.closePath(); ctx.fill();
    // boards
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) {
      const [ax, ay] = this.proj(i * 0.12, 0);
      const [bx, by] = this.proj(i * 0.12, 1);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    // gutters glow
    for (const e of [-0.46, 0.46]) {
      const [ax, ay] = this.proj(e, 0);
      const [bx, by] = this.proj(e, 1);
      ctx.strokeStyle = 'rgba(255,210,62,0.4)';
      ctx.lineWidth = h * 0.005;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // pins (far first)
    const pins = [...this.pins].sort((a, b) => b.z - a.z);
    for (const pin of pins) {
      const [x, y, p] = this.proj(pin.lx, pin.z);
      const s = h * 0.11 * p;
      ctx.save();
      ctx.translate(x, y);
      if (!pin.up) {
        ctx.rotate(pin.fallA * pin.fallT * 0.12 + (pin.fallA > 0 ? 1 : -1) * pin.fallT * 1.35);
        ctx.globalAlpha = 1 - pin.fallT * 0.35;
      }
      // body
      ctx.fillStyle = '#fff7ee';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.32, s * 0.16, s * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -s * 0.68, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      // neck stripes
      ctx.strokeStyle = '#ff5d73';
      ctx.lineWidth = s * 0.045;
      ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.52); ctx.lineTo(s * 0.12, -s * 0.52); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.45); ctx.lineTo(s * 0.1, -s * 0.45); ctx.stroke();
      ctx.restore();
    }

    // ball
    if (this.phase === 'roll' || this.phase === 'settle') {
      const [x, y, p] = this.proj(this.ball.lx, Math.min(1, this.ball.z));
      const r = h * 0.05 * p;
      const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.2, x, y, r);
      g.addColorStop(0, '#b39dff');
      g.addColorStop(1, '#5a3dd0');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - r * 0.4, r, 0, Math.PI * 2); ctx.fill();
      // finger holes
      ctx.fillStyle = 'rgba(20,12,40,0.6)';
      for (const [ox, oy] of [[-0.25, -0.5], [0.05, -0.62], [0.25, -0.42]] as const) {
        ctx.beginPath(); ctx.arc(x + ox * r, y + oy * r - r * 0.2, r * 0.09, 0, Math.PI * 2); ctx.fill();
      }
    }

    // aim marker + arrow
    if (this.phase === 'aim') {
      const [x, y] = this.proj(this.aimX * 0.28, 0.05);
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = h * 0.006;
      ctx.setLineDash([h * 0.012, h * 0.014]);
      const [tx, ty] = this.proj(this.aimX * 0.28, 0.8);
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.02); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(x, y, h * 0.016, 0, Math.PI * 2);
      ctx.fill();
    }

    // messages + hud
    if (this.msgT > 0) flashText(ctx, w, h, this.msg, this.msg === 'STRIKE' ? '#ffd23e' : '#fff7ee', Math.min(1, this.msgT * 2));
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `400 ${h * 0.034}px 'Lilita One', sans-serif`;
    ctx.fillStyle = '#fff7ee';
    const totals = this.scores.map((s) => s.reduce((a, b) => a + b, 0));
    ctx.fillText(this.players === 2 ? `P1 ${totals[0]}  P2 ${totals[1]}` : String(totals[0]), w * 0.045, h * 0.09);
    ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.6)';
    ctx.fillText(`Frame ${Math.min(FRAMES, this.frame + 1)} of ${FRAMES}${this.players === 2 ? `, player ${this.player + 1}` : ''}`, w * 0.046, h * 0.122);
    if (this.phase === 'aim') {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,247,238,0.75)';
      ctx.font = `700 ${h * 0.02}px 'Baloo 2', sans-serif`;
      ctx.fillText('Step sideways to aim, then swing your arm', w / 2, h * 0.95);
    }
    ctx.restore();
  }
}
