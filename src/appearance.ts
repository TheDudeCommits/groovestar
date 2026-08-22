// Appearance capture: build a stylized character profile from the player's
// webcam image. We sample colors at landmark-guided regions (hair, face, chest,
// forearms, thighs) across many frames, take per-channel medians for
// robustness, then push the palette into the game's neon-arcade language
// (saturation boost, lightness clamps). Long sleeves ≈ chest color on the
// forearms → the avatar gets a hoodie treatment; short sleeves → bare arms.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface BodyShape {
  headScale: number;   // head radius multiplier vs default
  buildScale: number;  // limb thickness multiplier (from shoulder-width ratio)
}

export interface StyleProfile {
  skin: string;
  hair: string;
  top: string;        // shirt / hoodie body
  topDeep: string;    // darker shade of top for depth
  bottom: string;
  boots: string;
  glove: string;
  longSleeves: boolean;
  hairIsSkin: boolean; // shaved/bald → skip hair swoop
  body: BodyShape;
}

type RGB = [number, number, number];

const IDX = { nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26 };

export class StyleScanner {
  private cv = document.createElement('canvas');
  private cx = this.cv.getContext('2d', { willReadFrequently: true })!;
  private samples: Record<string, RGB[]> = { hair: [], skin: [], top: [], forearm: [], bottom: [] };
  private headRatios: number[] = [];   // ear distance / torso length
  private buildRatios: number[] = [];  // shoulder width / torso length

  /** feed one video frame + its landmarks; call ~15–30 times during the scan */
  feed(video: HTMLVideoElement, lms: NormalizedLandmark[]) {
    const w = 160, h = 120;
    this.cv.width = w; this.cv.height = h;
    try { this.cx.drawImage(video, 0, 0, w, h); } catch { return; }
    const img = this.cx.getImageData(0, 0, w, h).data;
    const at = (x: number, y: number): RGB | null => {
      const px = Math.round(x * w), py = Math.round(y * h);
      if (px < 2 || py < 2 || px >= w - 2 || py >= h - 2) return null;
      // 3x3 average
      let r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = ((py + dy) * w + px + dx) * 4;
        r += img[i]; g += img[i + 1]; b += img[i + 2];
      }
      return [r / 9, g / 9, b / 9];
    };
    const P = (i: number) => ({ x: lms[i].x, y: lms[i].y, v: lms[i].visibility ?? 1 });
    const nose = P(IDX.nose), eyeL = P(IDX.eyeL), eyeR = P(IDX.eyeR);
    const shL = P(IDX.shL), shR = P(IDX.shR), hipL = P(IDX.hipL), hipR = P(IDX.hipR);
    const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
    const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const eyeY = (eyeL.y + eyeR.y) / 2;
    const faceH = Math.max(0.02, nose.y - eyeY) * 2.4; // rough face half-height

