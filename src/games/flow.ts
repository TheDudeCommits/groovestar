// Shared round flow for the movement suite: the pre-game body check and
// countdown, and the results count-up. Lives between main.ts's launch code
// and the games so every game gets the same AAA opening beat: camera up,
// body framed and measured, 3-2-1-GO.

import type { TrackerLike } from './shared';
import { saveBodyScale } from '../pose/rig';
import { sfx } from './sfx';

const CAM_ASPECT = 4 / 3;

/**
 * Framing check + body measurement. Pumps the tracker itself (no game loop
 * is running yet). Guides the player into frame, then averages shoulder
 * width and torso length over ~0.8s and persists them for the rig. Resolves
 * quietly after `timeoutMs` if nobody is in frame — the rig self-calibrates
 * live, so this is a best-effort head start, never a gate the player can
 * get stuck on.
 */
export function calibrateBody(tracker: TrackerLike, statusEl: HTMLElement, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const samples: { sw: number; torso: number }[] = [];
    let raf = 0;
    const done = (ok: boolean) => { cancelAnimationFrame(raf); resolve(ok); };
    const step = () => {
      raf = requestAnimationFrame(step);
      tracker.update();
      if (performance.now() - t0 > timeoutMs) return done(false);
      const lms = tracker.latestLandmarks;
      const seen = lms && [11, 12, 23, 24, 15, 16].every((i) => (lms[i].visibility ?? 1) > 0.4);
      if (!seen) {
        statusEl.textContent = 'Step back so your whole upper body is in view';
        samples.length = 0;
        return;
      }
      if (samples.length === 0) statusEl.textContent = 'There you are, hold still';
      const sw = Math.hypot((lms[11].x - lms[12].x) * CAM_ASPECT, lms[11].y - lms[12].y);
      const torso = Math.hypot(
        ((lms[11].x + lms[12].x) / 2 - (lms[23].x + lms[24].x) / 2) * CAM_ASPECT,
        (lms[11].y + lms[12].y) / 2 - (lms[23].y + lms[24].y) / 2,
      );
      samples.push({ sw, torso });
      if (samples.length >= 25) {
        const avg = (f: (s: { sw: number; torso: number }) => number) =>
          samples.reduce((a, s) => a + f(s), 0) / samples.length;
        saveBodyScale({ shoulderW: avg((s) => s.sw), torso: avg((s) => s.torso) });
        statusEl.textContent = 'Locked in';
        done(true);
      }
    };
    step();
  });
}

/** 3-2-1-GO inside the ready card, with ticks; resolves as GO lands */
export function countdown(host: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = `font-family:'Lilita One',sans-serif;font-size:min(14vh,110px);color:#ffd23e;text-align:center;line-height:1.1;margin-top:2vh`;
    host.appendChild(el);
    const steps = ['3', '2', '1', 'GO'];
    let i = 0;
    const next = () => {
      const s = steps[i++];
      el.textContent = s;
      el.animate(
        [{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 240, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
      );
      if (s === 'GO') {
        sfx.go();
        setTimeout(() => { el.remove(); resolve(); }, 420);
      } else {
        sfx.tick();
        setTimeout(next, 650);
      }
    };
    next();
  });
}

/** eased score count-up with ticks; returns a cancel function */
export function countUp(el: HTMLElement, to: number, ms = 1100): () => void {
  const t0 = performance.now();
  let raf = 0;
  let lastTick = 0;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(to * eased));
    if (k < 1) {
      const now = performance.now();
      if (now - lastTick > 40) { lastTick = now; sfx.count(); }
      raf = requestAnimationFrame(step);
    } else {
      el.textContent = String(to);
    }
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
