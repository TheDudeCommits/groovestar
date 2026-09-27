// Nova's motion-captured dance routines.
//
// The Dance coach performs Meshy dance clips (public/models/nova-moves.glb),
// time-warped onto the song's beat grid. src/data/nova-dances.json holds each
// clip's natural tempo, the phase of its first beat and the game pose
// parameters at 8 samples per beat (see tools/primetime/dance-data.py), so
// the scorer and the move cards read the same motion the coach performs.
//
// A routine is built from 8-beat phrases. Choruses always reuse the same two
// phrases so the player learns them, like the reference games.

import data from '../data/nova-dances.json';
import { CLIPS } from '../motion';
import type { ChoreoMove, SectionDef } from '../songs';

export interface NovaClip {
  id: string;
  bpm: number;
  /** seconds from the clip start to its first beat */
  phase: number;
  beats: number;
  /** motion energy per beat, 0..1 */
  e: number[];
  /** mean degrees turned away from the camera per beat */
  face: number[];
  /** pose parameters, `spb` samples per beat */
  f: number[][];
}

const SPB = (data as { spb: number }).spb;
export const NOVA: Record<string, NovaClip> = {};
for (const c of (data as { clips: NovaClip[] }).clips) NOVA[c.id] = c;

const KF = 16;
const PREFIX = 'nv:';

/** Move id for the two beats of `clip` starting at `start`. */
export function sliceId(clip: string, start: number) {
  return `${PREFIX}${clip}:${start}`;
}

export function parseSlice(id: string): { clip: NovaClip; start: number } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [name, s] = id.slice(PREFIX.length).split(':');
  const clip = NOVA[name];
  return clip ? { clip, start: +s } : null;
}

