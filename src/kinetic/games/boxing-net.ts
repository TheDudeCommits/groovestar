import type { PunchKind } from "./boxing-input";

/**
 * Online boxing traffic over a room (see net/room.ts). Each fighter is the
 * authority on their own body: they stream their pose, announce the punches
 * they throw, and decide what the other fighter's punches did to them
 * (blocked, slipped or landed), then report back. The host runs the clock.
 */
export type BxMsg =
  | { k: "pose"; w: number[] }
  | { k: "punch"; id: number; hand: "L" | "R"; kind: PunchKind; power: number; high: boolean }
  | { k: "result"; id: number; out: "hit" | "block" | "slip" | "duck"; dmg: number }
  | { k: "state"; hp: number; st: number; name: string }
  | { k: "round"; phase: string; round: number; left: number }
  | { k: "down" }
  | { k: "count"; n: number }
  | { k: "up"; hp: number }
  | { k: "over"; loser: "sender" | "receiver"; how: string };

/** World joints the opponent's avatar needs (MediaPipe indices). */
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/** Quantize world landmarks: millimeters and visibility percent. */
export function encodeWorld(world: { x: number; y: number; z: number; visibility?: number }[]): number[] {
  const out: number[] = [];
  for (const i of JOINTS) {
    const l = world[i];
    out.push(Math.round((l?.x ?? 0) * 1000), Math.round((l?.y ?? 0) * 1000), Math.round((l?.z ?? 0) * 1000), Math.round((l?.visibility ?? 0) * 100));
  }
  return out;
}

export function decodeWorld(d: number[]) {
  if (!Array.isArray(d) || d.length !== JOINTS.length * 4) return null;
  const lms = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  JOINTS.forEach((idx, k) => {
    lms[idx] = { x: d[k * 4] / 1000, y: d[k * 4 + 1] / 1000, z: d[k * 4 + 2] / 1000, visibility: d[k * 4 + 3] / 100 };
  });
  return lms;
}

/** Damage an online punch does, before the defender's block or slip. */
export const ONLINE_DMG: Record<PunchKind, number> = { jab: 6, cross: 8, hook: 9, uppercut: 10 };
