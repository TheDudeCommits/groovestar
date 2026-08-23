// GrooveStar — a camera-controlled dance game in the presentation language of
// the reference footage: menu → get-ready card → countdown → dance → results.
// Songs come from the built-in synth engine or from an imported YouTube video
// (official embed as audio/backdrop + procedurally generated choreography).

import './style.css';
import { SONGS, type Song, type SectionDef } from './songs';
import { AudioEngine } from './audio/engine';
import { PoseTracker } from './pose/tracker';
import { Scorer, type JudgmentEvent } from './pose/scorer';
import { choreoPose, addGroove, drawCoach } from './coach';
import { drawScene } from './scenes';
import { Hud, drawPictograms } from './ui/hud';
import { MOVES } from './moves';
import { StyleScanner, type StyleProfile } from './appearance';
import { CLIPS } from './motion';
import { PlayerAvatar, type Cosmetics } from './avatar';
import { generateChoreo } from './choreograph';
import { parseYouTubeId, YouTubeSource, YouTubeClock } from './youtube';
import { BeatListener } from './audio/beatsync';
import { fetchSyncedLyrics, lyricsToLines, applyKeywordChoreo, fetchAiChoreo, fetchSongMeta, introBeatsOf } from './lyrics';
import { Room, encodePose, decodePose, MAX_PLAYERS, type NetMsg } from './net/room';
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

let audio: AudioEngine | null = null;
const tracker = new PoseTracker();
let trackerStarted = false;
let cameraOk = false;

