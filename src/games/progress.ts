// Progression + lifetime stats for the movement suite. Medals earned across
// runs unlock saber styles and trails; per-game lifetime stats feed the game
// home screens. Everything lives in localStorage.

export interface FruitStats {
  games: number;
  sliced: number;
  bossKills: number;
  bestCombo: number;
  kcal: number;
  medals: { bronze: number; silver: number; gold: number };
}

const FRUIT_KEY = 'gs-fruit-stats';

export function fruitStats(): FruitStats {
  const base: FruitStats = { games: 0, sliced: 0, bossKills: 0, bestCombo: 0, kcal: 0, medals: { bronze: 0, silver: 0, gold: 0 } };
  try {
    const raw = JSON.parse(localStorage.getItem(FRUIT_KEY) ?? '{}');
    return { ...base, ...raw, medals: { ...base.medals, ...(raw.medals ?? {}) } };
  } catch { return base; }
}

export function addFruitRun(run: { sliced: number; bossKills: number; combo: number; kcal: number; medal: 0 | 1 | 2 | 3 }) {
  const s = fruitStats();
  s.games++;
  s.sliced += run.sliced;
  s.bossKills += run.bossKills;
  s.bestCombo = Math.max(s.bestCombo, run.combo);
  s.kcal += run.kcal;
  if (run.medal === 1) s.medals.bronze++;
  if (run.medal === 2) s.medals.silver++;
  if (run.medal === 3) s.medals.gold++;
  localStorage.setItem(FRUIT_KEY, JSON.stringify(s));
}

export function totalMedals(): number {
  const m = fruitStats().medals;
  return m.bronze + m.silver + m.gold;
}

// ---- saber styles -----------------------------------------------------------

export interface SaberStyle {
  id: string;
  name: string;
  need: number;                 // total medals required
  colL: string; colR: string;
  deepL: string; deepR: string;
  ember: string[];
  trail: 'comet' | 'star' | 'petal';
}

export const SABER_STYLES: SaberStyle[] = [
  { id: 'classic', name: 'Classic', need: 0, colL: '#6ee7ff', colR: '#ffd23e', deepL: '#2a8ab8', deepR: '#d9861f', ember: ['#fff7ee'], trail: 'comet' },
  { id: 'ember', name: 'Ember', need: 2, colL: '#ff8a2e', colR: '#ff5d5d', deepL: '#c2571a', deepR: '#a83232', ember: ['#ffd23e', '#ff8a2e'], trail: 'comet' },
  { id: 'starlight', name: 'Starlight', need: 5, colL: '#b39dff', colR: '#ff6ac1', deepL: '#6a4fd0', deepR: '#c23a8a', ember: ['#fff7ee', '#ffd23e'], trail: 'star' },
  { id: 'bloom', name: 'Bloom', need: 9, colL: '#7cf95c', colR: '#ff6ac1', deepL: '#3fae2e', deepR: '#c23a8a', ember: ['#ff6ac1', '#fff7ee'], trail: 'petal' },
];

export function saberStyle(): SaberStyle {
  const id = localStorage.getItem('gs-saber') ?? 'classic';
  const unlockedAt = totalMedals();
  const s = SABER_STYLES.find((x) => x.id === id);
  return s && s.need <= unlockedAt ? s : SABER_STYLES[0];
}

export function setSaberStyle(id: string) {
  localStorage.setItem('gs-saber', id);
}
