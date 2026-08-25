// In-game music for the movement suite, played by the same procedural synth
// engine as the dance songs — zero audio assets, sample-accurate beat clock
// the backgrounds pulse to. Tracks are Songs with empty choreography.
//
// BLADE_RUNNING: the Fruit Slice track. 132 BPM, I-vi-IV-V in G, arranged so
// the round opens on a short intro, spends most of its 60 seconds in
// full-energy chorus, breathes twice in verses, and sprints the finale.

import type { Song } from '../songs';

const NO_COACH = { skin: '#e8b89a', hair: '#20182a', top: '#ffd23e', vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' };

export const BLADE_RUNNING: Song = {
  id: 'blade-running',
  title: 'Blade Running',
  artist: 'The Midnight Circuit',
  bpm: 132,
  beats: 160,
  scene: 'city',
  difficulty: 1,
  accent: '#ffd23e',
  accent2: '#ff6ac1',
  coach: NO_COACH,
  root: 55, // G major: G Em C D — bright, driving
  chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],
  sections: [
    { beat: 0, kind: 'intro' },
    { beat: 4, kind: 'chorus' },
    { beat: 36, kind: 'verse' },
    { beat: 52, kind: 'chorus' },
    { beat: 84, kind: 'verse' },
    { beat: 92, kind: 'chorus' },
    { beat: 140, kind: 'outro' },
  ],
  choreo: [],
  lyrics: [],
};
