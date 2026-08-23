// LRCLIB proxy — used only if the browser can't reach lrclib.net directly.
// GET /api/lyrics?path=<encoded "get?artist_name=...&track_name=...">

import { checkOrigin, rateLimit } from './_utils';

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'lyrics', 30)) return;
  const path = String(req.query?.path ?? '');
  if (!/^(get|search)\?[\w%&=+.\-*']*$/.test(path)) {
    res.status(400).json({ error: 'bad path' });
    return;
  }
  try {
    const r = await fetch(`https://lrclib.net/api/${path}`, {
      headers: { 'User-Agent': 'GrooveStar (https://groovestar.vercel.app)' },
    });
    const body = await r.text();
    res.status(r.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 's-maxage=86400')
      .send(body);
  } catch {
    res.status(502).json({ error: 'lrclib unreachable' });
  }
}
