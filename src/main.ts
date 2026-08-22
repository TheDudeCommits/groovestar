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
import { PlayerAvatar } from './avatar';
import { generateChoreo } from './choreograph';
import { parseYouTubeId, YouTubeSource, YouTubeClock } from './youtube';

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

function showMenu() {
  state = 'menu';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .hud, .yt-holder, .cam-preview').forEach((e) => e.remove());

  const menu = div('overlay menu');
  menu.innerHTML = `
    <div class="logo">GROOVE<span>STAR</span></div>
    <div class="tagline">You are the dancer — the camera puts a stylized you on stage, mirroring every move. Hit the pictograms, chase the stars.</div>
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

  // --- YouTube import panel ---
  const yt = div('yt-panel');
  yt.innerHTML = `
    <div class="yt-title">▶ DANCE TO ANY YOUTUBE SONG</div>
    <div class="yt-sub">Paste a music video or choreography link — we generate the routine on the spot.</div>
    <div class="yt-row">
      <input id="yt-url" placeholder="https://www.youtube.com/watch?v=…" spellcheck="false">
      <button id="yt-go">GO DANCE</button>
    </div>
    <div class="yt-row yt-opts">
      <span class="yt-label">TEMPO</span>
      <span id="bpm-val" class="bpm-val">120 BPM</span>
      <button id="tap" class="tap">TAP THE BEAT</button>
      <span class="yt-presets">${[100, 110, 120, 128, 140].map((b) => `<button class="preset" data-bpm="${b}">${b}</button>`).join('')}</span>
      <span class="yt-label">LEVEL</span>
      <span class="yt-diff">${[1, 2, 3].map((d) => `<button class="diff ${d === 2 ? 'sel' : ''}" data-d="${d}">${'●'.repeat(d)}</button>`).join('')}</span>
    </div>
    <div id="yt-err" class="yt-err"></div>`;
  menu.appendChild(yt);

  let bpm = 120, ytDiff: 1 | 2 | 3 = 2;
  const bpmVal = yt.querySelector('#bpm-val') as HTMLElement;
  const setBpm = (b: number) => { bpm = Math.round(Math.min(180, Math.max(60, b))); bpmVal.textContent = `${bpm} BPM`; };
  const taps: number[] = [];
  yt.querySelector('#tap')!.addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2200) taps.length = 0;
    taps.push(now);
    if (taps.length >= 3) {
      const ds = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
      setBpm(60000 / ds[Math.floor(ds.length / 2)]);
    }
  });
  yt.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => setBpm(Number((b as HTMLElement).dataset.bpm))));
  yt.querySelectorAll('.diff').forEach((b) => b.addEventListener('click', () => {
    yt.querySelectorAll('.diff').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    ytDiff = Number((b as HTMLElement).dataset.d) as 1 | 2 | 3;
  }));
  const err = yt.querySelector('#yt-err') as HTMLElement;
  yt.querySelector('#yt-go')!.addEventListener('click', () => {
    const url = (yt.querySelector('#yt-url') as HTMLInputElement).value.trim();
    const id = parseYouTubeId(url);
    if (!id) { err.textContent = 'That does not look like a YouTube link.'; return; }
    err.textContent = '';
    startYouTube(id, bpm, ytDiff);
  });

  const foot = div('menu-foot');
  foot.innerHTML = `<label>Dancer name <input id="pname" maxlength="14" value="${localStorage.getItem('gs-name') ?? 'DANCER'}"></label>
    <div class="cam-note" id="cam-note">📷 The webcam scans your look (hair, skin, outfit) into a neon avatar and scores your moves. No camera? Demo Mode — full show, simulated scoring.</div>`;
  menu.appendChild(foot);
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
    if (tip) tip.innerHTML = '<span class="scanline">SCANNING YOUR STYLE…</span> stand back so your upper body is in frame';
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
  };
}

function swatches(s: StyleProfile): string {
  const chip = (c: string, label: string) =>
    `<span class="chip" title="${label}" style="background:${c}"></span>`;
  return `<span class="chips">${chip(s.hair, 'hair')}${chip(s.skin, 'skin')}${chip(s.top, 'top')}${chip(s.bottom, 'bottom')}</span>`;
}

// ---------------------------------------------------------------------------
// YouTube flow

async function startYouTube(videoId: string, bpm: number, difficulty: 1 | 2 | 3) {
  const playerName = playerNameFromMenu();
  state = 'ready';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .yt-holder').forEach((e) => e.remove());

  const loadCard = div('overlay ready-card');
  loadCard.innerHTML = `<div class="ready-inner"><div class="get-ready">TUNING IN…</div>
    <div class="ready-tip">Loading the video & choreographing your routine</div></div>`;
  app.appendChild(loadCard);

  const src = new YouTubeSource();
  const ok = await src.load(videoId);
  loadCard.remove();
  if (!ok) {
    src.destroy();
    showMenu();
    setTimeout(() => {
      const err = document.getElementById('yt-err');
      if (err) err.textContent = src.error ?? 'Could not load that video.';
    }, 50);
    return;
  }

  // build a Song from the video: generated sections + choreography
  const seedNum = [...videoId].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const accents = YT_ACCENTS[seedNum % YT_ACCENTS.length];
  const scenes = ['city', 'bokeh', 'disco'] as const;
  const totalBeats = Math.max(48, Math.floor((src.duration * bpm) / 60) - 8);
  const gen = generateChoreo(videoId, totalBeats, difficulty);
  const song: Song = {
    id: 'yt-' + videoId,
    title: src.title || 'YouTube Track',
    artist: 'your pick · generated routine',
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
    lyrics: [],
  };

  await readyFlow(song, `<b>${escapeHtml(song.title)}</b><span>${bpm} BPM · routine generated from your link</span>`);
  const clock = new YouTubeClock(src, bpm, gen.sections, totalBeats, 4);
  const run = () => {
    clock.restart();
    play(song, playerName, { clock, yt: src, onAgain: run });
  };
  run();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------------------------------------------------------------------------
// Gameplay

interface FxState { gloveFlash: number; goldBurst: number; shake: number }
interface PlayOpts { clock: SongClock; yt?: YouTubeSource; onAgain: () => void }

function play(song: Song, playerName: string, opts: PlayOpts) {
  state = 'play';
  const { clock, yt } = opts;
  const scorer = new Scorer(song.choreo);
  scorer.demoMode = !cameraOk;
  const hud = new Hud(app, playerName, song);
  const fx: FxState = { gloveFlash: 0, goldBurst: 0, shake: 0 };
  const avatar = new PlayerAvatar();

  const preview = buildPreview();
  const countdown = div('overlay countdown');
  app.appendChild(countdown);
  const playStart = performance.now();
  let tapShown = false;

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
    hud.updateLyrics(song.lyrics, beat);

    const section = clock.sectionAt(Math.max(0, beat));
    fx.goldBurst *= 0.94;
    fx.gloveFlash *= 0.9;
    fx.shake *= 0.86;
    const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
    ctx.save();
    ctx.translate(sx, sy);
    drawScene({ ctx, w: W(), h: H(), beat: Math.max(0, beat), section, song, goldBurst: fx.goldBurst });

    // YouTube backdrop panel: punch a window through the scene to the iframe
    if (yt) drawVideoPanel(yt, song, fx.goldBurst);

    const { pose, goldHold } = choreoPose(song.choreo, beat);
    const coachPose = goldHold ? pose : addGroove(pose, Math.max(0, beat), 0.8);

    if (cameraOk && playerStyle) {
      const aspect = tracker.video.videoWidth / Math.max(1, tracker.video.videoHeight);
      avatar.update(tracker.latestLandmarks, aspect || 4 / 3, performance.now());
      if (avatar.hasPose) {
        avatar.draw(ctx, playerStyle, W() / 2, H() * 0.84, H() * 0.56, {
          beat: Math.max(0, beat), accent: song.accent, w: W(),
          gloveFlash: fx.gloveFlash, goldGlow: fx.goldBurst > 0.25,
        });
      } else {
        hintStepIn(ctx);
      }
      drawCoach(ctx, song, coachPose, W() * 0.885, H() * 0.64, H() * 0.21, {
        gloveFlash: 0, goldHold: goldHold && fx.goldBurst > 0.2,
      });
      ctx.save();
      ctx.font = `700 ${Math.max(11, H() * 0.014)}px 'Trebuchet MS', sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText('COACH', W() * 0.885, H() * 0.665);
      ctx.restore();
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
    hud.popJudgment(ev.judgment);
    if (ev.judgment !== 'X') fx.gloveFlash = 1;
    if (ev.judgment === 'YEAH') {
      fx.goldBurst = 1;
      fx.shake = 10;
      clock.goldSting();
    }
  }
  loop();
}

