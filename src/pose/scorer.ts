// Move evaluation. For each choreography move we open a window around its beat,
// keep the player's best pose-similarity inside it, blend in motion energy
// (deliberately forgiving — the reference rewards enthusiasm, it is not a
// mocap exam), and emit a judgment right after the window closes.

import { MOVES, poseFeatures } from '../moves';
import type { ChoreoMove } from '../songs';
import type { PlayerFrame } from './tracker';

export type Judgment = 'X' | 'OK' | 'GOOD' | 'SUPER' | 'PERFECT' | 'YEAH';

export interface JudgmentEvent {
  judgment: Judgment;
  gold: boolean;
  score: number;       // points awarded
  moveIndex: number;
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
  score = 0;
  combo = 0;
  judged = 0;
  counts: Record<Judgment, number> = { X: 0, OK: 0, GOOD: 0, SUPER: 0, PERFECT: 0, YEAH: 0 };
  /** true → no camera; judgments are simulated so presentation still works */
  demoMode = false;

  constructor(choreo: ChoreoMove[]) {
    this.slots = choreo.map((move, index) => ({ move, index, best: 0, sawPlayer: false, done: false }));
    // gold moves are worth double
    const weight = choreo.reduce((n, m) => n + (m.gold ? 2 : 1), 0);
    this.perMove = MAX_SCORE / weight;
  }

  /** feed the current player frame; call every rAF */
  update(beat: number, frame: PlayerFrame | null): JudgmentEvent[] {
    const out: JudgmentEvent[] = [];
    for (const slot of this.slots) {
      if (slot.done) continue;
      const d = beat - slot.move.beat;
      if (d < -WINDOW) break; // slots are beat-ordered
      if (d <= WINDOW) {
        const sim = this.similarity(slot, frame);
        if (sim !== null) {
          slot.sawPlayer = true;
          // slight timing shaping: dead-center hits count a touch more
          const timing = 1 - 0.15 * Math.min(1, Math.abs(d) / WINDOW);
          slot.best = Math.max(slot.best, sim * timing);
        }
      } else {
        slot.done = true;
        out.push(this.judge(slot));
      }
    }
    return out;
  }

  private similarity(slot: Slot, frame: PlayerFrame | null): number | null {
    if (this.demoMode) {
      // scripted-but-plausible results so menus/HUD can be exercised without a camera
      const r = Math.sin(slot.index * 12.9898) * 43758.5453;
      return 0.55 + (r - Math.floor(r)) * 0.4;
    }
    if (!frame || !frame.features) return null;
    const target = poseFeatures(MOVES[slot.move.move].pose);
    const f = frame.features;
    // arms weighted heavily; forearms slightly less than upper arms
    const weights = [1.0, 0.7, 1.0, 0.7, 0.55];
    let acc = 0, wsum = 0;
    for (let i = 0; i < target.length; i++) {
      const diff = wrapDiff(target[i], f[i]);
      // 0° → 1.0, 90°+ → 0; generous curve
      const s = Math.max(0, 1 - diff / 105);
      acc += s * weights[i];
      wsum += weights[i];
    }
    const poseSim = acc / wsum;
    const energyTarget = MOVES[slot.move.move].energy;
    const energySim = Math.min(1, frame.energy / Math.max(0.12, energyTarget * 0.5));
    // 70% pose accuracy, 30% "are you actually moving with it"
    return poseSim * 0.7 + energySim * 0.3;
  }

  private judge(slot: Slot): JudgmentEvent {
    const gold = !!slot.move.gold;
    let judgment: Judgment;
    const b = slot.best;
    if (!slot.sawPlayer && !this.demoMode) judgment = 'X';
    else if (b >= 0.78) judgment = 'PERFECT';
    else if (b >= 0.66) judgment = 'SUPER';
    else if (b >= 0.5) judgment = 'GOOD';
    else if (b >= 0.32) judgment = 'OK';
    else judgment = 'X';

    const frac: Record<Judgment, number> = { X: 0, OK: 0.35, GOOD: 0.65, SUPER: 0.85, PERFECT: 1, YEAH: 1 };
    let pts = this.perMove * frac[judgment];
    if (gold && judgment !== 'X' && judgment !== 'OK') {
      judgment = 'YEAH';
      pts = this.perMove * 2;
    } else if (gold) {
      pts *= 2;
    }
    if (judgment === 'X') this.combo = 0; else this.combo++;
    this.score += pts;
    this.judged++;
    this.counts[judgment]++;
    return { judgment, gold, score: pts, moveIndex: slot.index };
  }

  /** 0..5 stars + superstar beyond, matching the reference meter feel */
  stars(): number {
    const r = this.score / MAX_SCORE;
    const th = [0.12, 0.26, 0.42, 0.58, 0.74];
    let s = 0;
    for (const t of th) if (r >= t) s++;
    return s;
  }
  get superstar() { return this.score / MAX_SCORE >= 0.88; }
  get ratio() { return Math.min(1, this.score / MAX_SCORE); }
}
