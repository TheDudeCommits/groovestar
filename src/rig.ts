// Sprite rig ("paper-doll") skin: body parts are baked ONCE into offscreen
// canvases as detailed vector art — jacket with zipper and collar, pants with
// seams, sneakers with soles and laces — then stamped onto the live skeleton
// every frame with per-bone rotation, length-fit and depth scaling. The same
// puppet technique as Rayman / South Park rigs.

import type { StyleProfile } from './appearance';

type P2 = [number, number];

const BASE = 200; // bake resolution: pixels per torso-length

interface Parts {
  torso: HTMLCanvasElement;
  sleeveU: HTMLCanvasElement; sleeveL: HTMLCanvasElement;   // long-sleeve arm
  armU: HTMLCanvasElement; armL: HTMLCanvasElement;         // bare arm
  thigh: HTMLCanvasElement; shin: HTMLCanvasElement;
  sneaker: HTMLCanvasElement;
  head: HTMLCanvasElement;
  skirt: HTMLCanvasElement | null;
}

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return [c, c.getContext('2d')!];
}

function shade(hex: string, f: number): string {
  const m = hex.match(/\d+/g);
  if (m && hex.startsWith('rgb')) {
    return `rgb(${m.slice(0, 3).map((v) => Math.round(Math.min(255, Number(v) * f))).join(',')})`;
  }
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, ((v >> s) & 255) * f));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** vertical limb segment: rounded, tapered, side-shaded, with a seam */
function bakeLimb(w1: number, w2: number, len: number, color: string, opts: { seam?: boolean; cuff?: string } = {}): HTMLCanvasElement {
  const pad = 6;
  const [c, g] = cv(Math.max(w1, w2) * 2 + pad * 2, len + pad * 2);
  const cx = c.width / 2;
  g.translate(cx, pad);
  const path = () => {
    g.beginPath();
    g.arc(0, 0, w1, Math.PI, 0);
    g.lineTo(w2, len);
    g.arc(0, len, w2, 0, Math.PI);
    g.closePath();
  };
  // base + side shading
  path();
  const grad = g.createLinearGradient(-w1, 0, w1, 0);
  grad.addColorStop(0, shade(color, 1.12));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, 0.72));
  g.fillStyle = grad;
  g.fill();
  // seam
  if (opts.seam) {
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = Math.max(1.5, w1 * 0.12);
    g.beginPath();
    g.moveTo(w1 * 0.55, w1 * 0.4);
    g.lineTo(w2 * 0.55, len - w2 * 0.3);
    g.stroke();
  }
  // cuff band at the bottom
  if (opts.cuff) {
    g.fillStyle = opts.cuff;
    g.beginPath();
    g.arc(0, len, w2, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-w2, len - w2 * 0.9, w2 * 2, w2 * 0.7);
  }
  return c;
}