let raf = 0;
let state: 'menu' | 'ready' | 'play' | 'results' = 'menu';
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
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
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
  const row = div('song-row');
  for (const song of SONGS) {
    const tile = div('song-tile');
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 200;
    drawCover(cv, song);
    tile.appendChild(cv);
    const meta = div('song-meta');
    meta.innerHTML = `<div class="song-title">${song.title}</div>
      <div class="song-artist">${song.artist}</div>
      <div class="song-diff">${'●'.repeat(song.difficulty)}${'○'.repeat(3 - song.difficulty)} · ${song.bpm} BPM</div>`;
    tile.appendChild(meta);
    tile.addEventListener('click', () => startSong(song));
    row.appendChild(tile);
  }
  menu.appendChild(row);

  // --- YouTube search / import panel ---
  const yt = div('yt-panel');
  yt.innerHTML = `
    <div class="yt-title">▶ DANCE TO ANY YOUTUBE SONG</div>
    <div class="yt-sub">Search YouTube or paste a link — routine, tempo and intro are figured out automatically.</div>
    <div class="yt-row">
      <input id="yt-url" placeholder="Search a song… or paste a YouTube link" spellcheck="false">
      <button id="yt-go">GO DANCE</button>
    </div>
    <div id="yt-results" class="yt-results"></div>
    <div id="yt-err" class="yt-err"></div>`;
  menu.appendChild(yt);

  const err = yt.querySelector('#yt-err') as HTMLElement;
  const resultsBox = yt.querySelector('#yt-results') as HTMLElement;
  const input = yt.querySelector('#yt-url') as HTMLInputElement;
  const go = async () => {
    const q = input.value.trim();
    if (!q) return;
    const id = parseYouTubeId(q);
    if (id) { err.textContent = ''; startYouTube(id); return; }
    // search mode
    err.textContent = '';
    resultsBox.innerHTML = '<div class="yt-searching">Searching YouTube…</div>';
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      const results: { id: string; title: string; duration: string; channel: string }[] = data?.results ?? [];
      if (!results.length) { resultsBox.innerHTML = ''; err.textContent = 'No results — try different words or paste a link.'; return; }
      resultsBox.innerHTML = results.map((v) => `
        <button class="yt-result" data-id="${v.id}">
          <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" loading="lazy">
          <span class="ytr-meta"><span class="ytr-title">${escapeHtml(v.title)}</span>
          <span class="ytr-sub">${escapeHtml(v.channel)}${v.duration ? ' · ' + escapeHtml(v.duration) : ''}</span></span>
        </button>`).join('');
      resultsBox.querySelectorAll<HTMLElement>('.yt-result').forEach((b) =>
        b.addEventListener('click', () => startYouTube(b.dataset.id!)));
    } catch {
      resultsBox.innerHTML = '';
      err.textContent = 'Search is unavailable right now — paste a YouTube link instead.';
    }
  };
  yt.querySelector('#yt-go')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  // --- dance-off (multiplayer) panel ---
  const mp = div('yt-panel mp-panel');
  mp.innerHTML = `
    <div class="yt-title mp-title">\u2694 DANCE OFF \u2014 UP TO ${MAX_PLAYERS} PLAYERS</div>
    <div class="yt-sub">Create a room, drop a YouTube link, share the 4-digit code. Everyone dances the same routine live.</div>
    <div class="yt-row">
      <button id="mp-create" class="mp-btn">CREATE ROOM</button>
      <span class="yt-label">or</span>
      <input id="mp-code" placeholder="CODE" maxlength="4" inputmode="numeric">
      <button id="mp-join" class="mp-btn">JOIN</button>
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
      <button id="calib" class="calib-btn">\u{1F4D0} CALIBRATE${localStorage.getItem('gs-style') ? ' \u2713' : ''}</button>
    </div>
    <div class="cam-note" id="cam-note">\u{1F4F7} The webcam scans your look into a neon avatar and scores your moves. No camera? Demo Mode \u2014 full show, simulated scoring.</div>`;
  menu.appendChild(foot);
  foot.querySelector('#calib')!.addEventListener('click', () => openCalibrate());
  app.appendChild(menu);

  const loop = () => {
    if (state !== 'menu') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 2, section: 'verse', song: SONGS[0], goldBurst: 0 });
    const pose = addGroove(MOVES[['sway_l', 'sway_r', 'clap_up', 'pump'][Math.floor(t) % 4]].pose, t * 2, 0.7);
    drawCoach(ctx, SONGS[0], pose, W() / 2, H() * 0.99, H() * 0.34, { alpha: 0.45 });
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function drawCover(cv: HTMLCanvasElement, song: Song) {
  const c = cv.getContext('2d')!;
  drawScene({ ctx: c, w: cv.width, h: cv.height, beat: 0.9, section: 'chorus', song, goldBurst: 0 });
  const pose = MOVES[song.scene === 'disco' ? 'letter_v' : song.scene === 'bokeh' ? 'lasso' : 'point_up_r'].pose;
  drawCoach(c, song, pose, cv.width / 2, cv.height * 0.94, cv.height * 0.62);
}

function playerNameFromMenu(): string {
  const nameInput = document.getElementById('pname') as HTMLInputElement | null;
  const name = (nameInput?.value || 'DANCER').toUpperCase();
  localStorage.setItem('gs-name', name);
  return name;
}

// ---------------------------------------------------------------------------
// Get ready → play (built-in synth songs)

async function startSong(song: Song) {
  const playerName = playerNameFromMenu();
  await readyFlow(song, `<b>${song.title}</b><span>${song.artist}</span>`);
  audio?.stop();
  audio = new AudioEngine();
  audio.play(song, 4);
  play(song, playerName, { clock: audio, onAgain: () => startSong(song) });
}

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
  drawCoach(ctx, song, MOVES['v_up'].pose, W() / 2, H() * 0.86, H() * 0.55);

  if (!trackerStarted) {
    trackerStarted = true;
    cameraOk = await tracker.init();
  }
  const tip = document.getElementById('ready-tip');
  if (cameraOk) {
    // stored calibration profile wins — the player already scanned in detail
    const stored = loadStoredStyle();
    if (stored) {
      playerStyle = stored;
      if (tip) tip.innerHTML = 'Style loaded from your calibration \u2713 \u2014 you are the dancer!';
      await wait(1100);
      card.remove();
      return;
    }
    if (tip) tip.innerHTML = '<span class="scanline">SCANNING YOUR STYLE\u2026</span> stand back so your upper body is in frame';
    const scanned = await scanStyle(song);
    playerStyle = scanned ?? defaultStyle(song);
    if (tip) {
      tip.innerHTML = scanned
        ? `Style locked — you're the dancer! ${swatches(scanned)} Follow the pictograms & mini coach.`
        : 'You are the dancer on stage — step into frame! Follow the pictograms & mini coach.';
    }
    await wait(1700);
  } else {
    if (tip) tip.textContent = `Demo Mode — no camera (${tracker.error ?? 'unavailable'}). The show runs with simulated scoring.`;
    await wait(2200);
  }
  card.remove();
}

