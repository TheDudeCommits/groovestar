import type { Difficulty } from "../core/settings";
import { random } from "../core/records";

/**
 * Cut directions, as the player sees them on screen (mirrored view):
 * 0 down, 1 up, 2 left, 3 right, 4 down-left, 5 down-right, 6 up-left,
 * 7 up-right, 8 any direction (a dot).
 */
export type CutDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Screen-space unit vector of each cut (y grows downward). */
export const CUT_VEC: Record<CutDir, [number, number]> = {
  0: [0, 1],
  1: [0, -1],
  2: [-1, 0],
  3: [1, 0],
  4: [-Math.SQRT1_2, Math.SQRT1_2],
  5: [Math.SQRT1_2, Math.SQRT1_2],
  6: [-Math.SQRT1_2, -Math.SQRT1_2],
  7: [Math.SQRT1_2, -Math.SQRT1_2],
  8: [0, 0],
};

export interface BeatNote {
  beat: number;
  hand: "L" | "R";
  /** 0..3 left to right */
  col: number;
  /** 0 bottom, 1 middle, 2 top */
  row: number;
  dir: CutDir;
  kind: "note" | "bomb";
}

export interface ChartSection {
  beat: number;
  kind: "intro" | "verse" | "chorus" | "bridge" | "outro";
}

const DOWNS: CutDir[] = [0, 0, 0, 4, 5];
const UPS: CutDir[] = [1, 1, 1, 6, 7];

/**
 * Beat Saber-style charts built on the song's own beat grid and sections.
 *
 * Every hand alternates down and up swings (parity), so each cut starts
 * where the last one ended and the arms never have to reset. Left notes
 * stay in the left two columns and right notes in the right two, rows follow
 * the swing (down cuts sit high, up cuts low) and density rises with the
 * song: sparse intros, steady verses, doubles and streams in the chorus.
 */
export function bladeChart(
  totalBeats: number,
  sections: ChartSection[],
  seed: string,
  difficulty: Difficulty,
): BeatNote[] {
  const rnd = random(`blade:${seed}:${difficulty}`);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const notes: BeatNote[] = [];
  const next: Record<"L" | "R", "down" | "up"> = { L: "down", R: "down" };
  const sorted = [...sections].sort((a, b) => a.beat - b.beat);
  const sectionAt = (b: number) => {
    let s = sorted[0]?.kind ?? "verse";
    for (const x of sorted) if (x.beat <= b) s = x.kind;
    return s;
  };
  const level = (kind: ChartSection["kind"]) => {
    const base = { intro: 0, outro: 0, verse: 1, bridge: 1, chorus: 2 }[kind];
    return difficulty === "flow" ? Math.min(1, base) : difficulty === "athlete" ? base : Math.min(3, base + 1);
  };
  const place = (beat: number, hand: "L" | "R", opts: { horizontal?: boolean; dot?: boolean } = {}) => {
    const swing = next[hand];
    next[hand] = swing === "down" ? "up" : "down";
    let dir: CutDir;
    if (opts.dot) dir = 8;
    else if (opts.horizontal) {
      // inward then outward, which keeps parity for a sideways pair
      dir = swing === "down" ? (hand === "L" ? 3 : 2) : hand === "L" ? 2 : 3;
    } else dir = swing === "down" ? pick(DOWNS) : pick(UPS);
    // diagonals point away from the other hand, never across the body
    if (hand === "L" && (dir === 5 || dir === 7)) dir = dir === 5 ? 4 : 6;
    if (hand === "R" && (dir === 4 || dir === 6)) dir = dir === 4 ? 5 : 7;
    const inner = rnd() < 0.72;
    const col = hand === "L" ? (inner ? 1 : 0) : inner ? 2 : 3;
    const row = opts.horizontal ? 1 : swing === "down" ? (rnd() < 0.55 ? 1 : 2) : rnd() < 0.6 ? 1 : 0;
    notes.push({ beat, hand, col, row, dir, kind: "note" });
  };

  const start = 8,
    end = totalBeats - 6;
  let hand: "L" | "R" = "L";
  for (let bar = start; bar < end; bar += 4) {
    const kind = sectionAt(bar);
    const lv = level(kind);
    const barRnd = rnd();
    if (lv === 0) {
      // one note every two beats, alternating hands
      place(bar, hand);
      hand = hand === "L" ? "R" : "L";
      if (bar + 2 < end) {
        place(bar + 2, hand);
        hand = hand === "L" ? "R" : "L";
      }
      continue;
    }
    if (lv === 1) {
      // steady: one note per beat, alternating; now and then a double
      for (let b = 0; b < 4; b++) {
        const beat = bar + b;
        if (beat >= end) break;
        if (b === 0 && barRnd < 0.3) {
          place(beat, "L");
          place(beat, "R");
          continue;
        }
        if (b === 3 && barRnd > 0.75) continue; // a breath
        place(beat, hand, { horizontal: kind === "bridge" && b === 2 && rnd() < 0.5 });
        hand = hand === "L" ? "R" : "L";
      }
      continue;
    }
    // lv 2-3: chorus energy. Doubles on the downbeat, alternating streams.
    const step = lv >= 3 && barRnd < 0.5 ? 0.5 : 1;
    for (let b = 0; b < 4; b += step) {
      const beat = bar + b;
      if (beat >= end) break;
      if (b === 0 || (lv >= 3 && b === 2 && barRnd > 0.6)) {
        place(beat, "L");
        place(beat, "R");
        continue;
      }
      place(beat, hand, { horizontal: rnd() < 0.12 });
      hand = hand === "L" ? "R" : "L";
    }
    // bombs on higher difficulties sit where the free hand would swing
    if (difficulty !== "flow" && kind === "chorus" && rnd() < 0.35) {
      const beat = bar + 1.5;
      if (beat < end) notes.push({ beat, hand: rnd() < 0.5 ? "L" : "R", col: rnd() < 0.5 ? 0 : 3, row: 2, dir: 8, kind: "bomb" });
    }
  }
  return notes.sort((a, b) => a.beat - b.beat || (a.hand === "L" ? -1 : 1));
}
