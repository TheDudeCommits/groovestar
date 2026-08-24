// GrooveStar — a camera-controlled dance game in the presentation language of
// the reference footage: menu → get-ready card → countdown → dance → results.
// Songs come from the built-in synth engine or from an imported YouTube video
// (official embed as audio/backdrop + procedurally generated choreography).

import './style.css';
import { SONGS, type Song, type SectionDef } from './songs';
import { PoseTracker } from './pose/tracker';
import { Scorer, type JudgmentEvent } from './pose/scorer';
import { choreoPose, addGroove, drawCharacter, coachStyleOf } from './coach';
import { drawScene } from './scenes';
import { Hud, drawPictograms } from './ui/hud';
import { MOVES, type Pose } from './moves';
import { StyleScanner, type StyleProfile } from './appearance';
import { CAST, applyCharacter } from './characters';
import { CLIPS, clipPose } from './motion';
import { PlayerAvatar, type Cosmetics } from './avatar';
import { generateChoreo, freestyleWindows, carveFreestyle, smoothChoreo, type FreestyleWindow } from './choreograph';
import { fetchVibe, vibeAt, type VibePalette } from './vibe';
import { fetchRoutineIndex, loadRoutine, type RoutineEntry } from './routines';
import { parseYouTubeId, YouTubeSource, YouTubeClock } from './youtube';
import { BeatListener } from './audio/beatsync';
import { fetchSyncedLyrics, lyricsToLines, applyKeywordChoreo, fetchAiChoreo, fetchSongMeta, introBeatsOf } from './lyrics';
import { Room, encodePose, decodePose, MAX_PLAYERS, type NetMsg } from './net/room';
import { TvCamHost, connectPhoneCam } from './net/camlink';
import { DEFAULT_COSMETICS } from './avatar';

/** common clock interface: the synth engine and the YouTube playhead both provide it */
interface SongClock {
  beat(): number;
  sectionAt(beat: number): SectionDef['kind'];
  readonly finished: boolean;
  stop(): void;
  goldSting(): void;
}

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'stage';
app.appendChild(canvas);
const ctx = canvas.getContext('2d')!;

const tracker = new PoseTracker();
let trackerStarted = false;
let cameraOk = false;

let raf = 0;
let state: 'menu' | 'ready' | 'play' | 'results' = 'menu';
/** strongest stage beam this frame — the avatar's key light in YouTube mode */
let stageLight: { x: number; color: string } | null = null;
/** phone-as-camera link (TV side) — when connected it replaces the local webcam */
let phoneCam: TvCamHost | null = null;
const cam = () => (phoneCam?.connected ? phoneCam : tracker);

// fitness mode: kcal + active time, lifetime totals + day streak
const fitnessOn = () => localStorage.getItem('gs-fitness') === '1';
function fitStats(): { kcal: number; secs: number; days: Record<string, number> } {
  try { return { kcal: 0, secs: 0, days: {}, ...JSON.parse(localStorage.getItem('gs-fit') ?? '{}') }; }
  catch { return { kcal: 0, secs: 0, days: {} }; }
}
function fitStreak(): number {
  const days = fitStats().days;
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (days[key] > 0) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

/** small non-blocking notice, bottom-center */
function toast(text: string) {
  const t = div('gs-toast');
  t.textContent = text;
  app.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
}
const skinPref = (): 'toon' | 'sprite' | 'wire' => {
  const v = localStorage.getItem('gs-skin');
  return v === 'toon' || v === 'wire' ? v : 'sprite';
};
const charPref = () => localStorage.getItem('gs-char') ?? 'auto';
const animePref = () => localStorage.getItem('gs-anime') === '1';
let playerStyle: StyleProfile | null = null;
let activeRoom: Room | null = null;

/** remote player state in a dance-off */
interface RemotePlayer {
  id: string;
  style: StyleProfile;
  avatar: PlayerAvatar;
  lms: ReturnType<typeof decodePose>;
  lastPoseAt: number;
  score: number;
  stars: number;
  end?: number;
}

function resize() {
  // cap the render scale: full Retina DPR doubles every fill's pixel cost for
  // no visible gain at dance-game viewing distance, and the avatar pipeline
  // does a dozen full-surface composites per frame
  const dpr = Math.min(devicePixelRatio, 1.5);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const W = () => window.innerWidth;
const H = () => window.innerHeight;

// ---------------------------------------------------------------------------
// Menu

const YT_ACCENTS: [string, string][] = [
  ['#37e0ff', '#b348ff'], ['#ffc843', '#ff7847'], ['#7cf95c', '#ff5ad2'],
  ['#ff6b6b', '#ffd23e'], ['#7aa2ff', '#5cf9c7'],
];

// ---------------------------------------------------------------------------
// Style locker: cosmetics unlocked by lifetime stars

interface LockerOption { id: string; label: string; stars: number; color: string | null }
const LOCKER: Record<'aura' | 'trim' | 'tattoo' | 'kicks', LockerOption[]> = {
  aura: [
    { id: 'accent', label: 'Song Accent', stars: 0, color: null },
    { id: 'magenta', label: 'Magenta', stars: 5, color: '#ff5ad2' },
    { id: 'gold', label: 'Gold', stars: 10, color: '#ffd23e' },
    { id: 'emerald', label: 'Emerald', stars: 20, color: '#57f9a6' },
  ],
  trim: [
    { id: 'none', label: 'None', stars: 0, color: null },
    { id: 'cyan', label: 'Cyan Piping', stars: 5, color: '#55f0ff' },
    { id: 'gold', label: 'Gold Piping', stars: 20, color: '#ffd23e' },
  ],
  tattoo: [
    { id: 'none', label: 'None', stars: 0, color: null },
    { id: 'circuit', label: 'Circuit Glow', stars: 10, color: null },
    { id: 'royal', label: 'Royal Rings', stars: 35, color: null },
  ],
  kicks: [
    { id: 'default', label: 'Classic', stars: 0, color: null },
    { id: 'neon', label: 'Neon Kicks', stars: 10, color: null },
    { id: 'gold', label: 'Gold Kicks', stars: 35, color: null },
  ],
};

const totalStars = () => Number(localStorage.getItem('gs-stars') ?? '0');
const addStars = (n: number) => localStorage.setItem('gs-stars', String(totalStars() + n));
const crewOn = () => localStorage.getItem('gs-crew') !== '0';

function getEquip(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('gs-equip') ?? '{}'); } catch { return {}; }
}
function setEquip(slot: string, id: string) {
  const e = getEquip(); e[slot] = id;
  localStorage.setItem('gs-equip', JSON.stringify(e));
}
function resolveCosmetics(): Cosmetics {
  const e = getEquip();
  const stars = totalStars();
  const opt = (slot: keyof typeof LOCKER) => {
    const o = LOCKER[slot].find((x) => x.id === e[slot]);
    return o && o.stars <= stars ? o : LOCKER[slot][0];
  };
  return {
    aura: opt('aura').color,
    trim: opt('trim').color,
    tattoo: opt('tattoo').id as Cosmetics['tattoo'],
    kicks: opt('kicks').id as Cosmetics['kicks'],
  };
}

/** coach palette derived from the player's captured style (crew, victory dance) */
function paletteFromStyle(s: StyleProfile): Song['coach'] {
  return { skin: s.skin, hair: s.hair, top: s.top, vest: s.topDeep, pants: s.bottom, glove: s.glove, boots: s.boots };
}

/**
 * Live YouTube search box: results appear as you type (350ms debounce,
 * in-flight requests aborted). Pasting a link resolves it directly.
 * GO / Enter picks the first result. Used on the homepage and in lobbies.
 */
