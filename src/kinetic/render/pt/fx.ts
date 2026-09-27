import * as T from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PT, neon, seeded, softDot, artTexture } from "./palette";
import type { ShowDirector } from "./show";

const VERT_UV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/* ------------------------------------------------------------------ sky -- */

/** Gradient night sky with a faint star field. */
export function skyDome(
  parent: T.Object3D,
  o: { top?: number; horizon?: number; bottom?: number; stars?: number; radius?: number } = {},
) {
  const mat = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new T.Color(o.top ?? 0x0a0520) },
      uHorizon: { value: new T.Color(o.horizon ?? 0x2a0f55) },
      uBottom: { value: new T.Color(o.bottom ?? PT.black) },
      uStars: { value: o.stars ?? 0.8 },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform float uStars; uniform float uTime; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y * 1.6, 0.0, 1.0), 0.7)) : mix(uHorizon, uBottom, clamp(-y * 5.0, 0.0, 1.0));
        vec3 p = floor(vDir * 420.0);
        float s = hash(p);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
        c += vec3(0.9, 0.85, 1.0) * step(0.9975, s) * smoothstep(0.02, 0.3, y) * uStars * tw;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new T.Mesh(new T.SphereGeometry(o.radius ?? 190, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  parent.add(dome);
  return { mesh: dome, update: (t: number) => (mat.uniforms.uTime.value = t) };
}

/* ----------------------------------------------------------- stage light -- */

const beamGeometry = (() => {
  const g = new T.ConeGeometry(1, 1, 36, 1, true);
  g.translate(0, -0.5, 0);
  return g;
})();

function beamMaterial(color: T.Color) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    fog: false,
    uniforms: { uColor: { value: color }, uK: { value: 0.1 }, uTime: { value: 0 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vY = -position.y; vP = position; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform vec3 uColor; uniform float uK; uniform float uTime;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fall = pow(clamp(1.0 - vY, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.04, vY);
        float dust = 0.78 + 0.22 * sin(vY * 38.0 - uTime * 1.7 + atan(vP.x, vP.z) * 3.0);
        gl_FragColor = vec4(uColor * edge * fall * dust * uK, 1.0);
      }`,
  });
}

export interface MovingHeadsOpts {
  count: number;
  from: T.Vector3;
  to: T.Vector3;
  length?: number;
  radius?: number;
  truss?: boolean;
  aim?: T.Vector3;
  strength?: number;
  sweep?: number;
}

/** A truss of moving-head spotlights with volumetric beams. */
export class MovingHeads {
  readonly group = new T.Group();
  private heads: { pivot: T.Group; beam: T.Mesh; lens: T.Sprite; phase: number; base: T.Quaternion; mat: T.ShaderMaterial; color: T.Color }[] = [];
  private sq = new T.Quaternion();
  private se = new T.Euler();
  constructor(parent: T.Object3D, private o: MovingHeadsOpts) {
    parent.add(this.group);
    const len = o.length ?? 14,
      rad = o.radius ?? 0.9;
    const body = new T.MeshStandardMaterial({ color: 0x18142a, roughness: 0.45, metalness: 0.8 });
    const parts: T.BufferGeometry[] = [];
    if (o.truss !== false) {
      const d = o.to.clone().sub(o.from);
      const bar = new T.BoxGeometry(d.length() + 1.2, 0.26, 0.26);
      bar.rotateY(-Math.atan2(d.z, d.x));
      bar.translate((o.from.x + o.to.x) / 2, o.from.y + 0.28, (o.from.z + o.to.z) / 2);
      parts.push(bar);
    }
    for (let i = 0; i < o.count; i++) {
      const k = o.count === 1 ? 0.5 : i / (o.count - 1);
      const p = o.from.clone().lerp(o.to, k);
      const housing = new T.CylinderGeometry(0.17, 0.21, 0.36, 12);
      housing.translate(p.x, p.y, p.z);
      parts.push(housing);
      const pivot = new T.Group();
      pivot.position.copy(p);
      this.group.add(pivot);
      const color = new T.Color(PT.cyan);
      const mat = beamMaterial(color);
      const beam = new T.Mesh(beamGeometry, mat);
      beam.scale.set(rad, len, rad);
      beam.position.y = -0.18;
      beam.renderOrder = 4;
      beam.frustumCulled = false;
      pivot.add(beam);
      const lens = new T.Sprite(
        new T.SpriteMaterial({ map: softDot(), color, blending: T.AdditiveBlending, depthWrite: false, fog: false }),
      );
      lens.scale.setScalar(0.9);
      lens.position.y = -0.2;
      pivot.add(lens);
      const aim = o.aim ?? new T.Vector3(p.x * 0.3, 0, p.z + 4);
      const dir = aim.clone().sub(p).normalize();
      const base = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), dir);
      this.heads.push({ pivot, beam, lens, phase: i * 0.83, base, mat, color });
    }
    if (parts.length) {
      const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
      parts.forEach((g) => g.dispose());
      if (merged) this.group.add(new T.Mesh(merged, body));
    }
  }
  update(t: number, show: ShowDirector) {
    const lvl = show.level,
      sweep = (this.o.sweep ?? 1) * (0.35 + lvl * 0.09),
      speed = 0.45 + lvl * 0.16,
      k = (this.o.strength ?? 1) * (0.05 + 0.05 * show.intensity + 0.05 * show.pulse + 0.06 * show.flash);
    this.heads.forEach((h, i) => {
      const a = t * speed + h.phase;
      this.sq.setFromEuler(this.se.set(Math.cos(a * 0.8) * sweep * 0.6, 0, Math.sin(a) * sweep));
      h.pivot.quaternion.copy(h.base).multiply(this.sq);
      h.color.copy(i % 2 ? show.colorA : show.colorB);
      h.mat.uniforms.uK.value = k;
      h.mat.uniforms.uTime.value = t;
      (h.lens.material as T.SpriteMaterial).color.copy(h.color).multiplyScalar(1.2 + show.pulse * 1.4);
    });
  }
}

/* --------------------------------------------------------------- lasers -- */

/** Fans of thin laser beams that open up from Headliner onward. */
export class Lasers {
  readonly group = new T.Group();
  private beams: { pivot: T.Group; mesh: T.Mesh; i: number; side: number }[] = [];
  private mats: T.MeshBasicMaterial[] = [];
  constructor(parent: T.Object3D, o: { emitters: T.Vector3[]; perEmitter?: number; length?: number; minLevel?: number }) {
    parent.add(this.group);
    this.minLevel = o.minLevel ?? 2;
    const geo = new T.CylinderGeometry(0.012, 0.012, o.length ?? 60, 5, 1, true);
    geo.translate(0, (o.length ?? 60) / 2, 0);
    for (let c = 0; c < 2; c++) {
      const m = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      this.mats.push(m);
    }
    o.emitters.forEach((e, ei) => {
      for (let i = 0; i < (o.perEmitter ?? 6); i++) {
        const pivot = new T.Group();
        pivot.position.copy(e);
        const mesh = new T.Mesh(geo, this.mats[i % 2]);
        mesh.frustumCulled = false;
        pivot.add(mesh);
        this.group.add(pivot);
        this.beams.push({ pivot, mesh, i, side: e.x < 0 ? -1 : 1 });
      }
      void ei;
    });
  }
  private minLevel: number;
  private open = 0;
  update(t: number, show: ShowDirector) {
    const want = show.level >= this.minLevel ? 1 : show.sinceLevel < 1.2 && show.level >= 1 ? 1 : 0;
    this.open += (want - this.open) * 0.06;
    this.group.visible = this.open > 0.02;
    if (!this.group.visible) return;
    this.mats[0].color.copy(show.colorA).multiplyScalar(2.6 * this.open * (0.55 + 0.45 * show.pulse));
    this.mats[1].color.copy(show.colorB).multiplyScalar(2.6 * this.open * (0.55 + 0.45 * show.pulse));
    for (const b of this.beams) {
      const k = b.i;
      b.pivot.rotation.z = b.side * (0.35 + k * 0.17 + Math.sin(t * 1.1 + k) * 0.08) * this.open - b.side * 0.1;
      b.pivot.rotation.x = -1.18 + Math.sin(t * 0.8 + k * 0.6) * 0.1;
    }
  }
}

/* ------------------------------------------------------------- LED wall -- */

export type LedMode = "city" | "rings" | "bars" | "chevrons" | "image";
const LED_MODES: Record<LedMode, number> = { city: 0, rings: 1, bars: 2, chevrons: 3, image: 4 };

/** A dot-matrix LED screen. Content is procedural or a generated plate. */
export class LedWall {
  readonly mesh: T.Mesh;
  readonly material: T.ShaderMaterial;
  constructor(
    parent: T.Object3D,
    o: {
      width: number;
      height: number;
      position: T.Vector3;
      curve?: number;
      grid?: number;
      mode?: LedMode;
      image?: string;
      brightness?: number;
    },
  ) {
    const grid = o.grid ?? 90;
    this.material = new T.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uHype: { value: 0 },
        uA: { value: new T.Color(PT.magenta) },
        uB: { value: new T.Color(PT.cyan) },
        uMode: { value: LED_MODES[o.mode ?? "city"] },
        uGrid: { value: new T.Vector2(grid * (o.width / o.height), grid) },
        uMap: { value: o.image ? artTexture(o.image) : null },
        uHasMap: { value: o.image ? 1 : 0 },
        uBright: { value: o.brightness ?? 1.2 },
        uFlash: { value: 0 },
      },
      vertexShader: VERT_UV,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uBeat; uniform float uPulse; uniform float uHype;
        uniform vec3 uA; uniform vec3 uB; uniform float uMode; uniform vec2 uGrid; uniform sampler2D uMap; uniform float uHasMap;
        uniform float uBright; uniform float uFlash;
        float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
        float sdStar(vec2 p, float r, float rf){
          const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-k1.x, k1.y);
          p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x); p.y -= r;
          vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
          return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
        }
        vec3 city(vec2 id){
          vec3 col = mix(uA, uB * 0.35, smoothstep(0.0, 0.95, id.y));
          float band = fract((id.x * 1.7 - id.y * 1.1) * 2.2 - uTime * 0.25);
          col += smoothstep(0.0, 0.02, band) * smoothstep(0.34, 0.32, band) * uB * 0.5;
          float bx = floor(id.x * 46.0);
          float hgt = 0.22 + 0.5 * h1(bx * 1.7) * (0.55 + 0.45 * h1(bx * 3.1));
          float building = step(id.y, hgt);
          vec2 wv = fract(vec2(id.x * 230.0, id.y * 42.0));
          float lit = step(0.78, h1(floor(id.x * 230.0) * 3.0 + floor(id.y * 42.0) * 17.0 + floor(uTime * 0.6)));
          float win = step(0.3, wv.x) * step(wv.x, 0.8) * step(0.25, wv.y) * step(wv.y, 0.75) * lit;
          vec3 bcol = mix(vec3(0.05, 0.01, 0.16), vec3(0.22, 0.05, 0.42), id.y / max(hgt, 0.01));
          col = mix(col, bcol + win * uB * 0.9, building);
          vec2 c2 = vec2((id.x - 0.5) * 3.2, id.y - 0.55);
          float ang = atan(c2.y, c2.x); float rad = length(c2);
          float rays = smoothstep(0.55, 0.95, 0.5 + 0.5 * cos(ang * 12.0 + uTime * 0.6)) * smoothstep(0.75, 0.05, rad);
          float d = sdStar(c2, 0.2, 0.45);
          col = mix(col, vec3(1.0, 0.8, 0.3), smoothstep(0.006, 0.0, d) * 0.9);
          col += rays * uA * 0.45 + smoothstep(0.03, 0.0, abs(d - 0.012)) * uA;
          return col;
        }
        vec3 rings(vec2 id){
          vec2 c = vec2((id.x - 0.5) * uGrid.x / uGrid.y, id.y - 0.5);
          float r = length(c);
          float w = fract(r * 4.0 - uBeat * 0.5);
          vec3 col = mix(uA, uB, 0.5 + 0.5 * sin(r * 10.0 - uTime));
          col *= smoothstep(0.0, 0.1, w) * smoothstep(0.5, 0.25, w);
          float d = sdStar(c * 1.2, 0.18 + uPulse * 0.03, 0.45);
          col = mix(col * 0.8, vec3(1.0, 0.82, 0.3), smoothstep(0.01, 0.0, d));
          return col;
        }
        vec3 bars(vec2 id){
          float n = 48.0; float bx = floor(id.x * n);
          float hgt = 0.15 + 0.65 * h1(bx + floor(uBeat * 2.0) * 7.0) * (0.5 + 0.5 * uPulse) + 0.1 * sin(bx * 0.4 + uTime * 3.0);
          float on = step(abs(id.y - 0.5) * 2.0, hgt);
          vec3 col = mix(uB, uA, abs(id.y - 0.5) * 2.0 / max(hgt, 0.01));
          return col * on + mix(uA, uB, id.x) * 0.06;
        }
        vec3 chevrons(vec2 id){
          float v = fract(id.x * 6.0 + abs(id.y - 0.5) * 3.0 - uTime * 0.8);
          vec3 col = mix(uA, uB, step(0.5, fract(id.x * 3.0 - uTime * 0.4)));
          return col * smoothstep(0.0, 0.05, v) * smoothstep(0.45, 0.4, v);
        }
        void main(){
          vec2 cell = fract(vUv * uGrid) - 0.5;
          vec2 id = (floor(vUv * uGrid) + 0.5) / uGrid;
          float led = smoothstep(0.55, 0.12, length(cell));
          vec3 col;
          if (uMode < 0.5) col = city(id);
          else if (uMode < 1.5) col = rings(id);
          else if (uMode < 2.5) col = bars(id);
          else if (uMode < 3.5) col = chevrons(id);
          else {
            col = uHasMap > 0.5 ? texture2D(uMap, id).rgb : city(id);
            float sweep = fract(id.x * 0.7 + id.y * 0.3 - uTime * 0.18);
            col += smoothstep(0.0, 0.03, sweep) * smoothstep(0.12, 0.08, sweep) * uB * 0.35;
          }
          col *= 1.0 + 0.35 * uPulse + uFlash * 0.6;
          gl_FragColor = vec4(col * led * uBright, 1.0);
        }`,
    });
    const curve = o.curve ?? 0;
    let geo: T.BufferGeometry;
    if (curve > 0) {
      const radius = o.width / curve;
      geo = new T.CylinderGeometry(radius, radius, o.height, 64, 1, true, Math.PI - curve / 2, curve);
      const uv = geo.attributes.uv as T.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      geo.translate(0, 0, radius);
      this.material.side = T.BackSide;
    } else geo = new T.PlaneGeometry(o.width, o.height);
    this.mesh = new T.Mesh(geo, this.material);
    this.mesh.position.copy(o.position);
    parent.add(this.mesh);
  }
  setMode(mode: LedMode) {
    this.material.uniforms.uMode.value = LED_MODES[mode];
  }
  private hole?: T.ShaderMaterial;
  /**
   * Turn the wall into a window onto a video playing behind a transparent
   * canvas: the wall writes black with an LED-dot alpha pattern, so the
   * video shows through as if on the screen, dimmed between the dots.
   */
  videoMode() {
    this.hole = new T.ShaderMaterial({
      blending: T.NoBlending,
      side: this.material.side,
      fog: false,
      uniforms: { uGrid: this.material.uniforms.uGrid, uPulse: { value: 0 } },
      vertexShader: VERT_UV,
      fragmentShader: `varying vec2 vUv; uniform vec2 uGrid; uniform float uPulse;
        void main(){
          vec2 cell = fract(vUv * uGrid) - 0.5;
          float led = smoothstep(0.62, 0.2, length(cell));
          float edge = smoothstep(0.0, 0.03, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          float a = mix(0.6, 0.22, led) - uPulse * 0.06;
          gl_FragColor = vec4(0.0, 0.0, 0.0, mix(1.0, a, edge));
        }`,
    });
    this.mesh.material = this.hole;
  }
  update(t: number, show: ShowDirector) {
    if (this.hole) this.hole.uniforms.uPulse.value = show.pulse;
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uBeat.value = show.beat;
    u.uPulse.value = show.pulse;
    u.uHype.value = show.hype;
    u.uFlash.value = show.flash * 0.5;
    (u.uA.value as T.Color).copy(show.colorA);
    (u.uB.value as T.Color).copy(show.colorB);
  }
}

