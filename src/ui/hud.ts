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

  /** fitness milestone: a burning number that flashes for ~2 seconds */
  flashCalories(n: number) {
    const f = el('div', 'cal-flash');
    f.innerHTML = `<span class="cal-num">${n}</span><span class="cal-label">calories burned</span>`;
    this.root.appendChild(f);
    setTimeout(() => f.remove(), 2000);
  }

  destroy() { this.root.remove(); }
}

// ---------------------------------------------------------------------------
// Pictogram strip (canvas-drawn so cards slide at 60fps)

export function drawPictograms(
  ctx: CanvasRenderingContext2D,
  song: Song, beat: number, w: number, h: number,
) {
  // Silhouette cards glide right to left onto the "now" ring, bottom right,
  // clear of the coach.
  const size = Math.min(190, h * 0.235, w * 0.15);
  const stripY = h * 0.935;                 // feet baseline
  const nowX = w * 0.775;
  const spacing = size * 0.78;              // px per move (2 beats)
  const speed = spacing / 2;

  ctx.save();
  // track: a soft rail from the ring to the edge, and the ring itself
  const pulse = Math.pow(1 - (((beat % 1) + 1) % 1), 3);
  const railY = stripY + size * 0.07;
  const rail = ctx.createLinearGradient(nowX, 0, w, 0);
  rail.addColorStop(0, 'rgba(255,255,255,0.55)');
  rail.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rail;
  ctx.beginPath();
  ctx.roundRect(nowX, railY - 2, w - nowX, 4, 2);
  ctx.fill();
  const ringY = stripY - size * 0.46;
  ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.45})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(nowX, ringY, size * (0.5 + pulse * 0.03), size * (0.58 + pulse * 0.03), 0, 0, Math.PI * 2);
  ctx.stroke();
  for (const m of song.choreo) {
    const d = m.beat - beat;               // beats until arrival
    if (d < -0.8 || d > 8) continue;
    const x = nowX + d * speed;
    if (x > w + size) continue;
    let alpha = 1, scale = d < 0.5 ? 1.08 : 0.9;
    if (d < 0) { alpha = 1 + d / 0.8; scale = 1.08 + (-d) * 0.35; }  // arrival pop & fade
    else if (d > 6) alpha = (8 - d) / 2;
    drawPicto(ctx, m.move, !!m.gold, x, stripY - (d < 0 ? -d * size * 0.2 : 0), size * scale, alpha, song.accent, true, Math.abs(d) < 0.5);
  }
  ctx.restore();
}

const arrowCache = new Map<string, [number, number][][] | null>();
/** Wrist paths across a motion slice, for the move-card arrows. */
function wristPaths(moveId: string): [number, number][][] | null {
  if (arrowCache.has(moveId)) return arrowCache.get(moveId)!;
  const clip = CLIPS[moveId];
  let out: [number, number][][] | null = null;
  if (clip) {
    const keys = [0, Math.floor(clip.pk / 2), clip.pk].map((k) => clip.f[Math.max(0, Math.min(clip.f.length - 1, k))]);
    const sks = keys.map((r) => forward({ lean: r[0], crouch: r[1], armL: [r[2], r[3]], armR: [r[4], r[5]], legL: [r[6], r[7]], legR: [r[8], r[9]] }));
    out = [];
    for (const side of ['wrL', 'wrR'] as const) {
      const pts = sks.map((sk) => sk[side]);
      const dist = Math.hypot(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]);
      if (dist > 0.38) out.push(pts);
    }
  }
  arrowCache.set(moveId, out);
  return out;
}