function attachYtSearch(
  input: HTMLInputElement,
  resultsBox: HTMLElement,
  err: HTMLElement,
  goBtn: HTMLButtonElement | null,
  onPick: (id: string, title: string) => void,
) {
  let timer = 0;
  let ctrl: AbortController | null = null;
  let firstResult: { id: string; title: string } | null = null;

  const render = (results: { id: string; title: string; duration: string; channel: string }[]) => {
    firstResult = results[0] ? { id: results[0].id, title: results[0].title } : null;
    resultsBox.innerHTML = results.map((v) => `
      <button class="yt-result" data-id="${v.id}" data-title="${escapeHtml(v.title)}">
        <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" loading="lazy">
        <span class="ytr-meta"><span class="ytr-title">${escapeHtml(v.title)}</span>
        <span class="ytr-sub">${escapeHtml(v.channel)}${v.duration ? ' \u00b7 ' + escapeHtml(v.duration) : ''}</span></span>
      </button>`).join('');
    resultsBox.querySelectorAll<HTMLElement>('.yt-result').forEach((b) =>
      b.addEventListener('click', () => onPick(b.dataset.id!, b.dataset.title ?? '')));
  };

  const search = async (q: string) => {
    ctrl?.abort();
    ctrl = new AbortController();
    const mine = ctrl;
    if (!resultsBox.childElementCount) resultsBox.innerHTML = '<div class="yt-searching">Searching YouTube\u2026</div>';
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: mine.signal });
      const data = await r.json();
      if (mine.signal.aborted) return;
      const results = (data?.results ?? []) as { id: string; title: string; duration: string; channel: string }[];
      if (!results.length) { resultsBox.innerHTML = ''; err.textContent = 'No results. Try different words or paste a link.'; return; }
      err.textContent = '';
      render(results);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      resultsBox.innerHTML = '';
      err.textContent = 'Search is unavailable. Paste a YouTube link instead.';
    }
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (parseYouTubeId(q)) { resultsBox.innerHTML = ''; err.textContent = ''; return; }
    if (q.length < 3) { resultsBox.innerHTML = ''; firstResult = null; err.textContent = ''; return; }
    timer = window.setTimeout(() => search(q), 350);
  });

  const go = () => {
    const q = input.value.trim();
    if (!q) return;
    const id = parseYouTubeId(q);
    if (id) { err.textContent = ''; onPick(id, ''); return; }
    if (firstResult) { onPick(firstResult.id, firstResult.title); return; }
    search(q);
  };
  goBtn?.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function showMenu() {
  state = 'menu';
  cancelAnimationFrame(raf);
  activeRoom?.destroy();
  activeRoom = null;
  app.querySelectorAll('.overlay, .hud, .yt-holder, .cam-preview, .mp-corners').forEach((e) => e.remove());

  const menu = div('overlay menu');
  menu.innerHTML = `
    <div class="logo">GROOVE<span>STAR</span></div>
  `;
  // --- Just Dance classics: real extracted routines, lazily listed ---
  const classics = div('classics-panel');
  classics.innerHTML = `<div class="yt-title">Classics</div>
    <div class="classics-row" id="classics-row"></div>`;
  menu.appendChild(classics);
  fetchRoutineIndex().then((idx) => {
    if (!idx.length) { classics.remove(); return; }
    const crow = classics.querySelector('#classics-row')!;
    for (const e of idx) {
      const tile = div('song-tile classic-tile');
      tile.innerHTML = `<img src="https://i.ytimg.com/vi/${e.v}/mqdefault.jpg" alt="" loading="lazy">
        <div class="song-meta"><div class="song-title">${escapeHtml(e.title)}</div>
        <div class="song-artist">${escapeHtml(e.artist || 'Just Dance')}</div>
        <div class="song-diff">${Math.round(e.bpm)} BPM</div></div>`;
      tile.addEventListener('click', () => startClassic(e));
      crow.appendChild(tile);
    }
  });

  // --- YouTube search / import panel ---
  const yt = div('yt-panel');
  yt.innerHTML = `
    <div class="yt-title">Any song</div>
    <div class="yt-row">
      <input id="yt-url" placeholder="Search or paste a YouTube link" spellcheck="false">
      <button id="yt-go">Play</button>
    </div>
    <div id="yt-results" class="yt-results"></div>
    <div id="yt-err" class="yt-err"></div>`;
  menu.appendChild(yt);

  attachYtSearch(
    yt.querySelector('#yt-url') as HTMLInputElement,
    yt.querySelector('#yt-results') as HTMLElement,
    yt.querySelector('#yt-err') as HTMLElement,
    yt.querySelector('#yt-go') as HTMLButtonElement,
    (id) => startYouTube(id),
  );

  // --- dance-off (multiplayer) panel ---
  const mp = div('yt-panel mp-panel');
  mp.innerHTML = `
    <div class="yt-title mp-title">Dance off</div>
    <div class="yt-row">
      <button id="mp-create" class="mp-btn">Create room</button>
      <input id="mp-code" placeholder="CODE" maxlength="4" inputmode="numeric">
      <button id="mp-join" class="mp-btn">Join</button>
      <span id="mp-err" class="yt-err"></span>
    </div>`;
  menu.appendChild(mp);
  const mpErr = mp.querySelector('#mp-err') as HTMLElement;
  mp.querySelector('#mp-create')!.addEventListener('click', async () => {
    mpErr.textContent = 'Creating room\u2026';
    try {
      activeRoom = await Room.create(playerNameFromMenu());
      openLobby(activeRoom);
    } catch (e) { mpErr.textContent = String((e as Error).message ?? e); }
  });
  mp.querySelector('#mp-join')!.addEventListener('click', async () => {
    const code = (mp.querySelector('#mp-code') as HTMLInputElement).value.trim();
    if (!/^\d{4}$/.test(code)) { mpErr.textContent = 'Enter the 4-digit code.'; return; }
    mpErr.textContent = 'Joining\u2026';
    try {
      activeRoom = await Room.join(code, playerNameFromMenu());
      openLobby(activeRoom);
    } catch (e) { mpErr.textContent = String((e as Error).message ?? e); }
  });

  const foot = div('menu-foot');
  foot.innerHTML = `
    <div class="foot-row">
      <label>Dancer name <input id="pname" maxlength="14" value="${localStorage.getItem('gs-name') ?? 'DANCER'}"></label>
      <button id="calib" class="calib-btn ${localStorage.getItem('gs-style') ? 'on' : ''}">Calibrate</button>
      <button id="fit-toggle" class="calib-btn ${fitnessOn() ? 'on' : ''}">Fitness${fitStreak() > 1 ? ` ${fitStreak()}d` : ''}</button>
      <button id="phone-cam" class="calib-btn ${phoneCam?.connected ? 'on' : ''}">Phone camera</button>
      <button id="char-cycle" class="calib-btn">Dancer · ${charPref() === 'auto' ? 'My look' : (CAST.find((c) => c.id === charPref())?.name ?? 'My look')}</button>
    </div>
`;
  menu.appendChild(foot);
  foot.querySelector('#calib')!.addEventListener('click', () => openCalibrate());
  foot.querySelector('#fit-toggle')!.addEventListener('click', () => {
    localStorage.setItem('gs-fitness', fitnessOn() ? '0' : '1');
    showMenu();
  });
  foot.querySelector('#phone-cam')!.addEventListener('click', () => openPhoneCam());
  foot.querySelector('#char-cycle')!.addEventListener('click', () => {
    const ids = ['auto', ...CAST.map((c) => c.id)];
    const next = ids[(ids.indexOf(charPref()) + 1) % ids.length];
    localStorage.setItem('gs-char', next);
    const btn = foot.querySelector('#char-cycle')!;
    btn.textContent = `Dancer · ${next === 'auto' ? 'My look' : CAST.find((c) => c.id === next)!.name}`;
  });
  app.appendChild(menu);

  const loop = () => {
    if (state !== 'menu') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 2, section: 'verse', song: SONGS[0], goldBurst: 0 });
    const pose = addGroove(MOVES[['sway_l', 'sway_r', 'clap_up', 'pump'][Math.floor(t) % 4]].pose, t * 2, 0.7);
    const castStyle = { ...CAST[Math.floor(t / 5) % CAST.length].style, body: { headScale: 1, buildScale: 1 } };
    drawCharacter(ctx, 'menu', pose, castStyle, W() / 2, H() * 0.99, H() * 0.34, { alpha: 0.45, beat: t * 2 });
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function playerNameFromMenu(): string {
  const nameInput = document.getElementById('pname') as HTMLInputElement | null;
  const name = (nameInput?.value || 'DANCER').toUpperCase();
  localStorage.setItem('gs-name', name);
  return name;
}

// ---------------------------------------------------------------------------
// Get ready → play (built-in synth songs)

/** shared ready-card: camera init + style scan; draws the song cover behind */
async function readyFlow(song: Song, bannerHtml: string) {
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay').forEach((e) => e.remove());
  const card = div('overlay ready-card');
  card.innerHTML = `
    <div class="ready-inner">
      <div class="get-ready">GET READY!</div>
      <div class="song-banner">${bannerHtml}</div>
      <div class="ready-tip" id="ready-tip">Starting camera & pose tracking…</div>
    </div>`;
  app.appendChild(card);
  drawScene({ ctx, w: W(), h: H(), beat: 0.95, section: 'chorus', song, goldBurst: 0 });
  drawCharacter(ctx, 'ready', MOVES['v_up'].pose, coachStyleOf(song), W() / 2, H() * 0.86, H() * 0.55);

  if (phoneCam?.connected) {
    cameraOk = true; // the phone is the camera
  } else if (!trackerStarted) {
    trackerStarted = true;
    cameraOk = await tracker.init();
  }
  const tip = document.getElementById('ready-tip');
  const charSeed = [...song.id].reduce((n, c2) => n + c2.charCodeAt(0), 0);
  if (cameraOk) {
    // stored calibration profile wins — the player already scanned in detail
    const stored = loadStoredStyle();
    if (stored) {
      playerStyle = applyCharacter(stored, charPref(), charSeed);
      if (tip) tip.innerHTML = 'Style loaded from your calibration.';
      await wait(1100);
      card.remove();
      return;
    }
    if (tip) tip.innerHTML = '<span class="scanline">SCANNING YOUR STYLE\u2026</span> stand back so your upper body is in frame';
    const scanned = await scanStyle(song);
    playerStyle = applyCharacter(scanned ?? defaultStyle(song), charPref(), charSeed);
    if (tip) {
      tip.innerHTML = scanned
        ? `Style locked. ${swatches(scanned)}`
        : 'Step into frame.';
    }
    await wait(1700);
  } else {
    if (tip) tip.textContent = `Demo mode. No camera (${tracker.error ?? 'unavailable'}), scoring is simulated.`;
    await wait(2200);
  }
  card.remove();
}

