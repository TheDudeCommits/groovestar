// Video color palette for the reactive stage. The YouTube iframe is
// cross-origin (no pixel access in the browser), so we grade the stage from
// the video's storyboard thumbnails instead: hq1/hq2/hq3.jpg are frames from
// roughly the first/middle/late thirds of every video. One palette pair per
// thumbnail → the client interpolates across the song. CDN-cached per video.
// GET /api/vibe?v=<videoId>

import jpeg from 'jpeg-js';
import { checkOrigin, rateLimit } from './_utils.js';

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (u: number) => Math.round((u + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** dominant + secondary hue of one decoded thumbnail, neon-boosted; null if the frame is basically colorless */
function palette(data: Uint8Array, width: number, height: number): [string, string] | null {
  const BINS = 12;
  const weight = new Array(BINS).fill(0);
  const hueSum = new Array(BINS).fill(0);
  const satSum = new Array(BINS).fill(0);
  let total = 0;
  // skip the letterbox bars ytimg pads 4:3 thumbs with
  const y0 = Math.floor(height * 0.14), y1 = Math.floor(height * 0.86);
  for (let y = y0; y < y1; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      const w = s * v;                       // colorful & bright pixels dominate
      if (w < 0.04) continue;
      const bin = Math.floor(h / (360 / BINS)) % BINS;
      weight[bin] += w; hueSum[bin] += h * w; satSum[bin] += s * w;
      total += w;
    }
  }
  if (total < 40) return null;               // grayscale / near-black frame
  const order = weight.map((w, i) => i).sort((a, b) => weight[b] - weight[a]);
  const top = order[0];
  // secondary: strongest bin at least 2 bins of hue away, else the complement
  const second = order.find((b) => Math.min(Math.abs(b - top), BINS - Math.abs(b - top)) >= 2);
  const hexOf = (bin: number) => {
    const h = hueSum[bin] / weight[bin];
    const s = Math.max(0.62, Math.min(1, satSum[bin] / weight[bin] + 0.2));
    return hsvToHex(h, s, 0.95);             // stage lights: saturated, bright
  };
  const a = hexOf(top);
  const b = second !== undefined && weight[second] > total * 0.06
    ? hexOf(second)
    : hsvToHex(((hueSum[top] / weight[top]) + 150) % 360, 0.7, 0.95);
  return [a, b];
}

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'vibe', 12)) return;
  const videoId = String(req.query?.v ?? '');
  if (!/^[\w-]{11}$/.test(videoId)) { res.status(400).json({ error: 'bad request' }); return; }

  const palettes = await Promise.all([1, 2, 3].map(async (n) => {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${videoId}/hq${n}.jpg`);
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 64 });
      return palette(img.data as Uint8Array, img.width, img.height);
    } catch { return null; }
  }));

  res.status(200)
    .setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=604800')
    .json({ palettes: palettes.some(Boolean) ? palettes : null });
}
