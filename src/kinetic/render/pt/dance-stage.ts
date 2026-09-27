import * as T from "three";
import type { Stage } from "../stage";
import { PT, neon, softDot, alphaSafe, seeded } from "./palette";
import { Confetti, Sparks, Lasers, glossFloor } from "./fx";
import type { ShowDirector } from "./show";

/**
 * Dance Main Stage, built around the coach: a giant LED wall of beat-synced
 * graphics, a truss of moving heads and floor uplights that change looks on
 * every bar, a follow spot and colored rims on Nova, a black mirror floor,
 * and confetti, sparks and lasers for the big moments.
 */

export type SectionKind = "intro" | "verse" | "chorus" | "bridge" | "outro";

/** Section palettes: [A, B]. The show brightens them with hype. */
const PALETTES: Record<SectionKind, [number, number]> = {
  intro: [0x4a3bff, 0x16c8ff],
  verse: [0x9a5cff, 0x2fd8ff],
  chorus: [0xff2e9a, 0xffb52e],
  bridge: [0x22f0c0, 0x3a62ff],
  outro: [0xffb52e, 0xff2e9a],
};
/** LED wall graphics per section, cycled every 8 bars inside a section. */
const WALL_MODES: Record<SectionKind, number[]> = {
  intro: [3, 5],
  verse: [2, 4, 5],
  chorus: [0, 1, 6],
  bridge: [3, 2],
  outro: [0, 1],
};

