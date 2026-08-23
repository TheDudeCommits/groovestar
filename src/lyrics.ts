// Synced lyrics + context-aware choreography.
//  - LRCLIB (free, no auth) provides time-synced lyrics matched from the
//    YouTube title; they feed the karaoke HUD and the choreographers below.
//  - Tier 1 (always available): keyword mapping — lyric words trigger matching
//    moves ("jump" → star_jump, "hands up" → raise_roof, ...).
//  - Tier 2 (when the server has an Anthropic API key): /api/choreo asks Claude
//    to beat-map a full routine that understands the lyrics' meaning. Falls
//    back to tier 1 transparently when unavailable.

import { MOVES } from './moves';
import { CLIPS } from './motion';
import type { ChoreoMove, LyricLine, SectionDef } from './songs';

export interface SyncedLyric { t: number; text: string }

// ---------------------------------------------------------------------------
// Title parsing & LRCLIB lookup

/** "Artist - Track (Official Video) [4K]" → {artist, track} */
export function parseTitle(title: string): { artist: string; track: string } | null {
  let t = title
    .replace(/[([][^)\]]*(official|video|audio|lyric|lyrics|visualizer|hd|4k|remaster|mv|m\/v)[^)\]]*[)\]]/gi, '')
    .replace(/\s*(official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = t.split(/\s+[-–—|]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), track: parts.slice(1).join(' ').trim() };
  }
  return null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/** fetch synced lyrics for a track; returns null when not found */
export async function fetchSyncedLyrics(title: string, durationSec: number): Promise<SyncedLyric[] | null> {
  const parsed = parseTitle(title);
  const tryBases = ['https://lrclib.net/api', '/api/lyrics?path='];
  for (const base of tryBases) {
    const mk = (p: string, q: Record<string, string>) => {
      const qs = new URLSearchParams(q).toString();
      return base.endsWith('=') ? `${base}${encodeURIComponent(`${p}?${qs}`)}` : `${base}/${p}?${qs}`;
    };
    // 1. exact get with duration (better version matching)
    if (parsed) {
      const got = await fetchJson(mk('get', {
        artist_name: parsed.artist, track_name: parsed.track, duration: String(Math.round(durationSec)),
      }), 6000);
      if (got?.syncedLyrics) return parseLRC(got.syncedLyrics);
    }
    // 2. fuzzy search on the whole title
    const q = parsed ? `${parsed.artist} ${parsed.track}` : title;
    const results = await fetchJson(mk('search', { q }), 6000);
    if (Array.isArray(results)) {
      const withSync = results.filter((r: any) => r.syncedLyrics);
      // prefer duration match within 7s
      withSync.sort((a: any, b: any) =>
        Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec));
      const best = withSync[0];
      if (best && Math.abs((best.duration ?? 0) - durationSec) < 20) {
        return parseLRC(best.syncedLyrics);
      }
    }
    if (base === tryBases[0] && parsed === null) continue;
  }
  return null;
}

