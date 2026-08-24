// HUD systems, matching the observed reference layout:
//  top    — player name chip + judgment pops beneath it
//  left   — vertical progress meter with 5 stars accumulating
//  bottom-left  — two-line karaoke lyrics with progressive highlight
//  bottom-right — pictogram queue sliding right→left onto a "now" slot
//  results — white flash → banner → count-up score with popping stars

import { MOVES, forward, type Pose } from '../moves';
import { CLIPS, clipPeakPose } from '../motion';
import type { Song, LyricLine } from '../songs';

export class Hud {
  root: HTMLElement;
  private meterFill: HTMLElement;
  private starEls: HTMLElement[] = [];
  private lyricNow: HTMLElement;
  private lyricNext: HTMLElement;
  private starsShown = 0;

  constructor(parent: HTMLElement, _playerName: string, song: Song) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);

    const meter = el('div', 'meter');
    const track = el('div', 'meter-track');
    this.meterFill = el('div', 'meter-fill');
    this.meterFill.style.background = `linear-gradient(180deg, ${song.accent}, ${song.accent2})`;
    track.appendChild(this.meterFill);
    const starCol = el('div', 'star-col');
    for (let i = 0; i < 5; i++) {
      const st = el('div', 'star', '★');
      this.starEls.push(st);
      starCol.appendChild(st);
    }
    meter.append(starCol, track);
    this.root.appendChild(meter);

    const lyr = el('div', 'lyrics');
    this.lyricNow = el('div', 'lyric-now');
    this.lyricNext = el('div', 'lyric-next');
    this.lyricNow.style.setProperty('--accent', song.accent);
    lyr.append(this.lyricNow, this.lyricNext);
    this.root.appendChild(lyr);

    this.syncChip = el('div', 'sync-chip');
    this.syncChip.style.display = 'none';
    this.root.appendChild(this.syncChip);

    this.comboChip = el('div', 'combo-chip');
    this.comboChip.style.display = 'none';
    this.root.appendChild(this.comboChip);

    this.fsBanner = el('div', 'freestyle-banner');
    this.fsBanner.style.display = 'none';
    this.root.appendChild(this.fsBanner);
  }

  private syncChip: HTMLElement;
  private comboChip: HTMLElement;
  private fsBanner: HTMLElement;
  private lastMult = 1;
  private lastFs: string | null = null;

  /** combo multiplier chip beside the star meter; pops on every level-up */
  setCombo(mult: number) {
    if (mult < 2) {
      this.comboChip.style.display = 'none';
      this.lastMult = mult;
      return;
    }
    this.comboChip.style.display = 'block';
    this.comboChip.textContent = `×${mult}`;
    this.comboChip.className = `combo-chip c${mult}`;
    if (mult !== this.lastMult) {
      this.comboChip.classList.add('pop');
      setTimeout(() => this.comboChip.classList.remove('pop'), 450);
    }
    this.lastMult = mult;
  }

  /** freestyle window banner: 'soon' countdown → GO OFF!! → hidden */
  setFreestyle(mode: 'soon' | 'go' | null) {
    if (mode === this.lastFs) return;
    this.lastFs = mode;
    if (!mode) { this.fsBanner.style.display = 'none'; return; }
    this.fsBanner.style.display = 'block';
    this.fsBanner.className = `freestyle-banner ${mode}`;
    this.fsBanner.innerHTML = mode === 'soon'
      ? 'FREESTYLE INCOMING…'
      : '<span class="fs-big">FREESTYLE</span><span class="fs-sub">GO OFF!!</span>';
  }
  /** beat-sync status indicator (YouTube mode) */
  setSync(text: string | null, locked: boolean) {
    if (!text) { this.syncChip.style.display = 'none'; return; }
    this.syncChip.style.display = 'block';
    this.syncChip.textContent = text;
    this.syncChip.classList.toggle('locked', locked);
  }

  // judgment feedback lives on the dancer's neon rim now (see PlayerAvatar.react)

  setProgress(ratio: number, stars: number, superstar: boolean) {
    this.meterFill.style.height = `${Math.min(100, ratio * 100)}%`;
    for (let i = 0; i < 5; i++) {
      const on = i < stars;
      const cls = this.starEls[i].classList;
      if (on && !cls.contains('on')) {
        cls.add('on', 'pop');
        setTimeout(() => cls.remove('pop'), 600);
      }
    }
    if (superstar) this.meterFill.classList.add('superstar');
    this.starsShown = stars;
  }

  private lastLine = '';
  updateLyrics(lyrics: LyricLine[], beat: number) {
    let now: LyricLine | null = null, next: LyricLine | null = null;
    for (const l of lyrics) {
      if (beat >= l.beat - 0.5 && beat < l.beat + l.durBeats) now = l;
      else if (beat < l.beat - 0.5 && !next) next = l;
    }
    if (now) {
      const frac = Math.max(0, Math.min(1, (beat - now.beat) / now.durBeats));
      if (now.text !== this.lastLine) {
        this.lastLine = now.text;
        this.lyricNow.textContent = now.text;
        // cinematic line entrance: rise + unblur + overshoot
        this.lyricNow.animate([
          { opacity: 0, transform: 'translateY(18px) scale(0.9)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'translateY(-3px) scale(1.04)', filter: 'blur(0px)', offset: 0.7 },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
        ], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
      }
      this.lyricNow.style.setProperty('--fill', `${frac * 100}%`);
    } else if (this.lastLine) {
      this.lastLine = '';
      const el2 = this.lyricNow;
      el2.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px)', filter: 'blur(4px)' }],
        { duration: 300, easing: 'ease-out' }).onfinish = () => { if (!this.lastLine) el2.textContent = ''; };
    }
    this.lyricNext.textContent = next ? next.text : '';
  }

  destroy() { this.root.remove(); }
}

