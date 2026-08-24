// BodyArt: the dancer's body, rebuilt from the ground up as constructed
// anatomy rather than decorated capsules.
//  - torso: shoulder/chest/waist/hip silhouette with breathing, and clothing
//    as GEOMETRY (hood volume, jacket panels + lapels, tee hems, skirts)
//  - limbs: one continuous curved shape per arm/leg through all three joints,
//    tapered widths, cross-lit gradient, crease at the elbow/knee
//  - hands: palm + fingers + thumb, splaying open on fast moves, fist on gold
//  - feet: articulated sneakers with sole, collar and toe direction
//  - head: neck, jaw, eyes with tracking pupils and blinks, brows, mouth
//    states, ears; hair as spring-driven masses per style
//  - fast wrists leave classic animation smears
// Everything draws into the avatar's body layer, so the judgment sticker rim,
// reflection, cel beam pass and particles apply on top unchanged.

import type { StyleProfile } from './appearance';

type P2 = [number, number];
type Ctx = CanvasRenderingContext2D;

export interface BodyJoints {
  pelvis: P2; midSh: P2; head: P2; hr: number;
  shA: P2; elA: P2; wrA: P2; shB: P2; elB: P2; wrB: P2;
  hipA: P2; kneeA: P2; ankA: P2; hipB: P2; kneeB: P2; ankB: P2;
  torsoPx: number; groundY: number;
  dz: (k: string) => number;
  frontA: boolean; frontB: boolean;
}

export interface BodyOpts {
  beat: number;
  now: number;
  dt: number;
  gloveFlash: number;
  goldHold: boolean;
  faceState: 'idle' | 'smile' | 'stars' | 'wobble';
  /** screen x the key light comes from (beam), for shade side */
  lightX?: number;
}

// ---- tiny vector helpers ----------------------------------------------------
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const len = (a: P2) => Math.hypot(a[0], a[1]) || 1e-4;
const norm = (a: P2): P2 => mul(a, 1 / len(a));
const perp = (a: P2): P2 => [-a[1], a[0]];
const mix = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function shadeCss(c: string, f: number): string {
  const m = c.match(/\d+/g);
  if (m && c.startsWith('rgb')) {
    return `rgb(${m.slice(0, 3).map((v) => Math.round(Math.min(255, Number(v) * f))).join(',')})`;
  }
  const v = parseInt(c.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, ((v >> s) & 255) * f));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

class Spring2 {
  p: P2 = [0, 0]; v: P2 = [0, 0]; init = false;
  follow(t: P2, dt: number, k: number, damp: number) {
    if (!this.init) { this.p = [...t]; this.init = true; }
    for (let i = 0; i < 2; i++) {
      const a = (t[i] - this.p[i]) * k - this.v[i] * damp;
      this.v[i] += a * dt;
      this.p[i] += this.v[i] * dt;
    }
    return this.p;
  }
}

export class BodyArt {
  private hood = new Spring2();
  private hairB = new Spring2();
  private tail = new Spring2();
  private hem = [new Spring2(), new Spring2()];
  private prevWr: Record<string, { p: P2; t: number }[]> = { A: [], B: [] };
  private blinkAt = 0;