async function scanStyle(song: Song): Promise<StyleProfile | null> {
  const scanner = new StyleScanner();
  const t0 = performance.now();
  while (performance.now() - t0 < 1500) {
    tracker.update();
    if (tracker.latestLandmarks) scanner.feed(tracker.video, tracker.latestLandmarks);
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
  const [meta, lyr] = await Promise.all([
    fetchSongMeta(videoId, src.title, src.duration),
    Promise.race([fetchSyncedLyrics(src.title, src.duration), wait(9000).then(() => null)]),
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
    const result = await fetchAiChoreo({
      title: song.title, bpm, totalBeats, difficulty, introBeat: introBeats,
      sections: gen.sections,
      lyrics: song.lyrics.map((l) => ({ beat: Math.round(l.beat * 10) / 10, text: l.text })),
      moves: [
        ...Object.values(CLIPS).map((c) => ({ id: c.id, energy: c.e, genre: c.g, beats: c.b })),
        ...Object.values(MOVES).filter((m) => m.id.startsWith('gold_')).map((m) => ({ id: m.id, energy: m.energy })),
      ],
    });
    if (result) { try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* full */ } }
    return result;
  })();

  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>${Math.round(bpm)} BPM${meta === null ? ' (auto-sync)' : ''}${introBeats > 10 ? ' \u00b7 intro detected' : ''}</span>`);

  if (lyr) {
    const waitCard = div('overlay ready-card');
    waitCard.innerHTML = `<div class="ready-inner"><div class="ready-tip"><span class="scanline">\u266a CHOREOGRAPHING TO THE LYRICS\u2026</span></div></div>`;
    app.appendChild(waitCard);
    const ai = await Promise.race([aiPromise, wait(12000).then(() => 'timeout' as const)]);
    waitCard.remove();
    if (ai && ai !== 'timeout') {
      song.choreo = ai;
    } else {
      song.choreo = applyKeywordChoreo(gen.choreo, song.lyrics).choreo;
    }
  }

  const clock = new YouTubeClock(src, bpm, gen.sections, totalBeats, 4);
  clock.freeTempo = meta === null; // unknown tempo: let the mic adopt the real one
  const mic = new BeatListener();
  mic.start(); // fire and forget — sync silently disabled if mic is denied
  const run = () => {
    clock.restart();
    play(song, playerName, { clock, yt: src, mic, onAgain: run });
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
      <div class="lobby-title">DANCE OFF LOBBY</div>
      <div class="lobby-code">ROOM CODE <b>${room.code}</b></div>
      <div class="lobby-players" id="lobby-players"></div>
      ${room.isHost ? `
        <div class="yt-row">
          <input id="mp-url" placeholder="Paste a YouTube link for the battle…" spellcheck="false">
        </div>
        <div class="yt-row">
          <button id="mp-start" class="mp-btn big">START THE DANCE OFF</button>
          <span id="lobby-err" class="yt-err"></span>
        </div>` : `
        <div class="lobby-wait">Waiting for the host to pick a song and start…</div>`}
      <button id="lobby-leave" class="lobby-leave">LEAVE ROOM</button>
    </div>`;
  app.appendChild(lobby);

  const renderPlayers = () => {
    const el = document.getElementById('lobby-players');
    if (!el) return;
    el.innerHTML = room.players.map((p, i) =>
      `<span class="lobby-player">${i + 1}. ${escapeHtml(p.name)}${p.id === room.myId ? ' (you)' : ''}${i === 0 ? ' ★host' : ''}</span>`
    ).join('');
  };
  renderPlayers();
  room.onUpdate = renderPlayers;
  room.onClosed = (reason) => { alertOverlay(reason); showMenu(); };
  room.onMessage = (_from, msg) => {
    if (msg.t === 'start' && !room.isHost) {
      lobby.remove();
      startYouTubeMP(msg.videoId, msg.bpm, msg.intro, room);
    }
  };

  document.getElementById('lobby-leave')!.addEventListener('click', () => showMenu());

  if (room.isHost) {
    document.getElementById('mp-start')!.addEventListener('click', async () => {
      const err = document.getElementById('lobby-err')!;
      const id = parseYouTubeId((document.getElementById('mp-url') as HTMLInputElement).value.trim());
      if (!id) { err.textContent = 'That does not look like a YouTube link.'; return; }
      err.textContent = 'Preparing the battle track\u2026';
      // host resolves tempo + intro so every client dances the same grid
      const probe = new YouTubeSource();
      const ok = await probe.load(id);
      if (!ok) { probe.destroy(); err.textContent = probe.error ?? 'Could not load that video.'; return; }
      const [meta, lyr] = await Promise.all([
        fetchSongMeta(id, probe.title, probe.duration),
        Promise.race([fetchSyncedLyrics(probe.title, probe.duration), wait(8000).then(() => null)]),
      ]);
      probe.destroy();
      const bpm = meta ?? 120;
      const intro = introBeatsOf(lyr, bpm, 4);
      room.send({ t: 'start', videoId: id, bpm, intro });
      lobby.remove();
      startYouTubeMP(id, bpm, intro, room);
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
async function startYouTubeMP(videoId: string, bpm: number, introBeats: number, room: Room) {
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

  const src = new YouTubeSource();
  const ok = await src.load(videoId);
  loadCard.remove();
  if (!ok) { src.destroy(); alertOverlay(src.error ?? 'Could not load that video.'); showMenu(); return; }

  const seedNum = [...videoId].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const accents = YT_ACCENTS[seedNum % YT_ACCENTS.length];
  const scenes = ['city', 'bokeh', 'disco'] as const;
  const totalBeats = Math.max(48, Math.floor((src.duration * bpm) / 60) - 8);
  const gen = generateChoreo(videoId, totalBeats, 2, introBeats);
  const song: Song = {
    id: 'yt-' + videoId,
    title: src.title || 'YouTube Track',
    artist: `dance off · room ${room.code}`,
    bpm, beats: totalBeats,
    scene: scenes[seedNum % 3], difficulty: 2,
    accent: accents[0], accent2: accents[1],
    coach: { skin: '#e8b89a', hair: '#20182a', top: accents[0], vest: '#191d2e', pants: '#2c3352', glove: '#ffd23e', boots: '#14121c' },
    root: 57, chords: [[0, 3, 7]],
    sections: gen.sections, choreo: gen.choreo, lyrics: [],
  };

  const lyricsPromise = fetchSyncedLyrics(song.title, src.duration);
  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>room ${room.code} · ${room.players.length} dancers</span>`);
  if (playerStyle) room.send({ t: 'style', style: playerStyle });
  const camStream = tracker.video.srcObject as MediaStream | null;
  if (camStream) room.shareStream(camStream);
  const lyr = await Promise.race([lyricsPromise, wait(1500).then(() => null)]);
  if (lyr) song.lyrics = lyricsToLines(lyr, bpm, 4);

  const clock = new YouTubeClock(src, bpm, gen.sections, totalBeats, 4);
  clock.restart();
  play(song, room.myName, {
    clock, yt: src, room, remotes, streams,
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

async function openCalibrate() {
  const overlay = div('overlay calib');
  overlay.innerHTML = `
    <div class="calib-box">
      <div class="lobby-title">CALIBRATE</div>
      <canvas id="calib-view" width="640" height="480"></canvas>
      <div id="calib-status" class="calib-status">Starting camera\u2026</div>
      <div id="calib-chips" class="ready-tip"></div>
      <div class="yt-row">
        <button id="calib-scan" class="mp-btn" disabled>SCAN MY STYLE</button>
        <button id="calib-close" class="lobby-leave">CLOSE</button>
      </div>
    </div>`;
  app.appendChild(overlay);
  let open = true;
  overlay.querySelector('#calib-close')!.addEventListener('click', () => { open = false; overlay.remove(); });

  if (!trackerStarted) {
    trackerStarted = true;
    cameraOk = await tracker.init();
  }
  const status = overlay.querySelector('#calib-status') as HTMLElement;
  const scanBtn = overlay.querySelector('#calib-scan') as HTMLButtonElement;
  const chips = overlay.querySelector('#calib-chips') as HTMLElement;
  if (!cameraOk) {
    status.textContent = `Camera unavailable (${tracker.error ?? 'denied'}) \u2014 calibration needs a webcam.`;
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
    if (btn) btn.textContent = '\u{1F4D0} CALIBRATE \u2713';
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
  onAgain: () => void;
}

function play(song: Song, playerName: string, opts: PlayOpts) {
  state = 'play';
  const { clock, yt } = opts;
  const scorer = new Scorer(song.choreo);
  scorer.demoMode = !cameraOk;
  const hud = new Hud(app, playerName, song);
  const fx: FxState = { gloveFlash: 0, goldBurst: 0, shake: 0 };
  const avatar = new PlayerAvatar();
  const cosmetics = resolveCosmetics();
  const crew = crewOn() && cameraOk && !opts.room; // no backup dancers in a dance off
  const crewPalette = playerStyle ? paletteFromStyle(playerStyle) : song.coach;

  const preview = opts.room ? null : buildPreview(); // corners carry the cams in MP
  const corners = opts.room ? buildCorners(opts.room, opts.streams!) : null;
  let lastPoseSend = 0, lastScoreSend = 0;
  const countdown = div('overlay countdown');
  app.appendChild(countdown);
  const playStart = performance.now();
  let tapShown = false;
  let lastSync = 0;

  const loop = () => {
    if (state !== 'play') return;
    raf = requestAnimationFrame(loop);
    const beat = clock.beat();
    tracker.update();

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

    const events = scorer.update(beat, tracker.latest);
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

    // YouTube backdrop: the video becomes the upper half of the stage
    if (yt) drawVideoStage(yt, song, Math.max(0, beat), fx.goldBurst);

    const { pose, goldHold, flowing } = choreoPose(song.choreo, beat);
    // real motion clips carry their own bounce — no synthetic groove on top
    const coachPose = goldHold || flowing ? pose : addGroove(pose, Math.max(0, beat), 0.8);

    // ---- multiplayer: broadcast pose/score, draw rival dancers, update corners
    if (opts.room && opts.remotes) {
      const now = performance.now();
      if (tracker.latestLandmarks && now - lastPoseSend > 80) {
        lastPoseSend = now;
        opts.room.send({ t: 'pose', d: encodePose(tracker.latestLandmarks) });
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
          });
        }
      });
      corners?.update(opts.room, opts.remotes, scorer);
    }

    if (cameraOk && playerStyle) {
      const aspect = tracker.video.videoWidth / Math.max(1, tracker.video.videoHeight);
      avatar.update(tracker.latestLandmarks, aspect || 4 / 3, performance.now());
      // optional backup crew: two smaller clones of you dancing the routine
      if (crew) {
        const crewPose = goldHold ? pose : addGroove(pose, Math.max(0, beat + 0.5), 0.9);
        for (const cxr of [0.22, 0.78]) {
          drawCoach(ctx, song, crewPose, W() * cxr, H() * 0.8, H() * 0.3, {
            alpha: 0.8, palette: crewPalette, goldHold: goldHold && fx.goldBurst > 0.2,
          });
        }
      }
      if (avatar.hasPose) {
        avatar.draw(ctx, playerStyle, W() / 2, H() * 0.84, H() * 0.56, {
          beat: Math.max(0, beat), accent: song.accent, w: W(),
          gloveFlash: fx.gloveFlash, goldGlow: fx.goldBurst > 0.25,
          cosmetics,
        });
      } else {
        hintStepIn(ctx);
      }
      drawCoach(ctx, song, coachPose, W() * 0.885, H() * 0.64, H() * 0.21, {
        gloveFlash: 0, goldHold: goldHold && fx.goldBurst > 0.2,
      });
    } else {
      drawCoach(ctx, song, coachPose, W() / 2, H() * 0.84, H() * 0.56, {
        gloveFlash: fx.gloveFlash, goldHold: goldHold && fx.goldBurst > 0.2,
      });
    }
    drawPictograms(ctx, song, beat, W(), H());
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
function drawVideoStage(yt: YouTubeSource, song: Song, beat: number, goldBurst: number) {
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
  const ac = song.accent;
  ctx.fillStyle = hexA(ac, 0.05 + 0.09 * pulse + goldBurst * 0.12);
  ctx.fillRect(0, 0, w, h);

  // sweeping light beams from the rig above the screen
  const beams = 4;
  for (let i = 0; i < beams; i++) {
    const bx = w * (0.14 + (0.72 * i) / (beams - 1));
    const swing = Math.sin(beat * 0.55 + i * 1.7) * 0.5;
    const ang = Math.PI / 2 + swing * 0.55;
    const len = h * 1.35;
    const half = 0.05 + 0.02 * Math.sin(i * 2.1);
    const col = i % 2 === 0 ? ac : song.accent2;
    const on = (Math.floor(beat) + i) % 2 === 0 ? 1 : 0.35;
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
        const source: HTMLVideoElement | null = isMe ? tracker.video : (cell.vid.srcObject ? cell.vid : null);
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
          const pts = tracker.latest.points;
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
  try { c.drawImage(tracker.video, 0, 0, cv.width, cv.height); } catch { /* not ready */ }
  c.restore();
  c.fillStyle = 'rgba(6,8,18,0.45)';
  c.fillRect(0, 0, cv.width, cv.height);
  const pts = tracker.latest.points;
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
  res.innerHTML = `
    <div class="congrats">Congratulations!</div>
    <div class="result-banner">
      <div class="avatar">🎧</div>
      <div class="result-name">${playerName}</div>
      <div class="result-stars">${'<span class="rstar">★</span>'.repeat(5)}</div>
      <div class="result-score" id="rscore">0</div>
    </div>
    <div class="result-counts">${(['PERFECT', 'SUPER', 'GOOD', 'OK', 'X'] as const)
      .map((k) => `<span class="rc rc-${k}">${k === 'X' ? '✕' : k} <b>${scorer.counts[k] + (k === 'PERFECT' ? scorer.counts.YEAH : 0)}</b></span>`).join('')}
    </div>
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
  const victoryPalette = playerStyle ? paletteFromStyle(playerStyle) : song.coach;
  const bgLoop = () => {
    if (state !== 'results') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 1.9, section: 'chorus', song, goldBurst: 0 });
    const vb = t * 1.9;
    const moveId = victorySeq[Math.floor(vb / 2) % victorySeq.length];
    const pose = addGroove(MOVES[moveId].pose, vb, 1);
    drawCoach(ctx, song, pose, W() * 0.18, H() * 0.97, H() * 0.4, { alpha: 0.95, palette: victoryPalette });
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
  const medals = ['🥇', '🥈', '🥉', '4.'];
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
