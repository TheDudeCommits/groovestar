// Song definitions: original synth tracks + beat-mapped choreography.
// Choreography cadence mirrors the reference: one pictogram move every 2 beats,
// section-based repetition so the player can learn patterns, Gold Moves at
// section climaxes and the finale.

export interface ChoreoMove {
  beat: number;        // beat the move lands on (pictogram arrival)
  move: string;        // key into MOVES
  gold?: boolean;
}

export interface LyricLine {
  beat: number;        // line start
  durBeats: number;    // highlight sweep duration
  text: string;
}

export type SceneKind = 'city' | 'bokeh' | 'disco';

export interface SectionDef { beat: number; kind: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' }

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  beats: number;              // total song length in beats
  scene: SceneKind;
  difficulty: 1 | 2 | 3;
  accent: string;             // UI accent color
  accent2: string;
  coach: { skin: string; hair: string; top: string; vest: string; pants: string; glove: string; boots: string };
  chords: number[][];         // chord loop, semitones from root, one chord per bar
  root: number;               // MIDI root
  sections: SectionDef[];
  choreo: ChoreoMove[];
  lyrics: LyricLine[];
}

// pattern helper: lay `moves` starting at `beat`, one every `step` beats
function run(beat: number, step: number, moves: string[]): ChoreoMove[] {
  return moves.map((move, i) => ({ beat: beat + i * step, move }));
}
function gold(beat: number, move: string): ChoreoMove {
  return { beat, move, gold: true };
}

// ---------------------------------------------------------------------------
const verseA = ['sway_l', 'sway_r', 'sway_l', 'wave_r', 'sway_r', 'sway_l', 'sway_r', 'wave_l'];
const verseB = ['hips_l', 'hips_r', 'cross_arms', 'reach_fwd', 'hips_l', 'hips_r', 'punch_l', 'punch_r'];
const chorusA = ['clap_up', 'pump', 'v_up', 'punch_r', 'clap_up', 'pump', 'v_up', 'punch_l'];
const chorusB = ['point_up_r', 'pump', 'point_up_l', 'pump', 'hi_five_r', 'hi_five_l', 'squat_pump', 'star_jump'];
const bridgeA = ['reach_fwd', 'muscle', 'wave_r', 'wave_l', 'cross_arms', 'muscle', 'slide_l', 'slide_r'];
const letters = ['letter_g', 'letter_r', 'letter_v', 'pump', 'letter_g', 'letter_r', 'letter_v', 'star_jump'];