  render(o: Ctx, J: BodyJoints, style: StyleProfile, opts: BodyOpts) {
    const T = J.torsoPx;
    const b = style.body.buildScale;
    const look = style.look;
    const outfit: 'hoodie' | 'jacket' | 'tee' =
      style.longSleeves ? 'hoodie' : look?.pattern === 'halves' ? 'jacket' : 'tee';
    const lightSide = (opts.lightX ?? J.pelvis[0] - T) < J.pelvis[0] ? -1 : 1;
    const W = {
      shoulder: 0.105 * T * b, elbow: 0.075 * T * b, wrist: 0.054 * T * b,
      thigh: 0.15 * T * (style.body.hipScale ?? b), knee: 0.095 * T * b, ankle: 0.062 * T * b,
    };
    o.lineJoin = 'round';
    o.lineCap = 'round';

    // ---- one continuous curved limb: a→m→e with tapered widths -------------
    const limbPath = (a: P2, m: P2, e: P2, wA: number, wM: number, wE: number) => {
      const n1 = norm(perp(sub(m, a)));
      const n2 = norm(perp(sub(e, m)));
      const nm = norm(add(n1, n2));
      // widen the middle normal so a sharply-bent joint keeps its thickness
      const bendBoost = 1 + Math.max(0, 0.5 - (n1[0] * n2[0] + n1[1] * n2[1])) * 0.35;
      const aL = add(a, mul(n1, wA)), aR = sub(a, mul(n1, wA));
      const mL = add(m, mul(nm, wM * bendBoost)), mR = sub(m, mul(nm, wM * bendBoost));
      const eL = add(e, mul(n2, wE)), eR = sub(e, mul(n2, wE));
      o.beginPath();
      o.moveTo(aL[0], aL[1]);
      o.quadraticCurveTo(mL[0], mL[1], eL[0], eL[1]);
      o.arc(e[0], e[1], wE, Math.atan2(eL[1] - e[1], eL[0] - e[0]), Math.atan2(eR[1] - e[1], eR[0] - e[0]));
      o.quadraticCurveTo(mR[0], mR[1], aR[0], aR[1]);
      o.arc(a[0], a[1], wA, Math.atan2(aR[1] - a[1], aR[0] - a[0]), Math.atan2(aL[1] - a[1], aL[0] - a[0]));
      o.closePath();
      return { nm, mid: m, bend: Math.max(0, 1 - (n1[0] * n2[0] + n1[1] * n2[1])) };
    };

    /** hard two-tone cel fill + bend-deepened crease line at the joint */
    const limb = (a: P2, m: P2, e: P2, wA: number, wM: number, wE: number, color: string, crease = true) => {
      const trace = () => limbPath(a, m, e, wA, wM, wE);
      const { nm, mid, bend } = trace();
      o.fillStyle = color;
      o.fill();
      // cel: clip to the limb, flood with the shadow tone, then stamp the
      // shape again shifted toward the light — the uncovered sliver on the
      // far side becomes one hard-edged core shadow
      o.save();
      trace(); o.clip();
      trace(); o.fillStyle = shadeCss(color, 0.66); o.fill();
      o.translate(lightSide * -wM * 0.5, -wM * 0.3);
      trace(); o.fillStyle = color; o.fill();
      // cool bounce light kissing the dark edge
      o.translate(lightSide * wM * 1.35, wM * 0.8);
      trace();
      o.strokeStyle = 'rgba(150,195,255,0.24)';
      o.lineWidth = wM * 0.34;
      o.stroke();
      o.restore();
      if (crease) {
        // the more the joint bends, the deeper the fold reads
        o.strokeStyle = `rgba(0,0,0,${0.16 + bend * 0.3})`;
        o.lineWidth = Math.max(1, wM * (0.18 + bend * 0.34));
        o.beginPath();
        const c1 = add(mid, mul(nm, wM * 0.66)), c2 = sub(mid, mul(nm, wM * 0.2));
        o.moveTo(c1[0], c1[1]);
        o.quadraticCurveTo(mid[0] + nm[0] * wM * 0.2, mid[1] + nm[1] * wM * 0.2, c2[0], c2[1]);
        o.stroke();
      }
    };

    // ---- sneakers -----------------------------------------------------------
    const sneaker = (ank: P2, knee: P2, side: number) => {
      const fx = Math.sign(ank[0] - J.pelvis[0]) || side;
      const L = 0.3 * T, H = 0.13 * T;
      const heel: P2 = [ank[0] - fx * L * 0.28, ank[1] + H * 0.12];
      const toe: P2 = [ank[0] + fx * L * 0.62, ank[1] + H * 0.42];
      o.save();
      // body
      o.beginPath();
      o.moveTo(heel[0], heel[1] - H * 0.55);
      o.quadraticCurveTo(heel[0] - fx * L * 0.1, toe[1] - H * 0.2, heel[0] + fx * L * 0.06, toe[1] + H * 0.28);
      o.lineTo(toe[0], toe[1] + H * 0.28);
      o.quadraticCurveTo(toe[0] + fx * L * 0.16, toe[1] + H * 0.05, toe[0] - fx * L * 0.12, toe[1] - H * 0.35);
      o.quadraticCurveTo(ank[0] + fx * L * 0.1, ank[1] - H * 0.5, heel[0] + fx * L * 0.08, heel[1] - H * 0.62);
      o.closePath();
      const grad = o.createLinearGradient(ank[0], ank[1] - H, ank[0], toe[1] + H * 0.3);
      grad.addColorStop(0, shadeCss(style.boots, 1.3));
      grad.addColorStop(1, style.boots);
      o.fillStyle = grad;
      o.fill();
      // collar hugging the ankle
      o.strokeStyle = shadeCss(style.boots, 0.6);
      o.lineWidth = H * 0.16;
      o.beginPath();
      o.arc(ank[0], ank[1] - H * 0.18, H * 0.42, Math.PI * 1.05, Math.PI * 1.95);
      o.stroke();
      // toecap + laces
      o.fillStyle = 'rgba(255,255,255,0.85)';
      o.beginPath();
      o.moveTo(toe[0] - fx * L * 0.16, toe[1] - H * 0.3);
      o.quadraticCurveTo(toe[0] + fx * L * 0.14, toe[1] - H * 0.22, toe[0] + fx * L * 0.12, toe[1] + H * 0.26);
      o.lineTo(toe[0] - fx * L * 0.05, toe[1] + H * 0.26);
      o.closePath();
      o.fill();
      o.strokeStyle = 'rgba(255,255,255,0.7)';
      o.lineWidth = Math.max(1, H * 0.09);
      for (let i = 0; i < 3; i++) {
        o.beginPath();
        o.moveTo(ank[0] + fx * L * (0.02 + i * 0.09), ank[1] - H * (0.2 - i * 0.12));
        o.lineTo(ank[0] + fx * L * (0.14 + i * 0.09), ank[1] + H * (0.02 + i * 0.1));
        o.stroke();
      }
      // sole
      o.fillStyle = '#f4f1ea';
      o.beginPath();
      o.moveTo(heel[0] - fx * L * 0.04, toe[1] + H * 0.24);
      o.lineTo(toe[0] + fx * L * 0.16, toe[1] + H * 0.24);
      o.lineTo(toe[0] + fx * L * 0.16, toe[1] + H * 0.52);
      o.lineTo(heel[0] - fx * L * 0.04, toe[1] + H * 0.46);
      o.closePath();
      o.fill();
      o.fillStyle = 'rgba(0,0,0,0.16)';
      o.fillRect(Math.min(heel[0], toe[0]), toe[1] + H * 0.24, Math.abs(toe[0] - heel[0]) + fx * 0, H * 0.06);
      o.restore();
    };

    // ---- hands --------------------------------------------------------------
    const hand = (wr: P2, el: P2, color: string, key: 'A' | 'B', flash: number) => {
      const dirV = norm(sub(wr, el));
      const r = 0.085 * T * b;
      const c = add(wr, mul(dirV, r * 0.9));
      // speed → finger splay
      const hist = this.prevWr[key];
      hist.push({ p: [...wr], t: opts.now });
      while (hist.length > 4) hist.shift();
      const old = hist[0];
      const v = old ? len(sub(wr, old.p)) / Math.max(0.016, (opts.now - old.t) / 1000) : 0;
      const open = opts.goldHold ? 0 : Math.min(1, v / (T * 6));
      o.save();
      if (flash > 0.05) {
        o.shadowColor = '#ffd23e';
        o.shadowBlur = r * (1 + flash * 2.2);
      }
      // palm
      o.fillStyle = color;
      o.beginPath();
      o.ellipse(c[0], c[1], r, r * 0.88, Math.atan2(dirV[1], dirV[0]), 0, Math.PI * 2);
      o.fill();
      if (opts.goldHold) {
        // fist: knuckle bumps
        for (let i = -1; i <= 1; i++) {
          const k = add(c, mul(perp(dirV), i * r * 0.52));
          o.beginPath(); o.arc(k[0] + dirV[0] * r * 0.55, k[1] + dirV[1] * r * 0.55, r * 0.34, 0, Math.PI * 2); o.fill();
        }
      } else {
        // fingers fan out with speed
        const base = Math.atan2(dirV[1], dirV[0]);
        const splay = 0.16 + open * 0.42;
        for (let i = -1; i <= 2; i++) {
          const ang = base + (i - 0.5) * splay;
          const fl = r * (1.05 + open * 0.4) * (i === 2 ? 0.85 : 1);
          const tip: P2 = [c[0] + Math.cos(ang) * fl, c[1] + Math.sin(ang) * fl];
          o.strokeStyle = color;
          o.lineWidth = r * 0.42;
          o.beginPath(); o.moveTo(c[0] + Math.cos(ang) * r * 0.4, c[1] + Math.sin(ang) * r * 0.4); o.lineTo(tip[0], tip[1]); o.stroke();
        }
        // thumb
        const ta = base - Math.PI * 0.55;
        o.lineWidth = r * 0.46;
        o.beginPath();
        o.moveTo(c[0], c[1]);
        o.lineTo(c[0] + Math.cos(ta) * r * 0.85, c[1] + Math.sin(ta) * r * 0.85);
        o.stroke();
      }
      o.restore();
    };

    // ---- motion smears (before everything — they sit behind the body) ------
    for (const key of ['A', 'B'] as const) {
      const hist = this.prevWr[key];
      if (hist.length >= 3) {
        const a = hist[0].p, e2 = key === 'A' ? J.wrA : J.wrB;
        const v = len(sub(e2, a)) / Math.max(0.016, (opts.now - hist[0].t) / 1000);
        if (v > T * 7) {
          const d = norm(sub(e2, a));
          const n = perp(d);
          o.save();
          o.globalAlpha = 0.3;
          o.fillStyle = key === 'B' ? style.glove : style.top;
          o.beginPath();
          o.moveTo(a[0] + n[0] * T * 0.015, a[1] + n[1] * T * 0.015);
          o.lineTo(e2[0] + n[0] * T * 0.085, e2[1] + n[1] * T * 0.085);
          o.lineTo(e2[0] - n[0] * T * 0.085, e2[1] - n[1] * T * 0.085);
          o.lineTo(a[0] - n[0] * T * 0.015, a[1] - n[1] * T * 0.015);
          o.closePath();
          o.fill();
          o.restore();
        }
      }
    }

    // ---- torso path builder -------------------------------------------------
    const axis = sub(J.midSh, J.pelvis);
    const per = norm(perp(axis));
    const at = (t: number, w: number): P2 => add(add(J.pelvis, mul(axis, t)), mul(per, w));
    const breathe = Math.sin(opts.now / 850) * 0.008 * T;
    const sS = style.body.shoulderScale ?? b;
    const hS = style.body.hipScale ?? b;
    const shoulderH = 0.365 * T * sS, chestH = 0.335 * T * sS + breathe;
    // waist pinches toward the narrower of the two — broad shoulders read
    // V-shaped, wider hips read hourglass; it's construction, not scaling
    const waistH = 0.25 * T * (Math.min(sS, hS) * 0.72 + Math.max(sS, hS) * 0.24);
    const hipH = 0.315 * T * hS;
    const torsoPath = (inflate = 0) => {
      const sL = at(1.0, -(shoulderH + inflate)), sR = at(1.0, shoulderH + inflate);
      const cL = at(0.78, -(chestH + inflate)), cR = at(0.78, chestH + inflate);
      const wL = at(0.42, -(waistH + inflate)), wR = at(0.42, waistH + inflate);
      const hL = at(0.0, -(hipH + inflate)), hR = at(0.0, hipH + inflate);
      const neckL = at(1.06, -0.13 * T), neckR = at(1.06, 0.13 * T);
      o.beginPath();
      o.moveTo(neckL[0], neckL[1]);
      o.quadraticCurveTo(sL[0], sL[1] - 0.03 * T, ...mix(sL, cL, 0.5));
      o.quadraticCurveTo(cL[0], cL[1], wL[0], wL[1]);
      o.quadraticCurveTo(...mix(wL, hL, 0.6), hL[0], hL[1]);
      o.quadraticCurveTo(...at(-0.06, 0), hR[0], hR[1]);
      o.quadraticCurveTo(...mix(wR, hR, 0.6), wR[0], wR[1]);
      o.quadraticCurveTo(cR[0], cR[1], ...mix(sR, cR, 0.5));
      o.quadraticCurveTo(sR[0], sR[1] - 0.03 * T, neckR[0], neckR[1]);
      o.closePath();
    };

    // ---------------- draw order ----------------
    const armW: [number, number, number] = [W.shoulder, W.elbow, W.wrist];
    const skinArm = outfit === 'tee';
    const armColor = (upper: boolean) => (skinArm && !upper ? style.skin : style.top);
    const drawArm = (sh: P2, el: P2, wr: P2, key: 'A' | 'B', dU: number, dL: number) => {
      if (skinArm) {
        // cap sleeve on the upper third, skin below
        limb(sh, el, wr, armW[0] * dU, armW[1] * dL, armW[2] * dL, style.skin);
        const cap = mix(sh, el, 0.42);
        limb(sh, mix(sh, cap, 0.6), cap, armW[0] * dU * 1.12, armW[0] * dU * 1.05, armW[1] * dL * 1.15, style.top, false);
      } else {
        limb(sh, el, wr, armW[0] * dU, armW[1] * dL, armW[2] * dL, armColor(true));
        // sleeve fold lines gathering at the elbow
        const foldDir = norm(sub(wr, el));
        const foldN = perp(foldDir);
        o.strokeStyle = 'rgba(0,0,0,0.2)';
        o.lineWidth = Math.max(1, armW[1] * 0.16);
        for (const fOff of [0.12, 0.3]) {
          const fp = mix(el, wr, fOff);
          o.beginPath();
          o.moveTo(fp[0] + foldN[0] * armW[1] * 0.7, fp[1] + foldN[1] * armW[1] * 0.7);
          o.quadraticCurveTo(fp[0] + foldDir[0] * armW[1] * 0.5, fp[1] + foldDir[1] * armW[1] * 0.5,
            fp[0] - foldN[0] * armW[1] * 0.7, fp[1] - foldN[1] * armW[1] * 0.7);
          o.stroke();
        }
        // cuff
        const cf = mix(el, wr, 0.86);
        o.fillStyle = shadeCss(style.top, 0.66);
        o.beginPath(); o.arc(cf[0], cf[1], armW[2] * dL * 1.15, 0, Math.PI * 2); o.fill();
        // sliver of skin at the wrist
        limb(mix(el, wr, 0.9), mix(el, wr, 0.96), wr, armW[2] * dL * 0.8, armW[2] * dL * 0.75, armW[2] * dL * 0.7, style.skin, false);
      }
    };
    const drawLeg = (hip: P2, knee: P2, ank: P2, side: number, dT: number, dS: number) => {
      limb(hip, knee, ank, W.thigh * dT, W.knee * dS, W.ankle * dS, style.bottom);
      // cuff over the sneaker collar
      const cf = mix(knee, ank, 0.9);
      o.fillStyle = shadeCss(style.bottom, 0.7);
      o.beginPath(); o.arc(cf[0], cf[1], W.ankle * dS * 1.12, 0, Math.PI * 2); o.fill();
      sneaker(ank, knee, side);
    };

    // far arm behind everything
    const flashB = opts.gloveFlash;
    if (!J.frontA) { drawArm(J.shA, J.elA, J.wrA, 'A', J.dz('elA'), J.dz('wrA')); hand(J.wrA, J.elA, style.skin, 'A', 0); }
    if (!J.frontB) { drawArm(J.shB, J.elB, J.wrB, 'B', J.dz('elB'), J.dz('wrB')); hand(J.wrB, J.elB, flashB > 0.05 ? '#ffe9a0' : style.glove, 'B', flashB); }

    // legs
    drawLeg(J.hipA, J.kneeA, J.ankA, -1, J.dz('kneeA'), J.dz('ankA'));
    drawLeg(J.hipB, J.kneeB, J.ankB, 1, J.dz('kneeB'), J.dz('ankB'));

    // skirt (geometry, swings with hem springs)
    if (look?.skirt) {
      const hemY = at(-0.42, 0);
      const l = this.hem[0].follow(at(-0.42, -hipH * 1.55), opts.dt, 130, 11);
      const r = this.hem[1].follow(at(-0.42, hipH * 1.55), opts.dt, 130, 11);
      o.fillStyle = style.bottom;
      o.beginPath();
      const wl = at(0.3, -waistH * 1.02), wr2 = at(0.3, waistH * 1.02);
      o.moveTo(wl[0], wl[1]);
      o.quadraticCurveTo(l[0], l[1] - 0.1 * T, l[0], l[1]);
      for (let i = 0; i <= 4; i++) {
        const p = mix(l, r, i / 4);
        o.lineTo(p[0], p[1] + (i % 2 === 0 ? 0 : 0.07 * T));
      }
      o.quadraticCurveTo(r[0], r[1] - 0.1 * T, wr2[0], wr2[1]);
      o.closePath();
      o.fill();
      o.fillStyle = 'rgba(255,255,255,0.25)';
      o.fillRect(wl[0], wl[1] - 0.02 * T, wr2[0] - wl[0], 0.045 * T);
      void hemY;
    }

    // hood volume behind the neck (before torso so the torso overlaps it)
    if (outfit === 'hoodie') {
      const hp = this.hood.follow(add(J.midSh, mul(norm(axis), 0.18 * T)), opts.dt, 70, 9);
      o.fillStyle = shadeCss(style.top, 0.72);
      o.beginPath();
      o.ellipse(hp[0], hp[1], 0.28 * T * b, 0.17 * T, Math.atan2(per[1], per[0]), 0, Math.PI * 2);
      o.fill();
    }

    // torso
    {
      torsoPath();
      o.fillStyle = style.top;
      o.fill();
      // hard cel shadow across the torso
      o.save();
      torsoPath(); o.clip();
      torsoPath(); o.fillStyle = shadeCss(style.top, 0.68); o.fill();
      o.translate(lightSide * -chestH * 0.34, -chestH * 0.18);
      torsoPath(); o.fillStyle = style.top; o.fill();
      o.translate(lightSide * chestH * 0.94, chestH * 0.5);
      torsoPath();
      o.strokeStyle = 'rgba(150,195,255,0.2)';
      o.lineWidth = chestH * 0.16;
      o.stroke();
      o.restore();

      o.save();
      torsoPath();
      o.clip();
      if (outfit === 'jacket') {
        // open jacket: under-shirt strip + two panels with lapels
        const shirt = look?.pattern2 ?? '#ffffff';
        o.fillStyle = shirt;
        const c0 = at(1.02, 0), c1 = at(-0.06, 0);
        o.beginPath();
        o.moveTo(c0[0] - 0.14 * T, c0[1]);
        o.lineTo(c1[0] - 0.2 * T, c1[1]);
        o.lineTo(c1[0] + 0.2 * T, c1[1]);
        o.lineTo(c0[0] + 0.14 * T, c0[1]);
        o.closePath();
        o.fill();
        for (const s of [-1, 1]) {
          o.fillStyle = s === lightSide ? shadeCss(style.top, 0.82) : shadeCss(style.top, 0.66);
          const n0 = at(1.02, s * 0.13 * T);
          const lap = at(0.62, s * 0.3 * T * b);
          o.beginPath();
          o.moveTo(n0[0], n0[1]);
          o.quadraticCurveTo(lap[0] - s * 0.06 * T, lap[1], lap[0], lap[1]);
          o.lineTo(n0[0] + s * 0.3 * T, n0[1] + 0.16 * T);
          o.closePath();
          o.fill();
        }
      } else if (outfit === 'tee') {
        // hem + collar geometry
        o.fillStyle = shadeCss(style.top, 0.8);
        const hL2 = at(-0.02, -hipH), hR2 = at(-0.02, hipH);
        o.beginPath();
        o.moveTo(hL2[0], hL2[1]);
        o.quadraticCurveTo(...at(-0.09, 0), hR2[0], hR2[1]);
        o.lineTo(...at(-0.16, hipH));
        o.lineTo(...at(-0.16, -hipH));
        o.closePath();
        o.fill();
        o.strokeStyle = 'rgba(0,0,0,0.2)';
        o.lineWidth = 0.02 * T;
        o.beginPath();
        const nl = at(0.99, -0.12 * T), nr = at(0.99, 0.12 * T);
        o.moveTo(nl[0], nl[1]);
        o.quadraticCurveTo(...at(0.9, 0), nr[0], nr[1]);
        o.stroke();
      } else {
        // hoodie: kangaroo pocket + drawstrings + zip
        o.fillStyle = shadeCss(style.top, 0.78);
        const p0 = at(0.3, -0.2 * T * b), p1 = at(0.3, 0.2 * T * b);
        const p2 = at(0.06, 0.24 * T * b), p3 = at(0.06, -0.24 * T * b);
        o.beginPath();
        o.moveTo(p0[0], p0[1]); o.lineTo(p1[0], p1[1]); o.lineTo(p2[0], p2[1]); o.lineTo(p3[0], p3[1]);
        o.closePath(); o.fill();
        o.strokeStyle = 'rgba(255,255,255,0.55)';
        o.lineWidth = Math.max(1.2, 0.014 * T);
        for (const s of [-1, 1]) {
          const d0 = at(0.96, s * 0.07 * T);
          o.beginPath();
          o.moveTo(d0[0], d0[1]);
          o.quadraticCurveTo(d0[0] + s * 0.02 * T, d0[1] + 0.22 * T, d0[0] - s * 0.015 * T, d0[1] + 0.3 * T);
          o.stroke();
        }
        o.strokeStyle = 'rgba(255,255,255,0.4)';
        o.beginPath();
        o.moveTo(...at(1.0, 0)); o.lineTo(...at(0.0, 0));
        o.stroke();
      }
      // patterns as part of the cloth (kept subtle, under the shading)
      if (look && look.pattern === 'stripes') {
        o.fillStyle = look.pattern2 ?? shadeCss(style.top, 0.7);
        for (let t = 0.85; t > 0.05; t -= 0.24) {
          const a2 = at(t, -chestH * 1.2), b2 = at(t, chestH * 1.2);
          o.save();
          o.globalAlpha = 0.85;
          o.beginPath();
          o.moveTo(a2[0], a2[1]); o.lineTo(b2[0], b2[1]);
          o.lineTo(b2[0] + axis[0] * 0.08, b2[1] + axis[1] * 0.08);
          o.lineTo(a2[0] + axis[0] * 0.08, a2[1] + axis[1] * 0.08);
          o.closePath(); o.fill();
          o.restore();
        }
      } else if (look && look.pattern === 'chevron') {
        o.strokeStyle = look.pattern2 ?? '#ffffff';
        o.lineWidth = 0.07 * T;
        for (let t = 0.72; t > 0.1; t -= 0.3) {
          const a2 = at(t, -chestH), m2 = at(t - 0.12, 0), b2 = at(t, chestH);
          o.beginPath();
          o.moveTo(a2[0], a2[1]); o.lineTo(m2[0], m2[1]); o.lineTo(b2[0], b2[1]);
          o.stroke();
        }
      }
      // line art: clavicle hints from the neckline toward each shoulder
      o.strokeStyle = 'rgba(0,0,0,0.18)';
      o.lineWidth = Math.max(1, 0.014 * T);
      for (const s of [-1, 1]) {
        const c0 = at(0.94, s * 0.06 * T), c1x = at(0.9, s * 0.22 * T);
        o.beginPath();
        o.moveTo(c0[0], c0[1]);
        o.quadraticCurveTo(...at(0.9, s * 0.12 * T), c1x[0], c1x[1]);
        o.stroke();
      }
      // contact shadow under the chin
      const nb = at(1.02, 0);
      o.fillStyle = 'rgba(0,0,10,0.22)';
      o.beginPath();
      o.ellipse(nb[0], nb[1] + 0.03 * T, 0.16 * T, 0.05 * T, Math.atan2(per[1], per[0]), 0, Math.PI * 2);
      o.fill();
      o.restore();
    }

    // ---- neck + head --------------------------------------------------------
    const hr = J.hr;
    const head = J.head;
    const nb = at(1.0, 0);
    o.fillStyle = style.skin;
    o.beginPath();
    o.moveTo(nb[0] - 0.09 * T, nb[1] + 0.02 * T);
    o.lineTo(head[0] - hr * 0.42, head[1] + hr * 0.6);
    o.lineTo(head[0] + hr * 0.42, head[1] + hr * 0.6);
    o.lineTo(nb[0] + 0.09 * T, nb[1] + 0.02 * T);
    o.closePath();
    o.fill();

    // hair behind the head
    this.hairBehind(o, head, hr, style, opts);

    // head: skull + jaw
    const headTrace = () => {
      o.beginPath();
      o.moveTo(head[0] - hr, head[1]);
      o.arc(head[0], head[1] - hr * 0.06, hr, Math.PI, 0);            // skull dome
      o.quadraticCurveTo(head[0] + hr * 0.96, head[1] + hr * 0.62, head[0] + hr * 0.34, head[1] + hr * 0.94);
      o.quadraticCurveTo(head[0], head[1] + hr * 1.06, head[0] - hr * 0.34, head[1] + hr * 0.94);  // jaw
      o.quadraticCurveTo(head[0] - hr * 0.96, head[1] + hr * 0.62, head[0] - hr, head[1]);
      o.closePath();
    };
    headTrace();
    o.fillStyle = style.skin;
    o.fill();
    // hard cel crescent on the shadow side of the face
    o.save();
    headTrace(); o.clip();
    headTrace(); o.fillStyle = shadeCss(style.skin, 0.78); o.fill();
    o.translate(lightSide * -hr * 0.3, -hr * 0.16);
    headTrace(); o.fillStyle = style.skin; o.fill();
    o.restore();
    // jaw line art
    o.strokeStyle = 'rgba(0,0,0,0.14)';
    o.lineWidth = Math.max(1, hr * 0.055);
    o.beginPath();
    o.moveTo(head[0] + hr * 0.5, head[1] + hr * 0.78);
    o.quadraticCurveTo(head[0], head[1] + hr * 0.98, head[0] - hr * 0.5, head[1] + hr * 0.78);
    o.stroke();
    // ears
    for (const s of [-1, 1]) {
      o.fillStyle = shadeCss(style.skin, 0.95);
      o.beginPath(); o.ellipse(head[0] + s * hr * 0.96, head[1] + hr * 0.1, hr * 0.14, hr * 0.2, 0, 0, Math.PI * 2); o.fill();
    }

    this.face(o, head, hr, style, opts);
    this.hairFront(o, head, hr, style, opts);

    // near-side arms draw over the torso (and face, when raised)
    if (J.frontA) { drawArm(J.shA, J.elA, J.wrA, 'A', J.dz('elA'), J.dz('wrA')); hand(J.wrA, J.elA, style.skin, 'A', 0); }
    if (J.frontB) { drawArm(J.shB, J.elB, J.wrB, 'B', J.dz('elB'), J.dz('wrB')); hand(J.wrB, J.elB, flashB > 0.05 ? '#ffe9a0' : style.glove, 'B', flashB); }
  }

