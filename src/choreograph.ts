// Procedural choreographer. Given a seed (e.g. a YouTube video id), BPM and
// length, it builds a routine with the reference's structure: repeating
// per-section patterns so the player can learn (choruses always reuse the
// chorus pattern), fills at pattern boundaries, gold moves at section climaxes,
// and a global anti-repetition budget so no move outstays its welcome.

import { MOVES } from './moves';
import { CLIPS, CLIP_GENRES } from './motion';
import type { ChoreoMove, SectionDef } from './songs';

export interface GenResult {
  sections: SectionDef[];
  choreo: ChoreoMove[];
}

// deterministic RNG from a string seed
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXCLUDE = new Set(['idle']);
const pool = (min: number, max: number) =>
  Object.values(MOVES)
    .filter((m) => !EXCLUDE.has(m.id) && !m.id.startsWith('gold_') && m.energy >= min && m.energy <= max)
    .map((m) => m.id);

export function generateChoreo(seed: string, totalBeats: number, difficulty: 1 | 2 | 3, introBeats = 8): GenResult {
  const rand = rng(seed);
  const bodyStart = Math.max(8, Math.min(totalBeats - 32, Math.round(introBeats / 2) * 2));
  const golds = Object.keys(MOVES).filter((id) => id.startsWith('gold_'));

  // Real-motion mode: build the routine from AIST++ clips. Two seeded genres
  // keep the routine stylistically coherent (a house track doesn't suddenly
  // switch to waacking mid-verse).
  let chill: string[], groove: string[], power: string[];
  const allClips = Object.values(CLIPS);
  if (allClips.length) {
    const g1 = CLIP_GENRES[Math.floor(rand() * CLIP_GENRES.length)];
    let g2 = CLIP_GENRES[Math.floor(rand() * CLIP_GENRES.length)];
    if (g2 === g1) g2 = CLIP_GENRES[(CLIP_GENRES.indexOf(g1) + 1) % CLIP_GENRES.length];
    const of = (pred: (c: { g: string; e: number }) => boolean) =>
      allClips.filter((c) => pred(c)).map((c) => c.id);
    chill = of((c) => c.g === g1 && c.e < 0.55);
    groove = of((c) => (c.g === g1 || c.g === g2) && c.e >= 0.25 && c.e <= 0.8);
    power = of((c) => (c.g === g1 || c.g === g2) && c.e > 0.55);
    // safety: never let a pool be empty
    if (chill.length < 4) chill = of((c) => c.g === g1);
    if (power.length < 4) power = of((c) => c.g === g1 || c.g === g2);
    if (groove.length < 4) groove = [...chill, ...power];
  } else {
    chill = pool(0, 0.5);
    groove = pool(0.4, 0.75);
    power = pool(0.6, 1);
  }

  // --- section plan: intro (through any detected song intro), then 32-beat
  // blocks, outro 16. No moves are scheduled during the intro — the dancer
  // just grooves in place until the song actually starts. --------------------
  const sections: SectionDef[] = [{ beat: 0, kind: 'intro' }];
  let b = bodyStart;
  let blockI = 0;
  const bodyEnd = totalBeats - 16;
  while (b < bodyEnd) {
    let kind: SectionDef['kind'];
    if (blockI % 2 === 0) kind = 'verse'; else kind = 'chorus';
    if (blockI === 4 && bodyEnd - b > 48) kind = 'bridge'; // mid-song breather
    sections.push({ beat: b, kind });
    b += Math.min(32, bodyEnd - b);
    blockI++;
  }
  sections.push({ beat: bodyEnd, kind: 'outro' });

  // --- move picking with anti-repetition ------------------------------------
  const used: Record<string, number> = {};
  const pick = (candidates: string[], avoid: Set<string>): string => {
    // among the least-used candidates, choose randomly
    let best: string[] = [];
    let bestCount = Infinity;
    for (const id of candidates) {
      if (avoid.has(id)) continue;
      const c = used[id] ?? 0;
      if (c < bestCount) { bestCount = c; best = [id]; }
      else if (c === bestCount) best.push(id);
    }
    const chosen = best.length ? best[Math.floor(rand() * best.length)] : candidates[Math.floor(rand() * candidates.length)];
    used[chosen] = (used[chosen] ?? 0) + 1;
    return chosen;
  };

  // mirrored-pair helper: sway_l ↔ sway_r etc, gives call-and-response feel
  const mirror = (id: string): string | null => {
    const m = id.match(/^(.*)_(l|r)$/);
    if (!m) return null;
    const other = `${m[1]}_${m[2] === 'l' ? 'r' : 'l'}`;
    return MOVES[other] ? other : null;
  };

  /** a 16-beat pattern = 8 move slots; even slots often echo as their mirror */
  const makePattern = (candidates: string[], n = 8): string[] => {
    const avoid = new Set<string>();
    const p: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 2 === 1 && rand() < 0.55) {
        const mir = mirror(p[i - 1]);
        if (mir && !avoid.has(mir)) { p.push(mir); avoid.add(mir); used[mir] = (used[mir] ?? 0) + 1; continue; }
      }
      const id = pick(candidates, avoid);
      avoid.add(id);
      const mir = mirror(id);
      if (mir) avoid.add(mir); // avoid l/r duplicates beyond the intentional echo
      p.push(id);
    }
    return p;
  };

  const poolFor = (kind: SectionDef['kind']): string[] =>
    kind === 'chorus' ? [...groove, ...power]
      : kind === 'bridge' ? chill
      : kind === 'outro' ? [...groove, ...power]
      : [...chill, ...groove];

  let chorusHook: string[] | null = null; // recurring first half of every chorus
  const choreo: ChoreoMove[] = [];
  const usedGolds = new Set<string>();

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const end = s + 1 < sections.length ? sections[s + 1].beat : totalBeats;
    if (sec.kind === 'intro') {
      // ease in with two sways just before the song kicks in
      if (bodyStart >= 6) {
        choreo.push({ beat: bodyStart - 4, move: 'sway_l' }, { beat: bodyStart - 2, move: 'sway_r' });
      }
      continue;
    }
    // choruses keep a recognizable hook (first 4 slots) but refresh the back
    // half each time — learnable like the reference without wearing moves out
    let pattern: string[];
    if (sec.kind === 'chorus') {
      chorusHook ??= makePattern(poolFor('chorus'), 4);
      const avoid = new Set(chorusHook);
      const back: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = pick(poolFor('chorus'), avoid);
        avoid.add(id);
        back.push(id);
      }
      pattern = [...chorusHook, ...back];
    } else {
      pattern = makePattern(poolFor(sec.kind));
    }
    const goldBeat = end - 2; // section climax
    for (let beat = sec.beat; beat < goldBeat; beat += 2) {
      const slot = Math.floor(((beat - sec.beat) % 16) / 2);
      const rep = Math.floor((beat - sec.beat) / 16);
      let move = pattern[slot];
      // odd repetitions mirror the pattern (call-and-response), and the final
      // slot of each odd repetition becomes a fresh fill
      if (rep % 2 === 1) {
        if (slot === 7) move = pick(poolFor(sec.kind), new Set(pattern));
        else move = mirror(move) ?? move;
      }
      choreo.push({ beat, move });
      // difficulty: sprinkle 1-beat double-time echoes on chorus/outro
      const doubles = difficulty === 3 ? 2 : difficulty === 2 ? 1 : 0;
      if (slot < doubles && (sec.kind === 'chorus' || sec.kind === 'outro') && beat + 1 < goldBeat) {
        const mir = mirror(move);
        if (mir) choreo.push({ beat: beat + 1, move: mir });
      }
    }
    // gold at the end of choruses, the bridge and the outro
    if (sec.kind !== 'verse' || s === sections.length - 2) {
      const g = golds.filter((x) => !usedGolds.has(x));
      const gold = g.length ? g[Math.floor(rand() * g.length)] : golds[Math.floor(rand() * golds.length)];
      usedGolds.add(gold);
      choreo.push({ beat: goldBeat, move: gold, gold: true });
    } else {
      choreo.push({ beat: goldBeat, move: pick(poolFor(sec.kind), new Set()) });
    }
  }
  choreo.sort((a, b2) => a.beat - b2.beat);
  return { sections, choreo };
}

