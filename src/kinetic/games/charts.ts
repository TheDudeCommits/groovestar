import type { Difficulty } from "../core/settings";
import { random } from "../core/records";
export interface BladeNote {
  beat: number;
  side: "L" | "R";
  height: number;
  dir: number;
}
// Authored eight-beat phrases: [offset, hand, height, cut direction].
// Directions: down, up, screen-right, screen-left. Each phrase includes a recovery.
const phrases: number[][][] = [
  [
    [0, 0, 1, 0],
    [2, 1, 1, 0],
    [4, 0, 0, 1],
    [6, 1, 0, 1],
  ],
  [
    [0, 0, 1, 2],
    [1, 1, 1, 2],
    [3, 0, 0, 0],
    [4, 1, 0, 0],
    [6, 0, 1, 1],
  ],
  [
    [0, 0, 1, 0],
    [0, 1, 1, 0],
    [2, 0, 0, 3],
    [4, 1, 0, 3],
    [6, 0, 1, 0],
    [6, 1, 1, 0],
  ],
  [
    [0, 1, 1, 2],
    [1, 0, 1, 2],
    [2, 1, 0, 1],
    [4, 0, 0, 1],
    [5, 1, 1, 0],
    [6, 0, 1, 0],
  ],
];
export function chart(
  beats: number,
  seed: string,
  difficulty: Difficulty,
  track = 0,
): BladeNote[] {
  const rnd = random(seed);
  const notes: BladeNote[] = [];
  for (let b = 8; b < beats - 8; b += 8) {
    const section = b < 32 ? 0 : b % 64 >= 48 ? 0 : Math.min(3, 1 + track);
    const phrase =
      phrases[section === 0 ? 0 : Math.floor(rnd() * (section + 1))];
    for (const [offset, s, h, dir] of phrase) {
      if (difficulty === "flow" && offset % 2) continue;
      notes.push({ beat: b + offset, side: s ? "R" : "L", height: h, dir });
      if (difficulty === "expert" && b > 48 && offset === 4)
        notes.push({
          beat: b + offset + 1,
          side: s ? "L" : "R",
          height: h,
          dir: dir === 0 ? 1 : 0,
        });
    }
  }
  const seen = new Set<string>();
  return notes
    .sort((a, b) => a.beat - b.beat)
    .filter((n) => {
      const key = `${n.beat}:${n.side}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export interface CourseObstacle {
  at: number;
  lane: number;
  kind: "block" | "hurdle" | "bar" | "coin" | "shield";
}
export function course(
  seed: string,
  seconds = 90,
  difficulty: Difficulty = "flow",
): CourseObstacle[] {
  const rnd = random(seed),
    out: CourseObstacle[] = [];
  let previous = 0;
  for (
    let t = 4;
    t < seconds - 3;
    t += difficulty === "flow" ? 3.6 : difficulty === "athlete" ? 2.9 : 2.4
  ) {
    const open = Math.max(-1, Math.min(1, previous + (rnd() < 0.5 ? -1 : 1)));
    const kind = rnd();
    if (kind < 0.52) {
      for (const lane of [-1, 0, 1])
        if (lane !== open) out.push({ at: t, lane, kind: "block" });
      out.push({ at: t + 0.75, lane: open, kind: "coin" });
      previous = open;
    } else if (kind < 0.76) {
      out.push({ at: t, lane: previous, kind: "hurdle" });
      out.push({ at: t + 0.8, lane: previous, kind: "coin" });
    } else if (kind < 0.91) {
      out.push({ at: t, lane: previous, kind: "bar" });
    } else out.push({ at: t, lane: previous, kind: "shield" });
  }
  return out;
}
export interface PadCue {
  at: number;
  side: "L" | "R";
  high: boolean;
  kind: "pad" | "slip";
}
export function combinations(
  seed: string,
  seconds = 60,
  difficulty: Difficulty = "flow",
): PadCue[] {
  const rnd = random(seed),
    out: PadCue[] = [];
  for (
    let t = 3;
    t < seconds - 3;
    t += difficulty === "flow" ? 6 : difficulty === "athlete" ? 5 : 4.2
  ) {
    out.push(
      { at: t, side: "L", high: true, kind: "pad" },
      {
        at: t + (difficulty === "expert" ? 0.8 : 1.15),
        side: "R",
        high: true,
        kind: "pad",
      },
    );
    if (t > 12 && rnd() < 0.5)
      out.push({
        at: t + (difficulty === "expert" ? 1.8 : 2.7),
        side: rnd() < 0.5 ? "L" : "R",
        high: false,
        kind: "slip",
      });
    else
      out.push({
        at: t + (difficulty === "expert" ? 1.8 : 2.7),
        side: rnd() < 0.5 ? "L" : "R",
        high: false,
        kind: "pad",
      });
  }
  return out;
}