  // ---- face ----------------------------------------------------------------
  private face(o: Ctx, head: P2, hr: number, style: StyleProfile, opts: BodyOpts) {
    const look = style.look;
    // blink clock
    if (opts.now > this.blinkAt + 3600) this.blinkAt = opts.now + Math.random() * 800;
    const blink = Math.abs(opts.now - this.blinkAt) < 70 ? 0.15 : 1;

    if (look?.shades) {
      o.fillStyle = '#131019';
      for (const s of [-1, 1]) {
        o.beginPath();
        o.roundRect(head[0] + s * hr * 0.48 - hr * 0.36, head[1] - hr * 0.28, hr * 0.72, hr * 0.42, hr * 0.14);
        o.fill();
      }
      o.fillRect(head[0] - hr * 0.16, head[1] - hr * 0.14, hr * 0.32, hr * 0.09);
      o.fillStyle = 'rgba(255,255,255,0.4)';
      o.fillRect(head[0] - hr * 0.72, head[1] - hr * 0.2, hr * 0.26, hr * 0.08);
    } else {
      // eyes with tracking pupils
      const lookX = Math.max(-1, Math.min(1, (this.prevWr.B[2]?.p[0] ?? head[0]) - head[0])) * 0.2;
      for (const s of [-1, 1]) {
        const ex = head[0] + s * hr * 0.36, ey = head[1] - hr * 0.02;
        o.fillStyle = '#ffffff';
        o.beginPath(); o.ellipse(ex, ey, hr * 0.17, hr * 0.23 * blink, 0, 0, Math.PI * 2); o.fill();
        o.fillStyle = '#241c30';
        o.beginPath(); o.arc(ex + lookX * hr, ey + hr * 0.03, hr * 0.095 * blink, 0, Math.PI * 2); o.fill();
        o.fillStyle = 'rgba(255,255,255,0.9)';
        o.beginPath(); o.arc(ex + lookX * hr - hr * 0.03, ey - hr * 0.03, hr * 0.032, 0, Math.PI * 2); o.fill();
      }
      // brows
      o.strokeStyle = style.hairIsSkin ? shadeCss(style.skin, 0.7) : style.hair;
      o.lineWidth = hr * 0.09;
      o.lineCap = 'round';
      const lift = opts.faceState === 'stars' ? -hr * 0.1 : opts.faceState === 'wobble' ? hr * 0.03 : 0;
      const tilt = opts.faceState === 'wobble' ? 0.12 : -0.06;
      for (const s of [-1, 1]) {
        o.beginPath();
        o.moveTo(head[0] + s * hr * 0.18, head[1] - hr * 0.32 + lift + s * 0 * hr);
        o.lineTo(head[0] + s * hr * 0.54, head[1] - hr * 0.36 + lift + tilt * s * s * hr + (opts.faceState === 'wobble' ? hr * 0.08 : 0));
        o.stroke();
      }
    }
    // mouth
    o.strokeStyle = 'rgba(40,24,40,0.8)';
    o.lineWidth = hr * 0.09;
    o.lineCap = 'round';
    if (opts.faceState === 'stars') {
      o.fillStyle = 'rgba(60,30,50,0.9)';
      o.beginPath(); o.ellipse(head[0], head[1] + hr * 0.5, hr * 0.18, hr * 0.24, 0, 0, Math.PI * 2); o.fill();
      o.fillStyle = 'rgba(255,255,255,0.85)';
      o.fillRect(head[0] - hr * 0.12, head[1] + hr * 0.33, hr * 0.24, hr * 0.07);
    } else if (opts.faceState === 'smile') {
      o.beginPath(); o.arc(head[0], head[1] + hr * 0.34, hr * 0.32, Math.PI * 0.15, Math.PI * 0.85); o.stroke();
    } else if (opts.faceState === 'wobble') {
      o.beginPath();
      o.moveTo(head[0] - hr * 0.28, head[1] + hr * 0.52);
      for (let i = 1; i <= 4; i++) {
        o.lineTo(head[0] - hr * 0.28 + (hr * 0.56 * i) / 4, head[1] + hr * 0.52 + (i % 2 ? -hr * 0.06 : hr * 0.06));
      }
      o.stroke();
    } else {
      o.beginPath(); o.arc(head[0], head[1] + hr * 0.4, hr * 0.24, Math.PI * 0.2, Math.PI * 0.8); o.stroke();
    }
    // headband
    if (look?.headband) {
      o.fillStyle = look.headband;
      o.fillRect(head[0] - hr * 1.0, head[1] - hr * 0.62, hr * 2.0, hr * 0.2);
    }
  }