/** parse LRC format: "[mm:ss.xx] line" */
export function parseLRC(lrc: string): SyncedLyric[] {
  const out: SyncedLyric[] = [];
  for (const line of lrc.split('\n')) {
    const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if (!m) continue;
    const t = parseInt(m[1]) * 60 + parseFloat(m[2]);
    const text = m[3].trim();
    if (text) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** convert to HUD LyricLine[] on the base-bpm beat grid */
export function lyricsToLines(lyr: SyncedLyric[], bpm: number, leadBeats: number): LyricLine[] {
  return lyr.map((l, i) => {
    const beat = (l.t * bpm) / 60 - leadBeats;
    const next = lyr[i + 1];
    const durBeats = next ? Math.min(8, Math.max(2, ((next.t - l.t) * bpm) / 60)) : 6;
    return { beat, durBeats, text: l.text };
  });
}

// ---------------------------------------------------------------------------
// Song tempo from Claude's music knowledge (cached per video)

export async function fetchSongMeta(videoId: string, title: string, duration: number): Promise<number | null> {
  const key = `gs-meta-${videoId}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached !== null) return cached === 'null' ? null : Number(cached);
  } catch { /* no storage */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch('/api/songmeta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, duration }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    const bpm = typeof data?.bpm === 'number' && data.bpm >= 70 && data.bpm <= 180 ? data.bpm : null;
    try { localStorage.setItem(key, bpm === null ? 'null' : String(bpm)); } catch { /* full */ }
    return bpm;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------
// Tier 1: keyword-mapped choreography

const KEYWORDS: [RegExp, string[]][] = [
  [/\bjump|bounce\b/i, ['star_jump']],
  [/\bhands?\s+(up|in the air)|put\s+your\s+hands|raise\b/i, ['raise_roof', 'touchdown']],
  [/\b(up|sky|high|fly|heaven|stars?)\b/i, ['v_up', 'point_up_r', 'point_up_l', 'touchdown']],
  [/\bclap\b/i, ['clap_up', 'clap_side_l', 'clap_side_r']],
  [/\b(down|low|floor|ground|drop)\b/i, ['swing_low', 'squat_pump', 'punch_dn_l', 'punch_dn_r', 'disco_down_l']],
  [/\bleft\b/i, ['sway_l', 'slide_l', 'step_touch_l']],
  [/\bright\b/i, ['sway_r', 'slide_r', 'step_touch_r']],
  [/\b(spin|round|around|turn)\b/i, ['helicopter', 'wave_r', 'wipe_r']],
  [/\b(shake|shimmy|wiggle)\b/i, ['shimmy', 'twist_l', 'twist_r']],
  [/\btwist\b/i, ['twist_l', 'twist_r']],
  [/\b(stop|freeze|hold)\b/i, ['t_pose', 'robot_l', 'robot_r']],
  [/\bwaves?\b/i, ['wave_l', 'wave_r', 'swim_l']],
  [/\b(swim|ocean|sea|deep)\b/i, ['swim_l', 'swim_r']],
  [/\b(walk|run|move)\b/i, ['run_man_l', 'run_man_r', 'march', 'knee_up_l']],
  [/\bkick\b/i, ['kick_l', 'kick_r']],
  [/\b(punch|hit|fight|knock)\b/i, ['punch_l', 'punch_r', 'uppercut_l', 'uppercut_r']],
  [/\b(love|heart|baby|darling)\b/i, ['prayer', 'cross_arms', 'hi_five_r']],
  [/\b(dance|dancing|groove|boogie)\b/i, ['disco_up_r', 'disco_up_l', 'hips_l', 'hips_r']],
  [/\b(roll|rolling)\b/i, ['roll_arms']],
  [/\b(strong|power|muscle)\b/i, ['muscle', 'cactus']],
  [/\b(whoa|oh+|yeah|hey)\b/i, ['crowd_l', 'crowd_r', 'raise_roof']],
  [/\b(point|look|see|watch)\b/i, ['point_up_r', 'point_up_l', 'archer_l', 'archer_r']],
];

/** replace choreo moves near lyric lines with keyword-matched moves (≤1 per line).
 *  Skipped for real-motion routines — splicing static poses into flowing
 *  mocap looks stiff; the AI tier handles semantics there instead. */
export function applyKeywordChoreo(choreo: ChoreoMove[], lines: LyricLine[]): { choreo: ChoreoMove[]; hits: number } {
  if (choreo.some((m) => CLIPS[m.move])) return { choreo, hits: 0 };
  const out = choreo.map((m) => ({ ...m }));
  let hits = 0;
  const usedIdx = new Set<number>();
  for (const line of lines) {
    for (const [re, moves] of KEYWORDS) {
      if (!re.test(line.text)) continue;
      // first non-gold move landing within this line's window
      const idx = out.findIndex((m, i) =>
        !usedIdx.has(i) && !m.gold && m.beat >= line.beat - 0.5 && m.beat < line.beat + line.durBeats);
      if (idx >= 0) {
        const candidates = moves.filter((id) => MOVES[id]);
        if (candidates.length) {
          out[idx].move = candidates[hits % candidates.length];
          usedIdx.add(idx);
          hits++;
        }
      }
      break; // one keyword per line
    }
  }
  return { choreo: out, hits };
}

// ---------------------------------------------------------------------------
// Tier 2: Claude-generated routine via /api/choreo

export interface AiChoreoRequest {
  title: string;
  bpm: number;
  totalBeats: number;
  difficulty: number;
  introBeat: number;
  sections: SectionDef[];
  lyrics: { beat: number; text: string }[];
  moves: { id: string; energy: number }[];
}

/** where the song actually starts, from the first synced-lyric timestamp */
export function introBeatsOf(lyr: SyncedLyric[] | null, bpm: number, leadBeats: number): number {
  if (!lyr?.length) return 8;
  const first = (lyr[0].t * bpm) / 60 - leadBeats;
  // long instrumental intro → hold choreography until just before the vocal;
  // cap so a mostly-instrumental track still dances
  return Math.max(8, Math.min(64, Math.floor(first / 2) * 2));
}

export async function fetchAiChoreo(req: AiChoreoRequest, timeoutMs = 25000): Promise<ChoreoMove[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/choreo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    return validateAiChoreo(data?.moves, req.totalBeats, req.introBeat);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function validateAiChoreo(raw: any, totalBeats: number, introBeat = 8): ChoreoMove[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChoreoMove[] = [];
  const minBeat = Math.max(4, introBeat - 4);
  let golds = 0;
  for (const e of raw) {
    const beat = Number(e?.b);
    const move = String(e?.m ?? '');
    if ((!MOVES[move] && !CLIPS[move]) || !isFinite(beat) || beat < minBeat || beat > totalBeats - 1) continue;
    const gold = !!e?.g && golds < 8 && move.startsWith('gold_');
    if (gold) golds++;
    out.push({ beat: Math.round(beat * 2) / 2, move, gold });
  }
  out.sort((a, b) => a.beat - b.beat);
  // enforce min 1-beat spacing
  const spaced: ChoreoMove[] = [];
  for (const m of out) {
    if (!spaced.length || m.beat - spaced[spaced.length - 1].beat >= 1) spaced.push(m);
  }
  // sanity: enough coverage to be danceable
  if (spaced.length < Math.min(40, totalBeats / 4)) return null;
  return spaced;
}
