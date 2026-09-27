import * as T from "three";
import type { Stage } from "../stage";
import { softDot, seeded } from "./palette";
import { Sparks, glossFloor } from "./fx";
import type { ShowDirector } from "./show";

/**
 * Beat Blade arena: a black void where the music draws the light. A tunnel of
 * neon rings spins on every bar, laser fans and side pylons flash on the
 * beat, a halo pulses at the vanishing point and the mirror floor doubles it
 * all. Left is blue, right is red, like the blades.
 */

export const BLADE_BLUE = 0x2f7bff;
export const BLADE_RED = 0xff2d55;

type Section = "intro" | "verse" | "chorus" | "bridge" | "outro";

const glowLine = (color: T.ColorRepresentation) =>
  new T.MeshBasicMaterial({ color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false });

export function bladeArena(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.background = new T.Color(0x010006);
  stage.scene.fog = new T.FogExp2(0x03020c, 0.012);
  stage.scene.children.filter((c) => c instanceof T.HemisphereLight).forEach((h) => ((h as T.HemisphereLight).intensity = 0.25));
  if (stage.key) stage.key.intensity = 0.8;

  const blue = new T.Color(BLADE_BLUE), red = new T.Color(BLADE_RED), white = new T.Color(1, 1, 1);

  // ---- mirror floor and the track -------------------------------------
  const floor = glossFloor(root, new T.PlaneGeometry(90, 220), { resolution: 0.42, strength: 0.5, tint: 0x9aa0c8, blur: 0.0035 });
  floor.position.set(0, -0.35, -90);
  // player platform: a dark slab with lit edges
  const slabMat = new T.MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.35, metalness: 0.7 });
  const slab = new T.Mesh(new T.BoxGeometry(3.4, 0.3, 5), slabMat);
  slab.position.set(0, -0.17, 3.2);
  root.add(slab);
  const edgeL = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 5), glowLine(blue.clone().multiplyScalar(2.5)));
  edgeL.position.set(-1.7, 0, 3.2);
  const edgeR = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 5), glowLine(red.clone().multiplyScalar(2.5)));
  edgeR.position.set(1.7, 0, 3.2);
  root.add(edgeL, edgeR);
  // lane rails into the distance with light pulses running toward the player
  const railMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    fog: false,
    uniforms: { uBeat: { value: 0 }, uColor: { value: blue.clone() }, uBright: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uBeat; uniform vec3 uColor; uniform float uBright;
      void main(){
        float z = vUv.y;                       // 0 near, 1 far
        float pulse = pow(fract(z * 12.0 + uBeat), 10.0);
        float fade = smoothstep(1.0, 0.25, z) * smoothstep(0.0, 0.02, z);
        float core = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
        gl_FragColor = vec4(uColor * core * fade * (0.5 + pulse * 2.4) * uBright, 1.0);
      }`,
  });
  const railMatR = railMat.clone();
  railMatR.uniforms.uColor.value = red.clone();
  for (const [x, m] of [[-1.7, railMat], [1.7, railMatR]] as const) {
    const g = new T.PlaneGeometry(0.16, 150);
    g.rotateX(-Math.PI / 2);
    // uv.y runs near->far
    const rail = new T.Mesh(g, m);
    rail.position.set(x, 0.01, 0.7 - 75);
    rail.renderOrder = 2;
    root.add(rail);
  }

  // ---- ring tunnel -----------------------------------------------------
  const RINGS = 26;
  const ringGeo = (() => {
    // a square frame of four thin bars
    const parts = [
      new T.BoxGeometry(22, 0.22, 0.22).translate(0, 7, 0),
      new T.BoxGeometry(22, 0.22, 0.22).translate(0, -7, 0),
      new T.BoxGeometry(0.22, 14, 0.22).translate(-11, 0, 0),
      new T.BoxGeometry(0.22, 14, 0.22).translate(11, 0, 0),
    ];
    const g = new T.BufferGeometry();
    const merged = parts.map((p) => p.toNonIndexed());
    const count = merged.reduce((n, p) => n + p.attributes.position.count, 0);
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const p of merged) {
      pos.set(p.attributes.position.array as Float32Array, o);
      o += (p.attributes.position.array as Float32Array).length;
    }
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    return g;
  })();
  const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: true });
  const rings = new T.InstancedMesh(ringGeo, ringMat, RINGS);
  rings.frustumCulled = false;
  root.add(rings);
  const ringState = Array.from({ length: RINGS }, (_, i) => ({ rot: (i * Math.PI) / 16, target: (i * Math.PI) / 16, glow: 0 }));
  let ringSpacing = 7, ringSpacingTarget = 7;
  const ringColor = new T.Color();
  // a darker, chunkier frame behind every other ring gives the tunnel mass
  const frameMat = new T.MeshStandardMaterial({ color: 0x07060e, roughness: 0.6, metalness: 0.6 });
  const frames = new T.InstancedMesh(new T.TorusGeometry(15.5, 0.5, 4, 8), frameMat, 10);
  frames.frustumCulled = false;
  root.add(frames);

  // ---- halo at the vanishing point ------------------------------------
  const haloMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    fog: false,
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: blue.clone() }, uB: { value: red.clone() }, uK: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB; uniform float uK;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        float ring = smoothstep(0.03, 0.0, abs(r - 0.42 - uPulse * 0.03)) * 1.4;
        float ring2 = smoothstep(0.012, 0.0, abs(r - 0.62)) * 0.8;
        float core = exp(-r * 11.0) * 0.8 + exp(-r * 3.0) * 0.12;
        vec3 c = mix(uA, uB, 0.5 + 0.5 * sin(atan(p.y, p.x) * 2.0 + uTime * 0.3)) * (ring + ring2) + vec3(1.0, 0.95, 1.0) * core;
        gl_FragColor = vec4(c * uK * smoothstep(1.0, 0.8, r), 1.0);
      }`,
  });
  const halo = new T.Mesh(new T.PlaneGeometry(34, 34), haloMat);
  halo.position.set(0, 4.2, -118);
  root.add(halo);

  // ---- laser fans --------------------------------------------------------
  const laserGeo = new T.BoxGeometry(0.05, 1, 0.05).translate(0, 0.5, 0);
  const LASERS = 10;
  const laserMats = [glowLine(blue), glowLine(red)];
  const lasers: { mesh: T.Mesh; side: number; i: number; base: number }[] = [];
  for (let i = 0; i < LASERS; i++) {
    const side = i < LASERS / 2 ? -1 : 1;
    const k = i % (LASERS / 2);
    const m = new T.Mesh(laserGeo, laserMats[side < 0 ? 0 : 1]);
    m.position.set(side * (14 + k * 2.2), -0.3, -40 - k * 12);
    m.scale.y = 70;
    m.frustumCulled = false;
    root.add(m);
    lasers.push({ mesh: m, side, i: k, base: side * (0.28 + k * 0.09) });
  }

  // ---- side pylons with vertical light strips -------------------------
  const PY = 12;
  const pylonGeo = new T.BoxGeometry(1.6, 16, 1.6);
  const pylons = new T.InstancedMesh(pylonGeo, new T.MeshStandardMaterial({ color: 0x06050c, roughness: 0.5, metalness: 0.7 }), PY * 2);
  const stripGeo = new T.BoxGeometry(0.12, 14, 0.12);
  const strips = new T.InstancedMesh(stripGeo, new T.MeshBasicMaterial({ color: 0xffffff, fog: true }), PY * 2);
  const m4 = new T.Matrix4();
  const rng = seeded(4);
  const pylonPos: { x: number; z: number; h: number; side: number; i: number }[] = [];
  for (let i = 0; i < PY; i++)
    for (const side of [-1, 1]) {
      const z = -8 - i * 9;
      const x = side * (8.5 + rng() * 1.5);
      const h = 0.7 + rng() * 0.6;
      pylonPos.push({ x, z, h, side, i });
      const idx = pylonPos.length - 1;
      m4.compose(new T.Vector3(x, 8 * h - 1, z), new T.Quaternion(), new T.Vector3(1, h, 1));
      pylons.setMatrixAt(idx, m4);
      m4.compose(new T.Vector3(x - side * 0.82, 7 * h - 0.5, z), new T.Quaternion(), new T.Vector3(1, h, 1));
      strips.setMatrixAt(idx, m4);
      strips.setColorAt(idx, new T.Color(0));
    }
  pylons.frustumCulled = strips.frustumCulled = false;
  root.add(pylons, strips);

  // ---- streaming motes -------------------------------------------------
  const MOTES = 420;
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) motePos.set([(rng() - 0.5) * 26, rng() * 12 - 0.5, -rng() * 120], i * 3);
  const moteGeo = new T.BufferGeometry();
  moteGeo.setAttribute("position", new T.BufferAttribute(motePos, 3).setUsage(T.DynamicDrawUsage));
  const moteMat = new T.PointsMaterial({ map: softDot(), size: 0.09, color: 0xaab4ff, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, fog: true });
  root.add(new T.Points(moteGeo, moteMat));

  const sparks = new Sparks(root, 1200, -8);

  // ---- light show state ---------------------------------------------------
  let section: Section = "intro";
  let flash = 0, missFlash = 0;
  let lastBeat = -1;
  let lastBar = -1;
  let leftBias = 0.5; // 0 = all blue, 1 = all red
  let leftBiasTarget = 0.5;
  let last = 0;

  const onBeat = (beat: number) => {
    const high = section === "chorus" || show.level >= 3;
    if (beat % 4 === 0) {
      // every bar the rings spin a notch in a wave from the far end
      const dir = Math.floor(beat / 4) % 2 ? 1 : -1;
      ringState.forEach((r, i) => (r.target += dir * (Math.PI / 8) * (high ? 2 : 1) * (1 + i * 0.02)));
    }
    if (beat % 8 === 0) leftBiasTarget = leftBiasTarget > 0.5 ? 0.15 : 0.85;
    if (high && beat % 2 === 0) ringSpacingTarget = ringSpacingTarget > 6.5 ? 5.2 : 7.6;
    if (!high) ringSpacingTarget = 7;
  };

  return {
    root,
    sparks,
    set section(s: Section) {
      section = s;
    },
    /** A clean cut: rings and pylons nearest the player flare. */
    cut(side: "L" | "R", quality: number) {
      flash = Math.min(0.7, flash + 0.08 + quality * 0.08);
      ringState.slice(0, 4).forEach((r) => (r.glow = Math.max(r.glow, 0.6 + quality * 0.4)));
      void side;
    },
    miss() {
      missFlash = 1;
    },
    /** Level up or combo milestone: full-white strobe and a ring burst. */
    moment() {
      flash = 1;
      ringState.forEach((r, i) => (r.glow = Math.max(r.glow, 1 - i * 0.02)));
    },
    update(t: number, reduced: boolean) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      const beat = Math.max(0, show.beat);
      const whole = Math.floor(beat);
      if (whole !== lastBeat && show.beat >= 0) {
        lastBeat = whole;
        onBeat(whole);
      }
      const bar = Math.floor(beat / 4);
      if (bar !== lastBar) lastBar = bar;
      const high = section === "chorus" || show.level >= 3;
      const energy = Math.min(1, 0.35 + show.hype * 0.5 + (high ? 0.3 : 0) + (section === "intro" ? -0.15 : 0));
      leftBias += (leftBiasTarget - leftBias) * (1 - Math.exp(-dt * 3));
      ringSpacing += (ringSpacingTarget - ringSpacing) * (1 - Math.exp(-dt * (reduced ? 1 : 5)));
      flash = Math.max(0, flash - dt * 2.8);
      missFlash = Math.max(0, missFlash - dt * 3);
      const pulse = show.pulse;
      // rings
      const q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(1, 1, 1), p = new T.Vector3();
      for (let i = 0; i < RINGS; i++) {
        const r = ringState[i];
        r.rot += (r.target - r.rot) * (1 - Math.exp(-dt * (reduced ? 2 : 6 - i * 0.1)));
        r.glow = Math.max(0, r.glow - dt * 2.2);
        const z = -14 - i * ringSpacing;
        e.set(0, 0, r.rot);
        q.setFromEuler(e);
        s.setScalar(1 + (high ? pulse * 0.04 : 0));
        m4.compose(p.set(0, 4.2, z), q, s);
        rings.setMatrixAt(i, m4);
        const wave = Math.pow(Math.max(0, 1 - Math.abs(((beat * 3 - (RINGS - i) * 0.25) % 5) - 0.4)), 4);
        ringColor.copy(i % 2 ? red : blue).lerp(i % 2 ? blue : red, leftBias > 0.5 ? leftBias - 0.5 : 0);
        const k = (0.25 + energy * 0.45 + wave * 0.8 * energy + r.glow * 1.5 + flash * 0.8) * (1 - missFlash * 0.6) * (i < 3 ? 0.55 : 1);
        ringColor.multiplyScalar(k);
        if (flash > 0.6) ringColor.lerp(white, (flash - 0.6) * 1.5);
        rings.setColorAt(i, ringColor);
      }
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      for (let i = 0; i < 10; i++) {
        e.set(0, 0, ringState[i * 2].rot + Math.PI / 8);
        q.setFromEuler(e);
        m4.compose(p.set(0, 4.2, -14 - i * 2 * ringSpacing - 0.6), q, s.setScalar(1));
        frames.setMatrixAt(i, m4);
      }
      frames.instanceMatrix.needsUpdate = true;
      // lasers: fan out and sweep; one side flashes per beat in chorus
      const beatSide = whole % 2 ? 1 : -1;
      for (const l of lasers) {
        const sweep = reduced ? 0 : Math.sin(t * (high ? 1.8 : 0.9) + l.i * 0.6) * (high ? 0.35 : 0.18);
        l.mesh.rotation.z = -(l.base + sweep) * 0.9;
        l.mesh.rotation.x = -0.25 - l.i * 0.03;
        const on = high ? (l.side === beatSide ? 1 : 0.35) : 0.6;
        l.mesh.visible = energy > 0.4;
        const mat = l.mesh.material as T.MeshBasicMaterial;
        mat.opacity = 1;
        void mat;
        l.mesh.scale.x = l.mesh.scale.z = 0.6 + pulse * 0.8 * on;
      }
      laserMats[0].color.copy(blue).multiplyScalar(1.4 * energy * (0.6 + pulse * 0.8));
      laserMats[1].color.copy(red).multiplyScalar(1.4 * energy * (0.6 + pulse * 0.8));
      // pylon strips chase toward the player on each beat
      for (let i = 0; i < pylonPos.length; i++) {
        const py = pylonPos[i];
        const chase = Math.pow(Math.max(0, 1 - Math.abs(((beat * 2 - (PY - py.i) * 0.22) % 4) - 0.3)), 3);
        ringColor.copy(py.side < 0 ? blue : red).multiplyScalar((0.18 + chase * 2.2 * energy + flash * 0.8) * (1 - missFlash * 0.7));
        strips.setColorAt(i, ringColor);
      }
      if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
      // rails and the halo
      railMat.uniforms.uBeat.value = beat;
      railMatR.uniforms.uBeat.value = beat;
      railMat.uniforms.uBright.value = railMatR.uniforms.uBright.value = 0.7 + energy * 0.6;
      haloMat.uniforms.uTime.value = t;
      haloMat.uniforms.uPulse.value = pulse;
      haloMat.uniforms.uK.value = (0.55 + energy * 0.6 + pulse * 0.4 * energy + flash * 0.6) * (1 - missFlash * 0.5);
      // edges on the player slab
      (edgeL.material as T.MeshBasicMaterial).color.copy(blue).multiplyScalar(1.6 + pulse * 1.5);
      (edgeR.material as T.MeshBasicMaterial).color.copy(red).multiplyScalar(1.6 + pulse * 1.5);
      // motes stream past
      const speed = reduced ? 4 : 10 + energy * 14;
      for (let i = 0; i < MOTES; i++) {
        let z = motePos[i * 3 + 2] + dt * speed;
        if (z > 8) z -= 128;
        motePos[i * 3 + 2] = z;
      }
      moteGeo.attributes.position.needsUpdate = true;
      moteMat.color.copy(white).lerp(leftBias > 0.5 ? red : blue, 0.35);
      sparks.update(dt);
    },
  };
}