function bakeTorso(style: StyleProfile, T: number): HTMLCanvasElement {
  const w = T * 0.72, len = T * 1.12, pad = 10;
  const [c, g] = cv(w + pad * 2, len + pad * 2);
  g.translate(c.width / 2, pad);
  const hw = w / 2;
  // jacket silhouette: shoulders → waist pinch → hip
  const body = () => {
    g.beginPath();
    g.moveTo(-hw, T * 0.06);
    g.quadraticCurveTo(-hw * 1.06, -T * 0.02, -hw * 0.55, -T * 0.04); // shoulder cap L
    g.quadraticCurveTo(0, -T * 0.1, hw * 0.55, -T * 0.04);            // neckline
    g.quadraticCurveTo(hw * 1.06, -T * 0.02, hw, T * 0.06);           // shoulder cap R
    g.quadraticCurveTo(hw * 0.82, len * 0.55, hw * 0.72, len * 0.8);  // waist R
    g.quadraticCurveTo(hw * 0.7, len, 0, len);
    g.quadraticCurveTo(-hw * 0.7, len, -hw * 0.72, len * 0.8);
    g.quadraticCurveTo(-hw * 0.82, len * 0.55, -hw, T * 0.06);
    g.closePath();
  };
  body();
  const grad = g.createLinearGradient(-hw, 0, hw, 0);
  grad.addColorStop(0, shade(style.top, 1.14));
  grad.addColorStop(0.5, style.top);
  grad.addColorStop(1, shade(style.top, 0.7));
  g.fillStyle = grad;
  g.fill();
  // outfit pattern, clipped to the jacket silhouette
  const look = style.look;
  if (look && look.pattern !== 'solid') {
    const c2 = look.pattern2 ?? style.topDeep;
    g.save();
    body(); g.clip();
    g.fillStyle = c2;
    if (look.pattern === 'halves') {
      g.fillRect(0, -T * 0.12, hw * 1.2, len * 1.1);
      // re-shade the seam
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(-T * 0.008, -T * 0.12, T * 0.016, len * 1.1);
    } else if (look.pattern === 'stripes') {
      for (let y = len * 0.12; y < len; y += len * 0.24) {
        g.fillRect(-hw * 1.1, y, hw * 2.2, len * 0.11);
      }
    } else if (look.pattern === 'chevron') {
      g.lineWidth = len * 0.09;
      g.strokeStyle = c2;
      for (let y = len * 0.18; y < len * 1.15; y += len * 0.3) {
        g.beginPath();
        g.moveTo(-hw * 1.05, y - len * 0.12);
        g.lineTo(0, y);
        g.lineTo(hw * 1.05, y - len * 0.12);
        g.stroke();
      }
    }
    g.restore();
  }
  // collar
  g.fillStyle = style.topDeep;
  g.beginPath();
  g.moveTo(-hw * 0.5, -T * 0.045);
  g.quadraticCurveTo(0, T * 0.09, hw * 0.5, -T * 0.045);
  g.quadraticCurveTo(0, T * 0.02, -hw * 0.5, -T * 0.045);
  g.closePath();
  g.fill();
  // zipper
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = Math.max(1.5, T * 0.014);
  g.beginPath(); g.moveTo(0, T * 0.05); g.lineTo(0, len * 0.97); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.moveTo(T * 0.012, T * 0.06); g.lineTo(T * 0.012, len * 0.97); g.stroke();
  // zipper pull
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(-T * 0.014, T * 0.14, T * 0.028, T * 0.05);
  // chest pocket stitch
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = Math.max(1, T * 0.01);
  g.beginPath();
  g.moveTo(hw * 0.28, len * 0.32);
  g.lineTo(hw * 0.62, len * 0.34);
  g.stroke();
  // hem band
  g.fillStyle = style.topDeep;
  g.fillRect(-hw * 0.72, len * 0.92, hw * 1.44, len * 0.08);
  return c;
}

function bakeSneaker(style: StyleProfile, T: number): HTMLCanvasElement {
  const len = T * 0.34, h = T * 0.17, pad = 6;
  const [c, g] = cv(len + pad * 2, h + pad * 2);
  g.translate(pad, pad);
  // body (heel at left, toe at right)
  g.beginPath();
  g.moveTo(0, h * 0.18);
  g.quadraticCurveTo(len * 0.02, 0, len * 0.22, 0);
  g.lineTo(len * 0.55, h * 0.16);
  g.quadraticCurveTo(len * 0.92, h * 0.26, len * 0.98, h * 0.6);
  g.lineTo(len, h * 0.78);
  g.lineTo(0, h * 0.78);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, shade(style.boots, 1.35));
  grad.addColorStop(1, style.boots);
  g.fillStyle = grad;
  g.fill();
  // toe cap
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.beginPath();
  g.moveTo(len * 0.82, h * 0.3);
  g.quadraticCurveTo(len * 0.98, h * 0.4, len * 0.99, h * 0.62);
  g.lineTo(len * 0.99, h * 0.78);
  g.lineTo(len * 0.78, h * 0.78);
  g.closePath();
  g.fill();
  // laces
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = Math.max(1, T * 0.012);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(len * (0.3 + i * 0.11), h * (0.14 + i * 0.1));
    g.lineTo(len * (0.44 + i * 0.11), h * (0.3 + i * 0.1));
    g.stroke();
  }
  // sole
  g.fillStyle = '#f2f0ec';
  g.fillRect(-1, h * 0.78, len + 2, h * 0.22);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(-1, h * 0.78, len + 2, h * 0.05);
  return c;
}

