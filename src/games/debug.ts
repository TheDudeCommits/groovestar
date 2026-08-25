// Gesture debug overlay — the tuning instrument for the movement suite.
// Toggle with the backquote key during any arcade game, or persist with
// localStorage gs-debug = 1. Draws live signal bars with their TUNING
// thresholds, fired-event flashes, and raw-vs-filtered wrist markers, so a
// two-minute session in front of a real camera turns guesswork into
// measurement. Pair with gsTune('swing.minSpeed', ...) in the console —
// changes apply immediately.
//
// The overlay never calls tracker.update(): the running game already pumps
// detection once per frame, and a second detectForVideo call would double
// the CPU cost. It only reads the latest landmarks.

import { SwingDetector, PunchDetector, BodyDetector } from '../pose/gestures';
import { HandRig } from '../pose/rig';
import { TUNING } from './tuning';
import type { TrackerLike } from './shared';

const KEY = 'gs-debug';
export function debugEnabled(): boolean { return localStorage.getItem(KEY) === '1'; }

interface Fired { label: string; at: number; color: string }

export class DebugOverlay {
  private cv = document.createElement('canvas');
  private ctx = this.cv.getContext('2d')!;
  private raf = 0;
  private rig = new HandRig();
  private swing = { L: new SwingDetector('L'), R: new SwingDetector('R') };
  private punch = { L: new PunchDetector('L'), R: new PunchDetector('R') };
  private body = new BodyDetector();
  private fired: Fired[] = [];
  private lastFeed = 0;

  constructor(private getTracker: () => TrackerLike) {
    this.cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40';
  }

  start() {
    document.body.appendChild(this.cv);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.cv.remove();
  }

  private frame() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    if (this.cv.width !== w * dpr) { this.cv.width = w * dpr; this.cv.height = h * dpr; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const tracker = this.getTracker();
    const lms = tracker.latestLandmarks;
    const world = tracker.latestWorld ?? null;
    const t = (tracker.latest as { t?: number }).t ?? performance.now();
    if (lms && t !== this.lastFeed) {
      this.lastFeed = t;
      this.rig.update(lms, world, t, 4 / 3);
      for (const hand of ['L', 'R'] as const) {
        const s = this.swing[hand].update(lms, t);
        if (s) this.flash(`SWING ${hand} ${s.speed.toFixed(1)}`, hand === 'L' ? '#6ee7ff' : '#ffd23e');
        const p = this.punch[hand].update(lms, world, t);
        if (p) this.flash(`PUNCH ${hand} ${(p.strength * 100).toFixed(0)}%`, '#ff5d73');
      }
      const wasJ = this.body.jumping, wasD = this.body.ducking;
      this.body.update(lms, t);
      if (this.body.jumping && !wasJ) this.flash('JUMP', '#7cf95c');
      if (this.body.ducking && !wasD) this.flash('DUCK', '#b39dff');
    }

    const now = performance.now();
    this.fired = this.fired.filter((f) => now - f.at < 2600);

    ctx.font = `700 ${Math.round(h * 0.014)}px 'Baloo 2', sans-serif`;
    ctx.textAlign = 'left';

    // signal bars, right edge
    const bx = w - w * 0.2, bw = w * 0.16;
    let by = h * 0.16;
    const T = TUNING;
    const bar = (label: string, v: number, max: number, thresh: number | null, color: string) => {
      ctx.fillStyle = 'rgba(255,247,238,0.55)';
      ctx.fillText(label, bx, by - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, Math.min(1, Math.max(0, v / max)) * bw, 8);
      if (thresh !== null) {
        ctx.fillStyle = '#fff7ee';
        ctx.fillRect(bx + Math.min(1, thresh / max) * bw - 1, by - 3, 2, 14);
      }
      ctx.fillStyle = 'rgba(255,247,238,0.8)';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(2), bx + bw + 40, by + 8);
      ctx.textAlign = 'left';
      by += h * 0.042;
    };

