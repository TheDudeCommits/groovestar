import * as T from "three";

/** Primetime palette: a night show. Hand colors keep the cobalt/coral code. */
export const PT = {
  black: 0x07040f,
  midnight: 0x1a0b3a,
  violet: 0x8d5cff,
  magenta: 0xff3fb4,
  cyan: 0x3fe0ff,
  gold: 0xffd23e,
  left: 0x4f7bff,
  right: 0xff6a4d,
  white: 0xfff4ea,
} as const;

/** Hype levels escalate the show: lights, lasers, pyro and crowd energy. */
export const HYPE_LEVELS = [
  { name: "SOUNDCHECK", colors: [PT.violet, PT.cyan] },
  { name: "WARM-UP", colors: [PT.cyan, PT.magenta] },
  { name: "HEADLINER", colors: [PT.magenta, PT.gold] },
  { name: "ENCORE", colors: [PT.gold, PT.cyan] },
  { name: "SUPERNOVA", colors: [PT.magenta, PT.cyan] },
] as const;

/** An unlit material bright enough to bloom. */
export function neon(color: T.ColorRepresentation, intensity = 2.2, fog = false) {
  return new T.MeshBasicMaterial({
    color: new T.Color(color).multiplyScalar(intensity),
    fog,
  });
}

/** Deterministic pseudo-random sequence for set dressing. */
export function seeded(seed = 7) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Shared soft round sprite used by particles and light flares. */
let dotTexture: T.Texture | null = null;
export function softDot() {
  if (dotTexture) return dotTexture;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.75)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  dotTexture = new T.CanvasTexture(cv);
  return dotTexture;
}

const textures = new Map<string, T.Texture>();
/** Cached sRGB texture for generated art in /kinetic/pt. */
export function artTexture(url: string) {
  let t = textures.get(url);
  if (!t) {
    t = new T.TextureLoader().load(url);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(url, t);
  }
  return t;
}

/**
 * Additive materials normally add their alpha to the frame. On a transparent
 * canvas that punches holes shut (the video wall), so keep the color blend
 * and leave the destination alpha untouched.
 */
export function keepAlpha(m: T.Material) {
  if (m.blending !== T.AdditiveBlending && m.blending !== T.CustomBlending) return;
  if (m.blending === T.AdditiveBlending) {
    m.blending = T.CustomBlending;
    m.blendEquation = T.AddEquation;
    m.blendSrc = T.SrcAlphaFactor;
    m.blendDst = T.OneFactor;
  }
  m.blendEquationAlpha = T.AddEquation;
  m.blendSrcAlpha = T.ZeroFactor;
  m.blendDstAlpha = T.OneFactor;
  m.needsUpdate = true;
}
/** Apply keepAlpha to every material under root. */
export function alphaSafe(root: T.Object3D) {
  root.traverse((o) => {
    const mat = (o as T.Mesh).material as T.Material | T.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) keepAlpha(m);
  });
}
