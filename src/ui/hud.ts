// HUD systems, matching the observed reference layout:
//  top    — player name chip + judgment pops beneath it
//  left   — vertical progress meter with 5 stars accumulating
//  bottom-left  — two-line karaoke lyrics with progressive highlight
//  bottom-right — pictogram queue sliding right→left onto a "now" slot
//  results — white flash → banner → count-up score with popping stars

import { MOVES, forward, type Pose } from '../moves';
import { CLIPS, clipPeakPose, clipPose } from '../motion';
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
    if (d < -1.9 || d > 7) continue;
    if (d <= 0.12) {
      // CURRENT move: parked in the now slot, ANIMATED through the actual
      // motion, with a countdown ring emptying over its two beats
      const into = Math.min(2, -d + 0.12);
      const fade = d < -1.55 ? Math.max(0, (1.9 + d) / 0.35) : 1;
      drawNowSlot(ctx, m.move, !!m.gold, nowX, stripY, size * 1.3, fade, song.accent, Math.max(0, beat - m.beat));
      void into;
      continue;
    }
    const x = nowX + d * speed;
    if (x > w + size) continue;
    let alpha = 1;
    if (d > 5.4) alpha = (7 - d) / 1.6;    // ease in from the right
    drawPicto(ctx, m.move, !!m.gold, x, stripY, size, alpha, song.accent, true);
  }
  ctx.restore();
}

function poseOf(moveId: string, t: number | null): Pose | null {
  const clip = CLIPS[moveId];
  if (clip) return t === null ? clipPeakPose(clip) : clipPose(clip, Math.min(clip.b, t));
  return MOVES[moveId]?.pose ?? null;
}

/** the current move: animated figure + countdown ring */
function drawNowSlot(
  ctx: CanvasRenderingContext2D,
  moveId: string, gold: boolean,
  x: number, y: number, size: number, alpha: number, accent: string, tBeats: number,
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  // slot ring: fills down as the move plays out
  const cy = y - size * 0.42;
  const r = size * 0.66;
  ctx.lineWidth = Math.max(3, size * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = gold ? '#ffd23e' : accent;
  ctx.beginPath();
  ctx.arc(x, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - tBeats / 2));
  ctx.stroke();
  drawPicto(ctx, moveId, gold, x, y, size, alpha, accent, false, tBeats);
  ctx.restore();
}

