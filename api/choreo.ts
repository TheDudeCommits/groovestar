// AI choreographer — Claude beat-maps a routine that understands the song's
// lyrics, structure, and energy. Active only when ANTHROPIC_API_KEY is set in
// the deployment environment; the client falls back to keyword mapping when
// this endpoint is unavailable.

import Anthropic from '@anthropic-ai/sdk';

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
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'no api key configured' }); return; }

  const { title, bpm, totalBeats, difficulty, sections, lyrics, moves } = req.body ?? {};
  if (!Array.isArray(moves) || !Array.isArray(lyrics) || !totalBeats || moves.length > 200 || lyrics.length > 300) {
    res.status(400).json({ error: 'bad request' });
    return;
  }

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
        '- Cover the whole song from beat 8 to the final beats with no gaps longer than 4 beats.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: JSON.stringify({
          song_title: title,
          bpm,
          total_beats: totalBeats,
          difficulty,
          sections,
          move_library: moves,
          synced_lyrics_on_beat_grid: lyrics,
        }),
      }],
    });

    if (response.stop_reason === 'refusal') {
      res.status(502).json({ error: 'model refused' });
      return;
    }
    const text = response.content.find((b: any) => b.type === 'text') as any;
    const parsed = JSON.parse(text?.text ?? '{}');
    res.status(200)
      .setHeader('Cache-Control', 's-maxage=604800')
      .json({ moves: parsed.moves ?? [] });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? 'generation failed' });
  }
}