    const push = (key: keyof typeof this.samples, c: RGB | null) => { if (c) this.samples[key].push(c); };
    // cheeks (skin) — between nose and jaw, offset sideways a touch
    push('skin', at(nose.x, nose.y + faceH * 0.35));
    push('skin', at(nose.x - faceH * 0.35, nose.y + faceH * 0.15));
    push('skin', at(nose.x + faceH * 0.35, nose.y + faceH * 0.15));
    // hair — above the eye line, top of head
    push('hair', at(nose.x, eyeY - faceH * 1.15));
    push('hair', at(nose.x, eyeY - faceH * 1.5));
    // chest — center of torso, upper third
    push('top', at(midSh.x * 0.7 + midHip.x * 0.3, midSh.y * 0.7 + midHip.y * 0.3));
    push('top', at(midSh.x * 0.5 + midHip.x * 0.5, midSh.y * 0.5 + midHip.y * 0.5));
    // forearms — midway elbow→wrist (sleeve detector)
    for (const [e, wr] of [[IDX.elL, IDX.wrL], [IDX.elR, IDX.wrR]] as const) {
      const el = P(e), w2 = P(wr);
      if (el.v > 0.5 && w2.v > 0.5) push('forearm', at((el.x + w2.x) / 2, (el.y + w2.y) / 2));
    }
    // thighs — midway hip→knee
    for (const [hp, kn] of [[IDX.hipL, IDX.kneeL], [IDX.hipR, IDX.kneeR]] as const) {
      const h2 = P(hp), k2 = P(kn);
      if (h2.v > 0.4 && k2.v > 0.4) push('bottom', at((h2.x + k2.x) / 2, (h2.y + k2.y) / 2));
    }
    // body-shape ratios (aspect-corrected x so ratios are geometric, not pixel)
    const A = 4 / 3;
    const torso = Math.hypot((midSh.x - midHip.x) * A, midSh.y - midHip.y);
    if (torso > 0.05) {
      const earL = P(IDX.earL), earR = P(IDX.earR);
      if (earL.v > 0.5 && earR.v > 0.5) {
        this.headRatios.push(Math.hypot((earL.x - earR.x) * A, earL.y - earR.y) / torso);
      }
      if (shL.v > 0.5 && shR.v > 0.5) {
        this.buildRatios.push(Math.hypot((shL.x - shR.x) * A, shL.y - shR.y) / torso);
      }
    }
  }

  get sampleCount() { return this.samples.top.length; }

  build(accentFallback: string): StyleProfile {
    const med = (arr: RGB[], fallback: RGB): RGB => {
      if (arr.length < 3) return fallback;
      const ch = (i: number) => arr.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(arr.length / 2)];
      return [ch(0), ch(1), ch(2)];
    };
    const skinRGB = med(this.samples.skin, [214, 168, 130]);
    const hairRGB = med(this.samples.hair, [40, 30, 28]);
    const topRGB = med(this.samples.top, [70, 200, 255]);
    const bottomRGB = med(this.samples.bottom, [44, 51, 82]);
    const foreRGB = med(this.samples.forearm, skinRGB);

    // sleeves: forearm closer to shirt color than to skin color → long
    const longSleeves = dist(foreRGB, topRGB) + 18 < dist(foreRGB, skinRGB);
    const hairIsSkin = dist(hairRGB, skinRGB) < 42;

    const med1 = (arr: number[], fb: number) =>
      arr.length >= 3 ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] : fb;
    // typical ear-span/torso ≈ 0.34, shoulder-span/torso ≈ 0.72 — normalize around those
    const headScale = Math.min(1.25, Math.max(0.85, med1(this.headRatios, 0.34) / 0.34));
    const buildScale = Math.min(1.35, Math.max(0.8, med1(this.buildRatios, 0.72) / 0.72));

    const top = stylize(topRGB, 1.75, [0.38, 0.6]);
    return {
      body: { headScale, buildScale },
      skin: rgbCss(clampL(skinRGB, 0.32, 0.82)),
      hair: rgbCss(stylize(hairRGB, 1.35, [0.12, 0.55])),
      top: rgbCss(top),
      topDeep: rgbCss(shade(top, 0.62)),
      bottom: rgbCss(stylize(bottomRGB, 1.5, [0.16, 0.45])),
      boots: '#16121f',
      glove: accentFallback,
      longSleeves,
      hairIsSkin,
    };
  }
}

// ---- color helpers ---------------------------------------------------------
function dist(a: RGB, b: RGB) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function rgbCss(c: RGB) { return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`; }
function shade(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }

function rgb2hsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function hsl2rgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** push a sampled color into the arcade palette: saturate + clamp lightness */
function stylize(c: RGB, satBoost: number, lRange: [number, number]): RGB {
  const [h, s, l] = rgb2hsl(c);
  const s2 = Math.min(0.95, Math.max(0.28, s * satBoost));
  const l2 = Math.min(lRange[1], Math.max(lRange[0], l));
  return hsl2rgb([h, s2, l2]);
}
function clampL(c: RGB, lo: number, hi: number): RGB {
  const [h, s, l] = rgb2hsl(c);
  return hsl2rgb([h, Math.min(0.7, s * 1.15), Math.min(hi, Math.max(lo, l))]);
}