/** dimmed video window behind the dancer, JD-video-background style */
function drawVideoPanel(yt: YouTubeSource, song: Song, goldBurst: number) {
  const w = Math.min(W() * 0.52, 900);
  const h = (w * 9) / 16;
  const x = (W() - w) / 2, y = H() * 0.05;
  yt.setBounds(x, y, w, h);
  ctx.save();
  // punch the window
  ctx.globalCompositeOperation = 'destination-out';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  // dim so the dancer stays the brightest thing on screen
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(5,8,20,${0.38 - goldBurst * 0.15})`;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  // neon frame
  ctx.strokeStyle = song.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = song.accent;
  ctx.shadowBlur = 16;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.restore();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function hintStepIn(c: CanvasRenderingContext2D) {
  c.save();
  c.font = `800 ${Math.max(18, H() * 0.03)}px 'Trebuchet MS', sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.textAlign = 'center';
  c.fillText('STEP INTO FRAME', W() / 2, H() * 0.5);
  c.restore();
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
  const playerName = localStorage.getItem('gs-name') ?? 'DANCER';

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
    <div class="result-btns">
      <button id="again">DANCE AGAIN</button>
      <button id="tolist">SONG LIST</button>
    </div>`;
  app.appendChild(res);

  const bgLoop = () => {
    if (state !== 'results') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 1.6, section: 'intro', song, goldBurst: 0 });
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
    res.remove(); cancelAnimationFrame(raf); opts.onAgain();
  });
  document.getElementById('tolist')!.addEventListener('click', () => {
    res.remove(); opts.yt?.destroy(); showMenu();
  });
}

// ---------------------------------------------------------------------------
function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

showMenu();