    const hl = this.rig.hand('L'), hr = this.rig.hand('R');
    bar('L SPEED  swing.minSpeed', hl?.rel ?? 0, 12, T.swing.minSpeed, '#6ee7ff');
    bar('R SPEED  swing.minSpeed', hr?.rel ?? 0, 12, T.swing.minSpeed, '#ffd23e');
    if (world) {
      bar('L PUNCH m/s  punch.minZVel', Math.max(0, hl?.zVel ?? 0), 5, T.punch.minZVel, '#ff5d73');
      bar('R PUNCH m/s  punch.minZVel', Math.max(0, hr?.zVel ?? 0), 5, T.punch.minZVel, '#ff5d73');
    } else {
      ctx.fillStyle = 'rgba(255,93,115,0.8)';
      ctx.fillText('NO WORLD LANDMARKS  (fallback punch path)', bx, by);
      by += h * 0.042;
    }
    bar('L EXTEND', hl?.extend ?? 0, 3, T.punch.fallbackShort, '#b39dff');
    bar('R EXTEND', hr?.extend ?? 0, 3, T.punch.fallbackShort, '#b39dff');

    // lane meter
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText('LANE  body.laneFullSW', bx, by - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = '#7cf95c';
    ctx.fillRect(bx + bw / 2 + (this.body.lane * bw) / 2 - 2, by - 2, 4, 12);
    by += h * 0.042;

    // state lamps
    const lamp = (label: string, on: boolean, color: string, i: number) => {
      ctx.fillStyle = on ? color : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(bx + 6 + i * bw * 0.34, by + 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,247,238,0.7)';
      ctx.fillText(label, bx + 16 + i * bw * 0.34, by + 8);
    };
    lamp('JUMP', this.body.jumping, '#7cf95c', 0);
    lamp('DUCK', this.body.ducking, '#b39dff', 1);
    lamp('POSE', !!lms, '#ffd23e', 2);
    by += h * 0.05;

    // fired-event log
    for (const f of this.fired.slice(-8)) {
      const a = Math.max(0, 1 - (now - f.at) / 2600);
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 0.25 + a * 0.75;
      ctx.fillText(f.label, bx, by);
      ctx.globalAlpha = 1;
      by += h * 0.026;
    }

    // wrist markers: raw landmark (dim) vs rig predicted (bright)
    if (lms) {
      for (const [i, color] of [[15, '#6ee7ff'], [16, '#ffd23e']] as const) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc((1 - lms[i].x) * w, lms[i].y * h, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      for (const hand of ['L', 'R'] as const) {
        const s = this.rig.hand(hand);
        if (!s) continue;
        ctx.strokeStyle = hand === 'L' ? '#6ee7ff' : '#ffd23e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.px * w, s.py * h, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(255,247,238,0.45)';
    ctx.fillText('GESTURE DEBUG   backquote hides   gsTune() in console', bx, h * 0.11);
  }

  private flash(label: string, color: string) {
    this.fired.push({ label, at: performance.now(), color });
  }
}

/** wire the backquote hotkey once; `active` gates it to arcade play */
export function installDebugHotkey(getTracker: () => TrackerLike, active: () => boolean) {
  let overlay: DebugOverlay | null = null;
  const sync = (on: boolean) => {
    localStorage.setItem(KEY, on ? '1' : '0');
    if (on && !overlay && active()) { overlay = new DebugOverlay(getTracker); overlay.start(); }
    if (!on && overlay) { overlay.stop(); overlay = null; }
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || !active()) return;
    sync(!(overlay !== null));
  });
  return {
    /** call when an arcade game starts: shows the overlay if persisted on */
    enter() { if (debugEnabled()) sync(true); },
    /** call when an arcade game ends */
    exit() { if (overlay) { overlay.stop(); overlay = null; } },
  };
}