function drawPicto(
  ctx: CanvasRenderingContext2D,
  moveId: string, gold: boolean,
  x: number, y: number, size: number, alpha: number, accent: string,
  withArrows: boolean, liveT: number | null = null,
) {
  const pose = poseOf(moveId, liveT);
  if (!pose) return;
  const move = MOVES[moveId];
  const sk = forward(pose);
  const s = size / 2.9;
  const P = (p: [number, number]): [number, number] => [x + p[0] * s, y + (p[1] - 1.0) * s];

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  if (gold) {
    ctx.shadowColor = '#ffd23e';
    ctx.shadowBlur = 16;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // chunky silhouette: dark outline pass, then a solid filled figure — reads
  // as a body at a glance instead of thin sticks
  const fillCol = gold ? '#ffd23e' : '#ffffff';
  const outCol = 'rgba(10,8,24,0.85)';
  const passes: [string, number][] = [[outCol, 0.19], [fillCol, 0.125]];
  for (const [col, lw] of passes) {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = size * lw;
    // torso wedge (shoulders wider than hips)
    const pel = P(sk.pelvis), nk = P(sk.neck);
    const ux = nk[0] - pel[0], uy = nk[1] - pel[1];
    const n = Math.hypot(ux, uy) || 1;
    const px = -uy / n, py = ux / n;
    const sw = s * 0.3, hw = s * 0.18;
    ctx.beginPath();
    ctx.moveTo(pel[0] - px * hw, pel[1] - py * hw);
    ctx.lineTo(nk[0] - px * sw, nk[1] - py * sw);
    ctx.lineTo(nk[0] + px * sw, nk[1] + py * sw);
    ctx.lineTo(pel[0] + px * hw, pel[1] + py * hw);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // limbs
    const seg = (...pts: [number, number][]) => {
      ctx.beginPath();
      const p0 = P(pts[0]); ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < pts.length; i++) { const p = P(pts[i]); ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
    };
    seg(sk.shL, sk.elL, sk.wrL);
    seg(sk.shR, sk.elR, sk.wrR);
    seg(sk.hipL, sk.kneeL, sk.ankL);
    seg(sk.hipR, sk.kneeR, sk.ankR);
    // hands (bigger dots — hand position is what players match)
    for (const wr of [sk.wrL, sk.wrR]) {
      const p = P(wr);
      ctx.beginPath(); ctx.arc(p[0], p[1], size * lw * 0.62, 0, Math.PI * 2); ctx.fill();
    }
    // head
    const hd = P(sk.head);
    ctx.beginPath(); ctx.arc(hd[0], hd[1], s * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
  }

  // MOTION arrows: where the hands actually travel during the move (from the
  // clip's start to its peak) — curved, in the accent color
  if (withArrows) {
    ctx.strokeStyle = gold ? '#fff3b0' : accent;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(2.5, size * 0.05);
    ctx.shadowBlur = 0;
    const clip = CLIPS[moveId];
    if (clip) {
      const sk0 = forward(clipPose(clip, 0));
      const skP = forward(clipPeakPose(clip));
      for (const [w0, wP] of [[sk0.wrL, skP.wrL], [sk0.wrR, skP.wrR]] as const) {
        const a = P(w0), b = P(wP);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const dist = Math.hypot(dx, dy);
        if (dist < s * 0.55) continue;       // hand barely moves — no arrow
        // curve bows outward from the body center
        const mx = (a[0] + b[0]) / 2 + (a[0] + b[0] > 2 * x ? 1 : -1) * s * 0.22;
        const my = (a[1] + b[1]) / 2 - s * 0.1;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(mx, my, b[0], b[1]);
        ctx.stroke();
        // arrowhead along the end tangent
        const tx = b[0] - mx, ty = b[1] - my;
        const tn = Math.hypot(tx, ty) || 1;
        const uxa = tx / tn, uya = ty / tn;
        ctx.beginPath();
        ctx.moveTo(b[0] + uxa * s * 0.22, b[1] + uya * s * 0.22);
        ctx.lineTo(b[0] - uya * s * 0.14, b[1] + uxa * s * 0.14);
        ctx.lineTo(b[0] + uya * s * 0.14, b[1] - uxa * s * 0.14);
        ctx.closePath();
        ctx.fill();
      }
    } else if (move?.pose.arrowL || move?.pose.arrowR) {
      // static moves keep their authored direction hints
      const arrow = (from: [number, number], dir: string, side: number) => {
        const [ax, ay] = P(from);
        const l2 = s * 0.5;
        let vx = 0, vy = 0;
        if (dir === 'up') vy = -l2;
        else if (dir === 'down') vy = l2;
        else if (dir === 'out') vx = side * l2;
        else if (dir === 'in') vx = -side * l2;
        else return;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + vx, ay + vy); ctx.stroke();
        const n2 = Math.hypot(vx, vy) || 1;
        const uxa = vx / n2, uya = vy / n2;
        ctx.beginPath();
        ctx.moveTo(ax + vx + uxa * s * 0.16, ay + vy + uya * s * 0.16);
        ctx.lineTo(ax + vx - uya * s * 0.12, ay + vy + uxa * s * 0.12);
        ctx.lineTo(ax + vx + uya * s * 0.12, ay + vy - uxa * s * 0.12);
        ctx.closePath(); ctx.fill();
      };
      if (move.pose.arrowL) arrow(sk.wrL, move.pose.arrowL, -1);
      if (move.pose.arrowR) arrow(sk.wrR, move.pose.arrowR, 1);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
function el(tag: string, cls?: string, text?: string): HTMLElement {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}
