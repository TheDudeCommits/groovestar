// Dev-only lab for Nova's Meshy dance clips (served by Vite in dev at
// /tools/primetime/lab/dance-lab.html).
//   ?mode=sheet&clips=D22,D23&frames=8   contact sheet of evenly spaced frames
//   ?mode=bake                           tempo, beat phase and per-beat pose
//                                        parameters, left on window.__bake
import * as T from "three";
import { Character } from "../../../src/kinetic/render/character";

const q = new URLSearchParams(location.search);
const mode = q.get("mode") ?? "sheet";
const W = window as unknown as { __bake?: unknown; __ready?: boolean; __err?: string };

const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color(0x1a1430);
scene.add(new T.HemisphereLight(0xdde6ff, 0x302040, 1.6));
const key = new T.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 4);
scene.add(key);
const camera = new T.PerspectiveCamera(34, 140 / 210, 0.1, 50);

const char = new Character();
scene.add(char.group);

const JOINTS = [
  "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot", "Hips",
] as const;
type J = (typeof JOINTS)[number];

function sampleJoints(name: string, t: number) {
  char.timeline([[name, t, 1]]);
  char.group.updateMatrixWorld(true);
  const out = {} as Record<J, T.Vector3>;
  for (const j of JOINTS) out[j] = char.rigBone(j)!.getWorldPosition(new T.Vector3());
  return out;
}

const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Game pose parameters as the coach appears to a camera on +z (see moves.ts). */
function params(fr: Record<J, T.Vector3>[]) {
  const n = fr.length;
  const pelvis = fr.map((f) => f.LeftUpLeg.clone().add(f.RightUpLeg).multiplyScalar(0.5));
  const neck = fr.map((f) => f.LeftArm.clone().add(f.RightArm).multiplyScalar(0.5));
  const torso = fr.map((_, i) => neck[i].distanceTo(pelvis[i])).sort((a, b) => a - b)[Math.floor(n / 2)];
  // Face each frame toward the camera: the hip axis (character left, +x when
  // facing +z) is rotated onto +x, so +x stays viewer right.
  const face = fr.map((f) => {
    const a = f.LeftUpLeg.clone().sub(f.RightUpLeg);
    return Math.atan2(a.z, a.x);
  });
  const P = (i: number, v: T.Vector3) => {
    const d = v.clone().sub(pelvis[i]);
    const c = Math.cos(-face[i]), s = Math.sin(-face[i]);
    // rotation about +y by -face: x' = x cos + z sin (right-handed, y up)
    return { x: d.x * c + d.z * s, y: d.y };
  };
  const limb = (a: { x: number; y: number }, b: { x: number; y: number }, s: number) => deg(Math.atan2((b.x - a.x) * s, -(b.y - a.y)));
  const ankH = fr.map((f) => (f.LeftFoot.y + f.RightFoot.y) / 2);
  const pelH = fr.map((f, i) => pelvis[i].y - ankH[i]);
  const stand = [...pelH].sort((a, b) => a - b)[Math.floor(n * 0.85)];
  const rows = fr.map((f, i) => {
    const sh = { L: P(i, f.RightArm), R: P(i, f.LeftArm) };
    const el = { L: P(i, f.RightForeArm), R: P(i, f.LeftForeArm) };
    const wr = { L: P(i, f.RightHand), R: P(i, f.LeftHand) };
    const hp = { L: P(i, f.RightUpLeg), R: P(i, f.LeftUpLeg) };
    const kn = { L: P(i, f.RightLeg), R: P(i, f.LeftLeg) };
    const an = { L: P(i, f.RightFoot), R: P(i, f.LeftFoot) };
    const nk = { x: (sh.L.x + sh.R.x) / 2, y: (sh.L.y + sh.R.y) / 2 };
    const lean = deg(Math.atan2(nk.x, nk.y));
    const crouch = Math.max(0, Math.min(1.3, (stand - pelH[i]) / (0.55 * torso)));
    const arm = (s: number, side: "L" | "R") => {
      const a = limb(sh[side], el[side], s), b = limb(el[side], wr[side], s);
      return [a, wrap(b - a)];
    };
    const leg = (s: number, side: "L" | "R") => {
      const a = limb(hp[side], kn[side], s), c = limb(kn[side], an[side], s);
      return [a, Math.max(-10, Math.min(150, wrap(a - c) / 0.9))];
    };
    return [lean, crouch, ...arm(-1, "L"), ...arm(1, "R"), ...leg(-1, "L"), ...leg(1, "R")];
  });
  // 5-frame box smoothing, like the AIST conversion
  const sm = rows.map((_, i) =>
    rows[i].map((__, c) => {
      let acc = 0, k = 0;
      for (let d = -2; d <= 2; d++) {
        const r = rows[Math.max(0, Math.min(n - 1, i + d))];
        acc += r[c];
        k++;
      }
      return acc / k;
    }),
  );
  return { rows: sm, torso, face: face.map((f) => Math.round(deg(f))) };
}

