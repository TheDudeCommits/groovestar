// YouTube search proxy — scrapes the public results page server-side (no API
// key needed) and returns a compact list of videos.
// GET /api/search?q=<terms>

import { checkOrigin, rateLimit } from './_utils.js';

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'search', 30)) return;
  const q = String(req.query?.q ?? '').slice(0, 120);
  if (!q.trim()) { res.status(400).json({ error: 'missing q' }); return; }
  try {
    const html = await fetchResults(q);
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    const out: { id: string; title: string; duration: string; channel: string }[] = [];
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents ?? [];
        for (const sec of sections) {
          for (const item of sec?.itemSectionRenderer?.contents ?? []) {
            const v = item?.videoRenderer;
            if (!v?.videoId) continue;
            out.push({
              id: v.videoId,
              title: v.title?.runs?.[0]?.text ?? '',
              duration: v.lengthText?.simpleText ?? '',
              channel: v.ownerText?.runs?.[0]?.text ?? '',
            });
            if (out.length >= 8) break;
          }
          if (out.length >= 8) break;
        }
      } catch { /* fall through to regex */ }
    }
    if (!out.length) {
      // fallback: raw regex over the page
      const seen = new Set<string>();
      const re = /"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
      let mm;
      while ((mm = re.exec(html)) && out.length < 8) {
        if (seen.has(mm[1])) continue;
        seen.add(mm[1]);
        out.push({ id: mm[1], title: JSON.parse(`"${mm[2]}"`), duration: '', channel: '' });
      }
    }
    res.status(200).setHeader('Cache-Control', 's-maxage=3600').json({ results: out });
  } catch (e: any) {
    // undici reports network failures as "fetch failed"; the cause says why
    const cause = e?.cause?.code ?? e?.cause?.message ?? '';
    console.error('search failed', e?.message, cause);
    res.status(502).json({ error: 'Search is unavailable right now. Paste a YouTube link instead.' });
  }
}

// One retry covers the transient connection failures seen in Production. The
// SOCS cookie skips the EU consent interstitial, which otherwise redirects in
// a loop without a cookie jar.
async function fetchResults(q: string): Promise<string> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'en',
    Cookie: 'SOCS=CAI',
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`YouTube responded ${r.status}`);
      return await r.text();
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError;
}
