// Video-reactive stage colors: /api/vibe grades each YouTube video's
// storyboard thumbnails into up to 3 palette pairs (early/mid/late). The
// stage interpolates through them as the song progresses; null entries and
// colorless videos fall back to the song's generated accents.

export type VibePalette = ([string, string] | null)[];

export async function fetchVibe(videoId: string): Promise<VibePalette | null> {
  const key = `gs-vibe-${videoId}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch { /* bad cache */ }
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`/api/vibe?v=${videoId}`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const p = Array.isArray(j?.palettes) ? j.palettes : null;
    if (p) { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* full */ } }
    return p;
  } catch {
    return null;
  }
}

function lerpHex(a: string, b: string, t: number): string {
  const va = parseInt(a.slice(1), 16), vb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((va >> sh) & 255) + (((vb >> sh) & 255) - ((va >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** stage color pair at song progress p (0..1); fallbacks fill null palette slots */
export function vibeAt(palettes: VibePalette | null, p: number, fallback: [string, string]): [string, string] {
  if (!palettes?.length) return fallback;
  const filled = palettes.map((x) => x ?? fallback);
  if (filled.length === 1) return filled[0];
  const seg = Math.max(0, Math.min(0.999, p)) * (filled.length - 1);
  const i = Math.floor(seg), t = seg - i;
  // ease across segment boundaries so grade shifts feel like lighting cues
  const tt = t * t * (3 - 2 * t);
  return [lerpHex(filled[i][0], filled[i + 1][0], tt), lerpHex(filled[i][1], filled[i + 1][1], tt)];
}