const VERT_UV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Concert LED wall with procedural motion graphics. */
export class ShowWall {
  readonly mesh: T.Mesh;
  readonly material: T.ShaderMaterial;
  private mode = 0;
  private hole?: T.ShaderMaterial;
  constructor(parent: T.Object3D, o: { width: number; height: number; position: T.Vector3; curve?: number; cells?: number }) {
    const cells = o.cells ?? 150;
    this.material = new T.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uBar: { value: 0 },
        uHype: { value: 0.2 },
        uA: { value: new T.Color(PT.magenta) },
        uB: { value: new T.Color(PT.cyan) },
        uMode: { value: 0 },
        uFlash: { value: 0 },
        uCells: { value: new T.Vector2(cells * (o.width / o.height), cells) },
        uAspect: { value: o.width / o.height },
        uBright: { value: 1 },
      },
      vertexShader: VERT_UV,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime, uBeat, uPulse, uBar, uHype, uMode, uFlash, uAspect, uBright;
        uniform vec3 uA, uB; uniform vec2 uCells;
        #define PI 3.14159265
        float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 pal(float t){ return mix(uA, uB, 0.5 + 0.5 * sin(t)); }
        // 0 sunburst
        vec3 burst(vec2 p){
          float a = atan(p.y, p.x), r = length(p);
          float rays = step(0.5, fract(a / (2.0 * PI) * 14.0 + uTime * 0.05 + uBeat * 0.0));
          vec3 c = mix(uA * 0.55, uB * 0.9, rays) * smoothstep(1.6, 0.1, r);
          float ring = fract(r * 1.2 - fract(uBeat));
          c += uB * smoothstep(0.06, 0.0, abs(ring - 0.5)) * (0.6 + uPulse);
          // a glowing star-shaped core instead of a flat disc
          float star = 0.2 + 0.05 * cos(a * 5.0 + uTime * 0.8) + uPulse * 0.04;
          float core = smoothstep(star + 0.01, star - 0.01, r);
          float halo = smoothstep(0.55, 0.0, r) * (0.35 + 0.4 * uPulse);
          c += mix(uB, vec3(1.0), 0.35) * halo;
          c = mix(c, mix(vec3(1.0, 0.97, 0.9), uB, 0.45), core);
          return c;
        }
        // 1 tunnel of rounded frames rushing outward on the beat
        vec3 tunnel(vec2 p){
          float d = max(abs(p.x) * 0.62, abs(p.y));
          float z = 0.35 / max(d, 0.02);
          float band = fract(z - uBeat * 0.5);
          float line = smoothstep(0.08, 0.0, abs(band - 0.5) - 0.18);
          vec3 c = mix(uA, uB, step(0.5, fract(z * 0.5 - uBeat * 0.25))) * line;
          c *= smoothstep(0.02, 0.35, d);
          c += mix(uB, vec3(1.0), 0.5) * smoothstep(0.12, 0.0, d) * (0.8 + uPulse);
          return c * (0.75 + 0.5 * uPulse);
        }
        // 2 flowing ribbons
        vec3 waves(vec2 p){
          vec3 c = vec3(0.0);
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float y = sin(p.x * (1.4 + fi * 0.35) + uTime * (0.6 + fi * 0.13) + fi * 1.7) * (0.25 + 0.06 * fi) + (fi - 2.0) * 0.18;
            float w = smoothstep(0.075, 0.0, abs(p.y - y));
            c += mix(uA, uB, fi / 4.0) * w * (0.6 + 0.4 * sin(uBeat * PI + fi));
          }
          return c + uA * 0.06;
        }
        // 3 synthwave horizon
        vec3 horizon(vec2 p){
          vec3 c = mix(uA * 0.12, uB * 0.05, smoothstep(-0.1, 0.9, p.y));
          vec2 s = p - vec2(0.0, 0.18);
          float sun = smoothstep(0.42, 0.41, length(s));
          float stripes = step(0.35, fract((s.y + 0.5) * 9.0 - uTime * 0.3)) + step(0.1, s.y);
          c = mix(c, mix(uB, vec3(1.0, 0.85, 0.5), clamp(s.y * 2.0 + 0.6, 0.0, 1.0)), sun * clamp(stripes, 0.0, 1.0));
          if (p.y < 0.0) {
            float z = 0.18 / (-p.y + 0.02);
            float gx = abs(fract(p.x * z * 0.9) - 0.5), gz = abs(fract(z - uBeat * 0.5) - 0.5);
            float grid = smoothstep(0.06 * z, 0.0, gx / z * 4.0) + smoothstep(0.05, 0.0, gz);
            c = uA * 0.05 + uA * clamp(grid, 0.0, 1.0) * smoothstep(0.0, 0.25, -p.y) * (1.0 + uPulse);
          }
          return c;
        }
        // 4 spectrum bars mirrored from the middle
        vec3 eq(vec2 p){
          float n = 42.0; float bx = floor((p.x / uAspect + 0.5) * n);
          float lvl = 0.12 + 0.6 * h1(bx + floor(uBeat * 2.0) * 13.0) * (0.55 + 0.45 * uPulse) + 0.12 * sin(bx * 0.5 + uTime * 2.0);
          float on = step(abs(p.y), lvl * 0.5);
          float seg = step(0.3, fract(p.y * 26.0));
          return mix(uB, uA, abs(p.y) / max(lvl * 0.5, 0.01)) * on * seg * 1.1;
        }
        // 5 warp starfield
        vec3 stars(vec2 p){
          vec3 c = uA * 0.04;
          float a = atan(p.y, p.x), r = length(p);
          float lane = floor(a / (2.0 * PI) * 90.0);
          float sp = h1(lane) * 0.8 + 0.2;
          float z = fract(r * 0.6 - uTime * 0.35 * sp - h1(lane * 7.1));
          float streak = smoothstep(0.0, 0.02, z) * smoothstep(0.12, 0.02, z) * step(0.55, h1(lane * 3.3));
          c += mix(uB, vec3(1.0), 0.4) * streak * r * 1.4;
          return c;
        }
        // 6 disco checker
        vec3 checker(vec2 p){
          vec2 g = floor(p * vec2(7.0, 7.0));
          float on = step(0.45, h2(g + floor(uBeat) * 3.7));
          vec3 c = mix(uA, uB, step(0.5, h2(g + 1.3 + floor(uBeat * 0.5)))) * on;
          vec2 f = abs(fract(p * 7.0) - 0.5);
          c *= smoothstep(0.5, 0.42, max(f.x, f.y));
          return c * (0.7 + 0.6 * uPulse);
        }
        void main(){
          vec2 id = mix((floor(vUv * uCells) + 0.5) / uCells, vUv, 0.75);
          vec2 p = vec2((id.x - 0.5) * uAspect, id.y - 0.5) * 2.0;
          vec3 c;
          if (uMode < 0.5) c = burst(p);
          else if (uMode < 1.5) c = tunnel(p);
          else if (uMode < 2.5) c = waves(p);
          else if (uMode < 3.5) c = horizon(p);
          else if (uMode < 4.5) c = eq(p);
          else if (uMode < 5.5) c = stars(p);
          else c = checker(p);
          c *= (0.55 + 0.45 * uHype) * (1.0 + 0.25 * uPulse);
          c += vec3(1.0) * uFlash;
          vec2 cell = fract(vUv * uCells) - 0.5;
          float dotm = smoothstep(0.62, 0.28, length(cell));
          float edge = smoothstep(0.0, 0.012, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          gl_FragColor = vec4(c * mix(0.62, 1.0, dotm) * uBright * edge, 1.0);
        }`,
    });
    let geo: T.BufferGeometry;
    const curve = o.curve ?? 0;
    if (curve > 0) {
      const radius = o.width / curve;
      geo = new T.CylinderGeometry(radius, radius, o.height, 72, 1, true, Math.PI - curve / 2, curve);
      const uv = geo.attributes.uv as T.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      geo.translate(0, 0, radius);
      this.material.side = T.BackSide;
    } else geo = new T.PlaneGeometry(o.width, o.height);
    this.mesh = new T.Mesh(geo, this.material);
    this.mesh.position.copy(o.position);
    parent.add(this.mesh);
  }
  setMode(m: number) {
    this.mode = m;
    this.material.uniforms.uMode.value = m;
  }
  get modeIndex() {
    return this.mode;
  }
  /** Transparent window onto a music video playing behind the canvas. */
  videoMode() {
    this.hole = new T.ShaderMaterial({
      blending: T.NoBlending,
      side: this.material.side,
      fog: false,
      uniforms: { uCells: this.material.uniforms.uCells, uPulse: { value: 0 } },
      vertexShader: VERT_UV,
      fragmentShader: `varying vec2 vUv; uniform vec2 uCells; uniform float uPulse;
        void main(){
          vec2 cell = fract(vUv * uCells) - 0.5;
          float led = smoothstep(0.62, 0.2, length(cell));
          float edge = smoothstep(0.0, 0.02, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          float a = mix(0.45, 0.08, led) - uPulse * 0.05;
          gl_FragColor = vec4(0.0, 0.0, 0.0, mix(1.0, a, edge));
        }`,
    });
    this.mesh.material = this.hole;
  }
  update(t: number, show: ShowDirector, a: T.Color, b: T.Color, flash: number) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uBeat.value = Math.max(0, show.beat);
    u.uPulse.value = show.pulse;
    u.uBar.value = show.barPulse;
    u.uHype.value = show.hype;
    u.uFlash.value = flash;
    (u.uA.value as T.Color).copy(a);
    (u.uB.value as T.Color).copy(b);
    if (this.hole) this.hole.uniforms.uPulse.value = show.pulse;
  }
}

/* -------------------------------------------------------------- beams -- */

const coneGeo = (() => {
  const g = new T.CylinderGeometry(0.06, 1, 1, 40, 1, true);
  g.translate(0, -0.5, 0);
  return g;
})();

function beamMat() {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new T.Color() }, uK: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vY = -position.y; vP = position; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform vec3 uColor; uniform float uK; uniform float uTime;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fall = pow(clamp(1.0 - vY, 0.0, 1.0), 1.25) * smoothstep(0.0, 0.03, vY);
        float dust = 0.8 + 0.2 * sin(vY * 44.0 - uTime * 2.1 + atan(vP.x, vP.z) * 5.0);
        gl_FragColor = vec4(uColor * edge * fall * dust * uK, 1.0);
      }`,
  });
}

