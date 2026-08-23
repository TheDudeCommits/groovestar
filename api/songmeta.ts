// Song tempo from Claude's music knowledge — GET so the CDN caches each
// answer globally (one Claude call per song, ever).
// GET /api/songmeta?t=<title>&d=<durationSec>

import Anthropic from '@anthropic-ai/sdk';
import { checkOrigin, rateLimit } from './_utils';

const SCHEMA = {
  type: 'object',
  properties: {
    bpm: {
      type: ['number', 'null'],
      description: 'the song tempo in BPM, folded into the 70-180 range (double or halve as needed); null if not confidently known',
    },
  },
  required: ['bpm'],
  additionalProperties: false,
} as const;

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'meta', 15)) return;
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'no api key configured' }); return; }
  const title = String(req.query?.t ?? '').slice(0, 200);
  const duration = Number(req.query?.d ?? 0);
  if (!title) { res.status(400).json({ error: 'missing title' }); return; }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
      system: 'You identify the tempo of songs from YouTube music-video titles. Return the BPM only when you actually know this specific song; fold it into 70-180 (halve/double as needed). Return null when unsure — a wrong tempo is worse than none.',
      messages: [{ role: 'user', content: JSON.stringify({ video_title: title, duration_seconds: duration }) }],
    });
    if (response.stop_reason === 'refusal') { res.status(200).json({ bpm: null }); return; }
    const text = response.content.find((b: any) => b.type === 'text') as any;
    const parsed = JSON.parse(text?.text ?? '{}');
    let bpm = typeof parsed.bpm === 'number' ? parsed.bpm : null;
    if (bpm !== null) {
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      bpm = Math.round(bpm * 10) / 10;
    }
    res.status(200).setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=604800').json({ bpm });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'meta failed' });
  }
}