// ---------------------------------------------------------------------------
// Freestyle sections: 8-beat "GO OFF!" windows where the routine steps aside
// and the player is scored on energy + movement variety instead of matching.
// Purely a function of (totalBeats, introBeats) so every multiplayer client
// derives identical windows.

export interface FreestyleWindow { start: number; end: number }

export function freestyleWindows(totalBeats: number, introBeats: number): FreestyleWindow[] {
  const span = totalBeats - introBeats;
  const at = (f: number) => introBeats + Math.round((span * f) / 8) * 8;
  const wins: FreestyleWindow[] = [];
  if (span >= 160) wins.push({ start: at(0.4), end: at(0.4) + 8 }, { start: at(0.72), end: at(0.72) + 8 });
  else if (span >= 96) wins.push({ start: at(0.55), end: at(0.55) + 8 });
  return wins.filter((w) => w.start > introBeats + 16 && w.end < totalBeats - 16);
}

/** remove routine moves inside freestyle windows; a gold caught inside lands right at the window's end instead */
export function carveFreestyle(choreo: ChoreoMove[], wins: FreestyleWindow[]): ChoreoMove[] {
  return choreo
    .map((m) => {
      const w = wins.find((x) => m.beat >= x.start - 1 && m.beat < x.end);
      if (!w) return m;
      return m.gold ? { ...m, beat: w.end } : null;
    })
    .filter((m): m is ChoreoMove => !!m)
    .sort((a, b) => a.beat - b.beat);
}