type Look = "fan" | "cross" | "center" | "sweep" | "ballyhoo" | "up";

/**
 * Moving-head fixtures with volumetric beams. Every bar the rig snaps to a
 * new look on the downbeat; within the bar it breathes with the beat.
 */
class BeamRig {
  readonly group = new T.Group();
  private heads: { pivot: T.Group; mat: T.ShaderMaterial; lens: T.Sprite; x: number; i: number; pan: number; tilt: number }[] = [];
  private look: Look = "fan";
  private lastBar = -1;
  private rng = seeded(21);
  constructor(
    parent: T.Object3D,
    private o: { count: number; y: number; z: number; spread: number; length: number; radius: number; floor?: boolean; looks: Look[]; strength: number },
  ) {
    parent.add(this.group);
    const body = new T.MeshStandardMaterial({ color: 0x14111f, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < o.count; i++) {
      const x = (o.count === 1 ? 0 : i / (o.count - 1) - 0.5) * o.spread;
      const pivot = new T.Group();
      pivot.position.set(x, o.y, o.z);
      const housing = new T.Mesh(new T.CylinderGeometry(0.11, 0.14, 0.26, 12), body);
      housing.position.y = o.floor ? -0.12 : 0.1;
      housing.visible = !o.floor;
      pivot.add(housing);
      const mat = beamMat();
      const beam = new T.Mesh(coneGeo, mat);
      beam.scale.set(o.radius, o.length, o.radius);
      beam.frustumCulled = false;
      beam.renderOrder = 4;
      pivot.add(beam);
      const lens = new T.Sprite(new T.SpriteMaterial({ map: softDot(), blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      lens.scale.setScalar(o.floor ? 0.16 : 0.5);
      pivot.add(lens);
      this.group.add(pivot);
      this.heads.push({ pivot, mat, lens, x, i, pan: 0, tilt: 0 });
    }
  }
  /** Beam direction for a look, as (pan about z, tilt about x) from straight down/up. */
  private aim(h: { x: number; i: number }, look: Look, beatInBar: number, t: number): [number, number] {
    const n = this.o.count, k = n === 1 ? 0 : h.i / (n - 1) - 0.5;
    const up = this.o.floor ? -1 : 1;
    switch (look) {
      case "fan":
        return [k * 1.3 * up, 0.35];
      case "cross":
        return [-k * 1.1 * up, 0.25];
      case "center":
        return [-h.x * 0.09 * up, 0.55];
      case "sweep": {
        const s = Math.sin((beatInBar / 4) * Math.PI * 2);
        return [s * 0.7 + k * 0.3, 0.3];
      }
      case "ballyhoo":
        return [Math.sin(t * 1.6 + h.i * 1.3) * 0.6, 0.3 + Math.cos(t * 1.3 + h.i) * 0.25];
      case "up":
        return [k * 0.5, -0.05];
    }
  }
  update(t: number, show: ShowDirector, a: T.Color, b: T.Color, energy: number, flash: number, dt: number) {
    const beat = Math.max(0, show.beat);
    const bar = Math.floor(beat / 4);
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      this.look = this.o.looks[Math.floor(this.rng() * this.o.looks.length)];
    }
    const inBar = beat % 4;
    const chase = energy > 0.7;
    for (const h of this.heads) {
      const [pan, tilt] = this.aim(h, this.look, inBar, t);
      const k = 1 - Math.exp(-dt * 9);
      h.pan += (pan - h.pan) * k;
      h.tilt += (tilt - h.tilt) * k;
      // hang down from the truss (or point up from the floor), then pan/tilt
      h.pivot.rotation.set(this.o.floor ? Math.PI - h.tilt : h.tilt, 0, h.pan, "ZXY");
      const on = chase ? (Math.floor(beat * 2) + h.i) % 2 === 0 : true;
      const col = h.i % 2 ? a : b;
      h.mat.uniforms.uColor.value.copy(col).lerp(new T.Color(1, 1, 1), flash * 0.6);
      h.mat.uniforms.uK.value = this.o.strength * (0.08 + 0.16 * energy + 0.1 * show.pulse + 0.12 * flash) * (on ? 1 : 0.25);
      h.mat.uniforms.uTime.value = t;
      (h.lens.material as T.SpriteMaterial).color.copy(col).multiplyScalar((1.2 + show.pulse * 1.5) * (on ? 1 : 0.3));
    }
  }
}

/* ------------------------------------------------------------- gobo -- */

function goboTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 512;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.5, "rgba(255,255,255,0.4)");
  g.addColorStop(0.72, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 512);
  // a ring of soft light petals around the pool
  c.translate(256, 256);
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < 12; i++) {
    c.save();
    c.rotate((i / 12) * Math.PI * 2);
    const pg = c.createRadialGradient(0, 196, 0, 0, 196, 46);
    pg.addColorStop(0, "rgba(255,255,255,0.35)");
    pg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = pg;
    c.beginPath();
    c.ellipse(0, 196, 22, 46, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------ the set -- */

export interface DanceStageOpts {
  videoWall?: boolean;
  /** Home lobby: no gameplay hooks, gentler show. */
  lobby?: boolean;
}

export function danceStage(stage: Stage, show: ShowDirector, o: DanceStageOpts = {}) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x05030c, 0.028);
  if (!o.videoWall) stage.scene.background = new T.Color(0x030208);

  // Lighting on the coach: a follow spot from the front and two rim spots.
  const scene = stage.scene;
  scene.children.filter((c) => c instanceof T.HemisphereLight).forEach((h) => ((h as T.HemisphereLight).intensity = 0.35));
  if (stage.key) {
    stage.key.intensity = 0.55;
    stage.key.position.set(-2, 7, 6);
  }
  const follow = new T.SpotLight(0xfff0e0, 15, 24, 0.2, 0.6, 1.2);
  follow.position.set(1.2, 8.5, 7.5);
  follow.target.position.set(0, 0.9, 0);
  follow.castShadow = true;
  follow.shadow.mapSize.set(1024, 1024);
  follow.shadow.bias = -0.0004;
  scene.add(follow, follow.target);
  const rimL = new T.SpotLight(PT.cyan, 9, 16, 0.45, 0.6, 1.2);
  rimL.position.set(-3.6, 4.6, -3.2);
  rimL.target.position.set(0, 1.2, 0);
  const rimR = new T.SpotLight(PT.magenta, 9, 16, 0.45, 0.6, 1.2);
  rimR.position.set(3.6, 4.6, -3.2);
  rimR.target.position.set(0, 1.2, 0);
  scene.add(rimL, rimL.target, rimR, rimR.target);

  // Floor: black mirror, a lit pool with a slowly turning gobo, LED rings.
  const mirror = glossFloor(root, new T.CircleGeometry(16, 96), { resolution: 0.4, strength: 0.42, tint: 0x8a84a8, blur: 0.004 });
  mirror.position.y = 0.0;
  const gobo = new T.Mesh(
    new T.CircleGeometry(1.9, 64),
    new T.MeshBasicMaterial({ map: goboTexture(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, color: new T.Color(0xffe8d0).multiplyScalar(0.55) }),
  );
  gobo.rotation.x = -Math.PI / 2;
  gobo.position.set(0, 0.006, 0.05);
  root.add(gobo);
  const ringMats: T.MeshBasicMaterial[] = [];
  [2.4, 3.3, 4.4].forEach((r, i) => {
    const m = neon(i % 2 ? PT.magenta : PT.cyan, 1.0) as T.MeshBasicMaterial;
    ringMats.push(m);
    const ring = new T.Mesh(new T.TorusGeometry(r, 0.02 + i * 0.004, 8, 160), m);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    root.add(ring);
  });
  // stage edge: a thin lit lip across the front
  const lip = new T.Mesh(new T.BoxGeometry(18, 0.05, 0.05), neon(PT.cyan, 1.6));
  lip.position.set(0, 0.02, 4.2);
  root.add(lip);

  // LED wall with a dark frame and two portrait side screens.
  const wall = new ShowWall(root, { width: 17, height: 7.4, position: new T.Vector3(0, 4.25, -7.2), curve: 0.55, cells: 250 });
  if (o.videoWall) wall.videoMode();
  const frameMat = new T.MeshStandardMaterial({ color: 0x0b0914, roughness: 0.5, metalness: 0.7 });
  const frame = new T.Mesh(new T.BoxGeometry(17.8, 0.35, 0.4), frameMat);
  frame.position.set(0, 8.1, -7.3);
  root.add(frame);
  // Truss with moving heads, floor uplights behind the dancer, lasers.
  const truss = new T.Mesh(new T.BoxGeometry(16, 0.3, 0.3), frameMat);
  truss.position.set(0, 6.9, -2.2);
  root.add(truss);
  const heads = new BeamRig(root, { count: 8, y: 6.7, z: -2.2, spread: 13, length: 13, radius: 0.5, looks: ["fan", "cross", "center", "sweep", "ballyhoo"], strength: 1 });
  const ups = new BeamRig(root, { count: 6, y: 0.1, z: -4.8, spread: 12, length: 15, radius: 0.34, floor: true, looks: ["fan", "cross", "up", "sweep"], strength: 0.9 });
  const lasers = new Lasers(root, { emitters: [new T.Vector3(-6.5, 0.4, -5), new T.Vector3(6.5, 0.4, -5)], perEmitter: 7, length: 50, minLevel: 3 });

  // Floating dust in the beams.
  const dustGeo = new T.BufferGeometry();
  const rnd = seeded(8);
  const dust = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) dust.set([(rnd() - 0.5) * 16, rnd() * 7, -6 + rnd() * 9], i * 3);
  dustGeo.setAttribute("position", new T.BufferAttribute(dust, 3));
  const dustMat = new T.PointsMaterial({ size: 0.035, map: softDot(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0x9f8cff, opacity: 0.55, fog: false });
  const dustPts = new T.Points(dustGeo, dustMat);
  root.add(dustPts);

  const confetti = new Confetti(root, { count: 700, area: new T.Box3(new T.Vector3(-7, -0.2, -4), new T.Vector3(7, 8, 3.5)), ambient: 0 });
  const sparks = new Sparks(root, 900, -7);
  const gerbs = [new T.Vector3(-3.2, 0.05, 2.6), new T.Vector3(3.2, 0.05, 2.6), new T.Vector3(-5.6, 0.05, 0.6), new T.Vector3(5.6, 0.05, 0.6)];
  let gerbUntil = 0;

  if (o.videoWall) alphaSafe(root);

  // Show state
  let section: SectionKind = "intro";
  let sectionStart = 0;
  const a = new T.Color(PALETTES.intro[0]), b = new T.Color(PALETTES.intro[1]);
  const ta = a.clone(), tb = b.clone();
  let wallFlash = 0;
  let lastModeKey = "";
  let time = 0;

  return {
    root,
    wall,
    sparks,
    confetti,
    follow,
    get section() {
      return section;
    },
    /** Section changes recolor the show, switch the wall and fire confetti. */
    setSection(kind: SectionKind, startBeat: number) {
      if (kind === section) return;
      section = kind;
      sectionStart = startBeat;
      ta.set(PALETTES[kind][0]);
      tb.set(PALETTES[kind][1]);
      wallFlash = 0.8;
      if (kind === "chorus" && !o.lobby) {
        confetti.burst(260);
        gerbUntil = time + 1.4;
      }
    },
    /** Big moment (gold move, Supernova): pyro, sparks and a white flash. */
    moment(strength = 1) {
      wallFlash = Math.max(wallFlash, 0.9 * strength);
      gerbUntil = time + 1.1 * strength;
      confetti.burst(Math.round(180 * strength), new T.Vector3(0, 0.2, 1.5), 7);
    },
    judged(quality: number, at: T.Vector3) {
      if (quality <= 0) return;
      sparks.emit(at, quality > 0.9 ? PT.gold : quality > 0.7 ? PT.cyan : PT.magenta, Math.round(10 + quality * 26), 3.5, 0.6);
    },
    update(t: number, dt: number, energy: number) {
      time = t;
      const k = 1 - Math.exp(-dt * 2.2);
      a.lerp(ta, k);
      b.lerp(tb, k);
      const beat = Math.max(0, show.beat);
      // wall graphics: new look every 8 bars inside a section
      const modes = WALL_MODES[section];
      const idx = Math.floor(Math.max(0, beat - sectionStart) / 32) % modes.length;
      const key = `${section}:${idx}`;
      if (key !== lastModeKey) {
        lastModeKey = key;
        wall.setMode(modes[idx]);
        wallFlash = Math.max(wallFlash, 0.5);
      }
      wallFlash = Math.max(0, wallFlash - dt * 2.6);
      const hot = a.clone().multiplyScalar(0.9 + show.hype * 0.5);
      const hotB = b.clone().multiplyScalar(0.9 + show.hype * 0.5);
      wall.update(t, show, hot, hotB, wallFlash);
      const e = Math.min(1, energy * 0.6 + (section === "chorus" ? 0.35 : 0) + show.hype * 0.35);
      heads.update(t, show, a, b, e, show.flash + wallFlash * 0.4, dt);
      ups.update(t, show, b, a, e * 0.9, show.flash, dt);
      lasers.update(t, show);
      // lights on the coach follow the palette; the follow spot kicks on the beat
      rimL.color.copy(b);
      rimR.color.copy(a);
      rimL.intensity = rimR.intensity = 7 + 7 * show.pulse * e;
      follow.intensity = 14 + 3 * show.pulse;
      ringMats.forEach((m, i) => m.color.copy(i % 2 ? a : b).multiplyScalar(0.7 + show.pulse * 1.1 * (i === 0 ? 1 : 0.6)));
      gobo.rotation.z = t * 0.15;
      (gobo.material as T.MeshBasicMaterial).color.copy(new T.Color(0xffe8d0).lerp(b, 0.25)).multiplyScalar(0.16 + show.pulse * 0.08);
      dustPts.rotation.y = Math.sin(t * 0.05) * 0.1;
      dustMat.color.copy(b).lerp(new T.Color(1, 1, 1), 0.5);
      if (time < gerbUntil) for (const g of gerbs) sparks.emit(g, 0xffd28a, 5, 6, 0.8, new T.Vector3(0, 1.6, 0));
      confetti.update(dt, t);
      sparks.update(dt);
    },
  };
}
