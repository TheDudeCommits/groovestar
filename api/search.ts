// YouTube search proxy — scrapes the public results page server-side (no API
// key needed) and returns a compact list of videos.
// GET /api/search?q=<terms>

import { checkOrigin, rateLimit } from './_utils';

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'search', 30)) return;
  const q = String(req.query?.q ?? '').slice(0, 120);
  if (!q.trim()) { res.status(400).json({ error: 'missing q' }); return; }
  try {
    const r = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept-Language': 'en' } },
    );
    const html = await r.text();
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
    res.status(502).json({ error: e?.message ?? 'search failed' });
  }
}