function bakeHead(style: StyleProfile, T: number): HTMLCanvasElement {
  const r = T * 0.23 * style.body.headScale;
  const pad = r * 1.3;                     // room for big hair
  const [c, g] = cv(r * 2 + pad * 2, r * 2 + pad * 2);
  g.translate(c.width / 2, c.height / 2);
  const hairKind = style.look?.hair ?? (style.longSleeves ? 'hood' : 'swoop');

  // behind-the-head hair mass
  g.fillStyle = style.hair;
  if (hairKind === 'hood') {
    g.fillStyle = style.topDeep;
    g.beginPath(); g.arc(0, r * 0.18, r * 1.28, 0, Math.PI * 2); g.fill();
  } else if (hairKind === 'afro' && !style.hairIsSkin) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78 - r * 0.22, r * 0.62, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath(); g.arc(0, -r * 0.22, r * 1.05, 0, Math.PI * 2); g.fill();
  } else if (hairKind === 'spiky' && !style.hairIsSkin) {
    for (let i = -2; i <= 2; i++) {
      const x = i * r * 0.42;
      g.beginPath();
      g.moveTo(x - r * 0.24, -r * 0.55);
      g.lineTo(x + (i === 0 ? 0 : i * r * 0.12), -r * (1.55 - Math.abs(i) * 0.18));
      g.lineTo(x + r * 0.24, -r * 0.55);
      g.closePath(); g.fill();
    }
  } else if (hairKind === 'bob' && !style.hairIsSkin) {
    g.beginPath();
    g.arc(0, -r * 0.05, r * 1.22, Math.PI * 0.86, Math.PI * 2.14);
    g.lineTo(r * 1.05, r * 0.75);
    g.quadraticCurveTo(r * 0.6, r * 0.95, r * 0.55, r * 0.45);
    g.lineTo(-r * 0.55, r * 0.45);
    g.quadraticCurveTo(-r * 0.6, r * 0.95, -r * 1.05, r * 0.75);
    g.closePath(); g.fill();
  } else if (hairKind === 'buns' && !style.hairIsSkin) {
    for (const s of [-1, 1]) {
      g.beginPath(); g.arc(s * r * 0.85, -r * 0.85, r * 0.42, 0, Math.PI * 2); g.fill();
    }
  } else if (hairKind === 'ponytail' && !style.hairIsSkin) {
    g.beginPath();
    g.moveTo(r * 0.7, -r * 0.55);
    g.quadraticCurveTo(r * 1.9, -r * 0.2, r * 1.45, r * 1.15);
    g.quadraticCurveTo(r * 1.15, r * 0.45, r * 0.55, r * 0.05);
    g.closePath(); g.fill();
    g.beginPath(); g.arc(r * 0.72, -r * 0.42, r * 0.24, 0, Math.PI * 2); g.fill();
  }

  // skin sphere with shading
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  grad.addColorStop(0, shade(style.skin, 1.12));
  grad.addColorStop(1, shade(style.skin, 0.82));
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  // face glow (signature look)
  const fg = g.createRadialGradient(0, r * 0.1, r * 0.1, 0, r * 0.1, r * 0.85);
  fg.addColorStop(0, 'rgba(255,255,255,0.9)');
  fg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fg;
  g.beginPath(); g.arc(0, r * 0.1, r * 0.85, 0, Math.PI * 2); g.fill();

  // front hair: fringe caps for most styles, cap gets fabric + brim
  if (hairKind === 'swoop' && !style.hairIsSkin) {
    g.fillStyle = style.hair;
    g.beginPath();
    g.arc(0, -r * 0.12, r * 1.03, Math.PI * 0.93, Math.PI * 2.07);
    g.quadraticCurveTo(r * 0.95, -r * 0.85, -r * 0.15, -r * 0.72);
    g.closePath();
    g.fill();
  } else if ((hairKind === 'bob' || hairKind === 'buns' || hairKind === 'spiky' || hairKind === 'afro' || hairKind === 'ponytail') && !style.hairIsSkin) {
    g.fillStyle = style.hair;
    g.beginPath();
    g.arc(0, 0, r * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    g.quadraticCurveTo(0, -r * 0.55, -r * 0.86, -r * 0.55 * 0.98);
    g.closePath();
    g.fill();
  } else if (hairKind === 'cap') {
    g.fillStyle = style.hair;
    g.beginPath();
    g.arc(0, -r * 0.18, r * 1.04, Math.PI, Math.PI * 2);
    g.closePath(); g.fill();
    g.fillStyle = shade(style.hair, 0.8);
    g.beginPath();
    g.ellipse(r * 0.72, -r * 0.18, r * 0.62, r * 0.16, -0.12, 0, Math.PI * 2);
    g.fill();
  }

  // headband
  if (style.look?.headband) {
    g.fillStyle = style.look.headband;
    g.fillRect(-r * 1.02, -r * 0.62, r * 2.04, r * 0.24);
  }
  // shades: JD coaches love them
  if (style.look?.shades) {
    g.fillStyle = '#12101a';
    const sy = -r * 0.14, sh = r * 0.34;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.roundRect(s * r * 0.5 - r * 0.38, sy, r * 0.76, sh, r * 0.12);
      g.fill();
    }
    g.fillRect(-r * 0.2, sy + sh * 0.25, r * 0.4, r * 0.08);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(-r * 0.78, sy + r * 0.05, r * 0.3, r * 0.07);
  }
  return c;
}

