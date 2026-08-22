// GrooveStar — a camera-controlled dance game in the presentation language of
// the reference footage: menu → get-ready card → countdown → dance → results.

import './style.css';
import { SONGS, type Song } from './songs';
import { AudioEngine } from './audio/engine';
import { PoseTracker } from './pose/tracker';
import { Scorer, type JudgmentEvent } from './pose/scorer';
import { choreoPose, addGroove, drawCoach } from './coach';
import { drawScene } from './scenes';
import { Hud, drawPictograms } from './ui/hud';
import { MOVES, forward } from './moves';
import { StyleScanner, type StyleProfile } from './appearance';
import { PlayerAvatar } from './avatar';

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

function showMenu() {
  state = 'menu';
  cancelAnimationFrame(raf);
  app.querySelectorAll('.overlay, .hud').forEach((e) => e.remove());

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
  const foot = div('menu-foot');
  foot.innerHTML = `<label>Dancer name <input id="pname" maxlength="14" value="${localStorage.getItem('gs-name') ?? 'DANCER'}"></label>
    <div class="cam-note" id="cam-note">📷 The webcam scans your look (hair, skin, outfit) into a neon avatar and scores your moves. No camera? Demo Mode — full show, simulated scoring.</div>`;
  menu.appendChild(foot);
  app.appendChild(menu);

  // idle background behind the menu
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

// ---------------------------------------------------------------------------
// Get ready → play

async function startSong(song: Song) {
  state = 'ready';
  cancelAnimationFrame(raf);
  const nameInput = document.getElementById('pname') as HTMLInputElement | null;
  const playerName = (nameInput?.value || 'DANCER').toUpperCase();
  localStorage.setItem('gs-name', playerName);
  app.querySelectorAll('.overlay').forEach((e) => e.remove());

  // Title card (song banner + coach), like the loading screen in the footage
  const card = div('overlay ready-card');
  card.innerHTML = `
    <div class="ready-inner">
      <div class="get-ready">GET READY!</div>
      <div class="song-banner"><b>${song.title}</b><span>${song.artist}</span></div>
      <div class="ready-tip" id="ready-tip">Starting camera & pose tracking…</div>
    </div>`;
  app.appendChild(card);
  drawCoverFull(song);

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
  play(song, playerName);
}

/** sample the player's appearance for ~1.5s and build a stylized profile */
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

function drawCoverFull(song: Song) {
  drawScene({ ctx, w: W(), h: H(), beat: 0.95, section: 'chorus', song, goldBurst: 0 });
  drawCoach(ctx, song, MOVES['v_up'].pose, W() / 2, H() * 0.86, H() * 0.55);
}

// ---------------------------------------------------------------------------
// Gameplay

interface FxState { gloveFlash: number; goldBurst: number; shake: number }

function play(song: Song, playerName: string) {
  state = 'play';
  audio?.stop();
  audio = new AudioEngine();
  const scorer = new Scorer(song.choreo);
  scorer.demoMode = !cameraOk;
  const hud = new Hud(app, playerName, song);
  const fx: FxState = { gloveFlash: 0, goldBurst: 0, shake: 0 };
  const avatar = new PlayerAvatar();

  const preview = buildPreview();
  const countdown = div('overlay countdown');
  app.appendChild(countdown);

  audio.play(song, 4);

  const loop = () => {
    if (state !== 'play') return;
    raf = requestAnimationFrame(loop);
    const beat = audio!.beat();
    tracker.update();

    // countdown 4..1 during count-in
    if (beat < 0) {
      countdown.textContent = String(Math.max(1, Math.ceil(-beat)));
    } else if (countdown.parentElement) {
      countdown.remove();
    }

    // scoring
    const events = scorer.update(beat, tracker.latest);
    for (const ev of events) applyEvent(ev);
    hud.setProgress(scorer.ratio, scorer.stars(), scorer.superstar);
    hud.updateLyrics(song.lyrics, beat);

    // render
    const section = audio!.sectionAt(Math.max(0, beat));
    fx.goldBurst *= 0.94;
    fx.gloveFlash *= 0.9;
    fx.shake *= 0.86;
    const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
    ctx.save();
    ctx.translate(sx, sy);
    drawScene({ ctx, w: W(), h: H(), beat: Math.max(0, beat), section, song, goldBurst: fx.goldBurst });
    const { pose, goldHold } = choreoPose(song.choreo, beat);
    const coachPose = goldHold ? pose : addGroove(pose, Math.max(0, beat), 0.8);

    if (cameraOk && playerStyle) {
      // the center dancer is YOU — mirrored live from the webcam
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
      // mini coach keeps demonstrating the choreography
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
      // demo mode: the coach dances center stage
      drawCoach(ctx, song, coachPose, W() / 2, H() * 0.84, H() * 0.56, {
        gloveFlash: fx.gloveFlash, goldHold: goldHold && fx.goldBurst > 0.2,
      });
    }
    drawPictograms(ctx, song, beat, W(), H());
    ctx.restore();
    drawPreview(preview);

    if (audio!.finished) endSong(song, playerName, scorer, hud, preview);
  };

  function applyEvent(ev: JudgmentEvent) {
    hud.popJudgment(ev.judgment);
    if (ev.judgment !== 'X') fx.gloveFlash = 1;
    if (ev.judgment === 'YEAH') {
      fx.goldBurst = 1;
      fx.shake = 10;
      audio!.goldSting();
    }
  }
  loop();
}

function hintStepIn(c: CanvasRenderingContext2D) {
  c.save();
  c.font = `800 ${Math.max(18, H() * 0.03)}px 'Trebuchet MS', sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.textAlign = 'center';
  c.fillText('STEP INTO FRAME', W() / 2, H() * 0.5);
  c.restore();
}

// mini camera preview with skeleton dots (bottom-left, small & unobtrusive)
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
  // mirrored video
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

async function endSong(song: Song, playerName: string, scorer: Scorer, hud: Hud, preview: HTMLCanvasElement | null) {
  state = 'results';
  audio?.stop();
  hud.destroy();
  preview?.remove();

  // white flash, like the "JUST DANCE" outro card
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

  // background keeps grooving quietly
  const bgLoop = () => {
    if (state !== 'results') return;
    const t = performance.now() / 1000;
    drawScene({ ctx, w: W(), h: H(), beat: t * 1.6, section: 'intro', song, goldBurst: 0 });
    raf = requestAnimationFrame(bgLoop);
  };
  bgLoop();

  // count-up + star pops at thresholds, like the reference results
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
    res.remove(); cancelAnimationFrame(raf); startSong(song);
  });
  document.getElementById('tolist')!.addEventListener('click', () => {
    res.remove(); showMenu();
  });
}

// ---------------------------------------------------------------------------
function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// silence unused warning for forward (used by hud/coach modules)
void forward;

showMenu();