async function scanStyle(song: Song): Promise<StyleProfile | null> {
  const scanner = new StyleScanner();
  const t0 = performance.now();
  while (performance.now() - t0 < 1500) {
    cam().update();
    if (cam().latestLandmarks) scanner.feed(cam().video, cam().latestLandmarks!);
    await new Promise(requestAnimationFrame);
  }
  if (scanner.sampleCount < 4) return null;
  return scanner.build(song.coach.glove);
}

function defaultStyle(song: Song): StyleProfile {
  const c = song.coach;
  return {
    skin: c.skin, hair: c.hair, top: c.top, topDeep: c.vest, bottom: c.pants,
    boots: c.boots, glove: c.glove, longSleeves: false, hairIsSkin: false,
    body: { headScale: 1, buildScale: 1 },
  };
}

function swatches(s: StyleProfile): string {
  const chip = (c: string, label: string) =>
    `<span class="chip" title="${label}" style="background:${c}"></span>`;
  return `<span class="chips">${chip(s.hair, 'hair')}${chip(s.skin, 'skin')}${chip(s.top, 'top')}${chip(s.bottom, 'bottom')}</span>`;
}

// ---------------------------------------------------------------------------
// YouTube flow

async function startYouTube(videoId: string) {
  const playerName = playerNameFromMenu();
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .yt-holder').forEach((e) => e.remove());

  const loadCard = div('overlay ready-card');
  loadCard.innerHTML = `<div class="ready-inner"><div class="get-ready">TUNING IN\u2026</div>
    <div class="ready-tip" id="tune-tip">Loading the video\u2026</div></div>`;
  app.appendChild(loadCard);

  const src = new YouTubeSource();
  const ok = await src.load(videoId);
  if (!ok) {
    loadCard.remove();
    src.destroy();
    showMenu();
    setTimeout(() => {
      const err = document.getElementById('yt-err');
      if (err) err.textContent = src.error ?? 'Could not load that video.';
    }, 50);
    return;
  }

  // tempo (Claude's music knowledge) + synced lyrics, in parallel
  const tuneTip = document.getElementById('tune-tip');
  if (tuneTip) tuneTip.textContent = 'Detecting tempo & fetching lyrics\u2026';
  const [meta, lyr, vibe] = await Promise.all([
    fetchSongMeta(videoId, src.title, src.duration),
    Promise.race([fetchSyncedLyrics(src.title, src.duration), wait(9000).then(() => null)]),
    fetchVibe(videoId),
  ]);
  loadCard.remove();
  const bpm = meta ?? 120;
  const difficulty = 2 as const;
  const introBeats = introBeatsOf(lyr, bpm, 4);

  // build a Song from the video: generated sections + choreography
  const seedNum = [...videoId].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const accents = YT_ACCENTS[seedNum % YT_ACCENTS.length];
  const scenes = ['city', 'bokeh', 'disco'] as const;
  const totalBeats = Math.max(48, Math.floor((src.duration * bpm) / 60) - 8);
  const gen = generateChoreo(videoId, totalBeats, difficulty, introBeats);
  const song: Song = {
    id: 'yt-' + videoId,
    title: src.title || 'YouTube Track',
    artist: 'your pick \u00b7 generated routine',
    bpm,
    beats: totalBeats,
    scene: scenes[seedNum % 3],
    difficulty,
    accent: accents[0],
    accent2: accents[1],
    coach: { skin: '#e8b89a', hair: '#20182a', top: accents[0], vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' },
    root: 57, chords: [[0, 3, 7]],
    sections: gen.sections,
    choreo: gen.choreo,
    lyrics: lyr ? lyricsToLines(lyr, bpm, 4) : [],
  };

  // AI choreography fetch runs in parallel with the camera scan
  const cacheKey = `gs-ai3-${videoId}-${Math.round(bpm)}`;
  const aiPromise: Promise<Song['choreo'] | null> = (async () => {
    if (!lyr) return null;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* bad cache */ }
    const result = await fetchAiChoreo(videoId, song.title, src.duration, bpm, introBeats, totalBeats);
    if (result) { try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* full */ } }
    return result;
  })();

  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>${Math.round(bpm)} BPM${meta === null ? ' (auto-sync)' : ''}${introBeats > 10 ? ' \u00b7 intro detected' : ''}</span>`);

  if (!lyr) toast('No synced lyrics found. Karaoke is off.');
  if (meta === null) toast('Tempo unknown. The mic will lock onto the beat.');
  if (lyr) {
    const waitCard = div('overlay ready-card');
    waitCard.innerHTML = `<div class="ready-inner"><div class="ready-tip"><span class="scanline">\u266a CHOREOGRAPHING TO THE LYRICS\u2026</span></div>
      <div class="ready-tip" style="opacity:0.6;font-size:0.85em">The first dance on a new song takes about 30 seconds to choreograph.</div></div>`;
    app.appendChild(waitCard);
    const ai = await Promise.race([aiPromise, wait(45000).then(() => 'timeout' as const)]);
    waitCard.remove();
    if (ai && ai !== 'timeout') {
      song.choreo = ai;
    } else {
      toast('AI choreographer unavailable. Using the generated routine.');
      song.choreo = applyKeywordChoreo(gen.choreo, song.lyrics).choreo;
    }
  }

  // fluidity pass, then carve the freestyle GO-OFF windows out of the routine
  const freestyle = freestyleWindows(totalBeats, introBeats);
  song.choreo = carveFreestyle(smoothChoreo(song.choreo), freestyle);

  const clock = new YouTubeClock(src, bpm, gen.sections, totalBeats, 4);
  clock.freeTempo = meta === null; // unknown tempo: let the mic adopt the real one
  const mic = new BeatListener();
  mic.start(); // fire and forget — sync silently disabled if mic is denied
  const run = () => {
    clock.restart();
    play(song, playerName, { clock, yt: src, mic, vibe, freestyle, onAgain: run });
  };
  run();
}

/** a Just Dance classic: the extracted routine + the original gameplay video as the stage */
async function startClassic(entry: RoutineEntry) {
  const playerName = playerNameFromMenu();
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .yt-holder').forEach((e) => e.remove());

  const loadCard = div('overlay ready-card');
  loadCard.innerHTML = `<div class="ready-inner"><div class="get-ready">LOADING THE CLASSIC…</div>
    <div class="ready-tip">${escapeHtml(entry.title)}</div></div>`;
  app.appendChild(loadCard);

  const [routine, src] = await Promise.all([
    loadRoutine(entry.v),
    (async () => { const s = new YouTubeSource(); await s.load(entry.v); return s; })(),
  ]);
  if (!routine || src.error) {
    loadCard.remove();
    src.destroy();
    toast(src.error ?? 'Could not load that routine.');
    showMenu();
    return;
  }
  // no karaoke overlay for classics: LRCLIB timestamps live on the SONG's
  // timeline, but gameplay videos have menu/intro footage (Blue starts ~84s
  // in) — and most JD videos display their own lyrics anyway
  const vibe = await fetchVibe(entry.v);
  loadCard.remove();

  const seedNum = [...entry.v].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const accents = YT_ACCENTS[seedNum % YT_ACCENTS.length];
  const song: Song = {
    id: 'jd-' + entry.v,
    title: entry.title,
    artist: entry.artist || 'Just Dance classic',
    bpm: routine.bpm,
    beats: routine.totalBeats,
    scene: (['city', 'bokeh', 'disco'] as const)[seedNum % 3],
    difficulty: 3,
    accent: accents[0], accent2: accents[1],
    coach: { skin: '#e8b89a', hair: '#20182a', top: accents[0], vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' },
    root: 57, chords: [[0, 3, 7]],
    sections: routine.sections,
    choreo: routine.choreo,
    lyrics: [],
  };

  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>the real routine · ${Math.round(routine.bpm)} BPM</span>`);

  // tempo and phase are measured from this exact video — no mic correction
  const clock = new YouTubeClock(src, routine.bpm, routine.sections, routine.totalBeats, 4);
  const run = () => {
    clock.restart();
    // long pre-routine footage (menus, loading screens in the capture) is
    // skipped — jump to 8 beats before the first move
    if (routine.bodyStart > 24) {
      src.seek(((routine.bodyStart - 8 + 4) * 60) / routine.bpm);
    }
    play(song, playerName, { clock, yt: src, vibe, onAgain: run });
  };
  run();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------------------------------------------------------------------------
// Multiplayer lobby & flow