// ---------------------------------------------------------------------------
// Pictogram strip (canvas-drawn so cards slide at 60fps)

export function drawPictograms(
  ctx: CanvasRenderingContext2D,
  song: Song, beat: number, w: number, h: number,
) {
  const stripY = h * 0.87;                  // baseline
  const nowX = w * 0.66;                    // "now" slot
  const spacing = Math.min(150, w * 0.12);  // px per upcoming beat-step
  const size = Math.min(110, h * 0.16);
  const speed = spacing / 2;                // 2 beats between moves

  ctx.save();
  for (const m of song.choreo) {
    const d = m.beat - beat;               // beats until arrival
    if (d < -0.6 || d > 7) continue;
    const x = nowX + d * speed;
    if (x > w + size) continue;
    let alpha = 1, scale = 1;
    if (d < 0) { alpha = 1 + d / 0.6; scale = 1 + (-d) * 0.45; } // arrival pop & fade
    else if (d > 5.4) alpha = (7 - d) / 1.6;                     // ease in from the right
    drawPicto(ctx, m.move, !!m.gold, x, stripY, size * scale, alpha, song.accent);
  }
  ctx.restore();
}

function drawPicto(
  ctx: CanvasRenderingContext2D,
  moveId: string, gold: boolean,
  x: number, y: number, size: number, alpha: number, accent: string,
) {
  let pose: Pose | null = MOVES[moveId]?.pose ?? null;
  if (!pose && CLIPS[moveId]) pose = clipPeakPose(CLIPS[moveId]);
  if (!pose) return;
  const move = MOVES[moveId];
  const sk = forward(pose);
  const s = size / 2.9;
  const P = (p: [number, number]): [number, number] => [x + p[0] * s, y + (p[1] - 1.0) * s];

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  // card glow for gold
  if (gold) {
    ctx.shadowColor = '#ffd23e';
    ctx.shadowBlur = 16;
  }
  const stroke = gold ? '#ffd23e' : '#ffffff';
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.055);

  const seg = (...pts: [number, number][]) => {
    ctx.beginPath();
    const p0 = P(pts[0]); ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < pts.length; i++) { const p = P(pts[i]); ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
  };
  seg(sk.pelvis, sk.neck);
  seg(sk.shL, sk.elL, sk.wrL);
  seg(sk.shR, sk.elR, sk.wrR);
  seg(sk.hipL, sk.kneeL, sk.ankL);
  seg(sk.hipR, sk.kneeR, sk.ankR);
  const hd = P(sk.head);
  ctx.beginPath(); ctx.arc(hd[0], hd[1], s * 0.2, 0, Math.PI * 2); ctx.fill();

  // accent arrows on the moving limb (yellow in the reference)
  ctx.strokeStyle = gold ? '#fff3b0' : accent;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(2.5, size * 0.045);
  const arrow = (from: [number, number], dir: string, side: number) => {
    const [ax, ay] = P(from);
    const len = s * 0.5;
    let vx = 0, vy = 0;
    if (dir === 'up') { vx = 0; vy = -len; }
    else if (dir === 'down') { vx = 0; vy = len; }
    else if (dir === 'out') { vx = side * len; vy = 0; }
    else if (dir === 'in') { vx = -side * len; vy = 0; }
    if (dir === 'cw' || dir === 'ccw') {
      const sw = dir === 'cw' ? 1 : -1;
      ctx.beginPath();
      ctx.arc(ax, ay, s * 0.42, sw * 0.4, sw * 0.4 + sw * 4.2);
      ctx.stroke();
      return;
    }
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + vx, ay + vy); ctx.stroke();
    const hx = ax + vx, hy = ay + vy;
    const n = Math.hypot(vx, vy) || 1;
    const ux = vx / n, uy = vy / n;
    ctx.beginPath();
    ctx.moveTo(hx + ux * s * 0.16, hy + uy * s * 0.16);
    ctx.lineTo(hx - uy * s * 0.12, hy + ux * s * 0.12);
    ctx.lineTo(hx + uy * s * 0.12, hy - ux * s * 0.12);
    ctx.closePath(); ctx.fill();
  };
  if (move?.pose.arrowL) arrow(sk.wrL, move.pose.arrowL, -1);
  if (move?.pose.arrowR) arrow(sk.wrR, move.pose.arrowR, 1);
  ctx.restore();
}

// ---------------------------------------------------------------------------
function el(tag: string, cls?: string, text?: string): HTMLElement {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}
