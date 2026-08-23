// The cast: designed Just Dance-style coaches. In AUTO mode the player's
// scanned colors get a seeded look (hair/pattern/accessories); picking a cast
// member swaps in that character's full outfit while keeping the player's
// scanned body proportions.

import type { StyleProfile, Look, BodyShape } from './appearance';

export interface CharacterPreset {
  id: string;
  name: string;
  style: Omit<StyleProfile, 'body'>;
}

const look = (l: Partial<Look>): Look => ({
  hair: 'swoop', shades: false, pattern: 'solid', skirt: false, ...l,
});

export const CAST: CharacterPreset[] = [
  {
    id: 'nova', name: 'NOVA',
    style: {
      skin: '#c98a5e', hair: '#1d1126', top: '#ff2fb4', topDeep: '#b3117a', bottom: '#2a1b52',
      boots: '#fff2f9', glove: '#ffffff', longSleeves: true, hairIsSkin: false,
      look: look({ hair: 'afro', shades: true, pattern: 'halves', pattern2: '#26e5ff' }),
    },
  },
  {
    id: 'blaze', name: 'BLAZE',
    style: {
      skin: '#e8b089', hair: '#e8342e', top: '#ff7b1f', topDeep: '#cf4d0a', bottom: '#231f2e',
      boots: '#1a1620', glove: '#ffffff', longSleeves: false, hairIsSkin: false,
      look: look({ hair: 'spiky', pattern: 'chevron', pattern2: '#ffd23e' }),
    },
  },
  {
    id: 'luna', name: 'LUNA',
    style: {
      skin: '#f0c9a8', hair: '#7a3df0', top: '#b39dff', topDeep: '#7a5fd0', bottom: '#3d2b73',
      boots: '#f6f2ff', glove: '#ffffff', longSleeves: false, hairIsSkin: false,
      look: look({ hair: 'bob', pattern: 'stripes', pattern2: '#ff9ad5', skirt: true }),
    },
  },
  {
    id: 'kiko', name: 'KIKO',
    style: {
      skin: '#a06a42', hair: '#120d16', top: '#20e3b2', topDeep: '#0f9e7a', bottom: '#ffd23e',
      boots: '#141019', glove: '#ffffff', longSleeves: false, hairIsSkin: false,
      look: look({ hair: 'buns', pattern: 'halves', pattern2: '#ffd23e', skirt: true, headband: '#ff4f9a' }),
    },
  },
  {
    id: 'rex', name: 'REX',
    style: {
      skin: '#d99c72', hair: '#23301f', top: '#57d95a', topDeep: '#2f9e39', bottom: '#26203a',
      boots: '#ffffff', glove: '#ffffff', longSleeves: true, hairIsSkin: false,
      look: look({ hair: 'cap', shades: true, pattern: 'solid' }),
    },
  },
  {
    id: 'velvet', name: 'VELVET',
    style: {
      skin: '#b57ab0', hair: '#2b174d', top: '#3ec5ff', topDeep: '#1d86c9', bottom: '#f5f5ff',
      boots: '#241d40', glove: '#ffffff', longSleeves: false, hairIsSkin: false,
      look: look({ hair: 'ponytail', pattern: 'stripes', pattern2: '#ffffff' }),
    },
  },
  {
    id: 'midnight', name: 'MIDNIGHT',
    style: {
      skin: '#8f9fd9', hair: '#101024', top: '#3a2a6e', topDeep: '#241a49', bottom: '#191330',
      boots: '#0f0c1c', glove: '#ffffff', longSleeves: true, hairIsSkin: false,
      look: look({ hair: 'hood', shades: true, pattern: 'solid' }),
    },
  },
  {
    id: 'sol', name: 'SOL',
    style: {
      skin: '#c77f4f', hair: '#f7e06e', top: '#ffd23e', topDeep: '#d9a616', bottom: '#ffffff',
      boots: '#e8562e', glove: '#ffffff', longSleeves: false, hairIsSkin: false,
      look: look({ hair: 'swoop', pattern: 'chevron', pattern2: '#ffffff', skirt: true }),
    },
  },
];

const HAIRS: Look['hair'][] = ['afro', 'spiky', 'bob', 'buns', 'ponytail', 'swoop'];
const PATTERNS: Look['pattern'][] = ['solid', 'stripes', 'chevron', 'halves'];

/** AUTO mode: keep the scanned colors, add a seeded character look */
export function autoLook(style: StyleProfile, seed: number): Look {
  return look({
    hair: style.longSleeves ? 'hood' : HAIRS[seed % HAIRS.length],
    shades: seed % 3 === 0,
    pattern: PATTERNS[(seed >> 2) % PATTERNS.length],
    pattern2: seed % 2 === 0 ? '#ffffff' : style.topDeep,
    headband: seed % 5 === 0 ? style.glove : undefined,
  });
}

/** resolve the dancer's style: cast pick (keeps scanned body) or auto look */
export function applyCharacter(scanned: StyleProfile, pref: string, seed: number): StyleProfile {
  const preset = CAST.find((c) => c.id === pref);
  const body: BodyShape = scanned.body;
  if (preset) return { ...preset.style, body };
  return { ...scanned, glove: '#ffffff', look: scanned.look ?? autoLook(scanned, seed) };
}