/** Register a slice with the motion library so the scorer and cards see it. */
export function ensureSlice(id: string) {
  if (CLIPS[id]) return;
  const p = parseSlice(id);
  if (!p) return;
  const { clip, start } = p;
  const at = (u: number) => {
    const x = Math.max(0, Math.min(clip.f.length - 1, (start + u) * SPB));
    const i = Math.floor(x), k = x - i;
    const a = clip.f[i], b = clip.f[Math.min(clip.f.length - 1, i + 1)];
    return a.map((v, j) => v + (b[j] - v) * k);
  };
  const f = Array.from({ length: KF }, (_, i) => at((i * 2) / (KF - 1)));
  let pk = 0, best = -1;
  f.forEach((r, i) => {
    const reach = Math.abs(r[2]) + Math.abs(r[4]) + Math.abs(r[3]) * 0.3 + Math.abs(r[5]) * 0.3;
    if (reach > best) { best = reach; pk = i; }
  });
  const e = ((clip.e[start] ?? 0.5) + (clip.e[start + 1] ?? 0.5)) / 2;
  CLIPS[id] = { id, g: 'nova', e: Math.round(e * 100) / 100, b: 2, pk, f };
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

interface Phrase { clip: string; start: number; energy: number }

/** Clips that stay natural when time-warped to `bpm` (0.8x to 1.25x). */
export function clipsFor(bpm: number): NovaClip[] {
  const all = Object.values(NOVA);
  const fit = all.filter((c) => bpm / c.bpm >= 0.8 && bpm / c.bpm <= 1.25);
  if (fit.length >= 3) return fit;
  return [...all].sort((a, b) => Math.abs(Math.log(bpm / a.bpm)) - Math.abs(Math.log(bpm / b.bpm))).slice(0, 4);
}

function phrasesOf(c: NovaClip): Phrase[] {
  const out: Phrase[] = [];
  for (let s = 0; s + 8 <= c.beats; s += 2) {
    const face = Math.max(...c.face.slice(s, s + 8));
    if (face > 55) continue;
    const e = c.e.slice(s, s + 8);
    out.push({ clip: c.id, start: s, energy: e.reduce((x, y) => x + y, 0) / e.length });
  }
  return out;
}

/**
 * Build a routine for a song: sections from the song (or the generator),
 * moves every two beats inside 8-beat phrases, gold at section climaxes.
 */
export function novaRoutine(o: {
  sections: SectionDef[];
  totalBeats: number;
  bpm: number;
  seed: string;
  difficulty: 1 | 2 | 3;
}): ChoreoMove[] {
  const rand = rng(o.seed);
  const clips = clipsFor(o.bpm);
  const byClip = clips.map((c) => ({ c, phrases: phrasesOf(c) })).filter((x) => x.phrases.length);
  // shuffle clip order per song so routines differ
  for (let i = byClip.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [byClip[i], byClip[j]] = [byClip[j], byClip[i]];
  }
  const used = new Set<string>();
  const pickPhrase = (want: 'high' | 'mid' | 'low'): Phrase => {
    const pool = byClip.filter((x) => !used.has(x.c.id));
    const src = pool.length ? pool : byClip;
    const scored = src.map((x) => {
      const ps = [...x.phrases].sort((a, b) => b.energy - a.energy);
      const p = want === 'high' ? ps[0] : want === 'low' ? ps[ps.length - 1] : ps[Math.floor(ps.length / 2)];
      return p;
    });
    scored.sort((a, b) => (want === 'low' ? a.energy - b.energy : b.energy - a.energy));
    const pick = scored[Math.min(scored.length - 1, Math.floor(rand() * Math.min(2, scored.length)))];
    used.add(pick.clip);
    return pick;
  };
  const intensity = o.difficulty === 3 ? 'high' : 'mid';
  const verse = [pickPhrase(o.difficulty === 1 ? 'low' : 'mid'), pickPhrase(o.difficulty === 1 ? 'low' : 'mid')];
  const chorus = [pickPhrase('high'), pickPhrase(intensity)];
  const bridge = [pickPhrase('mid')];

  const choreo: ChoreoMove[] = [];
  const sections = [...o.sections].sort((a, b) => a.beat - b.beat);
  sections.forEach((sec, s) => {
    const end = s + 1 < sections.length ? sections[s + 1].beat : o.totalBeats;
    if (sec.kind === 'intro') return;
    const plan = sec.kind === 'chorus' ? [chorus[0], chorus[1]] : sec.kind === 'bridge' ? [bridge[0]] : sec.kind === 'outro' ? [chorus[0]] : [verse[0], verse[1]];
    // phrase order: A A B B (verses), A B A B (choruses)
    const order = (i: number) => (sec.kind === 'chorus' ? plan[i % plan.length] : plan[Math.floor(i / 2) % plan.length]);
    let i = 0;
    for (let beat = sec.beat; beat + 2 <= end; beat += 8, i++) {
      const p = order(i);
      for (let k = 0; k < 8 && beat + k + 2 <= end; k += 2) {
        const id = sliceId(p.clip, p.start + k);
        ensureSlice(id);
        choreo.push({ beat: beat + k, move: id });
      }
    }
    // the section's last move is its climax
    const last = choreo[choreo.length - 1];
    if (last && last.beat >= sec.beat && sec.kind !== 'verse') last.gold = true;
  });
  return choreo.sort((a, b) => a.beat - b.beat);
}

/** Make sure every Nova slice in a routine is registered (e.g. one received from a host). */
export function registerRoutine(choreo: ChoreoMove[]) {
  for (const m of choreo) ensureSlice(m.move);
}

/**
 * Where the coach is in its clips at `beat`: the current slice's clip and
 * time, plus the previous one while a cut blends over.
 */
export function coachLayers(choreo: ChoreoMove[], beat: number, groove: string): [string, number, number][] {
  const seconds = (c: NovaClip, clipBeat: number) => c.phase + (clipBeat * 60) / c.bpm;
  const g = NOVA[groove] ?? Object.values(NOVA)[0];
  // idle groove on the beat when no move is live (intro, gaps, freestyle)
  const grooveAt = (b: number): [string, number] => {
    const span = Math.max(4, g.beats - (g.beats % 4));
    const local = ((b % span) + span) % span;
    return [g.id, seconds(g, local)];
  };
  let i = -1;
  for (let k = 0; k < choreo.length; k++) {
    if (choreo[k].beat <= beat + 1e-6) i = k;
    else break;
  }
  const cur = i >= 0 ? choreo[i] : null;
  const live = cur && beat < cur.beat + 2.5 ? parseSlice(cur.move) : null;
  if (!cur || !live) {
    const [name, t] = grooveAt(beat);
    // blend out of the last move into the groove
    const prev = cur ? parseSlice(cur.move) : null;
    if (cur && prev) {
      const k = Math.min(1, (beat - cur.beat - 2.5) / 0.75);
      if (k < 1) return [[prev.clip.id, seconds(prev.clip, prev.start + (beat - cur.beat)), 1 - k], [name, t, k]];
    }
    const next = choreo[i + 1];
    const nextSlice = next ? parseSlice(next.move) : null;
    if (next && nextSlice && next.beat - beat < 0.5) {
      const k = 1 - (next.beat - beat) / 0.5;
      return [[name, t, 1 - k], [nextSlice.clip.id, seconds(nextSlice.clip, nextSlice.start - (next.beat - beat)), k]];
    }
    return [[name, t, 1]];
  }
  const t = seconds(live.clip, live.start + (beat - cur!.beat));
  const layers: [string, number, number][] = [[live.clip.id, t, 1]];
  // continuing slice of the same clip: no blend; otherwise ease over half a beat
  const prevMove = i > 0 ? choreo[i - 1] : null;
  const prev = prevMove ? parseSlice(prevMove.move) : null;
  const flows = prev && prevMove && prev.clip.id === live.clip.id && prev.start + (cur!.beat - prevMove.beat) === live.start;
  const since = beat - cur!.beat;
  if (prev && prevMove && !flows && since < 0.5 && cur!.beat - prevMove.beat <= 2.5) {
    const k = since / 0.5;
    const w = k * k * (3 - 2 * k);
    layers[0][2] = w;
    layers.push([prev.clip.id, seconds(prev.clip, prev.start + (beat - prevMove.beat)), 1 - w]);
  } else if (!prev && since < 0.5) {
    const [name, gt] = grooveAt(beat);
    const k = since / 0.5;
    layers[0][2] = k;
    layers.push([name, gt, 1 - k]);
  }
  return layers;
}
