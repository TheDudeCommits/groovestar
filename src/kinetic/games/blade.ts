import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { bladeArena, BLADE_BLUE, BLADE_RED } from "../render/pt/blade-arena";
import { bladeChart, CUT_VEC, type BeatNote } from "./blade-chart";
import { sfx } from "../../games/sfx";
import { equippedSaber } from "../core/equipment";
import { RibbonTrail } from "../render/trail";
import { softDot } from "../render/pt/palette";
import { ReachSpace } from "../core/reach";

/*
 * Beat Blade, rebuilt around how a camera actually sees a player.
 *
 * - Hands are read in body-relative reach space (see core/reach.ts), so the
 *   note grid is always within arm's length wherever the player stands.
 * - Each blade grows out of the forearm: raise your arm and it points up,
 *   swing down and it sweeps down, like holding a real sword.
 * - A cut is the blade sweeping through a block on screen between two camera
 *   frames (the whole blade, hilt to tip, as in Fruit Slice), within a
 *   generous timing window that is lag-compensated for the camera pipeline.
 * - Direction matters for points, not for survival on Flow; a wrong-way cut
 *   is a BAD CUT on Athlete and Expert, as in Beat Saber.
 */

const HAND_COLOR = { L: BLADE_BLUE, R: BLADE_RED } as const;
/** Grid of the note lanes and rows at the hit plane (meters). */
const GRID_X = [-0.84, -0.28, 0.28, 0.84];
const GRID_Y = [0.8, 1.3, 1.8];
const BLOCK = 0.44;
/** Where hands map in the scene: shoulder height, gains and hilt depth. */
const MAP = { y0: 1.3, gx: 0.84, gy: 0.86, z: 0.85, blade: 1.05 };
const CAM = { y: 1.5, z: 2.7, lookY: 1.2, lookZ: -8, fov: 52 };
/** Seconds of camera-to-game latency the hit test looks back over. */
const LAG = 0.06;

type Judged = "perfect" | "great" | "good" | "bad" | "miss";

interface Note extends BeatNote {
  id: number;
  obj: T.Group | null;
  state: "live" | "cut" | "missed" | "bombed";
  spin: number;
  seed: number;
}

interface Half {
  mesh: T.Group;
  vel: T.Vector3;
  spin: T.Vector3;
  age: number;
  live: boolean;
}

interface Saber {
  side: "L" | "R";
  g: T.Group;
  glow: T.Mesh;
  core: T.Mesh;
  trail: RibbonTrail;
  flare: T.PointLight;
  /** display pose */
  hilt: T.Vector3;
  dir: T.Vector3;
  q: T.Quaternion;
  /** fresh-frame blade in screen space for the sweep test (x scaled by aspect) */
  prev: { h: [number, number]; t: [number, number]; at: number } | null;
  cur: { h: [number, number]; t: [number, number]; at: number } | null;
  seen: boolean;
  speed: number;
  lastWhoosh: number;
}

/** Note material: glossy body in the hand color with blazing edges. */
function crystal(color: number) {
  const m = new T.MeshStandardMaterial({
    color: new T.Color(color).multiplyScalar(0.5),
    emissive: new T.Color(color),
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.4,
  });
  m.defines = { USE_UV: "" };
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        vec2 e = min(vUv, 1.0 - vUv);
        float d = min(e.x, e.y);
        float edge = 1.0 - smoothstep(0.0, 0.075, d);
        float inner = smoothstep(0.5, 0.0, length(vUv - 0.5));
        totalEmissiveRadiance *= 0.28 + edge * 4.2 + inner * 0.08;
      }`,
    );
  };
  m.customProgramCacheKey = () => "bb-note3";
  return m;
}

/** Soft glow around a saber blade, brightest down its middle. */
function bladeGlow(color: T.Color) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    uniforms: { uColor: { value: color }, uK: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV;
      void main(){ float c = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); gl_FragColor = vec4(uColor * c * uK, 1.0); }`,
  });
}