function autocorr(a: number[], lag: number) {
  let s = 0;
  for (let i = 0; i + lag < a.length; i++) s += a[i] * a[i + lag];
  return s / Math.max(1, a.length - lag);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

async function bake() {
  const names = (q.get("clips") ?? "").split(",").filter(Boolean);
  const list = names.length ? names : char.clips.filter((c) => /^D\d+$/.test(c));
  const FPS = 60;
  const out: unknown[] = [];
  for (const name of list) {
    const dur = char.clipDuration(name);
    const n = Math.floor(dur * FPS);
    const fr = Array.from({ length: n }, (_, i) => sampleJoints(name, i / FPS));
    const { rows, torso, face } = params(fr);
    // speed of wrists, elbows, ankles, knees, head (torso lengths per second)
    const parts: J[] = ["LeftHand", "RightHand", "LeftForeArm", "RightForeArm", "LeftFoot", "RightFoot", "LeftLeg", "RightLeg", "Head"];
    const speed = fr.map((f, i) => {
      if (!i) return 0;
      let v = 0;
      for (const p of parts) v += f[p].distanceTo(fr[i - 1][p]);
      return (v * FPS) / torso;
    });
    speed[0] = speed[1];
    const hip = fr.map((f) => f.Hips.y / torso);
    const zs = speed.map((x) => x - mean(speed)), zh = hip.map((x) => x - mean(hip));
    const s0 = autocorr(zs, 0) || 1, h0 = autocorr(zh, 0) || 1;
    const curve: { bpm: number; score: number }[] = [];
    for (let lag = Math.round((FPS * 60) / 175); lag <= Math.round((FPS * 60) / 70); lag++) {
      curve.push({ bpm: (FPS * 60) / lag, score: autocorr(zs, lag) / s0 + 0.8 * (autocorr(zh, lag) / h0) });
    }
    // local maxima, best first
    const peaks = curve
      .filter((c, i) => i > 0 && i < curve.length - 1 && c.score >= curve[i - 1].score && c.score >= curve[i + 1].score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    out.push({ name, dur, torso, peaks: peaks.map((p) => [Math.round(p.bpm * 10) / 10, Math.round(p.score * 1000) / 1000]), rows, speed, hip, face });
  }
  return out;
}

async function sheet() {
  const names = (q.get("clips") ?? "").split(",").filter(Boolean);
  const list = names.length ? names : char.clips.filter((c) => /^D\d+$/.test(c));
  const frames = +(q.get("frames") ?? 8);
  const cw = 140, ch = 210, lw = 70;
  const width = lw + frames * cw, height = list.length * ch;
  renderer.setSize(width, height);
  const label = document.createElement("canvas");
  label.width = width;
  label.height = height;
  Object.assign(label.style, { position: "absolute", left: "0", top: "0" });
  document.body.append(label);
  const g = label.getContext("2d")!;
  g.fillStyle = "#fff";
  g.font = "bold 13px system-ui";
  renderer.setScissorTest(true);
  camera.aspect = cw / ch;
  camera.position.set(0, 1.0, 4.1);
  camera.lookAt(0, 0.92, 0);
  camera.updateProjectionMatrix();
  list.forEach((name, r) => {
    const dur = char.clipDuration(name);
    g.fillText(name, 8, r * ch + 20);
    g.fillText(`${dur.toFixed(1)}s`, 8, r * ch + 38);
    for (let c = 0; c < frames; c++) {
      const t = ((c + 0.5) / frames) * dur;
      char.timeline([[name, t, 1]]);
      const x = lw + c * cw, y = height - (r + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      renderer.render(scene, camera);
    }
  });
}

(async () => {
  try {
    await char.load("nova");
    await char.loadMoves();
    if (mode === "bake") W.__bake = await bake();
    else await sheet();
  } catch (e) {
    W.__err = String((e as Error)?.stack ?? e);
  }
  W.__ready = true;
})();