function openLobby(room: Room) {
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay').forEach((e) => e.remove());
  drawScene({ ctx, w: W(), h: H(), beat: 0.9, section: 'chorus', song: SONGS[0], goldBurst: 0 });

  const lobby = div('overlay lobby');
  lobby.innerHTML = `
    <div class="lobby-box">
      <div class="lobby-title">Lobby</div>
      <div class="lobby-code">Code <b>${room.code}</b></div>
      <div class="lobby-players" id="lobby-players"></div>
      ${room.isHost ? `
        <div class="yt-row">
          <input id="mp-url" placeholder="Search a song\u2026 or paste a YouTube link" spellcheck="false">
        </div>
        <div id="mp-results" class="yt-results"></div>
        <div class="yt-title lobby-classics-title">Classics</div>
        <div class="classics-row lobby-classics" id="mp-classics"></div>
        <div id="mp-picked" class="mp-picked"></div>
        <div class="yt-row">
          <button id="mp-start" class="mp-btn big">Start</button>
          <span id="lobby-err" class="yt-err"></span>
        </div>` : `
        <div class="lobby-wait">Waiting for the host to pick a song and start…</div>`}
      <button id="lobby-leave" class="lobby-leave">Leave</button>
    </div>`;
  app.appendChild(lobby);

  const renderPlayers = () => {
    const el = document.getElementById('lobby-players');
    if (!el) return;
    el.innerHTML = room.players.map((p, i) =>
      `<span class="lobby-player">${i + 1}. ${escapeHtml(p.name)}${p.id === room.myId ? ' (you)' : ''}${i === 0 ? ' host' : ''}</span>`
    ).join('');
  };
  renderPlayers();
  room.onUpdate = renderPlayers;
  room.onClosed = (reason) => { alertOverlay(reason); showMenu(); };
  room.onMessage = (_from, msg) => {
    if (msg.t === 'start' && !room.isHost) {
      lobby.remove();
      startYouTubeMP(msg.videoId, msg.bpm, msg.intro, room, msg.choreo ?? null, !!msg.jd);
    }
  };

  document.getElementById('lobby-leave')!.addEventListener('click', () => showMenu());

  if (room.isHost) {
    let pickedId: string | null = null;
    let pickedClassic: RoutineEntry | null = null;
    const picked = document.getElementById('mp-picked')!;
    attachYtSearch(
      document.getElementById('mp-url') as HTMLInputElement,
      document.getElementById('mp-results') as HTMLElement,
      document.getElementById('lobby-err')!,
      null,
      (id, title) => {
        pickedId = id;
        pickedClassic = null;
        picked.innerHTML = `\u2705 Battle track: <b>${escapeHtml(title || id)}</b>`;
        (document.getElementById('mp-results') as HTMLElement).innerHTML = '';
      },
    );
    // classics catalog: the whole room dances a real extracted routine
    fetchRoutineIndex().then((idx) => {
      const crow = document.getElementById('mp-classics');
      if (!crow) return;
      if (!idx.length) { crow.remove(); document.querySelector('.lobby-classics-title')?.remove(); return; }
      for (const e of idx) {
        const tile = div('song-tile classic-tile');
        tile.innerHTML = `<img src="https://i.ytimg.com/vi/${e.v}/mqdefault.jpg" alt="" loading="lazy">
          <div class="song-meta"><div class="song-title">${escapeHtml(e.title)}</div>
          <div class="song-artist">${escapeHtml(e.artist || 'Just Dance')}</div></div>`;
        tile.addEventListener('click', () => {
          pickedClassic = e;
          pickedId = null;
          picked.innerHTML = `\u2705 Battle track: <b>${escapeHtml(e.title)}</b> \u00b7 classic routine`;
        });
        crow.appendChild(tile);
      }
    });
    document.getElementById('mp-start')!.addEventListener('click', async () => {
      const err = document.getElementById('lobby-err')!;
      if (pickedClassic) {
        // classic: every client loads the same routine file \u2014 nothing to probe
        room.send({ t: 'start', videoId: pickedClassic.v, bpm: pickedClassic.bpm, intro: 0, jd: true });
        lobby.remove();
        startYouTubeMP(pickedClassic.v, pickedClassic.bpm, 0, room, null, true);
        return;
      }
      const id = pickedId ?? parseYouTubeId((document.getElementById('mp-url') as HTMLInputElement).value.trim());
      if (!id) { err.textContent = 'Search and pick a track (or paste a link) first.'; return; }
      err.textContent = 'Preparing the battle track\u2026';
      // host resolves tempo + intro so every client dances the same grid
      const probe = new YouTubeSource();
      const ok = await probe.load(id);
      if (!ok) { probe.destroy(); err.textContent = probe.error ?? 'Could not load that video.'; return; }
      const [meta, lyr] = await Promise.all([
        fetchSongMeta(id, probe.title, probe.duration),
        Promise.race([fetchSyncedLyrics(probe.title, probe.duration), wait(8000).then(() => null)]),
      ]);
      const bpm = meta ?? 120;
      const intro = introBeatsOf(lyr, bpm, 4);
      // host fetches the AI routine once and hands the exact same moves to
      // every client — guests never need their own (possibly diverging) fetch
      let aiChoreo: Song['choreo'] | null = null;
      if (lyr) {
        err.textContent = 'Choreographing. The first time on a song takes about 30 seconds.';
        const totalBeats = Math.max(48, Math.floor((probe.duration * bpm) / 60) - 8);
        aiChoreo = await Promise.race([
          fetchAiChoreo(id, probe.title, probe.duration, bpm, intro, totalBeats),
          wait(45000).then(() => null),
        ]);
      }
      probe.destroy();
      room.send({ t: 'start', videoId: id, bpm, intro, choreo: aiChoreo ?? undefined });
      lobby.remove();
      startYouTubeMP(id, bpm, intro, room, aiChoreo);
    });
  }
}

