// Shared endpoint guards: browser-origin verification + per-IP rate limiting.
// Not bulletproof (nothing client-callable is), but blocks casual abuse of the
// Anthropic key from scripts and other sites.

const ALLOWED = [/^https:\/\/groovestar[.-][a-z0-9-]*\.?vercel\.app$/, /^https?:\/\/localhost(:\d+)?$/];

export function checkOrigin(req: any, res: any): boolean {
  const site = String(req.headers['sec-fetch-site'] ?? '');
  if (site === 'same-origin') return true;
  const src = String(req.headers.origin ?? req.headers.referer ?? '');
  try {
    const o = src ? new URL(src).origin : '';
    if (o && ALLOWED.some((re) => re.test(o))) return true;
  } catch { /* bad url */ }
  res.status(403).json({ error: 'forbidden' });
  return false;
}

// naive in-memory limiter — per warm serverless instance, which is enough of
// a deterrent for a free game endpoint
const hits = new Map<string, { n: number; t: number }>();

export function rateLimit(req: any, res: any, key: string, perMin: number): boolean {
  const ip = String(req.headers['x-forwarded-for'] ?? 'x').split(',')[0].trim();
  const k = `${key}:${ip}`;
  const now = Date.now();
  const h = hits.get(k);
  if (!h || now - h.t > 60_000) {
    hits.set(k, { n: 1, t: now });
  } else if (++h.n > perMin) {
    res.status(429).json({ error: 'slow down' });
    return false;
  }
  if (hits.size > 5000) hits.clear(); // bound memory
  return true;
}

// ---------------------------------------------------------------------------
// Server-side LRCLIB lookup (mirrors the client logic)

export interface SyncedLine { t: number; text: string }

export function parseTitle(title: string): { artist: string; track: string } | null {
  const t = title
    .replace(/[([][^)\]]*(official|video|audio|lyric|lyrics|visualizer|hd|4k|remaster|mv|m\/v)[^)\]]*[)\]]/gi, '')
    .replace(/\s*(official\s*(music\s*)?video|official\s*audio|lyrics?|visualizer)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = t.split(/\s+[-–—|]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), track: parts.slice(1).join(' ').trim() };
  return null;
}

export function parseLRC(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const line of lrc.split('\n')) {
    const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if (!m) continue;
    const text = m[3].trim();
    if (text) out.push({ t: parseInt(m[1]) * 60 + parseFloat(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function fetchLyricsServer(title: string, durationSec: number): Promise<SyncedLine[] | null> {
  const headers = { 'User-Agent': 'GrooveStar (https://groovestar.vercel.app)' };
  const parsed = parseTitle(title);
  try {
    if (parsed) {
      const q = new URLSearchParams({
        artist_name: parsed.artist, track_name: parsed.track, duration: String(Math.round(durationSec)),
      });
      const r = await fetch(`https://lrclib.net/api/get?${q}`, { headers });
      if (r.ok) {
        const d: any = await r.json();
        if (d?.syncedLyrics) return parseLRC(d.syncedLyrics);
      }
    }
    const q2 = new URLSearchParams({ q: parsed ? `${parsed.artist} ${parsed.track}` : title });
    const r2 = await fetch(`https://lrclib.net/api/search?${q2}`, { headers });
    if (r2.ok) {
      const list: any[] = await r2.json();
      const withSync = (list ?? []).filter((x) => x.syncedLyrics);
      withSync.sort((a, b) => Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec));
      const best = withSync[0];
      if (best && Math.abs((best.duration ?? 0) - durationSec) < 20) return parseLRC(best.syncedLyrics);
    }
  } catch { /* lrclib down */ }
  return null;
}