/** flared skirt stamped over the hips (drawn between legs and torso) */
function bakeSkirt(style: StyleProfile, T: number): HTMLCanvasElement {
  const w = T * 0.95, len = T * 0.42, pad = 8;
  const [c, g] = cv(w + pad * 2, len + pad * 2);
  g.translate(c.width / 2, pad);
  const hw = w / 2;
  g.beginPath();
  g.moveTo(-hw * 0.62, 0);
  g.lineTo(hw * 0.62, 0);
  g.quadraticCurveTo(hw * 0.95, len * 0.75, hw, len);
  // zigzag hem
  for (let i = 4; i >= -4; i--) {
    g.lineTo((i / 4.5) * hw, len - (Math.abs(i) % 2 === 0 ? 0 : len * 0.14));
  }
  g.closePath();
  const grad = g.createLinearGradient(-hw, 0, hw, 0);
  grad.addColorStop(0, shade(style.bottom, 1.2));
  grad.addColorStop(0.5, style.bottom);
  grad.addColorStop(1, shade(style.bottom, 0.72));
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(-hw * 0.62, 0, hw * 1.24, len * 0.1);
  return c;
}

export class SpriteRig {
  private parts: Parts | null = null;
  private bakedFor = '';

  ensure(style: StyleProfile) {
    const key = JSON.stringify([style.top, style.bottom, style.skin, style.hair, style.boots, style.longSleeves, style.body, style.look]);
    if (this.parts && this.bakedFor === key) return;
    this.bakedFor = key;
    const T = BASE;
    const b = style.body.buildScale;
    this.parts = {
      torso: bakeTorso(style, T),
      sleeveU: bakeLimb(T * 0.095 * b, T * 0.075 * b, T * 0.42, style.top, { seam: true }),
      sleeveL: bakeLimb(T * 0.075 * b, T * 0.055 * b, T * 0.4, style.top, { seam: true, cuff: shade(style.top, 0.7) }),
      armU: bakeLimb(T * 0.09 * b, T * 0.07 * b, T * 0.42, style.skin, {}),
      armL: bakeLimb(T * 0.07 * b, T * 0.05 * b, T * 0.4, style.skin, {}),
      thigh: bakeLimb(T * 0.115 * b, T * 0.088 * b, T * 0.5, style.bottom, { seam: true }),
      shin: bakeLimb(T * 0.088 * b, T * 0.06 * b, T * 0.48, style.bottom, { seam: true, cuff: shade(style.bottom, 0.75) }),
      sneaker: bakeSneaker(style, T),
      head: bakeHead(style, T),
      skirt: style.look?.skirt ? bakeSkirt(style, T) : null,
    };
  }