  // ---- hair ----------------------------------------------------------------
  private hairBehind(o: Ctx, head: P2, hr: number, style: StyleProfile, opts: BodyOpts) {
    const kind = style.look?.hair ?? (style.longSleeves ? 'hood' : 'swoop');
    if (style.hairIsSkin && kind !== 'hood') return;
    const hb = this.hairB.follow(head, opts.dt, 80, 9);
    const lag: P2 = [(hb[0] - head[0]) * 0.7, (hb[1] - head[1]) * 0.7];
    o.fillStyle = style.hair;
    if (kind === 'hood') {
      o.fillStyle = shadeCss(style.top, 0.8);
      o.beginPath();
      o.ellipse(head[0] + lag[0] * 0.3, head[1] + lag[1] * 0.3 + hr * 0.12, hr * 1.22, hr * 1.26, 0, 0, Math.PI * 2);
      o.fill();
      o.fillStyle = shadeCss(style.top, 0.55);
      o.beginPath();
      o.ellipse(head[0] + lag[0] * 0.3, head[1] + lag[1] * 0.3 + hr * 0.16, hr * 1.12, hr * 1.16, 0, 0, Math.PI * 2);
      o.fill();
    } else if (kind === 'afro') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        o.beginPath();
        o.arc(head[0] + Math.cos(a) * hr * 0.8 + lag[0], head[1] + Math.sin(a) * hr * 0.8 - hr * 0.25 + lag[1], hr * 0.6, 0, Math.PI * 2);
        o.fill();
      }
      o.beginPath(); o.arc(head[0] + lag[0], head[1] - hr * 0.25 + lag[1], hr * 1.06, 0, Math.PI * 2); o.fill();
    } else if (kind === 'bob') {
      o.beginPath();
      o.moveTo(head[0] - hr * 1.16, head[1] - hr * 0.1);
      o.arc(head[0], head[1] - hr * 0.16, hr * 1.16, Math.PI, 0);
      o.quadraticCurveTo(head[0] + hr * 1.2 + lag[0], head[1] + hr * 0.9 + lag[1], head[0] + hr * 0.62, head[1] + hr * 0.86 + lag[1] * 0.5);
      o.lineTo(head[0] - hr * 0.62, head[1] + hr * 0.86 + lag[1] * 0.5);
      o.quadraticCurveTo(head[0] - hr * 1.2 + lag[0], head[1] + hr * 0.9 + lag[1], head[0] - hr * 1.16, head[1] - hr * 0.1);
      o.closePath();
      o.fill();
    } else if (kind === 'buns') {
      for (const s of [-1, 1]) {
        o.beginPath();
        o.arc(head[0] + s * hr * 0.82 + lag[0] * 0.6, head[1] - hr * 0.85 + lag[1] * 0.6, hr * 0.4, 0, Math.PI * 2);
        o.fill();
      }
    } else if (kind === 'ponytail') {
      const base: P2 = [head[0] + hr * 0.75, head[1] - hr * 0.5];
      const tp = this.tail.follow([base[0] + hr * 0.65, base[1] + hr * 1.7], opts.dt, 60, 8);
      o.beginPath();
      o.moveTo(base[0], base[1]);
      o.quadraticCurveTo(base[0] + hr * 0.9, base[1] + hr * 0.2, tp[0], tp[1]);
      o.quadraticCurveTo(base[0] + hr * 0.15, base[1] + hr * 1.1, base[0] - hr * 0.3, base[1] + hr * 0.55);
      o.closePath();
      o.fill();
      o.beginPath(); o.arc(base[0], base[1], hr * 0.26, 0, Math.PI * 2); o.fill();
    } else if (kind === 'spiky') {
      for (let i = -2; i <= 2; i++) {
        const x = head[0] + i * hr * 0.4;
        o.beginPath();
        o.moveTo(x - hr * 0.22, head[1] - hr * 0.55);
        o.lineTo(x + i * hr * 0.1 + lag[0] * 0.8, head[1] - hr * (1.5 - Math.abs(i) * 0.16) + lag[1] * 0.6);
        o.lineTo(x + hr * 0.22, head[1] - hr * 0.55);
        o.closePath();
        o.fill();
      }
    }
  }

  private hairFront(o: Ctx, head: P2, hr: number, style: StyleProfile, opts: BodyOpts) {
    const kind = style.look?.hair ?? (style.longSleeves ? 'hood' : 'swoop');
    if (style.hairIsSkin && kind !== 'hood' && kind !== 'cap') return;
    o.fillStyle = style.hair;
    if (kind === 'hood') {
      // hood rim framing the face
      o.strokeStyle = shadeCss(style.top, 1.05);
      o.lineWidth = hr * 0.3;
      o.beginPath();
      o.arc(head[0], head[1] + hr * 0.06, hr * 1.08, Math.PI * 0.92, Math.PI * 2.08);
      o.stroke();
    } else if (kind === 'cap') {
      o.beginPath();
      o.arc(head[0], head[1] - hr * 0.2, hr * 1.05, Math.PI, 0);
      o.closePath(); o.fill();
      o.fillStyle = shadeCss(style.hair, 0.78);
      o.beginPath();
      o.ellipse(head[0] + hr * 0.72, head[1] - hr * 0.22, hr * 0.6, hr * 0.15, -0.1, 0, Math.PI * 2);
      o.fill();
      // button
      o.fillStyle = shadeCss(style.hair, 1.25);
      o.beginPath(); o.arc(head[0], head[1] - hr * 1.16, hr * 0.09, 0, Math.PI * 2); o.fill();
    } else if (kind === 'swoop') {
      o.beginPath();
      o.arc(head[0], head[1] - hr * 0.12, hr * 1.05, Math.PI * 0.93, Math.PI * 2.07);
      o.quadraticCurveTo(head[0] + hr * 0.95, head[1] - hr * 0.85, head[0] - hr * 0.15, head[1] - hr * 0.66);
      o.closePath();
      o.fill();
      // underside tone
      o.fillStyle = shadeCss(style.hair, 0.72);
      o.beginPath();
      o.moveTo(head[0] - hr * 0.9, head[1] - hr * 0.4);
      o.quadraticCurveTo(head[0] - hr * 0.2, head[1] - hr * 0.7, head[0] + hr * 0.55, head[1] - hr * 0.62);
      o.quadraticCurveTo(head[0] - hr * 0.2, head[1] - hr * 0.5, head[0] - hr * 0.82, head[1] - hr * 0.28);
      o.closePath();
      o.fill();
    } else {
      // generic fringe cap for afro/bob/buns/ponytail/spiky
      o.beginPath();
      o.arc(head[0], head[1] - hr * 0.05, hr * 1.03, Math.PI * 1.06, Math.PI * 1.94);
      o.quadraticCurveTo(head[0], head[1] - hr * 0.5, head[0] - hr * 0.85, head[1] - hr * 0.5);
      o.closePath();
      o.fill();
    }
  }
}
