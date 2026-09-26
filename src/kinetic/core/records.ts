import type { GameId } from "./catalog";
import type { Difficulty } from "./settings";
export interface ReplayPoint {
  t: number;
  x: number;
  y: number;
  action?: string;
  score: number;
}
export interface RunRecord {
  id: GameId;
  score: number;
  seconds: number;
  hits: number;
  misses: number;
  combo: number;
  seed: string;
  difficulty: Difficulty;
  lowImpact: boolean;
  camera: boolean;
  track?: number;
  endless?: boolean;
  players?: number;
  details?: { label: string; value: string }[];
  activeSeconds?: number;
  date: string;
  version: 2;
  replay?: ReplayPoint[];
}
export interface Ledger {
  version: 2;
  runs: RunRecord[];
  activeSeconds: number;
  medals: number;
  days: Record<string, number>;
  legacyDays?: string[];
}
const KEY = "gs-kinetic-records";
export function ledger(): Ledger {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s?.version === 2 && Array.isArray(s.runs)) return s;
  } catch {}
  try {
    const old = JSON.parse(localStorage.getItem("gs-fit") ?? "null");
    if (old?.secs > 0) {
      const imported: Ledger = {
        version: 2,
        runs: [],
        activeSeconds: old.secs,
        medals: 0,
        days: {},
        legacyDays: Object.keys(old.days ?? {}),
      };
      localStorage.setItem(KEY, JSON.stringify(imported));
      return imported;
    }
  } catch {}
  return { version: 2, runs: [], activeSeconds: 0, medals: 0, days: {} };
}
export function saveRun(run: RunRecord) {
  if (!run.camera || !Number.isFinite(run.score) || run.seconds < 1)
    return false;
  const s = ledger();
  s.runs.push({ ...run, replay: run.replay?.slice(0, 900) });
  s.runs = s.runs.slice(-60);
  s.activeSeconds += run.activeSeconds ?? run.seconds;
  s.medals +=
    run.hits > 0 && run.hits / Math.max(1, run.hits + run.misses) >= 0.8
      ? 1
      : 0;
  const day = run.date.slice(0, 10);
  s.days[day] = (s.days[day] ?? 0) + (run.activeSeconds ?? run.seconds);
  localStorage.setItem(KEY, JSON.stringify(s));
  const k = `gs-${run.id}-best`;
  if (run.score > Number(localStorage.getItem(k) ?? 0))
    localStorage.setItem(k, String(run.score));
  return true;
}
export function bestGhost(
  id: GameId,
  seed: string,
  difficulty: Difficulty,
  lowImpact: boolean,
  endless = false,
  track?: number,
) {
  return ledger()
    .runs.filter(
      (r) =>
        r.id === id &&
        r.seed === seed &&
        r.difficulty === difficulty &&
        r.lowImpact === lowImpact &&
        !!r.endless === endless &&
        (track === undefined || (r.track ?? 0) === track) &&
        r.version === 2 &&
        r.camera &&
        r.replay?.length,
    )
    .sort((a, b) => b.score - a.score)[0];
}
export function dailySeed(id: string) {
  return `kinetic-v2:${id}:${new Date().toISOString().slice(0, 10)}`;
}
export function challengeUrl(
  run: Pick<
    RunRecord,
    "id" | "seed" | "difficulty" | "lowImpact" | "track" | "endless"
  >,
) {
  const u = new URL(location.origin);
  u.searchParams.set("game", run.id);
  u.searchParams.set("challenge", run.seed);
  u.searchParams.set("level", run.difficulty);
  u.searchParams.set("impact", run.lowImpact ? "low" : "standard");
  u.searchParams.set("track", String(run.track ?? 0));
  if (run.endless) u.searchParams.set("endless", "1");
  u.searchParams.set("v", "2");
  return u.href;
}
export function random(seed: string) {
  let a = 2166136261;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function movementStreak() {
  const l = ledger(),
    days = new Set([
      ...Object.keys(l.days).filter((d) => l.days[d] > 0),
      ...(l.legacyDays ?? []),
    ]),
    d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  let streak = 0;
  while (days.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}