/* ---------------------------------------------------------------- crowd -- */

function person(armsUp: boolean) {
  const parts: T.BufferGeometry[] = [];
  const body = new T.CapsuleGeometry(0.2, 0.55, 4, 8);
  body.translate(0, 0.62, 0);
  parts.push(body);
  const head = new T.SphereGeometry(0.13, 10, 8);
  head.translate(0, 1.16, 0);
  parts.push(head);
  for (const s of [-1, 1]) {
    const arm = new T.CapsuleGeometry(0.055, 0.5, 3, 5);
    if (armsUp || s === 1) {
      arm.rotateZ(s * -0.35);
      arm.translate(s * 0.26, 1.28, 0);
    } else {
      arm.rotateZ(s * 0.25);
      arm.translate(s * 0.27, 0.66, 0);
    }
    parts.push(arm);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** Instanced audience silhouettes with light sticks, bouncing on the beat. */
export class Crowd {
  readonly group = new T.Group();
  private up: T.InstancedMesh;
  private down: T.InstancedMesh;
  private sticks: T.InstancedMesh;
  private rows: { x: number; y: number; z: number; s: number; up: boolean; ph: number; ry: number }[] = [];
  private m = new T.Matrix4();
  private q = new T.Quaternion();
  private e = new T.Euler();
  private v = new T.Vector3();
  private sc = new T.Vector3();
  private hide = new T.Matrix4().makeScale(0, 0, 0);
  constructor(
    parent: T.Object3D,
    o: {
      count: number;
      area: (r: () => number) => { x: number; y?: number; z: number; ry?: number } | null;
      color?: T.ColorRepresentation;
      seed?: number;
      scale?: number;
    },
  ) {
    parent.add(this.group);
    const rng = seeded(o.seed ?? 11);
    for (let i = 0; i < o.count * 3 && this.rows.length < o.count; i++) {
      const p = o.area(rng);
      if (!p)
        continue;
      this.rows.push({
        x: p.x,
        y: p.y ?? 0,
        z: p.z,
        ry: p.ry ?? 0,
        s: (o.scale ?? 1) * (0.92 + rng() * 0.2),
        up: rng() > 0.4,
        ph: rng() * 6.28,
      });
    }
    const mat = new T.MeshBasicMaterial({ color: o.color ?? 0x05020b, fog: true });
    this.up = new T.InstancedMesh(person(true), mat, this.rows.length);
    this.down = new T.InstancedMesh(person(false), mat, this.rows.length);
    this.sticks = new T.InstancedMesh(
      new T.CylinderGeometry(0.018, 0.018, 0.24, 5),
      new T.MeshBasicMaterial({ fog: false }),
      this.rows.length,
    );
    const cols = [PT.magenta, PT.cyan, PT.gold, PT.violet, 0xffffff];
    this.rows.forEach((_, i) => this.sticks.setColorAt(i, new T.Color(cols[i % cols.length]).multiplyScalar(2.8)));
    for (const im of [this.up, this.down, this.sticks]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
  }
  update(show: ShowDirector) {
    const jumpAmp = 0.03 + show.hype * 0.09;
    this.rows.forEach((r, i) => {
      const jump = Math.max(0, Math.sin(show.beat * Math.PI + r.ph)) * jumpAmp;
      this.q.setFromEuler(this.e.set(0, r.ry, 0));
      this.m.compose(this.v.set(r.x, r.y + jump, r.z), this.q, this.sc.setScalar(r.s));
      this.up.setMatrixAt(i, r.up ? this.m : this.hide);
      this.down.setMatrixAt(i, r.up ? this.hide : this.m);
      const side = r.up ? -0.33 : 0.3;
      const hx = r.x + Math.cos(r.ry) * side * r.s,
        hz = r.z - Math.sin(r.ry) * side * r.s;
      this.q.setFromEuler(this.e.set(0, r.ry, Math.sin(show.beat * Math.PI * 0.5 + r.ph) * 0.5));
      this.m.compose(this.v.set(hx, r.y + jump + (r.up ? 1.62 : 1.5) * r.s, hz), this.q, this.sc.setScalar(r.s));
      this.sticks.setMatrixAt(i, this.m);
    });
    this.up.instanceMatrix.needsUpdate = true;
    this.down.instanceMatrix.needsUpdate = true;
    this.sticks.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------- confetti -- */

/** Falling confetti: a light ambient drift plus bursts on big moments. */
export class Confetti {
  readonly mesh: T.InstancedMesh;
  private p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; rs: number; life: number }[] = [];
  private m = new T.Matrix4();
  private q = new T.Quaternion();
  private e = new T.Euler();
  private v = new T.Vector3();
  private s = new T.Vector3(1, 1, 1);
  private rng = seeded(5);
  private cursor = 0;
  constructor(
    parent: T.Object3D,
    private o: { count?: number; area: T.Box3; ambient?: number },
  ) {
    const n = o.count ?? 500;
    this.mesh = new T.InstancedMesh(
      new T.PlaneGeometry(0.07, 0.035),
      new T.MeshBasicMaterial({ side: T.DoubleSide, fog: false }),
      n,
    );
    const cols = [PT.magenta, PT.cyan, PT.gold, 0xffffff, PT.violet];
    for (let i = 0; i < n; i++) {
      this.mesh.setColorAt(i, new T.Color(cols[i % cols.length]).multiplyScalar(i % 5 === 3 ? 1 : 1.5));
      this.p.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, r: 0, rs: 0, life: 0 });
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    parent.add(this.mesh);
    const a = o.area;
    for (let i = 0; i < n * (o.ambient ?? 0.35); i++) {
      const q = this.p[i];
      q.x = a.min.x + this.rng() * (a.max.x - a.min.x);
      q.y = a.min.y + this.rng() * (a.max.y - a.min.y);
      q.z = a.min.z + this.rng() * (a.max.z - a.min.z);
      q.vy = -(0.35 + this.rng() * 0.45);
      q.life = 1e9;
      q.rs = 1 + this.rng() * 4;
      q.r = this.rng() * 6;
    }
    this.cursor = Math.floor(n * (o.ambient ?? 0.35));
  }
  /** Launch n pieces from a point (cannon) or from the top of the area. */
  burst(n: number, from?: T.Vector3, power = 6) {
    const a = this.o.area;
    const total = this.p.length,
      start = Math.floor(total * (this.o.ambient ?? 0.35));
    for (let i = 0; i < n; i++) {
      const idx = start + (this.cursor++ % (total - start));
      const q = this.p[idx];
      if (from) {
        q.x = from.x;
        q.y = from.y;
        q.z = from.z;
        q.vx = (this.rng() - 0.5) * power * 0.6;
        q.vy = power * (0.6 + this.rng() * 0.6);
        q.vz = (this.rng() - 0.5) * power * 0.5;
      } else {
        q.x = a.min.x + this.rng() * (a.max.x - a.min.x);
        q.y = a.max.y;
        q.z = a.min.z + this.rng() * (a.max.z - a.min.z);
        q.vx = 0;
        q.vy = -(0.6 + this.rng());
        q.vz = 0;
      }
      q.life = 6;
      q.rs = 2 + this.rng() * 6;
      q.r = this.rng() * 6;
    }
  }
  update(dt: number, t: number) {
    const a = this.o.area;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i];
      if (q.life <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      q.life -= dt;
      // drag toward a slow flutter
      q.vx += (-q.vx) * Math.min(1, dt * 1.5);
      q.vz += (-q.vz) * Math.min(1, dt * 1.5);
      q.vy += (-(0.55) - q.vy) * Math.min(1, dt * 1.2);
      q.x += (q.vx + Math.sin(t * 1.3 + i) * 0.25) * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.life > 1e8 && q.y < a.min.y) q.y = a.max.y;
      if (q.life < 1e8 && q.y < a.min.y - 1) q.life = 0;
      this.q.setFromEuler(this.e.set(q.r + t * q.rs, q.r * 0.7 + t * q.rs * 0.6, 0));
      this.m.compose(this.v.set(q.x, q.y, q.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* --------------------------------------------------------------- sparks -- */

/**
 * Hit sparks: velocity-stretched additive streaks with gravity. One draw call
 * for the whole pool; attributes are rewritten each frame on the CPU.
 */
export class Sparks {
  readonly mesh: T.Mesh;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private aPos: T.InstancedBufferAttribute;
  private aVel: T.InstancedBufferAttribute;
  private aCol: T.InstancedBufferAttribute;
  private aLife: T.InstancedBufferAttribute;
  private cursor = 0;
  private rng = seeded(3);
  constructor(parent: T.Object3D, count = 600, private gravity = -6) {
    this.n = count;
    const quad = new T.PlaneGeometry(1, 1);
    const g = new T.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.attributes.position);
    g.setAttribute("uv", quad.attributes.uv);
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.aPos = new T.InstancedBufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage);
    this.aVel = new T.InstancedBufferAttribute(this.vel, 3).setUsage(T.DynamicDrawUsage);
    this.aCol = new T.InstancedBufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage);
    this.aLife = new T.InstancedBufferAttribute(this.life, 1).setUsage(T.DynamicDrawUsage);
    g.setAttribute("iPos", this.aPos);
    g.setAttribute("iVel", this.aVel);
    g.setAttribute("iCol", this.aCol);
    g.setAttribute("iLife", this.aLife);
    g.instanceCount = count;
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      fog: false,
      uniforms: { uSize: { value: 0.035 } },
      vertexShader: `attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; attribute float iLife;
        uniform float uSize; varying vec3 vCol; varying vec2 vUv; varying float vLife;
        void main(){
          vCol = iCol; vUv = uv; vLife = iLife;
          vec4 c = modelViewMatrix * vec4(iPos, 1.0);
          vec4 c2 = modelViewMatrix * vec4(iPos - iVel * 0.045, 1.0);
          vec2 dir = c.xy - c2.xy;
          float len = length(dir);
          dir = len > 1e-5 ? dir / len : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float size = uSize * (0.4 + iLife) ;
          vec2 off = nrm * position.x * size + dir * position.y * (size + len * 1.2);
          c.xy += off * step(0.001, iLife);
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: `varying vec3 vCol; varying vec2 vUv; varying float vLife;
        void main(){
          vec2 p = vUv - 0.5; float a = smoothstep(0.5, 0.0, length(p * vec2(2.0, 1.0)));
          gl_FragColor = vec4(vCol * a * vLife * 2.2, 1.0);
        }`,
    });
    this.mesh = new T.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
  }
  emit(at: T.Vector3, color: T.ColorRepresentation, count = 24, speed = 4, life = 0.6, dir?: T.Vector3) {
    const c = new T.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor++ % this.n;
      this.pos.set([at.x, at.y, at.z], i * 3);
      const u = this.rng() * 2 - 1,
        th = this.rng() * Math.PI * 2,
        r = Math.sqrt(1 - u * u),
        sp = speed * (0.35 + this.rng() * 0.8);
      let vx = r * Math.cos(th) * sp,
        vy = u * sp + speed * 0.25,
        vz = r * Math.sin(th) * sp;
      if (dir) {
        vx = vx * 0.5 + dir.x * speed;
        vy = vy * 0.5 + dir.y * speed;
        vz = vz * 0.5 + dir.z * speed;
      }
      this.vel.set([vx, vy, vz], i * 3);
      const w = 0.75 + this.rng() * 0.25;
      this.col.set([c.r * w + 0.2, c.g * w + 0.2, c.b * w + 0.2], i * 3);
      this.maxLife[i] = life * (0.6 + this.rng() * 0.7);
      this.life[i] = 1;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
      const j = i * 3;
      this.vel[j + 1] += this.gravity * dt;
      this.vel[j] *= 1 - dt * 1.5;
      this.vel[j + 2] *= 1 - dt * 1.5;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aLife.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ pyro -- */

/** Stage pyro: flame jets that fire on level-ups and big moments. */
export class Pyro {
  private sparks: Sparks;
  private jets: { at: T.Vector3; until: number }[] = [];
  private t = 0;
  constructor(parent: T.Object3D, private emitters: T.Vector3[]) {
    this.sparks = new Sparks(parent, 700, 2.5);
    (this.sparks.mesh.material as T.ShaderMaterial).uniforms.uSize.value = 0.09;
  }
  fire(duration = 0.9) {
    for (const at of this.emitters) this.jets.push({ at, until: this.t + duration });
  }
  update(dt: number) {
    this.t += dt;
    this.jets = this.jets.filter((j) => j.until > this.t);
    for (const j of this.jets) {
      this.sparks.emit(j.at, 0xffa640, 10, 5.5, 0.55, new T.Vector3(0, 1.4, 0));
      this.sparks.emit(j.at, 0xff4a20, 6, 4, 0.4, new T.Vector3(0, 1.2, 0));
    }
    this.sparks.update(dt);
  }
}

/* ---------------------------------------------------------------- floors -- */

/**
 * Glossy stage floor: a planar reflection blurred and darkened by a custom
 * shader, so neon and characters reflect like polished black acrylic.
 */
export function glossFloor(
  parent: T.Object3D,
  geometry: T.BufferGeometry,
  o: { resolution?: number; tint?: T.ColorRepresentation; strength?: number; blur?: number } = {},
) {
  const w = Math.round((innerWidth || 1280) * (o.resolution ?? 0.4)),
    h = Math.round((innerHeight || 720) * (o.resolution ?? 0.4));
  const shader = {
    name: "PtGloss",
    uniforms: {
      color: { value: new T.Color(o.tint ?? 0x7a7490) },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uStrength: { value: o.strength ?? 0.6 },
      uBlur: { value: o.blur ?? 0.006 },
    },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vUv = textureMatrix * vec4(position, 1.0); vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float uStrength; uniform float uBlur; varying vec4 vUv; varying vec3 vWorld;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        vec2 uv = vUv.xy / vUv.w;
        vec3 c = vec3(0.0);
        c += texture2D(tDiffuse, uv).rgb * 0.36;
        c += texture2D(tDiffuse, uv + vec2(uBlur, 0.0)).rgb * 0.16;
        c += texture2D(tDiffuse, uv - vec2(uBlur, 0.0)).rgb * 0.16;
        c += texture2D(tDiffuse, uv + vec2(0.0, uBlur * 1.6)).rgb * 0.16;
        c += texture2D(tDiffuse, uv - vec2(0.0, uBlur * 1.6)).rgb * 0.16;
        gl_FragColor = vec4(c * color * uStrength, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  };
  const mirror = new Reflector(geometry, {
    textureWidth: w,
    textureHeight: h,
    clipBias: 0.003,
    color: new T.Color(o.tint ?? 0x7a7490),
    shader,
  });
  mirror.rotation.x = -Math.PI / 2;
  parent.add(mirror);
  return mirror;
}

/** Neon tube along a path; returns the mesh and its material for pulsing. */
export function neonTube(
  parent: T.Object3D,
  points: T.Vector3[],
  color: T.ColorRepresentation,
  o: { radius?: number; intensity?: number; closed?: boolean; segments?: number } = {},
) {
  const curve = new T.CatmullRomCurve3(points, o.closed ?? false, "catmullrom", 0.05);
  const geo = new T.TubeGeometry(curve, o.segments ?? Math.max(8, points.length * 8), o.radius ?? 0.03, 6, o.closed ?? false);
  const mat = neon(color, o.intensity ?? 2.4);
  const m = new T.Mesh(geo, mat);
  parent.add(m);
  return m;
}

/** Soft haze cards that catch the light near the floor. */
export function haze(parent: T.Object3D, o: { positions: T.Vector3[]; size: number; color?: T.ColorRepresentation; opacity?: number }) {
  const mat = new T.SpriteMaterial({
    map: softDot(),
    color: new T.Color(o.color ?? 0x6a3cff),
    transparent: true,
    opacity: o.opacity ?? 0.12,
    blending: T.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const group = new T.Group();
  for (const p of o.positions) {
    const s = new T.Sprite(mat);
    s.position.copy(p);
    s.scale.set(o.size * 2.2, o.size, 1);
    group.add(s);
  }
  parent.add(group);
  return { group, material: mat };
}