/** A bold chevron (or a dot) with a soft glow, pointing down before rotation. */
function faceTexture(dot: boolean) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d")!;
  c.translate(128, 128);
  c.lineCap = "round";
  c.lineJoin = "round";
  const draw = (width: number, style: string, blur: number) => {
    c.filter = blur ? `blur(${blur}px)` : "none";
    c.strokeStyle = c.fillStyle = style;
    c.lineWidth = width;
    c.beginPath();
    if (dot) {
      c.arc(0, 0, 30 + width * 0.2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.moveTo(-72, -30);
      c.lineTo(0, 44);
      c.lineTo(72, -30);
      c.stroke();
    }
  };
  draw(64, "rgba(255,255,255,0.35)", 10);
  draw(32, "#ffffff", 0);
  c.filter = "none";
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** Rotation (about Z) that turns a down-pointing face texture toward a cut. */
function faceAngle(dir: number) {
  const [x, y] = CUT_VEC[dir as keyof typeof CUT_VEC];
  if (!x && !y) return 0;
  // screen y grows down; world y grows up
  return Math.atan2(-y, x) + Math.PI / 2;
}

/** Point-in-convex-quad, then circle vs the quad's four edges. */
function sweepHits(a: [number, number], b: [number, number], c: [number, number], d: [number, number], p: [number, number], r: number) {
  const segDist = (s: [number, number], e: [number, number]) => {
    const dx = e[0] - s[0],
      dy = e[1] - s[1];
    const k = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(s[0] + dx * k - p[0], s[1] + dy * k - p[1]);
  };
  const dist = Math.min(segDist(a, b), segDist(b, c), segDist(c, d), segDist(d, a));
  if (dist <= r) return { hit: true, dist };
  const cross = (o: [number, number], e: [number, number]) => (e[0] - o[0]) * (p[1] - o[1]) - (e[1] - o[1]) * (p[0] - o[0]);
  const s = [cross(a, b), cross(b, c), cross(c, d), cross(d, a)];
  const inside = s.every((x) => x >= 0) || s.every((x) => x <= 0);
  return { hit: inside, dist: inside ? 0 : dist };
}

export class KineticBlade extends KineticSession {
  private world;
  private reach: ReachSpace;
  private notes: Note[] = [];
  private sabers: Record<"L" | "R", Saber>;
  private halves: Half[] = [];
  private slashes: { mesh: T.Mesh; t: number }[] = [];
  private spb: number;
  private speed: number;
  private lead: number;
  private beat = 0;
  private shake = 0;
  private energy = 0.5;
  private mult = 1;
  private multProgress = 0;
  private failed = false;
  private counts: Record<Judged, number> = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
  private cutScores: number[] = [];
  private materials: Record<"L" | "R", T.Material>;
  private faceMats: { arrow: T.MeshBasicMaterial; dot: T.MeshBasicMaterial };
  private geo = {
    whole: new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 3, 0.07),
    half: new RoundedBoxGeometry(BLOCK / 2 - 0.004, BLOCK, BLOCK, 2, 0.05),
    face: new T.PlaneGeometry(BLOCK * 0.8, BLOCK * 0.8),
    cutFace: new T.PlaneGeometry(BLOCK * 0.92, BLOCK * 0.92),
  };
  private cutFaceMat = new T.MeshBasicMaterial({ color: new T.Color(1, 0.95, 0.9).multiplyScalar(1.3), transparent: true, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending });
  private bombMat: T.Material;
  private ui: { root: HTMLElement; mult: HTMLElement; ring: HTMLElement; energy: HTMLElement; pops: HTMLElement[]; popAt: number };
  private freshAt = 0;
  private clashAt = 0;
  private nextId = 0;
  private cutLog: { dir: number; sd: [number, number]; dot: number; ahead: number }[] = [];

  constructor(o: KineticOpts) {
    super(o, { fog: 0x03020c, fogDensity: 0.012, bloom: 0.8, bloomRadius: 0.5, bloomThreshold: 0.78, vignette: 0.55, exposure: 1.0 });
    const track = this.music.track;
    this.duration = (track.beats * 60) / track.bpm;
    this.spb = 60 / track.bpm;
    const diff = this.config.difficulty;
    this.speed = diff === "expert" ? 14 : diff === "athlete" ? 12 : 10;
    this.lead = diff === "expert" ? 1.5 : diff === "athlete" ? 1.75 : 2.0;
    this.world = bladeArena(this.stage, this.show);
    this.show.onLevel((_, up) => up && this.world.moment());
    this.reach = new ReachSpace(this.input.rig);
    const cam = this.stage.camera;
    this.stage.setFov(CAM.fov);
    cam.position.set(0, CAM.y, CAM.z);
    cam.lookAt(0, CAM.lookY, CAM.lookZ);
    this.materials = { L: crystal(BLADE_BLUE), R: crystal(BLADE_RED) };
    const faceMat = (dot: boolean) =>
      new T.MeshBasicMaterial({ map: faceTexture(dot), color: new T.Color(1, 1, 1).multiplyScalar(1.5), transparent: true, depthWrite: false });
    this.faceMats = { arrow: faceMat(false), dot: faceMat(true) };
    this.bombMat = new T.MeshStandardMaterial({ color: 0x14121c, roughness: 0.35, metalness: 0.8, emissive: new T.Color(0x5a0a1a), emissiveIntensity: 0.8 });
    this.sabers = { L: this.makeSaber("L"), R: this.makeSaber("R") };
    const sections = track.sections.map((s) => ({ beat: s.beat, kind: s.kind }));
    this.notes = bladeChart(track.beats, sections, this.seed, diff).map((n) => ({ ...n, id: this.nextId++, obj: null, state: "live", spin: 0, seed: Math.random() }));
    for (let i = 0; i < 28; i++) this.halves.push(this.makeHalf());
    this.ui = this.makeUi();
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { gsGame: unknown }).gsGame = this;
  }

  // ---- construction ------------------------------------------------------

  private makeSaber(side: "L" | "R"): Saber {
    const style = equippedSaber();
    const col = new T.Color(HAND_COLOR[side]);
    const g = new T.Group();
    this.stage.scene.add(g);
    const metal = new T.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.28, metalness: 0.95 });
    const chrome = new T.MeshStandardMaterial({ color: 0x9aa3b8, roughness: 0.18, metalness: 1 });
    const grip = new T.Mesh(new T.CylinderGeometry(0.034, 0.038, 0.26, 18), metal);
    grip.position.y = -0.13;
    g.add(grip);
    const deep = style.id === "classic" ? col.clone() : new T.Color(side === "L" ? style.deepL : style.deepR);
    const accent = new T.MeshStandardMaterial({ color: deep, emissive: deep, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.6 });
    for (const y of [-0.21, -0.12, -0.03]) {
      const band = new T.Mesh(new T.TorusGeometry(0.039, 0.007, 8, 20), y === -0.03 ? chrome : accent);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      g.add(band);
    }
    const guard = new T.Mesh(new T.CylinderGeometry(0.05, 0.042, 0.05, 18), chrome);
    guard.position.y = 0.02;
    g.add(guard);
    const emitter = new T.Mesh(new T.TorusGeometry(0.044, 0.01, 8, 24), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(4) }));
    emitter.rotation.x = Math.PI / 2;
    emitter.position.y = 0.05;
    g.add(emitter);
    const L = MAP.blade;
    const core = new T.Mesh(new T.CapsuleGeometry(0.012, L, 4, 10), new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).lerp(col, 0.3).multiplyScalar(2.1) }));
    core.position.y = 0.06 + L / 2;
    g.add(core);
    const glow = new T.Mesh(new T.CapsuleGeometry(0.05, L, 4, 16), bladeGlow(col.clone().multiplyScalar(1.7)));
    glow.position.y = 0.06 + L / 2;
    g.add(glow);
    const tip = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: col.clone().multiplyScalar(2.2), blending: T.AdditiveBlending, depthWrite: false }));
    tip.scale.setScalar(0.22);
    tip.position.y = 0.07;
    g.add(tip);
    const flare = new T.PointLight(col, 1.2, 2.6);
    flare.position.y = 0.55;
    g.add(flare);
    const trail = new RibbonTrail(col.clone().multiplyScalar(0.75), 8, 0.9);
    this.stage.scene.add(trail.mesh);
    g.visible = false;
    trail.mesh.visible = false;
    return {
      side, g, glow, core, trail, flare,
      hilt: new T.Vector3(side === "L" ? -0.4 : 0.4, 0.8, MAP.z),
      dir: new T.Vector3(0, 1, -0.4).normalize(),
      q: new T.Quaternion(),
      prev: null, cur: null, seen: false, speed: 0, lastWhoosh: 0,
    };
  }

  private makeHalf(): Half {
    const g = new T.Group();
    const body = new T.Mesh(this.geo.half, this.materials.L);
    body.position.x = BLOCK / 4;
    g.add(body);
    const face = new T.Mesh(this.geo.cutFace, this.cutFaceMat);
    face.rotation.y = Math.PI / 2;
    face.position.x = 0.002;
    g.add(face);
    g.visible = false;
    this.stage.scene.add(g);
    return { mesh: g, vel: new T.Vector3(), spin: new T.Vector3(), age: 0, live: false };
  }

  private makeNoteObject(n: Note) {
    const g = new T.Group();
    if (n.kind === "bomb") {
      const core = new T.Mesh(new T.IcosahedronGeometry(BLOCK * 0.42, 1), this.bombMat);
      g.add(core);
      const spikeGeo = new T.ConeGeometry(0.035, 0.14, 6);
      const phi = (1 + Math.sqrt(5)) / 2;
      const dirs: [number, number, number][] = [];
      for (const a of [-1, 1]) for (const b of [-1, 1]) dirs.push([0, a, b * phi], [a, b * phi, 0], [a * phi, 0, b]);
      for (const d of dirs) {
        const v = new T.Vector3(...d).normalize();
        const s = new T.Mesh(spikeGeo, this.bombMat);
        s.position.copy(v).multiplyScalar(BLOCK * 0.45);
        s.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v);
        g.add(s);
      }
      const glow = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(0xff1030).multiplyScalar(1.2), blending: T.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.9);
      g.add(glow);
    } else {
      g.add(new T.Mesh(this.geo.whole, this.materials[n.hand]));
      const face = new T.Mesh(this.geo.face, n.dir === 8 ? this.faceMats.dot : this.faceMats.arrow);
      face.position.z = BLOCK / 2 + 0.004;
      face.rotation.z = faceAngle(n.dir);
      g.add(face);
    }
    this.stage.scene.add(g);
    return g;
  }

  private makeUi() {
    const root = document.createElement("div");
    root.className = "bb-ui";
    root.innerHTML = `<div class="bb-mult" data-mult><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" class="bb-ring-bg"/><circle cx="32" cy="32" r="28" class="bb-ring" data-ring/></svg><b data-mult-n>×1</b></div><div class="bb-energy" aria-hidden="true"><i data-energy></i></div><div class="bb-pops" data-pops></div>`;
    this.host.appendChild(root);
    const popsRoot = root.querySelector<HTMLElement>("[data-pops]")!;
    const pops: HTMLElement[] = [];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement("div");
      p.className = "bb-pop";
      popsRoot.appendChild(p);
      pops.push(p);
    }
    return {
      root,
      mult: root.querySelector<HTMLElement>("[data-mult-n]")!,
      ring: root.querySelector<HTMLElement>("[data-ring]")!,
      energy: root.querySelector<HTMLElement>("[data-energy]")!,
      pops,
      popAt: 0,
    };
  }

  // ---- mapping -----------------------------------------------------------

  /** Scene position of a note at the hit plane. */
  private lane(n: BeatNote) {
    return new T.Vector3(GRID_X[n.col], GRID_Y[n.row], 0);
  }

  /** Where a note is `ahead` seconds before it reaches the hit plane. */
  private notePos(n: Note, ahead: number, out = new T.Vector3()) {
    const final = this.lane(n);
    // past the hit plane a block eases to a stop just in front of the player
    // (the late part of the window is camera latency, not a real miss yet)
    const z = ahead >= 0 ? -ahead * this.speed : 1.1 * (1 - Math.exp((ahead * this.speed) / 1.1));
    // notes fly in low and wide, then jump into their lane before arriving
    const jumpStart = this.lead * 0.62,
      jumpEnd = this.lead * 0.32;
    const k = Math.max(0, Math.min(1, (jumpStart - ahead) / (jumpStart - jumpEnd)));
    const e = 1 - Math.pow(1 - k, 3);
    const lift = Math.sin(k * Math.PI) * 0.35;
    out.set(final.x * (0.35 + 0.65 * e), 0.55 + (final.y - 0.55) * e + lift, z);
    return out;
  }

  /** The scene pose of a saber for a reach sample. */
  private saberPose(side: "L" | "R", r: { u: number; v: number; fx: number; fy: number; flen: number }) {
    const hilt = new T.Vector3(r.u * MAP.gx, MAP.y0 + r.v * MAP.gy, MAP.z);
    // blade grows along the forearm; a foreshortened forearm (pointing at
    // the camera) hands over to a relaxed up-and-forward hold
    const w = Math.max(0, Math.min(1, (r.flen - 0.25) / 0.45));
    const rest = side === "L" ? -0.25 : 0.25;
    const dx = r.fx * w + rest * (1 - w),
      dy = r.fy * w + 0.9 * (1 - w);
    const dir = new T.Vector3(dx, dy, -0.55).normalize();
    return { hilt, dir };
  }

  private screen(v: T.Vector3): [number, number] {
    const p = this.stage.project(v);
    return [p.x * this.stage.camera.aspect, p.y];
  }

  // ---- frame -------------------------------------------------------------

  protected step(dt: number, t: number, input: MotionState) {
    const track = this.music.track;
    this.beat = this.music.beat(t);
    let sec: "intro" | "verse" | "chorus" | "bridge" | "outro" = "intro";
    for (const x of track.sections) if (this.beat >= x.beat) sec = x.kind;
    this.world.section = sec;
    this.world.update(t, this.config.reducedMotion);
    this.reach.update();
    if (input.fresh) this.freshAt = t;
    for (const side of ["L", "R"] as const) this.updateSaber(side, t, dt, input);
    if (input.fresh || !this.options.cameraOk) this.testCuts(t);
    this.updateNotes(t);
    this.updateHalves(dt);
    this.updateSlashes(t);
    this.clash(t);
    this.updateUi();
    // camera: gentle drift and a kick on every cut
    this.shake = Math.max(0, this.shake - dt * 4.5);
    const cam = this.stage.camera;
    const reduced = this.config.reducedMotion;
    const jit = reduced ? 0 : this.shake;
    cam.position.set((reduced ? 0 : Math.sin(t * 0.35) * 0.04) + (Math.random() - 0.5) * jit * 0.045, CAM.y + (Math.random() - 0.5) * jit * 0.035, CAM.z);
    cam.lookAt(0, CAM.lookY, CAM.lookZ);
  }

  private updateSaber(side: "L" | "R", t: number, dt: number, input: MotionState) {
    const s = this.sabers[side];
    let pose: { hilt: T.Vector3; dir: T.Vector3 } | null = null;
    if (this.options.cameraOk) {
      const r = this.reach.hand(side, true);
      const visible = !!r && r.vis > 0.45;
      if (visible && r) {
        // between camera frames, carry the hand along its velocity
        const k = Math.min(0.045, Math.max(0, t - this.freshAt));
        pose = this.saberPose(side, { ...r, u: r.u + r.du * k, v: r.v + r.dv * k });
        s.speed = r.speed;
      }
      if (input.fresh) {
        const raw = r && r.vis > 0.45 ? this.saberPose(side, r) : null;
        s.prev = s.cur;
        s.cur = raw ? { h: this.screen(raw.hilt), t: this.screen(raw.hilt.clone().addScaledVector(raw.dir, MAP.blade)), at: t } : null;
        if (!raw) s.prev = null;
      }
    } else {
      pose = this.demoPose(side, t);
      s.speed = 3;
      s.prev = s.cur;
      s.cur = { h: this.screen(pose.hilt), t: this.screen(pose.hilt.clone().addScaledVector(pose.dir, MAP.blade)), at: t };
    }
    s.g.visible = !!pose;
    s.trail.mesh.visible = !!pose;
    if (!pose) {
      if (s.seen) s.trail.clear();
      s.seen = false;
      sfx.saberHum(side, 0);
      return;
    }
    const k = s.seen ? 1 - Math.exp(-dt * 38) : 1;
    s.hilt.lerp(pose.hilt, k);
    s.dir.lerp(pose.dir, k).normalize();
    s.seen = true;
    s.q.setFromUnitVectors(new T.Vector3(0, 1, 0), s.dir);
    s.g.position.copy(s.hilt);
    s.g.quaternion.copy(s.q);
    const tip = s.hilt.clone().addScaledVector(s.dir, MAP.blade + 0.06);
    s.trail.push(s.hilt.clone().addScaledVector(s.dir, MAP.blade * 0.45), tip);
    const hot = Math.min(1, s.speed / 3);
    (s.glow.material as T.ShaderMaterial).uniforms.uK.value = 0.75 + this.show.pulse * 0.2 + hot * 0.3;
    s.flare.intensity = 1 + hot * 1.2;
    sfx.saberHum(side, Math.min(1, s.speed / 4));
    if (s.speed > 3.2 && t - s.lastWhoosh > 0.35) {
      s.lastWhoosh = t;
      sfx.whoosh();
    }
  }

  /** Demo autopilot: each blade winds up and cuts its next note on time. */
  private demoPose(side: "L" | "R", t: number) {
    const beat = this.music.beat(t);
    const next = this.notes.find((n) => n.hand === side && n.kind === "note" && n.state === "live" && n.beat > beat - 0.15);
    const restU = side === "L" ? -0.45 : 0.45;
    let u = restU,
      v = -0.2,
      fx = side === "L" ? -0.2 : 0.2,
      fy = 1;
    if (next) {
      const lane = this.lane(next);
      const tu = lane.x / MAP.gx,
        tv = (lane.y - MAP.y0) / MAP.gy;
      const d = (next.beat - beat) * this.spb; // seconds until arrival
      const [cx, cy] = CUT_VEC[next.dir].map((c) => c) as [number, number];
      const vx = cx || 0,
        vy = -(cy || 1);
      // swing through the lane: start behind the cut, pass it at arrival
      const k = Math.max(-1, Math.min(1, -d / 0.16));
      const reachBack = 0.65;
      u = tu - vx * reachBack * -k * 0.8 - vx * 0.2;
      v = tv - vy * reachBack * -k * 0.8 - 0.55;
      fx = vx * 0.3 + (side === "L" ? -0.1 : 0.1);
      fy = 1;
      if (d > 0.5) {
        u = restU * 0.5 + tu * 0.5;
        v = -0.35;
      }
    }
    return this.saberPose(side, { u, v, fx, fy, flen: 1 });
  }

  private testCuts(t: number) {
    const beatNow = this.music.beat(t - (this.options.cameraOk ? LAG : 0));
    const window = this.config.difficulty === "flow" ? 0.3 : this.config.difficulty === "athlete" ? 0.26 : 0.22;
    const minSpeed = this.options.cameraOk ? 0.55 : 0; // screen heights per second at the tip
    for (const side of ["L", "R"] as const) {
      const s = this.sabers[side];
      if (!s.prev || !s.cur || !s.seen) continue;
      const dtF = Math.max(1 / 90, s.cur.at - s.prev.at);
      const tipV: [number, number] = [(s.cur.t[0] - s.prev.t[0]) / dtF, (s.cur.t[1] - s.prev.t[1]) / dtF];
      const midV: [number, number] = [
        ((s.cur.t[0] + s.cur.h[0]) / 2 - (s.prev.t[0] + s.prev.h[0]) / 2) / dtF,
        ((s.cur.t[1] + s.cur.h[1]) / 2 - (s.prev.t[1] + s.prev.h[1]) / 2) / dtF,
      ];
      const tipSpeed = Math.hypot(tipV[0], tipV[1]);
      if (tipSpeed < minSpeed) continue;
      // the cut's direction is the hand's motion; the tip also turns with the
      // forearm, so it only helps when the fist itself barely moved
      const hiltV: [number, number] = [(s.cur.h[0] - s.prev.h[0]) / dtF, (s.cur.h[1] - s.prev.h[1]) / dtF];
      const hs = Math.hypot(hiltV[0], hiltV[1]);
      const wTip = hs > 0.35 ? 0.15 : 0.6;
      const swing = hiltV[0] * (1 - wTip) + midV[0] * wTip,
        swingY = hiltV[1] * (1 - wTip) + midV[1] * wTip;
      const sl = Math.hypot(swing, swingY) || 1;
      const sd: [number, number] = [swing / sl, swingY / sl];
      for (const n of this.notes) {
        if (n.state !== "live") continue;
        const ahead = (n.beat - beatNow) * this.spb;
        if (ahead > window) break;
        if (ahead < -window) continue;
        if (n.kind === "note" && n.hand !== side) continue;
        const p = this.notePos(n, Math.max(-0.4, ahead));
        const c = this.screen(p);
        // generous: the block's projected half-size plus a margin
        const edge = this.screen(p.clone().add(new T.Vector3(BLOCK / 2, 0, 0)));
        const r = Math.abs(edge[0] - c[0]) * (n.kind === "bomb" ? 0.95 : 1.45) + 0.012;
        const res = sweepHits(s.prev.h, s.prev.t, s.cur.t, s.cur.h, c, r);
        if (!res.hit) continue;
        if (n.kind === "bomb") {
          this.explode(n, t);
          continue;
        }
        const want = CUT_VEC[n.dir];
        const dirOk = n.dir === 8 ? 1 : sd[0] * want[0] + sd[1] * want[1];
        // a wind-up often brushes the block the wrong way before the real
        // swing; until the block arrives, only a cut the right way counts
        if (dirOk < 0.3 && ahead > -0.03) continue;
        this.cutLog.push({ dir: n.dir, sd: [+sd[0].toFixed(2), +sd[1].toFixed(2)], dot: +dirOk.toFixed(2), ahead: +ahead.toFixed(3) });
        if (this.cutLog.length > 12) this.cutLog.shift();
        this.cut(n, t, { dirDot: dirOk, timing: Math.abs(ahead) / window, center: res.dist / r, speed: tipSpeed, swing: sd });
      }
    }
  }

  private cut(n: Note, t: number, q: { dirDot: number; timing: number; center: number; speed: number; swing: [number, number] }) {
    const diff = this.config.difficulty;
    const good = q.dirDot >= 0.3;
    n.state = "cut";
    const at = this.notePos(n, (n.beat - this.music.beat(t)) * this.spb);
    this.splitNote(n, at, q.swing);
    this.flashSlash(at, q.swing, HAND_COLOR[n.hand]);
    if (!good && diff !== "flow") {
      // wrong way: the block breaks but it counts against you
      this.counts.bad++;
      this.popup(at, "BAD CUT", "bad");
      this.breakCombo(0.1);
      sfx.crack();
      return;
    }
    const swingQ = Math.min(1, 0.45 + q.speed / 3.2) * (good ? Math.min(1, 0.72 + q.dirDot * 0.3) : 0.55);
    const timingQ = 1 - Math.min(1, q.timing) * 0.6;
    const centerQ = 1 - Math.min(1, q.center) * 0.7;
    const points = Math.round(115 * Math.min(1, swingQ * 0.62 + timingQ * 0.25 + centerQ * 0.13 + 0.02));
    const tier: Judged = points >= 105 ? "perfect" : points >= 90 ? "great" : "good";
    this.counts[tier]++;
    this.cutScores.push(points);
    this.award(points, tier);
    this.popup(at, String(points), tier);
    this.energy = Math.min(1, this.energy + 0.012);
    this.world.cut(n.hand, points / 115);
    this.world.sparks.emit(at, HAND_COLOR[n.hand], 52, 7.5, 0.7, new T.Vector3(q.swing[0], -q.swing[1], 0).multiplyScalar(0.7));
    this.world.sparks.emit(at, 0xffffff, 18, 4.5, 0.4);
    this.shake = Math.min(1, this.shake + 0.35);
    sfx.slice(this.combo);
  }

  private award(points: number, tier: Judged) {
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += points * this.mult;
    // Beat Saber multiplier: 2 hits to x2, 4 more to x4, 8 more to x8
    this.multProgress++;
    const need = this.mult * 2;
    if (this.mult < 8 && this.multProgress >= need) {
      this.mult *= 2;
      this.multProgress = 0;
      this.ui.mult.parentElement!.classList.remove("bump");
      void this.ui.mult.parentElement!.offsetWidth;
      this.ui.mult.parentElement!.classList.add("bump");
      if (this.mult === 8) sfx.pop(6);
    }
    this.show.hit(tier === "perfect" ? 1 : tier === "great" ? 0.8 : 0.55);
  }

  private breakCombo(energyLoss: number) {
    this.misses++;
    this.combo = 0;
    this.mult = Math.max(1, this.mult / 2);
    this.multProgress = 0;
    this.show.miss();
    this.energy -= energyLoss;
    if (this.energy <= 0) {
      if (this.config.difficulty === "flow" || !this.options.cameraOk) this.energy = 0.02;
      else this.fail();
    }
  }

  private fail() {
    if (this.failed) return;
    this.failed = true;
    this.judge("LEVEL FAILED", false);
    window.setTimeout(() => this.finish(), 900);
  }

  private explode(n: Note, t: number) {
    n.state = "bombed";
    const at = this.notePos(n, (n.beat - this.music.beat(t)) * this.spb);
    if (n.obj) n.obj.visible = false;
    this.world.sparks.emit(at, 0xff3040, 90, 9, 0.9);
    this.world.sparks.emit(at, 0xffc080, 40, 5, 0.6);
    this.popup(at, "BOMB", "miss");
    this.world.miss();
    this.shake = 1;
    sfx.bomb();
    this.counts.miss++;
    this.breakCombo(0.15);
  }

  private splitNote(n: Note, at: T.Vector3, swing: [number, number]) {
    if (n.obj) n.obj.visible = false;
    // the cut plane runs along the swing; halves fly apart across it
    const sx = swing[0],
      sy = -swing[1];
    const ang = Math.atan2(sy, sx) + Math.PI / 2;
    const across = new T.Vector3(Math.cos(ang), Math.sin(ang), 0);
    const along = new T.Vector3(sx, sy, 0);
    for (const s of [-1, 1]) {
      const h = this.halves.find((x) => !x.live) ?? this.halves[0];
      h.live = true;
      h.age = 0;
      const body = h.mesh.children[0] as T.Mesh;
      body.material = this.materials[n.hand];
      h.mesh.visible = true;
      h.mesh.position.copy(at);
      h.mesh.rotation.set(0, 0, ang);
      if (s < 0) h.mesh.rotateZ(Math.PI);
      h.vel.copy(across).multiplyScalar(s * 1.6).addScaledVector(along, 1.2).add(new T.Vector3(0, 0.6, 1.2 + Math.random() * 0.6));
      h.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, s * (2 + Math.random() * 3));
      h.mesh.scale.setScalar(1);
    }
  }

  private flashSlash(at: T.Vector3, swing: [number, number], color: number) {
    const mesh = new T.Mesh(
      new T.PlaneGeometry(1.9, 0.06),
      new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).lerp(new T.Color(color), 0.35).multiplyScalar(2.2), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    );
    mesh.position.copy(at);
    mesh.position.z += BLOCK / 2 + 0.02;
    mesh.rotation.z = Math.atan2(-swing[1], swing[0]);
    this.stage.scene.add(mesh);
    this.slashes.push({ mesh, t: this.elapsed });
  }

  private updateNotes(t: number) {
    const beat = this.music.beat(t);
    const tmp = new T.Vector3();
    for (const n of this.notes) {
      const ahead = (n.beat - beat) * this.spb;
      if (ahead > this.lead + 0.1) break;
      if (n.state !== "live") {
        if (n.obj && n.obj.visible) n.obj.visible = false;
        continue;
      }
      if (!n.obj) n.obj = this.makeNoteObject(n);
      if (ahead < -0.45) {
        n.state = "missed";
        n.obj.visible = false;
        if (n.kind === "note") {
          this.counts.miss++;
          this.popup(this.notePos(n, 0), "MISS", "miss");
          this.world.miss();
          this.breakCombo(0.12);
        }
        continue;
      }
      n.obj.visible = true;
      this.notePos(n, ahead, tmp);
      n.obj.position.copy(tmp);
      const late = Math.max(0, Math.min(1, (-ahead - 0.1) / 0.3));
      // spin into their final angle while they fly in
      const k = Math.max(0, Math.min(1, (this.lead * 0.62 - ahead) / (this.lead * 0.3)));
      const e = 1 - Math.pow(1 - k, 3);
      n.obj.rotation.set((1 - e) * 1.2, (1 - e) * (n.seed - 0.5) * 3, (1 - e) * (n.seed - 0.5) * 4);
      const near = Math.max(0, 1 - Math.abs(ahead) * 3);
      n.obj.scale.setScalar((1 + near * this.show.pulse * 0.06) * (1 - late * 0.6));
      if (n.kind === "bomb") n.obj.rotation.y += t * 1.5;
    }
    // free objects of notes long gone
    for (const n of this.notes) {
      if (n.obj && n.state !== "live" && (n.beat - beat) * this.spb < -1.5) {
        n.obj.removeFromParent();
        n.obj = null;
      }
    }
  }

  private updateHalves(dt: number) {
    for (const h of this.halves) {
      if (!h.live) continue;
      h.age += dt;
      h.vel.y -= 5.5 * dt;
      h.mesh.position.addScaledVector(h.vel, dt);
      h.mesh.rotation.x += h.spin.x * dt;
      h.mesh.rotation.y += h.spin.y * dt;
      h.mesh.rotation.z += h.spin.z * dt;
      const fade = Math.max(0, 1 - Math.max(0, h.age - 0.45) / 0.35);
      h.mesh.scale.setScalar(Math.max(0.01, fade));
      (h.mesh.children[1] as T.Mesh).visible = h.age < 0.35;
      if (h.age > 0.8) {
        h.live = false;
        h.mesh.visible = false;
      }
    }
  }

  private updateSlashes(t: number) {
    this.slashes = this.slashes.filter((r) => {
      const age = t - r.t;
      if (age > 0.2) {
        r.mesh.removeFromParent();
        r.mesh.geometry.dispose();
        (r.mesh.material as T.Material).dispose();
        return false;
      }
      r.mesh.scale.set(1 + age * 3, Math.max(0.05, 1 - age * 4), 1);
      (r.mesh.material as T.MeshBasicMaterial).opacity = 1 - age / 0.2;
      return true;
    });
  }

  /** Blades crossing each other throw sparks. */
  private clash(t: number) {
    const a = this.sabers.L,
      b = this.sabers.R;
    if (!a.seen || !b.seen || t - this.clashAt < 0.25 || a.speed + b.speed < 2.5) return;
    const p1 = a.hilt,
      p2 = a.hilt.clone().addScaledVector(a.dir, MAP.blade);
    const q1 = b.hilt,
      q2 = b.hilt.clone().addScaledVector(b.dir, MAP.blade);
    const d1 = p2.clone().sub(p1),
      d2 = q2.clone().sub(q1),
      r = p1.clone().sub(q1);
    const aa = d1.dot(d1),
      e = d2.dot(d2),
      f = d2.dot(r),
      c = d1.dot(r),
      bb = d1.dot(d2);
    const den = aa * e - bb * bb;
    if (den < 1e-6) return;
    const s = Math.max(0, Math.min(1, (bb * f - c * e) / den));
    const u = Math.max(0, Math.min(1, (bb * s + f) / e));
    const pa = p1.clone().addScaledVector(d1, s),
      pb = q1.clone().addScaledVector(d2, u);
    if (pa.distanceTo(pb) > 0.06) return;
    this.clashAt = t;
    this.world.sparks.emit(pa.lerp(pb, 0.5), 0xffffff, 40, 5, 0.5);
    sfx.crack();
  }

  private popup(at: T.Vector3, text: string, tier: Judged) {
    const p = this.stage.project(at);
    const el = this.ui.pops[this.ui.popAt++ % this.ui.pops.length];
    el.textContent = text;
    el.dataset.tier = tier;
    el.style.left = `${(p.x * 100).toFixed(2)}%`;
    el.style.top = `${(p.y * 100).toFixed(2)}%`;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
  }

  private updateUi() {
    this.ui.mult.textContent = `×${this.mult}`;
    const need = this.mult >= 8 ? 1 : this.mult * 2;
    const frac = this.mult >= 8 ? 1 : this.multProgress / need;
    this.ui.ring.style.strokeDashoffset = String(176 * (1 - frac));
    this.ui.energy.style.transform = `scaleX(${Math.max(0, Math.min(1, this.energy)).toFixed(3)})`;
    this.ui.energy.parentElement!.classList.toggle("low", this.energy < 0.25);
  }

  protected hint() {
    return "";
  }

  protected resultDetails() {
    const total = this.counts.perfect + this.counts.great + this.counts.good + this.counts.bad + this.counts.miss;
    const avg = this.cutScores.length ? this.cutScores.reduce((a, b) => a + b, 0) / this.cutScores.length : 0;
    const acc = total ? (this.cutScores.reduce((a, b) => a + b, 0) / (total * 115)) * 100 : 0;
    const rank = acc >= 90 ? "SS" : acc >= 80 ? "S" : acc >= 65 ? "A" : acc >= 50 ? "B" : acc >= 35 ? "C" : "D";
    return [
      { label: "RANK", value: this.failed ? "FAILED" : rank },
      { label: "AVERAGE CUT", value: String(Math.round(avg)) },
      { label: "PERFECT · GREAT · GOOD", value: `${this.counts.perfect} · ${this.counts.great} · ${this.counts.good}` },
    ];
  }

  protected diagnostics() {
    return {
      beat: this.beat,
      notes: this.notes.length,
      liveNotes: this.notes.filter((n) => n.obj?.visible).length,
      track: this.music.track.id,
      counts: this.counts,
      energy: this.energy,
      mult: this.mult,
      armLen: this.reach.armLen,
      cutLog: this.cutLog,
    };
  }

  /** Dev and QA: what a bot player needs to see. */
  botView() {
    const beat = this.music.beat(this.elapsed);
    return {
      game: "blade",
      beat,
      spb: this.spb,
      now: performance.now(),
      map: MAP,
      notes: this.notes
        .filter((n) => n.state === "live" && n.beat > beat - 0.5 && n.beat < beat + 8)
        .map((n) => ({ id: n.id, beat: n.beat, hand: n.hand, kind: n.kind, dir: n.dir, x: GRID_X[n.col], y: GRID_Y[n.row], at: performance.now() + (n.beat - beat) * this.spb * 1000 })),
    };
  }

  stop() {
    sfx.saberHumStop();
    super.stop();
  }
}