function drawPicto(
  ctx: CanvasRenderingContext2D,
  moveId: string, gold: boolean,
  x: number, y: number, size: number, alpha: number, accent: string,
  _carded = false, now = false,
) {
  void accent;
  let pose: Pose | null = MOVES[moveId]?.pose ?? null;
  if (!pose && CLIPS[moveId]) pose = clipPeakPose(CLIPS[moveId]);
  if (!pose) return;
  const move = MOVES[moveId];
  const sk = forward(pose);
  const s = size / 2.9;
  const P = (p: [number, number]): [number, number] => [x + p[0] * s, y + (p[1] - 1.0) * s];

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const c1 = gold ? '#fff07a' : now ? '#ff5ccf' : '#56e6ff';
  const c2 = gold ? '#ff9a1f' : now ? '#9d5cff' : '#6b62ff';
  const grad = ctx.createLinearGradient(x, y - 2.7 * s, x, y + 0.1 * s);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  const limb = (pts: [number, number][], width: number) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    const p0 = P(pts[0]);
    ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < pts.length; i++) { const q = P(pts[i]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  };
  const body = (extra: number) => {
    // torso as a rounded quad
    const quad = [P(sk.shL), P(sk.shR), P(sk.hipR), P(sk.hipL)];
    ctx.lineWidth = s * 0.22 + extra * 2;
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (const q of quad.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    limb([sk.neck, sk.head], s * 0.18 + extra * 2);
    limb([sk.hipL, sk.kneeL, sk.ankL], s * 0.3 + extra * 2);
    limb([sk.hipR, sk.kneeR, sk.ankR], s * 0.3 + extra * 2);
    limb([sk.shL, sk.elL, sk.wrL], s * 0.24 + extra * 2);
    limb([sk.shR, sk.elR, sk.wrR], s * 0.24 + extra * 2);
    const hd = P(sk.head);
    ctx.beginPath(); ctx.arc(hd[0], hd[1] - s * 0.06, s * 0.28 + extra, 0, Math.PI * 2); ctx.fill();
    for (const wr of [sk.wrL, sk.wrR]) {
      const q = P(wr);
      ctx.beginPath(); ctx.arc(q[0], q[1], s * 0.15 + extra, 0, Math.PI * 2); ctx.fill();
    }
  };
  // white outline with a dark halo reads on any wall color, then the fill
  ctx.shadowColor = 'rgba(8,2,20,0.75)';
  ctx.shadowBlur = size * 0.09;
  ctx.fillStyle = ctx.strokeStyle = '#ffffff';
  body(s * 0.085);
  ctx.shadowBlur = 0;
  if (now || gold) {
    ctx.shadowColor = gold ? '#ffd23e' : '#ff4fc1';
    ctx.shadowBlur = size * 0.16;
  }
  ctx.fillStyle = ctx.strokeStyle = grad;
  body(0);
  ctx.shadowBlur = 0;

  // motion arrows: how the hands travel into the pose
  const arrowCol = gold ? '#ffffff' : '#ffd23e';
  const drawArrow = (pts: [number, number][]) => {
    const a = P(pts[0]), m = P(pts[1]), b = P(pts[2]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < s * 0.3) return;
    const head = () => {
      const ux = (b[0] - m[0]) / (Math.hypot(b[0] - m[0], b[1] - m[1]) || 1), uy = (b[1] - m[1]) / (Math.hypot(b[0] - m[0], b[1] - m[1]) || 1);
      const hs = s * 0.2;
      ctx.beginPath();
      ctx.moveTo(b[0] + ux * hs * 0.8, b[1] + uy * hs * 0.8);
      ctx.lineTo(b[0] - uy * hs * 0.7 - ux * hs * 0.3, b[1] + ux * hs * 0.7 - uy * hs * 0.3);
      ctx.lineTo(b[0] + uy * hs * 0.7 - ux * hs * 0.3, b[1] - ux * hs * 0.7 - uy * hs * 0.3);
      ctx.closePath();
      ctx.fill();
    };
    for (const pass of [0, 1]) {
      ctx.strokeStyle = ctx.fillStyle = pass ? arrowCol : 'rgba(10,4,24,0.85)';
      ctx.lineWidth = s * (pass ? 0.09 : 0.17);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(m[0] * 2 - (a[0] + b[0]) / 2, m[1] * 2 - (a[1] + b[1]) / 2, b[0], b[1]);
      ctx.stroke();
      head();
    }
  };
  const paths = wristPaths(moveId);
  if (paths) for (const p of paths) drawArrow(p);
  else if (move) {
    const legacy = (from: [number, number], dir: string | undefined, side: number) => {
      if (!dir || dir === 'cw' || dir === 'ccw') return;
      const v: [number, number] = dir === 'up' ? [0, -0.55] : dir === 'down' ? [0, 0.55] : dir === 'out' ? [side * 0.55, 0] : [-side * 0.55, 0];
      drawArrow([[from[0] - v[0], from[1] - v[1]], [from[0] - v[0] / 2, from[1] - v[1] / 2], from]);
    };
    legacy(sk.wrL, move.pose.arrowL, -1);
    legacy(sk.wrR, move.pose.arrowR, 1);
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