  /** stamp a limb part from a to b, width-scaled by depth */
  private bone(o: CanvasRenderingContext2D, part: HTMLCanvasElement, a: P2, b: P2, T: number, baseLen: number, wScale: number) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    o.save();
    o.translate(a[0], a[1]);
    o.rotate(Math.atan2(dy, dx) - Math.PI / 2);
    const s = T / BASE;
    o.scale(s * wScale, len / (baseLen * s) * s);
    o.drawImage(part, -part.width / 2, -6);
    o.restore();
  }

  render(
    o: CanvasRenderingContext2D,
    J: {
      T: number;
      pelvis: P2; midSh: P2; head: P2; hr: number;
      shA: P2; elA: P2; wrA: P2; shB: P2; elB: P2; wrB: P2;
      hipA: P2; kneeA: P2; ankA: P2; hipB: P2; kneeB: P2; ankB: P2;
      dz: (k: string) => number;
      frontA: boolean; frontB: boolean;
    },
    style: StyleProfile,
  ) {
    this.ensure(style);
    const p = this.parts!;
    const T = J.T;
    const uArm = style.longSleeves ? p.sleeveU : p.armU;
    const lArm = style.longSleeves ? p.sleeveL : p.armL;

    const arm = (sh: P2, el: P2, wr: P2, dU: number, dL: number) => {
      this.bone(o, uArm, sh, el, T, BASE * 0.42, dU);
      this.bone(o, lArm, el, wr, T, BASE * 0.4, dL);
    };
    const leg = (hip: P2, knee: P2, ank: P2, side: number, dT: number, dS: number) => {
      this.bone(o, p.thigh, hip, knee, T, BASE * 0.5, dT);
      this.bone(o, p.shin, knee, ank, T, BASE * 0.48, dS);
      // sneaker: horizontal stamp at the ankle, flipped by direction
      const fx = Math.sign(ank[0] - J.pelvis[0]) || side;
      o.save();
      o.translate(ank[0], ank[1] - T * 0.02);
      const s = (T / BASE) * dS;
      o.scale(fx * s, s);
      o.drawImage(p.sneaker, -p.sneaker.width * 0.3, -p.sneaker.height * 0.35);
      o.restore();
    };

    // depth order: far arms behind everything, then legs, torso, near arms, head
    if (!J.frontA) arm(J.shA, J.elA, J.wrA, J.dz('elA'), J.dz('wrA'));
    if (!J.frontB) arm(J.shB, J.elB, J.wrB, J.dz('elB'), J.dz('wrB'));
    leg(J.hipA, J.kneeA, J.ankA, -1, J.dz('kneeA'), J.dz('ankA'));
    leg(J.hipB, J.kneeB, J.ankB, 1, J.dz('kneeB'), J.dz('ankB'));
    // skirt sits on the hips, over the thighs, under the torso
    if (p.skirt) {
      const s = T / BASE;
      o.save();
      o.translate(J.pelvis[0], J.pelvis[1] - T * 0.06);
      o.rotate(Math.atan2(J.pelvis[1] - J.midSh[1], J.pelvis[0] - J.midSh[0]) - Math.PI / 2);
      o.scale(s, s);
      o.drawImage(p.skirt, -p.skirt.width / 2, -8);
      o.restore();
    }
    // torso: shoulders → pelvis
    {
      const a = J.midSh, b = J.pelvis;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) + T * 0.14;
      o.save();
      o.translate(a[0], a[1] - T * 0.02);
      o.rotate(Math.atan2(dy, dx) - Math.PI / 2);
      const s = T / BASE;
      const shoulderW = Math.hypot(J.shB[0] - J.shA[0], J.shB[1] - J.shA[1]) / (T * 0.54);
      o.scale(s * Math.max(0.8, shoulderW), len / (BASE * 1.12 * s) * s);
      o.drawImage(p.torso, -p.torso.width / 2, -10);
      o.restore();
    }
    if (J.frontA) arm(J.shA, J.elA, J.wrA, J.dz('elA'), J.dz('wrA'));
    if (J.frontB) arm(J.shB, J.elB, J.wrB, J.dz('elB'), J.dz('wrB'));
    // head
    {
      const s = (T / BASE) * J.dz('nose');
      o.save();
      o.translate(J.head[0], J.head[1]);
      o.scale(s, s);
      o.drawImage(p.head, -p.head.width / 2, -p.head.height / 2);
      o.restore();
    }
  }
}