export const SONGS: Song[] = [
  {
    id: 'neon-nights',
    title: 'Neon Nights',
    artist: 'The Midnight Circuit',
    bpm: 120,
    beats: 168,
    scene: 'city',
    difficulty: 2,
    accent: '#37e0ff',
    accent2: '#b348ff',
    coach: { skin: '#e8b89a', hair: '#20182a', top: '#54f0ff', vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' },
    root: 57, // A
    chords: [[0, 3, 7], [-4, 0, 5], [-9, -5, 0], [-2, 2, 5]], // Am F C G
    sections: [
      { beat: 0, kind: 'intro' }, { beat: 16, kind: 'verse' }, { beat: 48, kind: 'chorus' },
      { beat: 80, kind: 'verse' }, { beat: 112, kind: 'chorus' }, { beat: 144, kind: 'outro' },
    ],
    choreo: [
      ...run(8, 2, ['idle', 'sway_l', 'sway_r', 'clap_up']),
      ...run(16, 2, verseA), ...run(32, 2, verseB.slice(0, 7)), gold(46, 'gold_sky'),
      ...run(48, 2, chorusA), ...run(64, 2, chorusA.slice(0, 7)), gold(78, 'gold_star'),
      ...run(80, 2, verseB), ...run(96, 2, verseA.slice(0, 7)), gold(110, 'gold_sky'),
      ...run(112, 2, chorusA), ...run(128, 2, chorusB.slice(0, 7)), gold(142, 'gold_star'),
      ...run(144, 2, ['sway_l', 'sway_r', 'clap_up', 'pump', 'v_up', 'point_up_r', 'point_up_l']),
      gold(160, 'gold_bow'),
    ],
    lyrics: [
      { beat: 8, durBeats: 8, text: 'City lights are calling out my name' },
      { beat: 16, durBeats: 8, text: 'Racing through the midnight in the rain' },
      { beat: 24, durBeats: 8, text: 'Every heartbeat drums a neon sign' },
      { beat: 32, durBeats: 8, text: 'Tonight the skyline’s yours and mine' },
      { beat: 40, durBeats: 8, text: 'Turn it up, we’re never going home' },
      { beat: 48, durBeats: 8, text: 'Neon nights — we light it up, up, up' },
      { beat: 56, durBeats: 8, text: 'Dancing till the stars fill up the cup' },
      { beat: 64, durBeats: 8, text: 'Neon nights — the city sings along' },
      { beat: 72, durBeats: 8, text: 'Every wire hums our favourite song' },
      { beat: 80, durBeats: 8, text: 'Shadows spin like records on the wall' },
      { beat: 88, durBeats: 8, text: 'Gravity was never ours at all' },
      { beat: 96, durBeats: 8, text: 'Catch the current, ride the glowing line' },
      { beat: 104, durBeats: 8, text: 'Tonight the skyline’s yours and mine' },
      { beat: 112, durBeats: 8, text: 'Neon nights — we light it up, up, up' },
      { beat: 120, durBeats: 8, text: 'Dancing till the stars fill up the cup' },
      { beat: 128, durBeats: 8, text: 'Neon nights — the city sings along' },
      { beat: 136, durBeats: 8, text: 'Every wire hums our favourite song' },
      { beat: 144, durBeats: 8, text: 'Hold the sky and never let it go' },
      { beat: 152, durBeats: 8, text: 'One more beat before the morning glow' },
    ],
  },
  {
    id: 'gold-rush',
    title: 'Gold Rush',
    artist: 'Stella Fever',
    bpm: 128,
    beats: 176,
    scene: 'bokeh',
    difficulty: 3,
    accent: '#ffc843',
    accent2: '#ff7847',
    coach: { skin: '#caa27e', hair: '#171126', top: '#ffc843', vest: '#241a30', pants: '#33254a', glove: '#ff5e3e', boots: '#1b1424' },
    root: 53, // F
    chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-2, 0, 5]], // Fm Db Ab Eb-ish
    sections: [
      { beat: 0, kind: 'intro' }, { beat: 16, kind: 'verse' }, { beat: 48, kind: 'chorus' },
      { beat: 80, kind: 'bridge' }, { beat: 112, kind: 'chorus' }, { beat: 152, kind: 'outro' },
    ],
    choreo: [
      ...run(8, 2, ['idle', 'hips_l', 'hips_r', 'pump']),
      ...run(16, 2, verseB), ...run(32, 2, verseA.slice(0, 7)), gold(46, 'gold_sky'),
      ...run(48, 2, chorusB), ...run(64, 2, chorusB.slice(0, 7)), gold(78, 'gold_star'),
      ...run(80, 2, bridgeA), ...run(96, 2, bridgeA.slice(0, 7)), gold(110, 'gold_bow'),
      ...run(112, 2, chorusB), ...run(128, 2, chorusA), ...run(144, 2, chorusB.slice(0, 3)), gold(150, 'gold_star'),
      ...run(152, 2, ['lasso', 'lasso', 'slide_l', 'slide_r', 'clap_up', 'squat_pump', 'v_up']),
      gold(168, 'gold_sky'),
    ],
    lyrics: [
      { beat: 8, durBeats: 8, text: 'Dust off your boots, the fever’s here' },
      { beat: 16, durBeats: 8, text: 'A spark of gold in the atmosphere' },
      { beat: 24, durBeats: 8, text: 'Shake the ground until it pays' },
      { beat: 32, durBeats: 8, text: 'We strike it rich in a thousand ways' },
      { beat: 40, durBeats: 8, text: 'Fortune favours the ones who move' },
      { beat: 48, durBeats: 8, text: 'Gold rush — everybody dig it now' },
      { beat: 56, durBeats: 8, text: 'Shimmer shimmer, take a bow' },
      { beat: 64, durBeats: 8, text: 'Gold rush — the night is paying out' },
      { beat: 72, durBeats: 8, text: 'Diamonds falling, hear us shout' },
      { beat: 80, durBeats: 8, text: 'Slow it down, let the embers glow' },
      { beat: 88, durBeats: 8, text: 'Every step is worth its weight in gold' },
      { beat: 96, durBeats: 8, text: 'Raise your hands up to the vault of stars' },
      { beat: 104, durBeats: 8, text: 'The treasure map was always ours' },
      { beat: 112, durBeats: 8, text: 'Gold rush — everybody dig it now' },
      { beat: 120, durBeats: 8, text: 'Shimmer shimmer, take a bow' },
      { beat: 128, durBeats: 8, text: 'Gold rush — the night is paying out' },
      { beat: 136, durBeats: 8, text: 'Diamonds falling, hear us shout' },
      { beat: 144, durBeats: 8, text: 'Spin the lasso, let it fly' },
      { beat: 152, durBeats: 8, text: 'We ride the glitter through the sky' },
      { beat: 160, durBeats: 8, text: 'One last nugget, one last round' },
      { beat: 168, durBeats: 8, text: 'The richest crew in town' },
    ],
  },
  {
    id: 'letter-party',
    title: 'Letter Party',
    artist: 'Discotron 5000',
    bpm: 116,
    beats: 168,
    scene: 'disco',
    difficulty: 1,
    accent: '#7cf95c',
    accent2: '#ff5ad2',
    coach: { skin: '#b98a63', hair: '#241d12', top: '#ff5ad2', vest: '#2c1d3d', pants: '#20387a', glove: '#7cf95c', boots: '#3d1d1d' },
    root: 60, // C
    chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], // C Am F G
    sections: [
      { beat: 0, kind: 'intro' }, { beat: 16, kind: 'verse' }, { beat: 48, kind: 'chorus' },
      { beat: 80, kind: 'verse' }, { beat: 112, kind: 'chorus' }, { beat: 144, kind: 'outro' },
    ],
    choreo: [
      ...run(8, 2, ['idle', 'clap_up', 'sway_l', 'sway_r']),
      ...run(16, 2, verseA), ...run(32, 2, verseB.slice(0, 7)), gold(46, 'gold_star'),
      ...run(48, 2, letters), ...run(64, 2, letters.slice(0, 7)), gold(78, 'gold_sky'),
      ...run(80, 2, verseB), ...run(96, 2, bridgeA.slice(0, 7)), gold(110, 'gold_bow'),
      ...run(112, 2, letters), ...run(128, 2, letters.slice(0, 7)), gold(142, 'gold_star'),
      ...run(144, 2, ['clap_up', 'muscle', 'hi_five_r', 'hi_five_l', 'pump', 'letter_v', 'letter_g']),
      gold(160, 'gold_star'),
    ],
    lyrics: [
      { beat: 8, durBeats: 8, text: 'Hey you, standing by the wall' },
      { beat: 16, durBeats: 8, text: 'The floor is lit, we need you all' },
      { beat: 24, durBeats: 8, text: 'No need to know the steps by heart' },
      { beat: 32, durBeats: 8, text: 'The alphabet will do its part' },
      { beat: 40, durBeats: 8, text: 'Warm it up, the bass is on its way' },
      { beat: 48, durBeats: 8, text: 'It’s a L-E-T-T-E-R party!' },
      { beat: 56, durBeats: 8, text: 'Spell it with your hands up high' },
      { beat: 64, durBeats: 8, text: 'It’s a L-E-T-T-E-R party!' },
      { beat: 72, durBeats: 8, text: 'Every letter reaches for the sky' },
      { beat: 80, durBeats: 8, text: 'Slide left, now slide to the right' },
      { beat: 88, durBeats: 8, text: 'The mirror floor is burning bright' },
      { beat: 96, durBeats: 8, text: 'Shoulder shimmy, do it slow' },
      { beat: 104, durBeats: 8, text: 'Then hit the pose and steal the show' },
      { beat: 112, durBeats: 8, text: 'It’s a L-E-T-T-E-R party!' },
      { beat: 120, durBeats: 8, text: 'Spell it with your hands up high' },
      { beat: 128, durBeats: 8, text: 'It’s a L-E-T-T-E-R party!' },
      { beat: 136, durBeats: 8, text: 'Every letter reaches for the sky' },
      { beat: 144, durBeats: 8, text: 'Last call — give me one more cheer' },
      { beat: 152, durBeats: 8, text: 'The brightest crew of the year' },
    ],
  },
];

export function songById(id: string): Song {
  const s = SONGS.find((x) => x.id === id);
  if (!s) throw new Error('unknown song ' + id);
  return s;
}