function alertOverlay(text: string) {
  const d = div('overlay ready-card');
  d.innerHTML = `<div class="ready-inner"><div class="ready-tip">${escapeHtml(text)}</div></div>`;
  app.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

/** multiplayer song start: deterministic choreography so every client matches */
async function startYouTubeMP(videoId: string, bpm: number, introBeats: number, room: Room, aiChoreo: Song['choreo'] | null = null, jd = false) {
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .yt-holder').forEach((e) => e.remove());

  // remote registry is wired BEFORE anything async so early messages land
  const remotes = new Map<string, RemotePlayer>();
  const streams = new Map<string, MediaStream>();
  const ensureRemote = (id: string): RemotePlayer => {
    let r = remotes.get(id);
    if (!r) {
      r = { id, style: null as any, avatar: new PlayerAvatar(), lms: null, lastPoseAt: 0, score: 0, stars: 0 };
      remotes.set(id, r);
    }
    return r;
  };
  room.onMessage = (from, msg: NetMsg) => {
    const r = ensureRemote(from);
    if (msg.t === 'style') r.style = msg.style;
    else if (msg.t === 'pose') { r.lms = decodePose(msg.d); r.lastPoseAt = performance.now(); }
    else if (msg.t === 'score') { r.score = msg.s; r.stars = msg.stars; }
    else if (msg.t === 'end') r.end = msg.s;
  };
  room.onStream = (id, stream) => {
    streams.set(id, stream);
    const v = document.querySelector<HTMLVideoElement>(`video[data-peer="${id}"]`);
    if (v) { v.srcObject = stream; v.play().catch(() => { /* autoplay */ }); }
  };
  room.onClosed = (reason) => { alertOverlay(reason); showMenu(); };

  const loadCard = div('overlay ready-card');
  loadCard.innerHTML = `<div class="ready-inner"><div class="get-ready">DANCE OFF!</div>
    <div class="ready-tip">Loading the battle track…</div></div>`;
  app.appendChild(loadCard);

  // classic routines load from the same static file on every client
  const routine = jd ? await loadRoutine(videoId) : null;
  const entry = jd ? (await fetchRoutineIndex()).find((e) => e.v === videoId) : null;
  if (jd && !routine) { alertOverlay('Could not load that classic routine.'); showMenu(); return; }

  const src = new YouTubeSource();
  const ok = await src.load(videoId);
  loadCard.remove();
  if (!ok) { src.destroy(); alertOverlay(src.error ?? 'Could not load that video.'); showMenu(); return; }

  const seedNum = [...videoId].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const accents = YT_ACCENTS[seedNum % YT_ACCENTS.length];
  const scenes = ['city', 'bokeh', 'disco'] as const;
  const useBpm = routine?.bpm ?? bpm;
  const totalBeats = routine?.totalBeats ?? Math.max(48, Math.floor((src.duration * bpm) / 60) - 8);
  const gen = routine ? null : generateChoreo(videoId, totalBeats, 2, introBeats);
  const song: Song = {
    id: (jd ? 'jd-' : 'yt-') + videoId,
    title: entry?.title ?? src.title ?? 'YouTube Track',
    artist: `dance off · room ${room.code}`,
    bpm: useBpm, beats: totalBeats,
    scene: scenes[seedNum % 3], difficulty: jd ? 3 : 2,
    accent: accents[0], accent2: accents[1],
    coach: { skin: '#e8b89a', hair: '#20182a', top: accents[0], vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' },
    root: 57, chords: [[0, 3, 7]],
    sections: routine?.sections ?? gen!.sections,
    choreo: routine?.choreo ?? gen!.choreo,
    lyrics: [],
  };

  const lyricsPromise = fetchSyncedLyrics(song.title, src.duration);
  const vibePromise = fetchVibe(videoId);
  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>room ${room.code} · ${room.players.length} dancers${jd ? ' · the real routine' : ''}</span>`);
  if (playerStyle) room.send({ t: 'style', style: playerStyle });
  const camStream = cam().video.srcObject as MediaStream | null;
  if (camStream) room.shareStream(camStream);
  const lyr = await Promise.race([lyricsPromise, wait(1500).then(() => null)]);
  if (lyr) song.lyrics = lyricsToLines(lyr, useBpm, 4);
  const vibe = await Promise.race([vibePromise, wait(1500).then(() => null)]);

  // classics play untouched; otherwise host AI routine (identical on every
  // client) or the seeded generator, smoothed + carved deterministically
  let freestyle: FreestyleWindow[] = [];
  if (!routine) {
    if (aiChoreo?.length) song.choreo = aiChoreo;
    freestyle = freestyleWindows(totalBeats, introBeats);
    song.choreo = carveFreestyle(smoothChoreo(song.choreo), freestyle);
  }

  const clock = new YouTubeClock(src, useBpm, song.sections, totalBeats, 4);
  clock.restart();
  play(song, room.myName, {
    clock, yt: src, room, remotes, streams, vibe, freestyle,
    onAgain: () => openLobby(room),
  });
}

// ---------------------------------------------------------------------------
// Calibration: find the right distance, scan the outfit in detail, store it

function loadStoredStyle(): StyleProfile | null {
  try {
    const raw = localStorage.getItem('gs-style');
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.top && p.body ? p as StyleProfile : null;
  } catch { return null; }
}

/** Phone-as-camera: this screen shows the game, a phone is the webcam */
function openPhoneCam() {
  const overlay = div('overlay calib');
  overlay.innerHTML = `
    <div class="calib-box">
      <div class="lobby-title">Phone camera</div>
      <div id="pc-body" class="pc-body">
        <button id="pc-tv" class="mp-btn big">This screen shows the game</button>
        <div class="yt-row" style="justify-content:center">
          <span class="yt-label">or</span>
          <input id="pc-code" placeholder="CODE" maxlength="4" inputmode="numeric" style="width:90px;text-align:center;letter-spacing:0.3em;font-weight:900">
          <button id="pc-join" class="mp-btn">This phone is the camera</button>
        </div>
        <div class="lobby-wait">Run the game here, use a phone as the camera.</div>
      </div>
      <div id="pc-status" class="calib-status"></div>
      ${phoneCam ? `<button id="pc-disconnect" class="lobby-leave">DISCONNECT PHONE CAMERA</button>` : ''}
      <button id="pc-close" class="lobby-leave">CLOSE</button>
    </div>`;
  app.appendChild(overlay);
  const status = overlay.querySelector('#pc-status') as HTMLElement;
  overlay.querySelector('#pc-close')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pc-disconnect')?.addEventListener('click', () => {
    phoneCam?.destroy(); phoneCam = null; overlay.remove(); showMenu();
  });

  overlay.querySelector('#pc-tv')!.addEventListener('click', async () => {
    status.textContent = 'Getting a code\u2026';
    status.className = 'calib-status scan';
    try {
      phoneCam?.destroy();
      phoneCam = await TvCamHost.create();
      const body = overlay.querySelector('#pc-body') as HTMLElement;
      body.innerHTML = `
        <div class="lobby-code">CAMERA CODE <b>${phoneCam.code}</b></div>
        <div class="lobby-wait">On your phone, open groovestar.vercel.app, tap Phone camera and enter this code.</div>`;
      status.textContent = 'Waiting for the phone\u2026';
      phoneCam.onChange = () => {
        if (phoneCam?.connected) {
          status.textContent = 'Phone connected. Close this and pick a song.';
          status.className = 'calib-status good';
        } else {
          status.textContent = 'Phone disconnected.';
          status.className = 'calib-status warn';
        }
      };
    } catch (e) {
      status.textContent = String((e as Error).message ?? e);
      status.className = 'calib-status bad';
    }
  });

  overlay.querySelector('#pc-join')!.addEventListener('click', async () => {
    const code = (overlay.querySelector('#pc-code') as HTMLInputElement).value.trim();
    if (!/^\d{4}$/.test(code)) { status.textContent = 'Enter the 4-digit code shown on the big screen.'; status.className = 'calib-status warn'; return; }
    status.textContent = 'Starting camera\u2026';
    status.className = 'calib-status scan';
    if (!trackerStarted) {
      trackerStarted = true;
      cameraOk = await tracker.init();
    }
    if (!cameraOk) {
      status.textContent = `Camera unavailable (${tracker.error ?? 'denied'}).`;
      status.className = 'calib-status bad';
      return;
    }
    try {
      await connectPhoneCam(code, tracker, (s) => { status.textContent = s; });
      status.className = 'calib-status good';
      (overlay.querySelector('#pc-body') as HTMLElement).innerHTML =
        `<div class="lobby-wait">Keep this phone propped up, pointed at the dance floor, screen on.</div>`;
      try { await (navigator as any).wakeLock?.request('screen'); } catch { /* unsupported */ }
    } catch (e) {
      status.textContent = String((e as Error).message ?? e);
      status.className = 'calib-status bad';
    }
  });
}

async function openCalibrate() {
  const overlay = div('overlay calib');
  overlay.innerHTML = `
    <div class="calib-box">
      <div class="lobby-title">Calibrate</div>
      <canvas id="calib-view" width="640" height="480"></canvas>
      <div id="calib-status" class="calib-status">Starting camera\u2026</div>
      <div id="calib-chips" class="ready-tip"></div>
      <div class="yt-row calib-skins">
        <span class="yt-label">DANCER SKIN</span>
        <button class="preset skin-opt" data-skin="toon">TOON</button>
        <button class="preset skin-opt" data-skin="sprite">SPRITE</button>
        <button class="preset skin-opt" data-skin="wire">NEON WIRE</button>
        <span class="yt-label">ANIME 12FPS</span>
        <button class="preset" id="anime-toggle">OFF</button>
      </div>
      <div class="yt-row">
        <button id="calib-scan" class="mp-btn" disabled>SCAN MY STYLE</button>
        <button id="calib-close" class="lobby-leave">CLOSE</button>
      </div>
    </div>`;
  app.appendChild(overlay);
  let open = true;
  overlay.querySelector('#calib-close')!.addEventListener('click', () => { open = false; overlay.remove(); });

  // skin + anime pickers
  const syncPickers = () => {
    overlay.querySelectorAll<HTMLElement>('.skin-opt').forEach((b) =>
      b.classList.toggle('sel', b.dataset.skin === skinPref()));
    const at = overlay.querySelector('#anime-toggle') as HTMLElement;
    at.textContent = animePref() ? 'ON' : 'OFF';
    at.classList.toggle('sel', animePref());
  };
  overlay.querySelectorAll<HTMLElement>('.skin-opt').forEach((b) =>
    b.addEventListener('click', () => { localStorage.setItem('gs-skin', b.dataset.skin!); syncPickers(); }));
  overlay.querySelector('#anime-toggle')!.addEventListener('click', () => {
    localStorage.setItem('gs-anime', animePref() ? '0' : '1');
    syncPickers();
  });
  syncPickers();

  if (!trackerStarted) {
    trackerStarted = true;
    cameraOk = await tracker.init();
  }
  const status = overlay.querySelector('#calib-status') as HTMLElement;
  const scanBtn = overlay.querySelector('#calib-scan') as HTMLButtonElement;
  const chips = overlay.querySelector('#calib-chips') as HTMLElement;
  if (!cameraOk) {
    status.textContent = `Camera unavailable (${tracker.error ?? 'denied'}). Calibration needs a webcam.`;
    return;
  }
  const cv = overlay.querySelector('#calib-view') as HTMLCanvasElement;
  const c2 = cv.getContext('2d')!;
  let framedSince = 0;
  let scanning = false;
  let resultShownAt = 0; // keep scan-result messages on screen briefly

  const loop = () => {
    if (!open) return;
    requestAnimationFrame(loop);
    tracker.update();
    // mirrored live view + landmark dots (same language as the in-game preview)
    c2.save();
    c2.translate(cv.width, 0); c2.scale(-1, 1);
    try { c2.drawImage(tracker.video, 0, 0, cv.width, cv.height); } catch { /* not ready */ }
    c2.restore();
    c2.fillStyle = 'rgba(6,8,18,0.25)';
    c2.fillRect(0, 0, cv.width, cv.height);
    const pts = tracker.latest.points;
    if (pts) {
      c2.fillStyle = '#54f0ff';
      for (const p of pts) {
        c2.beginPath(); c2.arc(p.x * cv.width, p.y * cv.height, 3.4, 0, Math.PI * 2); c2.fill();
      }
    }
    // framing quality from raw landmark visibility
    const lms = tracker.latestLandmarks;
    if (!scanning && performance.now() - resultShownAt > 4500) {
      if (!lms) {
        status.textContent = '\u{1F464} Step into frame';
        status.className = 'calib-status bad';
        framedSince = 0; scanBtn.disabled = true;
      } else {
        const vis = (i: number) => lms[i]?.visibility ?? 0;
        const head = vis(0), hips = Math.min(vis(23), vis(24)), ankles = Math.min(vis(27), vis(28));
        if (head < 0.5) {
          status.textContent = '\u2195 Adjust the camera \u2014 your head is cut off';
          status.className = 'calib-status warn'; framedSince = 0; scanBtn.disabled = true;
        } else if (hips < 0.5) {
          status.textContent = '\u2b05 Step back \u2014 we can only see your upper body';
          status.className = 'calib-status warn'; framedSince = 0; scanBtn.disabled = true;
        } else if (ankles < 0.4) {
          status.textContent = '\u{1F45F} Almost \u2014 step back a little more so your feet are in frame';
          status.className = 'calib-status warn'; scanBtn.disabled = false; framedSince = 0;
        } else {
          if (!framedSince) framedSince = performance.now();
          status.textContent = '\u2705 Perfect distance \u2014 full body tracked! Hold still and scan your style.';
          status.className = 'calib-status good';
          scanBtn.disabled = false;
        }
      }
    }
  };
  loop();

  scanBtn.addEventListener('click', async () => {
    if (scanning) return;
    scanning = true;
    scanBtn.disabled = true;
    status.textContent = '\u2728 Scanning your outfit \u2014 hold your pose\u2026';
    status.className = 'calib-status scan';
    const scanner = new StyleScanner();
    const t0 = performance.now();
    while (performance.now() - t0 < 3000 && open) {
      tracker.update();
      if (tracker.latestLandmarks) scanner.feed(tracker.video, tracker.latestLandmarks);
      await new Promise(requestAnimationFrame);
    }
    scanning = false;
    scanBtn.disabled = false;
    if (!open) return;
    if (scanner.sampleCount < 6) {
      status.textContent = 'Could not read your look \u2014 make sure you are well lit and try again.';
      status.className = 'calib-status warn';
      resultShownAt = performance.now();
      return;
    }
    const profile = scanner.build('#ffd23e');
    try { localStorage.setItem('gs-style', JSON.stringify(profile)); } catch { /* full */ }
    playerStyle = profile;
    status.textContent = '\u2705 Style saved! Every dance now uses this look. Rescan any time.';
    status.className = 'calib-status good';
    resultShownAt = performance.now();
    chips.innerHTML = `Your style: ${swatches(profile)}`;
    const btn = document.getElementById('calib');
    if (btn) btn.textContent = 'Calibrate';
  });
}

// ---------------------------------------------------------------------------
// Gameplay

interface FxState { gloveFlash: number; goldBurst: number; shake: number }
interface PlayOpts {
  clock: SongClock;
  yt?: YouTubeSource;
  mic?: BeatListener;
  room?: Room;
  remotes?: Map<string, RemotePlayer>;
  streams?: Map<string, MediaStream>;
  fitness?: { kcal: number; active: number };
  /** video thumbnail palettes — the stage grades itself to the music video */
  vibe?: VibePalette | null;
  /** freestyle GO-OFF windows (already carved out of the choreo) */
  freestyle?: FreestyleWindow[];
  onAgain: () => void;
}

function play(song: Song, playerName: string, opts: PlayOpts) {
  state = 'play';
  const { clock, yt } = opts;
  const scorer = new Scorer(song.choreo, opts.freestyle ?? []);
  scorer.demoMode = !cameraOk;
  const tiles = new Map<number, number>();   // lit floor tiles: index → glow
  const hud = new Hud(app, playerName, song);
  const fx: FxState = { gloveFlash: 0, goldBurst: 0, shake: 0 };
  const avatar = new PlayerAvatar();
  avatar.anime = animePref();
  const cosmetics = resolveCosmetics();
  const crew = crewOn() && cameraOk && !opts.room; // no backup dancers in a dance off

  const preview = opts.room ? null : buildPreview(); // corners carry the cams in MP
  const corners = opts.room ? buildCorners(opts.room, opts.streams!) : null;
  let lastPoseSend = 0, lastScoreSend = 0;
  const fit = { kcal: 0, active: 0 };
  opts.fitness = fit;
  let lastFitT = performance.now();
  const countdown = div('overlay countdown');
  app.appendChild(countdown);
  const playStart = performance.now();
  let tapShown = false;
  let lastSync = 0;

  const loop = () => {
    if (state !== 'play') return;
    raf = requestAnimationFrame(loop);
    const beat = clock.beat();
    cam().update();

    if (beat < 0) {
      countdown.textContent = String(Math.max(1, Math.ceil(-beat)));
      // autoplay blocked? offer a tap-to-start
      if (yt && !tapShown && beat < -3.5 && performance.now() - playStart > 2500) {
        tapShown = true;
        countdown.textContent = '';
        const tap = div('tap-start');
        tap.textContent = '▶ TAP TO START THE MUSIC';
        tap.addEventListener('click', () => { yt.play(); tap.remove(); });
        countdown.appendChild(tap);
      }
    } else if (countdown.parentElement) {
      countdown.remove();
    }

    // fitness mode: integrate effort into calories + active time
    if (fitnessOn() && beat > 0) {
      const nowF = performance.now();
      const dtF = Math.min(0.2, (nowF - lastFitT) / 1000);
      lastFitT = nowF;
      const en = cam().latest.energy;
      if (cam().latest.features) {
        fit.kcal += ((3.2 + 9 * en) / 60) * dtF;
        if (en > 0.15) fit.active += dtF;
      }
      hud.setSync(`${Math.round(fit.kcal)} kcal · ${Math.floor(fit.active / 60)}:${String(Math.floor(fit.active % 60)).padStart(2, '0')} active`, en > 0.45);
    } else {
      lastFitT = performance.now();
    }

    const events = scorer.update(beat, cam().latest);
    for (const ev of events) applyEvent(ev);
    hud.setProgress(scorer.ratio, scorer.stars(), scorer.superstar);
    // karaoke follows the raw video time (base tempo), gameplay the synced grid
    const lyricBeat = clock instanceof YouTubeClock ? clock.videoBeat() : beat;
    hud.updateLyrics(song.lyrics, lyricBeat);

    // mic beat-sync: pull the grid onto the room audio every ~2s (silent — no chip)
    if (opts.mic?.active && clock instanceof YouTubeClock && beat > 0) {
      if (performance.now() - lastSync > 2000) {
        lastSync = performance.now();
        const est = opts.mic.estimate();
        if (est) clock.applySync(est);
      }
    }

    const section = clock.sectionAt(Math.max(0, beat));
    fx.goldBurst *= 0.94;
    fx.gloveFlash *= 0.9;
    fx.shake *= 0.86;
    const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
    ctx.save();
    ctx.translate(sx, sy);
    drawScene({ ctx, w: W(), h: H(), beat: Math.max(0, beat), section, song, goldBurst: fx.goldBurst });

    // stage color pair: graded to the music video, easing between its acts
    const stageCols = vibeAt(opts.vibe ?? null, Math.max(0, beat) / song.beats, [song.accent, song.accent2]);

    // YouTube backdrop: the video becomes the upper half of the stage
    stageLight = null;
    if (yt) drawVideoStage(yt, Math.max(0, beat), fx.goldBurst, stageCols);

    // floor tiles that lit up under last frame's footsteps
    drawFloorTiles(tiles, avatar.feet, stageCols);

    // freestyle windows: banner + combo chip live on the HUD
    const fsWins = opts.freestyle ?? [];
    const inFs = fsWins.some((f) => beat >= f.start && beat < f.end);
    hud.setFreestyle(inFs ? 'go' : fsWins.some((f) => beat >= f.start - 4 && beat < f.start) ? 'soon' : null);
    hud.setCombo(scorer.multiplier);

    const { pose, goldHold, flowing } = choreoPose(song.choreo, beat);
    // real motion clips carry their own bounce — no synthetic groove on top
    const coachPose = goldHold || flowing ? pose : addGroove(pose, Math.max(0, beat), 0.8);

    // ---- multiplayer: broadcast pose/score, draw rival dancers, update corners
    if (opts.room && opts.remotes) {
      const now = performance.now();
      if (cam().latestLandmarks && now - lastPoseSend > 80) {
        lastPoseSend = now;
        opts.room.send({ t: 'pose', d: encodePose(cam().latestLandmarks!) });
      }
      if (now - lastScoreSend > 500) {
        lastScoreSend = now;
        opts.room.send({ t: 'score', s: Math.round(scorer.score), stars: scorer.stars() });
      }
      // rival dancers behind/beside you, live from their streamed poses
      const others = opts.room.players.filter((p) => p.id !== opts.room!.myId);
      const slots = [[0.16, 0.35], [0.84, 0.35], [0.68, 0.27]] as const;
      others.forEach((p, i) => {
        if (i >= slots.length) return;
        const r = opts.remotes!.get(p.id);
        if (!r || !r.lms || now - r.lastPoseAt > 1500) return;
        r.avatar.update(r.lms, 4 / 3, now);
        if (r.avatar.hasPose) {
          r.avatar.draw(ctx, r.style ?? defaultStyle(song), W() * slots[i][0], H() * 0.8, H() * slots[i][1], {
            beat: Math.max(0, beat), accent: song.accent2, w: W(), cosmetics: DEFAULT_COSMETICS,
            // one WebGL context per rival is too heavy — rivals stay sprites
            skin: skinPref(), light: stageLight ?? undefined,
          });
        }
      });
      corners?.update(opts.room, opts.remotes, scorer);
    }

    if (cameraOk && playerStyle) {
      const aspect = cam().video.videoWidth / Math.max(1, cam().video.videoHeight);
      avatar.update(cam().latestLandmarks, aspect || 4 / 3, performance.now());
      // optional backup crew: two smaller clones of you dancing the routine
      if (crew) {
        const crewPose = goldHold ? pose : addGroove(pose, Math.max(0, beat + 0.5), 0.9);
        for (const cxr of [0.22, 0.78]) {
          drawCharacter(ctx, `crew${cxr}`, crewPose, playerStyle, W() * cxr, H() * 0.8, H() * 0.3, {
            alpha: 0.85, goldHold: goldHold && fx.goldBurst > 0.2, beat: Math.max(0, beat),
          });
        }
      }
      if (avatar.hasPose) {
        avatar.draw(ctx, playerStyle, W() / 2, H() * 0.84, H() * 0.56, {
          beat: Math.max(0, beat), accent: song.accent, w: W(),
          gloveFlash: fx.gloveFlash, goldGlow: fx.goldBurst > 0.25,
          cosmetics, skin: skinPref(), light: stageLight ?? undefined,
          comboLevel: scorer.multiplier - 1, reflect: true,
        });
      } else {
        hintStepIn(ctx);
      }
      drawCharacter(ctx, 'mini', coachPose, coachStyleOf(song), W() * 0.885, H() * 0.64, H() * 0.21, {
        goldHold: goldHold && fx.goldBurst > 0.2, beat: Math.max(0, beat),
      });
    } else {
      drawCharacter(ctx, 'demo', coachPose, coachStyleOf(song), W() / 2, H() * 0.84, H() * 0.56, {
        gloveFlash: fx.gloveFlash, goldHold: goldHold && fx.goldBurst > 0.2, beat: Math.max(0, beat),
      });
    }
    if (!inFs) drawPictograms(ctx, song, beat, W(), H());
    ctx.restore();
    drawPreview(preview);

    if (clock.finished) endSong(song, scorer, hud, preview, opts);
  };

  function applyEvent(ev: JudgmentEvent) {
    avatar.react(ev.judgment); // the dancer's rim color IS the judgment feedback
    if (ev.judgment !== 'X') fx.gloveFlash = 1;
    if (ev.judgment === 'YEAH') {
      fx.goldBurst = 1;
      fx.shake = 10;
      clock.goldSting();
    }
  }
  loop();
}

/**
 * The music video becomes the upper half of the stage — like the giant screen
 * behind a concert stage. The scene is punched through with a soft gradient so
 * the video melts into the floor, then party lights, beat washes and vignettes
 * are drawn ON TOP of the video so it reads as one continuous set.
 */
function drawVideoStage(yt: YouTubeSource, beat: number, goldBurst: number, cols: [string, string]) {
  const w = W(), h = H() * 0.56;
  // size the iframe to COVER the band (center-cropped like background-size: cover)
  const vw = Math.max(w, (h * 16) / 9);
  const vh = (vw * 9) / 16;
  yt.setBounds((w - vw) / 2, Math.min(0, (h - vh) / 2), vw, vh);

  const pulse = Math.exp(-((beat % 1)) * 3.2);
  ctx.save();

  // punch through the scene with a soft bottom fade — video melts into the stage
  ctx.globalCompositeOperation = 'destination-out';
  const punch = ctx.createLinearGradient(0, 0, 0, h);
  punch.addColorStop(0, 'rgba(0,0,0,1)');
  punch.addColorStop(0.7, 'rgba(0,0,0,1)');
  punch.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = punch;
  ctx.fillRect(0, 0, w, h);

  // everything below draws OVER the video
  ctx.globalCompositeOperation = 'source-over';

  // base dim + color grade so the dancer stays the brightest thing on stage
  ctx.fillStyle = `rgba(6,6,20,${Math.max(0.1, 0.3 - goldBurst * 0.15)})`;
  ctx.fillRect(0, 0, w, h);
  const grade = ctx.createLinearGradient(0, 0, 0, h);
  grade.addColorStop(0, 'rgba(4,3,14,0.5)');       // darker sky-line up top
  grade.addColorStop(0.45, 'rgba(4,3,14,0)');
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, w, h);

  // side vignettes tie the screen into the dark wings of the stage
  for (const side of [0, 1]) {
    const vg = ctx.createLinearGradient(side ? w : 0, 0, side ? w - w * 0.2 : w * 0.2, 0);
    vg.addColorStop(0, 'rgba(5,3,15,0.85)');
    vg.addColorStop(1, 'rgba(5,3,15,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(side ? w * 0.8 : 0, 0, w * 0.2, h);
  }

  // beat-synced color wash over the video (party lighting)
  const ac = cols[0];
  ctx.fillStyle = hexA(ac, 0.05 + 0.09 * pulse + goldBurst * 0.12);
  ctx.fillRect(0, 0, w, h);

  // sweeping light beams from the rig above the screen
  const beams = 4;
  let bestBeam = 0;
  for (let i = 0; i < beams; i++) {
    const bx = w * (0.14 + (0.72 * i) / (beams - 1));
    const swing = Math.sin(beat * 0.55 + i * 1.7) * 0.5;
    const ang = Math.PI / 2 + swing * 0.55;
    const len = h * 1.35;
    const half = 0.05 + 0.02 * Math.sin(i * 2.1);
    const col = i % 2 === 0 ? ac : cols[1];
    const on = (Math.floor(beat) + i) % 2 === 0 ? 1 : 0.35;
    // where this beam lands at the dancer's height → key light candidate
    const strength = on * (0.4 + 0.6 * pulse);
    if (strength > bestBeam) {
      bestBeam = strength;
      stageLight = { x: bx + Math.cos(ang) * H() * 0.55, color: col };
    }
    const grad = ctx.createLinearGradient(bx, -10, bx + Math.cos(ang) * len, Math.sin(ang) * len);
    grad.addColorStop(0, hexA(col, (0.16 + 0.14 * pulse) * on));
    grad.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx, -10);
    ctx.lineTo(bx + Math.cos(ang - half) * len, -10 + Math.sin(ang - half) * len);
    ctx.lineTo(bx + Math.cos(ang + half) * len, -10 + Math.sin(ang + half) * len);
    ctx.closePath();
    ctx.fill();
  }

  // glowing seam where the screen meets the stage floor
  const seamY = h * 0.86;
  const seam = ctx.createLinearGradient(0, seamY - h * 0.1, 0, h);
  seam.addColorStop(0, hexA(ac, 0));
  seam.addColorStop(0.7, hexA(ac, 0.1 + 0.12 * pulse));
  seam.addColorStop(1, hexA(ac, 0));
  ctx.fillStyle = seam;
  ctx.fillRect(0, seamY - h * 0.1, w, h - seamY + h * 0.1);

  ctx.restore();
}

/**
 * Disco floor: tiles light up where the dancer's feet actually land and fade
 * back out. Feet come from the avatar's last drawn frame (screen space).
 */
function drawFloorTiles(tiles: Map<number, number>, feet: { x: number; y: number; v: number }[], cols: [string, string]) {
  const w = W(), h = H();
  const top = h * 0.68, nCols = 12, nRows = 3;
  const tw = w / nCols, th = (h - top) / nRows;
  for (const f of feet) {
    if (f.y < top) continue;                 // foot lifted off the floor band
    const c = Math.max(0, Math.min(nCols - 1, Math.floor(f.x / tw)));
    const r = Math.max(0, Math.min(nRows - 1, Math.floor((f.y - top) / th)));
    tiles.set(r * 100 + c, 1);
  }
  if (!tiles.size) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 2;
  for (const [key, g] of tiles) {
    if (g < 0.04) { tiles.delete(key); continue; }
    tiles.set(key, g * 0.94);
    const r = Math.floor(key / 100), c = key % 100;
    const x = c * tw, y = top + r * th;
    const col = (r + c) % 2 === 0 ? cols[0] : cols[1];
    ctx.shadowColor = col;
    ctx.shadowBlur = 20 * g;
    ctx.fillStyle = hexA(col, 0.1 * g);
    ctx.strokeStyle = hexA(col, 0.5 * g);
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, tw - 8, th - 8, 10);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${Math.max(0, Math.min(1, a))})`;
}

function hintStepIn(c: CanvasRenderingContext2D) {
  c.save();
  c.font = `800 ${Math.max(18, H() * 0.03)}px 'Trebuchet MS', sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.textAlign = 'center';
  c.fillText('STEP INTO FRAME', W() / 2, H() * 0.5);
  c.restore();
}

// ---------------------------------------------------------------------------
// Dance-off corner HUD: one cluster per player (name, webcam, meter, stars)

interface Corners { root: HTMLElement; update: (room: Room, remotes: Map<string, RemotePlayer>, scorer: Scorer) => void }

function buildCorners(room: Room, streams: Map<string, MediaStream>): Corners {
  const root = div('mp-corners');
  app.appendChild(root);
  // viewer-relative order: YOU bottom-left, then rivals BR -> TR -> TL
  const POS = ['bl', 'br', 'tr', 'tl'];
  const cells = new Map<string, { meter: HTMLElement; stars: HTMLElement; view: HTMLCanvasElement; vid: HTMLVideoElement }>();

  const orderedPlayers = () => {
    const others = room.players.filter((p) => p.id !== room.myId);
    const me = room.players.find((p) => p.id === room.myId);
    return me ? [me, ...others] : others;
  };

  const build = () => {
    root.innerHTML = '';
    cells.clear();
    orderedPlayers().forEach((p, i) => {
      if (i >= 4) return;
      const isMe = p.id === room.myId;
      const cell = div(`mp-corner ${POS[i]}`);
      cell.innerHTML = `
        <div class="mpc-name">${escapeHtml(p.name)}${isMe ? ' \u00b7 YOU' : ''}</div>
        <canvas class="mpc-view" width="176" height="132"></canvas>
        <video data-peer="${p.id}" autoplay playsinline muted style="display:none"></video>
        <div class="mpc-meter"><div class="mpc-fill"></div></div>
        <div class="mpc-stars"></div>`;
      root.appendChild(cell);
      const vid = cell.querySelector('video') as HTMLVideoElement;
      const stream = isMe ? null : streams.get(p.id) ?? null;
      if (stream) { vid.srcObject = stream; vid.play().catch(() => { /* autoplay */ }); }
      cells.set(p.id, {
        meter: cell.querySelector('.mpc-fill') as HTMLElement,
        stars: cell.querySelector('.mpc-stars') as HTMLElement,
        view: cell.querySelector('.mpc-view') as HTMLCanvasElement,
        vid,
      });
    });
  };
  build();
  room.onUpdate = build;

  return {
    root,
    update(r, remotes, scorer) {
      for (const p of r.players) {
        const cell = cells.get(p.id);
        if (!cell) continue;
        const isMe = p.id === r.myId;
        const score = isMe ? scorer.score : remotes.get(p.id)?.score ?? 0;
        const stars = isMe ? scorer.stars() : remotes.get(p.id)?.stars ?? 0;
        cell.meter.style.width = `${Math.min(100, (score / 13333) * 100)}%`;
        cell.stars.textContent = '\u2605'.repeat(stars) + '\u2606'.repeat(5 - stars);
        // single-player-style preview: mirrored cam + tracked landmark dots
        const c = cell.view.getContext('2d')!;
        const w = cell.view.width, h = cell.view.height;
        const source: HTMLVideoElement | null = isMe ? cam().video : (cell.vid.srcObject ? cell.vid : null);
        c.clearRect(0, 0, w, h);
        if (source) {
          c.save();
          c.translate(w, 0); c.scale(-1, 1);
          try { c.drawImage(source, 0, 0, w, h); } catch { /* not ready */ }
          c.restore();
        } else {
          c.fillStyle = '#0a0c1e'; c.fillRect(0, 0, w, h);
        }
        c.fillStyle = 'rgba(6,8,18,0.45)';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#54f0ff';
        if (isMe) {
          const pts = cam().latest.points;
          if (pts) for (const pt of pts) {
            c.beginPath(); c.arc(pt.x * w, pt.y * h, 2.4, 0, Math.PI * 2); c.fill();
          }
        } else {
          const lms = remotes.get(p.id)?.lms;
          if (lms) for (const lm of lms) {
            if (lm.visibility < 0.3) continue;
            c.beginPath(); c.arc((1 - lm.x) * w, lm.y * h, 2.4, 0, Math.PI * 2); c.fill();
          }
        }
      }
    },
  };
}

function buildPreview(): HTMLCanvasElement | null {
  if (!cameraOk) return null;
  const cv = document.createElement('canvas');
  cv.className = 'cam-preview';
  cv.width = 176; cv.height = 132;
  app.appendChild(cv);
  return cv;
}

function drawPreview(cv: HTMLCanvasElement | null) {
  if (!cv) return;
  const c = cv.getContext('2d')!;
  c.save();
  c.clearRect(0, 0, cv.width, cv.height);
  c.translate(cv.width, 0); c.scale(-1, 1);
  try { c.drawImage(cam().video, 0, 0, cv.width, cv.height); } catch { /* not ready */ }
  c.restore();
  c.fillStyle = 'rgba(6,8,18,0.45)';
  c.fillRect(0, 0, cv.width, cv.height);
  const pts = cam().latest.points;
  if (pts) {
    c.fillStyle = '#54f0ff';
    for (const p of pts) {
      c.beginPath();
      c.arc(p.x * cv.width, p.y * cv.height, 2.4, 0, Math.PI * 2);
      c.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Results

async function endSong(song: Song, scorer: Scorer, hud: Hud, preview: HTMLCanvasElement | null, opts: PlayOpts) {
  state = 'results';
  opts.clock.stop();
  hud.destroy();
  preview?.remove();
  app.querySelectorAll('.mp-corners').forEach((e) => e.remove());
  const playerName = opts.room?.myName ?? localStorage.getItem('gs-name') ?? 'DANCER';
  if (opts.room) {
    opts.room.send({ t: 'end', s: Math.round(scorer.score) });
    await wait(1200); // give rivals' final scores a moment to arrive
  }

  const flash = div('overlay flash');
  flash.innerHTML = `<div class="flash-logo">GROOVESTAR</div>`;
  app.appendChild(flash);
  await wait(900);
  flash.classList.add('fade');
  await wait(600);
  flash.remove();

  const res = div('overlay results');
  const finalScore = Math.round(scorer.score);
  const stars = scorer.stars();
  addStars(stars);
  if (fitnessOn() && opts.fitness && opts.fitness.kcal > 1) {
    const s = fitStats();
    s.kcal += opts.fitness.kcal;
    s.secs += opts.fitness.active;
    const day = new Date().toISOString().slice(0, 10);
    s.days[day] = (s.days[day] ?? 0) + opts.fitness.kcal;
    try { localStorage.setItem('gs-fit', JSON.stringify(s)); } catch { /* full */ }
  }
  res.innerHTML = `
    <div class="congrats">Congratulations!</div>
    <div class="result-banner">
      
      <div class="result-name">${playerName}</div>
      <div class="result-stars">${'<span class="rstar">★</span>'.repeat(5)}</div>
      <div class="result-score" id="rscore">0</div>
    </div>
    <div class="result-counts">${(['PERFECT', 'SUPER', 'GOOD', 'OK', 'X'] as const)
      .map((k) => `<span class="rc rc-${k}">${k === 'X' ? '✕' : k} <b>${scorer.counts[k] + (k === 'PERFECT' ? scorer.counts.YEAH : 0)}</b></span>`).join('')}
    </div>
    ${fitnessOn() && opts.fitness ? `<div class="fit-row">${Math.round(opts.fitness.kcal)} kcal · ${Math.round(opts.fitness.active / 60)} active min · ${fitStreak()} day streak</div>` : ''}
    ${opts.room ? `<div class="mp-ranking">${rankingHtml(opts, Math.round(scorer.score))}</div>` : ''}
    <div class="result-btns">
      <button id="again">${opts.room ? 'BACK TO LOBBY' : 'DANCE AGAIN'}</button>
      <button id="tolist">SONG LIST</button>
    </div>`;
  app.appendChild(res);

  // victory dance: your avatar replays the moves you nailed
  const nailed = [...new Set(scorer.log.filter((l) => l.judgment === 'PERFECT' || l.judgment === 'YEAH').map((l) => l.move))]
    .filter((m) => !m.startsWith('gold_')).slice(-4);
  const victorySeq = nailed.length >= 2 ? nailed : ['clap_up', 'v_up', 'pump', 'star_jump'];
  // classics nail clip ids (jd_N) — resolve through CLIPS, never assume MOVES
  const victoryPose = (id: string, vb: number): Pose =>
    MOVES[id]?.pose ?? (CLIPS[id] ? clipPose(CLIPS[id], vb % 2) : MOVES['clap_up'].pose);
  const bgLoop = () => {
    if (state !== 'results') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 1.9, section: 'chorus', song, goldBurst: 0 });
    const vb = t * 1.9;
    const moveId = victorySeq[Math.floor(vb / 2) % victorySeq.length];
    const pose = addGroove(victoryPose(moveId, vb), vb, 1);
    drawCharacter(ctx, 'victory', pose, playerStyle ?? coachStyleOf(song), W() * 0.18, H() * 0.97, H() * 0.4, { alpha: 0.95, faceState: 'smile', beat: vb });
    raf = requestAnimationFrame(bgLoop);
  };
  bgLoop();

  const scoreEl = document.getElementById('rscore')!;
  const starEls = Array.from(res.querySelectorAll('.rstar')) as HTMLElement[];
  const dur = 2600, t0 = performance.now();
  const thresholds = [0.12, 0.26, 0.42, 0.58, 0.74];
  const tick = () => {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(finalScore * eased);
    scoreEl.textContent = val.toLocaleString('en-US');
    thresholds.forEach((th, i) => {
      if (i < stars && val / 13333 >= th) starEls[i].classList.add('on');
    });
    if (t < 1) requestAnimationFrame(tick);
    else if (scorer.superstar) scoreEl.classList.add('superstar');
  };
  tick();

  document.getElementById('again')!.addEventListener('click', () => {
    res.remove(); cancelAnimationFrame(raf);
    if (opts.room) { opts.yt?.destroy(); opts.mic?.stop(); }
    opts.onAgain();
  });
  document.getElementById('tolist')!.addEventListener('click', () => {
    res.remove(); opts.yt?.destroy(); opts.mic?.stop(); showMenu();
  });
}

/** dance-off ranking table for the results screen */
function rankingHtml(opts: PlayOpts, myScore: number): string {
  const room = opts.room!;
  const rows = room.players.map((p) => ({
    name: p.name,
    me: p.id === room.myId,
    score: p.id === room.myId ? myScore : (opts.remotes?.get(p.id)?.end ?? opts.remotes?.get(p.id)?.score ?? 0),
  })).sort((a, b) => b.score - a.score);
  const medals = ['1', '2', '3', '4'];
  return `<div class="mp-rank-title">BATTLE RESULT</div>` + rows.map((r, i) =>
    `<div class="mp-rank-row ${r.me ? 'me' : ''}"><span>${medals[i] ?? ''} ${escapeHtml(r.name)}${r.me ? ' (you)' : ''}</span><b>${r.score.toLocaleString('en-US')}</b></div>`
  ).join('');
}

// ---------------------------------------------------------------------------
function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

showMenu();
