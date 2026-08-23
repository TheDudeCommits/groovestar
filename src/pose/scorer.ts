// Move evaluation. For each choreography move we open a window around its beat,
// keep the player's best pose-similarity inside it, blend in motion energy
// (deliberately forgiving — the reference rewards enthusiasm, it is not a
// mocap exam), and emit a judgment right after the window closes.

import { MOVES, poseFeatures } from '../moves';
import { CLIPS, clipPose } from '../motion';
import type { ChoreoMove } from '../songs';
import type { FreestyleWindow } from '../choreograph';
import type { PlayerFrame } from './tracker';

export type Judgment = 'X' | 'OK' | 'GOOD' | 'SUPER' | 'PERFECT' | 'YEAH';

export interface JudgmentEvent {
  judgment: Judgment;
  gold: boolean;
  score: number;       // points awarded
  moveIndex: number;   // -1 for freestyle windows
  freestyle?: boolean;
}

export const MAX_SCORE = 13333;

const WINDOW = 0.85;       // beats on each side of the target beat

interface Slot {
  move: ChoreoMove;
  index: number;
  best: number;            // best blended similarity seen in window
  sawPlayer: boolean;
  done: boolean;
}

function wrapDiff(a: number, b: number) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export class Scorer {
  private slots: Slot[];
  private perMove: number;
  /** raw accumulated points — normalized against a simulated flawless run */
  private raw = 0;
  private maxRaw = 1;
  combo = 0;
  judged = 0;
  counts: Record<Judgment, number> = { X: 0, OK: 0, GOOD: 0, SUPER: 0, PERFECT: 0, YEAH: 0 };
  /** per-move log, used by the results victory dance */
  log: { move: string; judgment: Judgment }[] = [];
  /** true → no camera; judgments are simulated so presentation still works */
  demoMode = false;

  private fs: {
    w: FreestyleWindow;
    energySum: number; n: number;
    samples: number[][];
    done: boolean;
  }[];

  constructor(choreo: ChoreoMove[], freestyle: FreestyleWindow[] = []) {
    this.slots = choreo.map((move, index) => ({ move, index, best: 0, sawPlayer: false, done: false }));
    this.fs = freestyle.map((w) => ({ w, energySum: 0, n: 0, samples: [], done: false }));
    const weight = choreo.reduce((n, m) => n + (m.gold ? 2 : 1), 0) + freestyle.length * 5;
    this.perMove = MAX_SCORE / Math.max(1, weight);
    // Normalize against a simulated FLAWLESS run (every move PERFECT, full
    // combo growth, perfect freestyles): only that run scores exactly 13333.
    // No cap — so two different performances can't collide at a ceiling.
    const events = [
      ...choreo.map((m) => ({ beat: m.beat, worth: m.gold ? 2 : 1 })),
      ...freestyle.map((w) => ({ beat: w.end, worth: 5 })),
    ].sort((a, b) => a.beat - b.beat);
    let combo = 0, max = 0;
    for (const ev of events) {
      const mult = combo >= 12 ? 4 : combo >= 8 ? 3 : combo >= 4 ? 2 : 1;
      max += this.perMove * ev.worth * mult;
      combo++;
    }
    this.maxRaw = Math.max(1, max);
  }

  /** displayed score: flawless = exactly MAX_SCORE, everything else below it */
  get score(): number {
    return (this.raw / this.maxRaw) * MAX_SCORE;
  }

  /** combo multiplier: 4+ in a row ×2, 8+ ×3, 12+ ×4 */
  get multiplier(): number {
    return this.combo >= 12 ? 4 : this.combo >= 8 ? 3 : this.combo >= 4 ? 2 : 1;
  }

  /** feed the current player frame; call every rAF */
  update(beat: number, frame: PlayerFrame | null): JudgmentEvent[] {
    const out: JudgmentEvent[] = [];
    for (const f of this.fs) {
      if (f.done) continue;
      if (beat >= f.w.start && beat < f.w.end) {
        if (frame?.features) {
          f.energySum += frame.energy; f.n++;
          // ~4 pose snapshots per beat feed the variety measure
          if (f.samples.length < (beat - f.w.start) * 4) f.samples.push(frame.features.slice(0, 4));
        }
      } else if (beat >= f.w.end) {
        f.done = true;
        out.push(this.judgeFreestyle(f));
      }
    }
    for (const slot of this.slots) {
      if (slot.done) continue;
      const d = beat - slot.move.beat;
      if (d < -WINDOW) break; // slots are beat-ordered
      if (d <= WINDOW) {
        const sim = this.similarity(slot, frame, beat);
        if (sim !== null) {
          slot.sawPlayer = true;
          // timing shaping: dead-center hits count meaningfully more
          const timing = 1 - 0.3 * Math.min(1, Math.abs(d) / WINDOW);
          slot.best = Math.max(slot.best, sim * timing);
        }
      } else {
        slot.done = true;
        out.push(this.judge(slot));
      }
    }
    return out;
  }

  private similarity(slot: Slot, frame: PlayerFrame | null, beat: number): number | null {
    if (this.demoMode) {
      // scripted-but-plausible results so menus/HUD can be exercised without a camera
      const r = Math.sin(slot.index * 12.9898) * 43758.5453;
      return 0.55 + (r - Math.floor(r)) * 0.4;
    }
    if (!frame || !frame.features) return null;
    // motion clips are compared against the pose at THIS instant of the clip —
    // continuous matching, like the reference — statics against their held pose
    const clip = CLIPS[slot.move.move];
    const targetPose = clip
      ? clipPose(clip, Math.max(0, Math.min(clip.b, beat - slot.move.beat)))
      : MOVES[slot.move.move].pose;
    const target = poseFeatures(targetPose);
    const f = frame.features;
    // arms weighted heavily; forearms slightly less than upper arms
    const weights = [1.0, 0.7, 1.0, 0.7, 0.55];
    let acc = 0, wsum = 0;
    for (let i = 0; i < target.length; i++) {
      const diff = wrapDiff(target[i], f[i]);
      // 0° → 1.0, 70°+ → 0 — you have to actually hit the shape
      const s = Math.max(0, 1 - diff / 70);
      acc += s * weights[i];
      wsum += weights[i];
    }
    const poseSim = acc / wsum;
    const energyTarget = clip ? clip.e : MOVES[slot.move.move].energy;
    const energySim = Math.min(1, frame.energy / Math.max(0.15, energyTarget * 0.7));
    // 80% pose accuracy, 20% "are you actually moving with it"
    return poseSim * 0.8 + energySim * 0.2;
  }

  private judge(slot: Slot): JudgmentEvent {
    const gold = !!slot.move.gold;
    let judgment: Judgment;
    const b = slot.best;
    if (!slot.sawPlayer && !this.demoMode) judgment = 'X';
    else if (b >= 0.85) judgment = 'PERFECT';
    else if (b >= 0.73) judgment = 'SUPER';
    else if (b >= 0.58) judgment = 'GOOD';
    else if (b >= 0.36) judgment = 'OK';
    else judgment = 'X';

    const frac: Record<Judgment, number> = { X: 0, OK: 0.35, GOOD: 0.65, SUPER: 0.85, PERFECT: 1, YEAH: 1 };
    let pts = this.perMove * frac[judgment];
    if (gold && judgment !== 'X' && judgment !== 'OK') {
      judgment = 'YEAH';
      pts = this.perMove * 2;
    } else if (gold) {
      pts *= 2;
    }
    pts *= this.multiplier;
    this.bumpCombo(judgment);
    this.raw += pts;
    this.judged++;
    this.counts[judgment]++;
    this.log.push({ move: slot.move.move, judgment });
    return { judgment, gold, score: (pts / this.maxRaw) * MAX_SCORE, moveIndex: slot.index };
  }

  /** X breaks the combo, OK merely holds it — only real hits build it */
  private bumpCombo(j: Judgment) {
    if (j === 'X') this.combo = 0;
    else if (j !== 'OK') this.combo++;
  }

  private judgeFreestyle(f: { energySum: number; n: number; samples: number[][] }): JudgmentEvent {
    let perf: number;
    if (this.demoMode) {
      perf = 0.72;
    } else if (!f.n) {
      perf = 0;
    } else {
      const energyScore = Math.min(1, (f.energySum / f.n) / 0.42);
      // variety: how widely each arm angle roamed across the window
      let variety = 0;
      if (f.samples.length >= 4) {
        for (let d = 0; d < 4; d++) {
          const vals = f.samples.map((s) => s[d]);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
          variety += Math.min(1, sd / 38) / 4;
        }
      }
      perf = energyScore * 0.55 + variety * 0.45;
    }
    const judgment: Judgment =
      perf >= 0.72 ? 'YEAH' : perf >= 0.52 ? 'SUPER' : perf >= 0.34 ? 'GOOD' : perf >= 0.15 ? 'OK' : 'X';
    const pts = this.perMove * 5 * perf * this.multiplier;
    this.bumpCombo(judgment);
    this.raw += pts;
    this.judged++;
    this.counts[judgment]++;
    return { judgment, gold: judgment === 'YEAH', score: (pts / this.maxRaw) * MAX_SCORE, moveIndex: -1, freestyle: true };
  }

  /** 0..5 stars + superstar beyond, matching the reference meter feel */
  stars(): number {
    const r = this.ratio;
    const th = [0.12, 0.26, 0.42, 0.58, 0.74];
    let s = 0;
    for (const t of th) if (r >= t) s++;
    return s;
  }
  get superstar() { return this.ratio >= 0.88; }
  get ratio() { return Math.min(1, this.raw / this.maxRaw); }
}
