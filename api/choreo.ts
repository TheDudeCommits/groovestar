// AI choreographer — GET so Vercel's CDN caches each song's routine GLOBALLY:
// Claude runs once per (video, bpm) worldwide; everyone else gets the cached
// routine instantly and the Anthropic key is spent once.
// GET /api/choreo?v=<videoId>&t=<title>&dur=<sec>&bpm=<n>&i=<introBeat>&tb=<totalBeats>

import Anthropic from '@anthropic-ai/sdk';
import { checkOrigin, rateLimit, fetchLyricsServer } from './_utils.js';
import clipsData from '../src/data/clips.json' with { type: 'json' };

const GOLDS = ['gold_sky', 'gold_star', 'gold_bow', 'gold_hero', 'gold_x', 'gold_kneel'];

const SCHEMA = {
  type: 'object',
  properties: {
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          b: { type: 'number', description: 'beat the move lands on (prefer even beats; one move every 2 beats)' },
          m: { type: 'string', description: 'move id from the provided library' },
          g: { type: 'boolean', description: 'true only for gold_* climax moves (5-7 total)' },
        },
        required: ['b', 'm'],
        additionalProperties: false,
      },
    },
  },
  required: ['moves'],
  additionalProperties: false,
} as const;

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'choreo', 6)) return;
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'no api key configured' }); return; }

  const q = req.query ?? {};
  const videoId = String(q.v ?? '');
  const title = String(q.t ?? '').slice(0, 200);
  const duration = Number(q.dur ?? 0);
  const bpm = Number(q.bpm ?? 0);
  const introBeat = Number(q.i ?? 8);
  const totalBeats = Number(q.tb ?? 0);
  if (!/^[\w-]{11}$/.test(videoId) || !title || !(bpm >= 60 && bpm <= 200) || !(totalBeats >= 48 && totalBeats <= 2000)) {
    res.status(400).json({ error: 'bad request' });
    return;
  }

  // server-side lyric fetch (also CDN-cached with the routine)
  const lyr = await fetchLyricsServer(title, duration);
  if (!lyr?.length) {
    res.status(200).setHeader('Cache-Control', 's-maxage=86400').json({ moves: null, reason: 'no-lyrics' });
    return;
  }
  const lines = lyr.map((l) => ({
    beat: Math.round(((l.t * bpm) / 60 - 4) * 10) / 10,
    text: l.text,
  })).filter((l) => l.beat > 0 && l.beat < totalBeats).slice(0, 300);

  const clips = (clipsData as { clips: { id: string; g: string; e: number; b: number }[] }).clips;
  const moves = [
    ...clips.map((c) => ({ id: c.id, energy: c.e, genre: c.g, beats: c.b })),
    ...GOLDS.map((id) => ({ id, energy: 1 })),
  ];
  // simple section plan for context (intro → alternating 32-beat blocks → outro)
  const sections: { beat: number; kind: string }[] = [{ beat: 0, kind: 'intro' }];
  let b = Math.max(8, introBeat), k = 0;
  while (b < totalBeats - 16) {
    sections.push({ beat: b, kind: k % 2 === 0 ? 'verse' : 'chorus' });
    b += 32; k++;
  }
  sections.push({ beat: totalBeats - 16, kind: 'outro' });

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 12000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
      system: [
        'You are the choreographer for a Just Dance-style camera game. You beat-map full routines for one dancer,',
        'using ONLY move ids from the provided library. Most library entries are real motion-capture dance clips',
        '(each spans 2 beats and carries a genre + energy); a few are static gold_* finisher poses.',
        'Principles:',
        '- Schedule one clip every 2 beats on even beats; each clip fills the 2 beats until the next.',
        '- GENRE COHERENCE: pick 1-2 genres that fit the song mood (e.g. house/lahiphop for EDM-pop, balletjazz/streetjazz',
        '  for ballads, krump/break for aggressive tracks, waack/lock for funk & disco) and stay within them.',
        '- Match energy to the song: low-energy clips in verses and quiet lyric moments, high-energy in choruses and drops.',
        '- Match the lyrics where possible: energetic clips on action words, smooth clips on emotional lines.',
        '- Build learnable phrases: repeat short 3-4 clip sequences within a section; give every chorus a recognizable',
        '  recurring hook of the same clips each time it returns.',
        '- Variety: avoid using any one clip more than ~5 times; never the same clip back-to-back.',
        '- Gold moves: exactly 5-7, ids starting with gold_, marked g:true, at section climaxes and the finale.',
        '- INTRO: the video may open with a non-musical intro (dialogue, skit, titles). intro_beat marks where the',
        '  song actually starts — schedule NOTHING before intro_beat except at most 2 gentle low-energy clips right',
        '  before it as a warmup. Also leave visible instrumental breaks (long gaps between lyric lines) low-energy.',
        '- Cover the song from intro_beat to the final beats with no gaps longer than 4 beats.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: JSON.stringify({
          song_title: title, bpm, total_beats: totalBeats, intro_beat: introBeat,
          sections, move_library: moves, synced_lyrics_on_beat_grid: lines,
        }),
      }],
    });

    if (response.stop_reason === 'refusal') { res.status(502).json({ error: 'model refused' }); return; }
    const text = response.content.find((bl: any) => bl.type === 'text') as any;
    const parsed = JSON.parse(text?.text ?? '{}');
    res.status(200)
      .setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=604800')
      .json({ moves: parsed.moves ?? [] });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'generation failed' });
  }
}
