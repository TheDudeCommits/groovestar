// Extracted routines: choreography built offline from a performance video
// (tools/extract_jd), beat-aligned to the video that plays as the stage
// backdrop. Each 2-beat window becomes a native 16-keyframe clip, so the
// coach, pictograms and scorer all run the same choreography.
//
// The only routines extracted so far came from third-party game footage, so
// they are local test data: they are not in the repository, and this loader
// only reads public/routines/ in development builds. Original choreography
// filmed for GrooveStar can ship through the same path later.
import { CLIPS, type Clip } from './motion';
import type { ChoreoMove, SectionDef } from './songs';

const ROUTINES_ENABLED = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

export interface RoutineEntry {
  v: string;
  title: string;
  artist: string;
  bpm: number;
  beats: number;
}

export interface LoadedRoutine {
  bpm: number;
  /** first choreo beat on the game grid (video intro grooves through) */
  bodyStart: number;
  totalBeats: number;
  choreo: ChoreoMove[];
  sections: SectionDef[];
}

let indexCache: RoutineEntry[] | null = null;

export async function fetchRoutineIndex(): Promise<RoutineEntry[]> {
  if (!ROUTINES_ENABLED) return [];
  if (indexCache) return indexCache;
  try {
    const r = await fetch('/routines/index.json');
    if (!r.ok) return [];
    indexCache = (await r.json()) as RoutineEntry[];
    return indexCache;
  } catch {
    return [];
  }
}

export async function loadRoutine(videoId: string): Promise<LoadedRoutine | null> {
  if (!ROUTINES_ENABLED) return null;
  try {
    const r = await fetch(`/routines/${videoId}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    // the extractor's grid: beat = t*bpm/60 - lead. The game clock runs
    // lead=4, so extracted beat 0 lands on game beat (lead - 4).
    const bodyStart = Math.max(4, Math.round((j.lead - 4) * 2) / 2);
    const choreo: ChoreoMove[] = [];
    const golds = new Set<number>(j.golds ?? []);
    for (let i = 0; i < j.windows.length; i++) {
      const id = `jd_${i}`;
      const clip: Clip = { id, g: 'jd', e: j.e[i] ?? 0.5, b: 2, pk: j.pk[i] ?? 8, f: j.windows[i] };
      CLIPS[id] = clip;   // (re)register — one classic routine active at a time
      choreo.push({ beat: bodyStart + i * 2, move: id, gold: golds.has(i) });
    }
    const totalBeats = bodyStart + j.beats;
    // simple 32-beat verse/chorus alternation for scene & HUD pacing
    const sections: SectionDef[] = [{ beat: 0, kind: 'intro' }];
    let b = bodyStart, k = 0;
    while (b < totalBeats - 16) {
      sections.push({ beat: b, kind: k % 2 === 0 ? 'verse' : 'chorus' });
      b += 32; k++;
    }
    sections.push({ beat: totalBeats - 16, kind: 'outro' });
    return { bpm: j.bpm, bodyStart, totalBeats, choreo, sections };
  } catch {
    return null;
  }
}
