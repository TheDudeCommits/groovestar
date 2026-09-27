import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon, softDot } from "./palette";
import { skyDome, LedWall, Confetti, Sparks, Crowd, glossFloor } from "./fx";
import type { ShowDirector } from "./show";

/**
 * Tennis: a night stadium. Painted stands and floodlights behind, a glossy
 * blue hard court with glowing lines, LED boards around the court.
 */
export function tennisVenue(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x04050f, 0.018);
  stage.scene.background = new T.Color(0x020309);
  const sky = skyDome(root, { top: 0x010208, horizon: 0x0a1030, bottom: 0x020309, stars: 0.6 });
  // Stands: dark tiers on three sides of the court, packed with fans.
  const tierMat = new T.MeshStandardMaterial({ color: 0x0b0d1c, roughness: 0.85 });
  const tiers: T.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const back = new T.BoxGeometry(26 + k * 2.4, 0.8, 1.4);
    back.translate(0, 0.4 + k * 0.8, -22 - k * 1.3);
    tiers.push(back);
    for (const side of [-1, 1]) {
      const g = new T.BoxGeometry(1.4, 0.8, 30);
      g.translate(side * (9.2 + k * 1.3), 0.4 + k * 0.8, -6);
      tiers.push(g);
    }
  }
  root.add(new T.Mesh(mergeGeometries(tiers)!, tierMat));

  // Surround and court.
  const surround = new T.Mesh(new T.PlaneGeometry(40, 50), new T.MeshStandardMaterial({ color: 0x08301f, roughness: 0.6, metalness: 0.1 }));
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(0, -0.01, -7);
  root.add(surround);
  const court = glossFloor(root, new T.PlaneGeometry(11, 24), { resolution: 0.35, strength: 0.35, tint: 0x6a8cff, blur: 0.008 });
  court.position.set(0, 0.002, -7);
  const paint = new T.Mesh(
    new T.PlaneGeometry(11, 24),
    new T.MeshStandardMaterial({ color: 0x0f2e7a, roughness: 0.6, transparent: true, opacity: 0.9 }),
  );
  paint.rotation.x = -Math.PI / 2;
  paint.position.set(0, 0.005, -7);
  root.add(paint);
  const lineMat = neon(0xeaf4ff, 1.0);
  const lines: T.BufferGeometry[] = [];
  const line = (w: number, d: number, x: number, z: number) => {
    const g = new T.BoxGeometry(w, 0.01, d);
    g.translate(x, 0.012, z);
    lines.push(g);
  };
  for (const x of [-4.5, 4.5, -3.4, 3.4]) line(0.05, 22, x, -7);
  for (const z of [4, -18]) line(9, 0.05, 0, z);
  for (const z of [-1.5, -12.5]) line(6.8, 0.05, 0, z);
  line(0.05, 11, 0, -7);
  root.add(new T.Mesh(mergeGeometries(lines)!, lineMat));

  // Net with a glowing tape.
  const netMat = new T.MeshBasicMaterial({ color: 0x0a0f26, transparent: true, opacity: 0.8 });
  const netGeo: T.BufferGeometry[] = [];
  for (let i = 0; i < 40; i++) {
    const g = new T.BoxGeometry(0.012, 0.86, 0.012);
    g.translate(-4.9 + i * 0.25, 0.46, -7);
    netGeo.push(g);
  }
  for (let i = 0; i < 7; i++) {
    const g = new T.BoxGeometry(9.8, 0.01, 0.012);
    g.translate(0, 0.1 + i * 0.13, -7);
    netGeo.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(netGeo)!, netMat));
  const tape = new T.Mesh(new T.BoxGeometry(9.9, 0.05, 0.03), neon(0xffffff, 1.3));
  tape.position.set(0, 0.92, -7);
  root.add(tape);
  const postMat = new T.MeshStandardMaterial({ color: 0x14163a, metalness: 0.8, roughness: 0.3 });
  for (const x of [-5, 5]) {
    const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1.05, 10), postMat);
    p.position.set(x, 0.52, -7);
    root.add(p);
  }

  // LED boards around the court.
  const boards = [
    new LedWall(root, { width: 16, height: 0.9, position: new T.Vector3(0, 0.46, -20.5), grid: 14, mode: "chevrons", brightness: 1 }),
    ...[-1, 1].map((s) => {
      const b = new LedWall(root, { width: 20, height: 0.9, position: new T.Vector3(s * 7.6, 0.46, -8), grid: 14, mode: "bars", brightness: 0.9 });
      b.mesh.rotation.y = -s * Math.PI / 2;
      return b;
    }),
  ];

  // Floodlight towers: a grid of lamps on each mast, with a soft flare.
  const flares = new T.Group();
  root.add(flares);
  const mastMat = new T.MeshStandardMaterial({ color: 0x0c0e18, roughness: 0.5, metalness: 0.7 });
  const lampMat = neon(0xf2f6ff, 3.2);
  const lamps: T.BufferGeometry[] = [];
  for (const [x, z] of [
    [-15, -20],
    [15, -20],
    [-17, 2],
    [17, 2],
  ]) {
    const mast = new T.Mesh(new T.CylinderGeometry(0.18, 0.28, 16, 8), mastMat);
    mast.position.set(x, 8, z);
    root.add(mast);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++) {
        const g = new T.BoxGeometry(0.55, 0.42, 0.1);
        g.translate(x + (i - 1.5) * 0.62, 16.4 + j * 0.5, z);
        g.lookAt?.(new T.Vector3(0, 0, -6));
        lamps.push(g);
      }
    const s = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(0xdfe8ff).multiplyScalar(1.6), blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.set(9, 7, 1);
    s.position.set(x, 16.9, z + 0.3);
    flares.add(s);
  }
  root.add(new T.Mesh(mergeGeometries(lamps)!, lampMat));
  const crowd = new Crowd(root, {
    count: 420,
    seed: 23,
    area: (r) => {
      const k = Math.floor(r() * 6);
      const where = r();
      if (where < 0.4) return { x: (r() - 0.5) * (24 + k * 2.4), y: 0.8 + k * 0.8, z: -22 - k * 1.3, ry: 0 };
      const side = where < 0.7 ? -1 : 1;
      return { x: side * (9.2 + k * 1.3), y: 0.8 + k * 0.8, z: 8 - r() * 28, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 };
    },
  });
  const sparks = new Sparks(root, 500, -6);
  const confetti = new Confetti(root, { count: 300, area: new T.Box3(new T.Vector3(-5, 0, -8), new T.Vector3(5, 7, 3)), ambient: 0 });
  show.onLevel((_, up) => {
    if (up) confetti.burst(140);
  });
  let last = 0;
  return {
    root,
    sparks,
    confetti,
    update(t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      boards.forEach((b) => b.update(t, show));
      crowd.update(show);
      sky.update(t);
      lineMat.color.setRGB(0.9, 0.95, 1).multiplyScalar(0.85 + show.pulse * 0.3);
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}

/** Procedural nebula mural: drifting magenta and cyan clouds over stars. */
export function nebulaWall(parent: T.Object3D, o: { width: number; height: number; position: T.Vector3 }) {
  const mat = new T.ShaderMaterial({
    fog: false,
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new T.Color(PT.magenta) }, uB: { value: new T.Color(PT.cyan) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec2 p = vUv * vec2(3.4, 1.4);
        float t = uTime * 0.02;
        float c1 = fbm(p + vec2(t, 0.0) + fbm(p * 1.6 - t));
        float c2 = fbm(p * 1.3 - vec2(0.0, t) + 4.0);
        vec3 col = uA * pow(c1, 3.0) * 1.6 + uB * pow(c2, 3.2) * 1.4;
        col += vec3(0.02, 0.01, 0.05);
        vec2 sp = floor(vUv * vec2(420.0, 170.0));
        float star = step(0.9965, h(sp)) * (0.6 + 0.4 * sin(uTime * 2.0 + h(sp) * 40.0));
        col += vec3(0.9, 0.9, 1.0) * star;
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.7, vUv.y) * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        gl_FragColor = vec4(col * edge * (0.9 + uPulse * 0.2), 1.0);
      }`,
  });
  const m = new T.Mesh(new T.PlaneGeometry(o.width, o.height), mat);
  m.position.copy(o.position);
  parent.add(m);
  return {
    mesh: m,
    update(t: number, show: ShowDirector) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uPulse.value = show.pulse;
    },
  };
}

/** A neon-rimmed racket for the player (first person) or the opponent. */
export function ptRacket(color: number) {
  const g = new T.Group();
  const frame = new T.Mesh(new T.TorusGeometry(0.29, 0.022, 10, 48), neon(color, 2));
  frame.scale.y = 1.3;
  frame.position.y = 0.3;
  g.add(frame);
  const strings = new T.Mesh(
    new T.CircleGeometry(0.28, 32),
    new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(0.3), transparent: true, opacity: 0.3, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false }),
  );
  strings.scale.y = 1.3;
  strings.position.y = 0.3;
  g.add(strings);
  const grid: T.BufferGeometry[] = [];
  for (let i = -3; i <= 3; i++) {
    const len = Math.sqrt(1 - (i / 4) ** 2);
    const v = new T.BoxGeometry(0.006, len * 0.7, 0.004);
    v.translate(i * 0.07, 0.3, 0);
    const h = new T.BoxGeometry(len * 0.54, 0.006, 0.004);
    h.translate(0, 0.3 + i * 0.09, 0);
    grid.push(v, h);
  }
  g.add(new T.Mesh(mergeGeometries(grid)!, new T.MeshBasicMaterial({ color: new T.Color(0xffffff).multiplyScalar(0.9), transparent: true, opacity: 0.7 })));
  const handle = new T.Mesh(new T.CylinderGeometry(0.028, 0.03, 0.36, 10), new T.MeshStandardMaterial({ color: 0x14122a, roughness: 0.4, metalness: 0.5 }));
  handle.position.y = -0.2;
  g.add(handle);
  return g;
}

/**
 * Bowling: cosmic night lanes. Blacklight lanes with glowing arrows and
 * gutters run toward a painted galaxy mural; pins glow under UV.
 */
export function bowlVenue(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x05020d, 0.016);
  stage.scene.background = new T.Color(0x030108);
  const nebula = nebulaWall(root, { width: 34, height: 14, position: new T.Vector3(0, 6.2, -26) });
  const hall = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: 0x0a0618, roughness: 0.7 }));
  hall.rotation.x = -Math.PI / 2;
  hall.position.set(0, -0.06, -10);
  root.add(hall);
  const laneMat = new T.ShaderMaterial({
    fog: true,
    uniforms: { ...T.UniformsLib.fog, uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new T.Color(PT.violet) }, uB: { value: new T.Color(PT.cyan) } },
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 uv = vUv * vec2(1.0, 25.0);
        float boards = smoothstep(0.0, 0.04, abs(fract(vUv.x * 12.0) - 0.5));
        vec3 wood = mix(vec3(0.018, 0.01, 0.04), vec3(0.035, 0.018, 0.07), boards);
        // swirling UV galaxy print
        vec2 p = vUv * vec2(3.0, 40.0);
        float n = sin(p.x * 2.1 + sin(p.y * 0.35 + uTime * 0.2) * 2.0) * sin(p.y * 0.23 - uTime * 0.15);
        vec3 c = wood + mix(uA, uB, 0.5 + 0.5 * n) * 0.07 * (0.6 + 0.4 * uPulse);
        float star = step(0.997, hash(floor(uv * vec2(40.0, 3.0))));
        c += vec3(0.8, 0.9, 1.0) * star * 0.35;
        // arrows and dots
        float ay = fract(vUv.y * 25.0);
        float arrowRow = step(0.78, vUv.y) * step(vUv.y, 0.82);
        float ax = abs(fract(vUv.x * 7.0) - 0.5);
        float arrow = arrowRow * step(ax * 2.0, 1.0 - (vUv.y - 0.78) / 0.04) * step(0.1, fract(vUv.x * 7.0)) * step(fract(vUv.x * 7.0), 0.9);
        c += uB * arrow * 1.6;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  const gutterMat = neon(PT.magenta, 1.4);
  const lanes: T.BufferGeometry[] = [];
  const gutters: T.BufferGeometry[] = [];
  for (const lane of [-1, 0, 1]) {
    const x = lane * 4.8;
    const g = new T.PlaneGeometry(3.55, 25);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0, -10);
    lanes.push(g);
    for (const s of [-1, 1]) {
      const gu = new T.BoxGeometry(0.05, 0.03, 25);
      gu.translate(x + s * 2.0, 0.02, -10);
      gutters.push(gu);
    }
  }
  const laneMesh = new T.Mesh(mergeGeometries(lanes)!, laneMat);
  root.add(laneMesh, new T.Mesh(mergeGeometries(gutters)!, gutterMat));
  // Pin deck glow and arch lights over each lane end.
  const archMat = neon(PT.cyan, 1.8);
  const arches: T.BufferGeometry[] = [];
  for (const lane of [-1, 0, 1]) {
    const x = lane * 4.8;
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(x - 1.9, 0, -22.6),
      new T.Vector3(x - 1.9, 2.2, -22.6),
      new T.Vector3(x, 3.0, -22.6),
      new T.Vector3(x + 1.9, 2.2, -22.6),
      new T.Vector3(x + 1.9, 0, -22.6),
    ]);
    arches.push(new T.TubeGeometry(curve, 30, 0.05, 6, false));
  }
  root.add(new T.Mesh(mergeGeometries(arches)!, archMat));
  const deckGlow = new T.Mesh(
    new T.PlaneGeometry(14, 3),
    new T.MeshBasicMaterial({ color: new T.Color(0x8d5cff).multiplyScalar(0.5), transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
  );
  deckGlow.rotation.x = -Math.PI / 2;
  deckGlow.position.set(0, 0.02, -21.5);
  root.add(deckGlow);
  // Ceiling light bars rushing toward the pins.
  const barMat = neon(PT.violet, 1.3);
  const bars: T.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new T.BoxGeometry(16, 0.06, 0.12);
    g.translate(0, 6, 2 - i * 3.2);
    bars.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(bars)!, barMat));
  const sparks = new Sparks(root, 600, -5);
  const confetti = new Confetti(root, { count: 360, area: new T.Box3(new T.Vector3(-6, 0, -22), new T.Vector3(6, 7, 2)), ambient: 0 });
  let last = 0;
  return {
    root,
    sparks,
    confetti,
    update(t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      laneMat.uniforms.uTime.value = t;
      nebula.update(t, show);
      laneMat.uniforms.uPulse.value = show.pulse;
      (laneMat.uniforms.uA.value as T.Color).copy(show.colorA);
      (laneMat.uniforms.uB.value as T.Color).copy(show.colorB);
      gutterMat.color.copy(show.colorA).multiplyScalar(1.1 + show.pulse * 0.8);
      archMat.color.copy(show.colorB).multiplyScalar(1.3 + show.pulse);
      barMat.color.copy(show.colorA).lerp(show.colorB, 0.5 + 0.5 * Math.sin(t)).multiplyScalar(0.8 + show.pulse * 0.6);
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}

/** A UV-glow bowling pin: white body, neon stripes, one draw call. */
let pinMat: T.MeshStandardMaterial | null = null;
export function ptPin() {
  const profile: [number, number][] = [
    [0.11, 0],
    [0.18, 0.06],
    [0.205, 0.2],
    [0.17, 0.4],
    [0.075, 0.59],
    [0.073, 0.69],
    [0.12, 0.75],
    [0.13, 0.85],
    [0.07, 0.94],
    [0, 0.97],
  ];
  const body = new T.LatheGeometry(profile.map(([x, y]) => new T.Vector2(x, y)), 24).toNonIndexed();
  const colorize = (g: T.BufferGeometry, c: T.Color) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new T.BufferAttribute(arr, 3));
    return g;
  };
  colorize(body, new T.Color(0.95, 0.93, 1));
  const stripes = [0.6, 0.67].map((y) => colorize(new T.CylinderGeometry(0.076, 0.08, 0.035, 24).translate(0, y, 0).toNonIndexed(), new T.Color(PT.magenta)));
  const geo = mergeGeometries([body, ...stripes])!;
  pinMat ??= new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x6a50c0, emissiveIntensity: 0.12 });
  const g = new T.Group();
  const m = new T.Mesh(geo, pinMat);
  m.castShadow = true;
  g.add(m);
  return g;
}
