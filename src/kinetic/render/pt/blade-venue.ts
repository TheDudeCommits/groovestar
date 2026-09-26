import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon, seeded, softDot } from "./palette";
import { skyDome, MovingHeads, Lasers, glossFloor, Sparks, Confetti } from "./fx";
import type { ShowDirector } from "./show";

/** A pointed (gothic) arch outline, as points for a neon tube. */
function archPoints(halfWidth: number, spring: number, apex: number, steps = 14) {
  const pts: T.Vector3[] = [];
  const r = (halfWidth * halfWidth + (apex - spring) ** 2) / (2 * halfWidth);
  const cxL = -halfWidth + r;
  const top = apex - spring;
  pts.push(new T.Vector3(-halfWidth, 0, 0));
  for (let i = 0; i <= steps; i++) {
    const y = (top * i) / steps;
    const x = cxL - Math.sqrt(Math.max(0, r * r - y * y));
    pts.push(new T.Vector3(x, spring + y, 0));
  }
  for (let i = steps; i >= 0; i--) {
    const y = (top * i) / steps;
    const x = -(cxL - Math.sqrt(Math.max(0, r * r - y * y)));
    pts.push(new T.Vector3(x, spring + y, 0));
  }
  pts.push(new T.Vector3(halfWidth, 0, 0));
  return pts;
}

/**
 * Beat Blade: a neon cathedral runway. Pointed arches of light march toward
 * a golden portal over a mirror floor; beams sweep across the nave and the
 * arches ripple toward the player on every beat.
 */
export function bladeVenue(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x0c0620, 0.016);
  const sky = skyDome(root, { top: 0x05030f, horizon: 0x1c0b44, bottom: 0x05030f, stars: 1 });

  // Mirror runway and dark side floors.
  const floor = glossFloor(root, new T.PlaneGeometry(12, 120), { resolution: 0.42, strength: 0.45, tint: 0x8c86b8, blur: 0.004 });
  floor.position.set(0, 0, -50);
  const side = new T.Mesh(new T.PlaneGeometry(120, 140), new T.MeshStandardMaterial({ color: 0x07050f, roughness: 0.6, metalness: 0.3 }));
  side.rotation.x = -Math.PI / 2;
  side.position.set(0, -0.02, -50);
  root.add(side);

  // Runway edge lights and floor grid.
  const edgeMat = neon(PT.gold, 1.6);
  const lineMat = neon(0x6a5cff, 0.6);
  const strips: T.BufferGeometry[] = [],
    grid: T.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new T.BoxGeometry(0.08, 0.02, 118);
    g.translate(s * 6.05, 0.012, -50);
    strips.push(g);
  }
  for (let i = 0; i < 40; i++) {
    const g = new T.BoxGeometry(12, 0.012, 0.025);
    g.translate(0, 0.008, 4 - i * 3);
    grid.push(g);
  }
  for (const x of [-3, 3]) {
    const g = new T.BoxGeometry(0.025, 0.012, 118);
    g.translate(x, 0.008, -50);
    grid.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(strips)!, edgeMat), new T.Mesh(mergeGeometries(grid)!, lineMat));

  // Cathedral arches: dark stone ribs with neon inner edges.
  const stone = new T.MeshStandardMaterial({ color: 0x120c26, roughness: 0.55, metalness: 0.5 });
  const pillarGeo: T.BufferGeometry[] = [];
  const arches: { mesh: T.Mesh; mat: T.MeshBasicMaterial; z: number }[] = [];
  const archCurve = archPoints(5.6, 5.2, 11.5);
  const archGeo = new T.TubeGeometry(new T.CatmullRomCurve3(archCurve, false, "catmullrom", 0.1), 90, 0.07, 6, false);
  const archOuter = new T.TubeGeometry(new T.CatmullRomCurve3(archPoints(6.3, 5.2, 12.6), false, "catmullrom", 0.1), 90, 0.32, 5, false);
  for (let i = 0; i < 15; i++) {
    const z = 2 - i * 7.5;
    const mat = neon(i % 2 ? PT.cyan : PT.magenta, 2.2);
    const m = new T.Mesh(archGeo, mat);
    m.position.z = z;
    root.add(m);
    arches.push({ mesh: m, mat, z });
    const o = archOuter.clone();
    o.translate(0, 0, z - 0.1);
    pillarGeo.push(o);
    for (const s of [-1, 1]) {
      const p = new T.BoxGeometry(0.9, 5.4, 0.9);
      p.translate(s * 6.3, 2.7, z - 0.1);
      pillarGeo.push(p);
      const cap = new T.CylinderGeometry(0.02, 0.5, 2.4, 4);
      cap.translate(s * 6.3, 13.8 + (i % 3) * 0.6, z - 0.1);
      pillarGeo.push(cap);
    }
  }
  root.add(new T.Mesh(mergeGeometries(pillarGeo.map((g) => g.toNonIndexed()))!, stone));

  // Stained-glass lancets between the ribs: the cathedral's color.
  const glassMat = new T.ShaderMaterial({
    fog: true,
    uniforms: {
      ...T.UniformsLib.fog,
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uA: { value: new T.Color(PT.magenta) },
      uB: { value: new T.Color(PT.cyan) },
    },
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        vec2 p = vUv * vec2(1.0, 2.2);
        // pointed lancet silhouette
        float x = abs(vUv.x - 0.5) * 2.0;
        float top = vUv.y > 0.72 ? 1.0 - (vUv.y - 0.72) / 0.28 : 1.0;
        float inside = step(x, sqrt(max(0.0, top)) * 0.98) * step(0.02, vUv.y);
        vec2 cell = floor(p * vec2(4.0, 5.0));
        vec2 f = fract(p * vec2(4.0, 5.0));
        float lead = smoothstep(0.0, 0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
        float k = h(cell);
        vec3 col = k < 0.35 ? uA : k < 0.7 ? uB : k < 0.88 ? vec3(0.55, 0.36, 1.0) : vec3(1.0, 0.8, 0.3);
        float rose = smoothstep(0.2, 0.18, length((vUv - vec2(0.5, 0.8)) * vec2(1.0, 2.2)));
        col = mix(col, vec3(1.0, 0.85, 0.4), rose * 0.6);
        float shimmer = 0.75 + 0.25 * sin(uTime * 1.5 + cell.x * 1.3 + cell.y * 0.7);
        vec3 c = col * lead * inside * (0.55 + 0.35 * shimmer + uPulse * 0.35);
        c += vec3(0.25, 0.2, 0.5) * (1.0 - lead) * inside * 0.1;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  const glassGeo: T.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const z = 2 - i * 7.5 - 3.75;
    for (const s of [-1, 1]) {
      const g = new T.PlaneGeometry(3.4, 8.2);
      g.rotateY(-s * Math.PI / 2);
      g.translate(s * 7.4, 5.6, z);
      glassGeo.push(g);
    }
  }
  root.add(new T.Mesh(mergeGeometries(glassGeo)!, glassMat));
  const tipMat = neon(PT.gold, 1.4);
  const tipGeo: T.BufferGeometry[] = [];
  for (let i = 0; i < 15; i++)
    for (const s of [-1, 1]) {
      const g = new T.OctahedronGeometry(0.22, 0);
      g.scale(1, 2.2, 1);
      g.translate(s * 6.3, 5.9, 2 - i * 7.5 + 0.35);
      tipGeo.push(g);
    }
  root.add(new T.Mesh(mergeGeometries(tipGeo.map((g) => g.toNonIndexed()))!, tipMat));

  // Spires and towers beyond the nave, with lit window slits.
  const rng = seeded(21);
  const spireGeo: T.BufferGeometry[] = [],
    windowGeo: T.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const s = i % 2 ? 1 : -1;
    const x = s * (13 + rng() * 22),
      z = -10 - rng() * 90,
      h = 12 + rng() * 26,
      w = 1.6 + rng() * 2.6;
    const tower = new T.BoxGeometry(w, h, w);
    tower.translate(x, h / 2, z);
    spireGeo.push(tower);
    const spire = new T.ConeGeometry(w * 0.55, h * 0.45, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(x, h + h * 0.225, z);
    spireGeo.push(spire);
    for (let k = 0; k < 5; k++) {
      const wg = new T.BoxGeometry(0.12, 1.2 + rng() * 2, 0.05);
      wg.translate(x + (rng() - 0.5) * w * 0.6, 2 + rng() * (h - 4), z + w / 2 + 0.03);
      windowGeo.push(wg);
    }
  }
  root.add(new T.Mesh(mergeGeometries(spireGeo.map((g) => g.toNonIndexed()))!, new T.MeshStandardMaterial({ color: 0x0d0822, roughness: 0.8 })));
  const windowMat = neon(0x7d6bff, 0.9);
  root.add(new T.Mesh(mergeGeometries(windowGeo)!, windowMat));

  // The golden portal at the end of the nave.
  const portal = new T.Group();
  portal.position.set(0, 5.6, -96);
  root.add(portal);
  const ringMat = neon(PT.gold, 2.0);
  const ringA = new T.Mesh(new T.TorusGeometry(5.2, 0.18, 12, 120), ringMat);
  const ringB = new T.Mesh(new T.TorusGeometry(4.3, 0.06, 8, 120), neon(0xfff0c0, 3));
  const ringC = new T.Mesh(new T.TorusGeometry(6.3, 0.05, 8, 120), neon(PT.magenta, 2.4));
  portal.add(ringA, ringB, ringC);
  const burstMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    fog: false,
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new T.Color(PT.gold) }, uB: { value: new T.Color(PT.magenta) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
        float rays = pow(0.5 + 0.5 * cos(a * 18.0 + uTime * 0.4), 6.0) + 0.6 * pow(0.5 + 0.5 * cos(a * 7.0 - uTime * 0.25), 8.0);
        float core = exp(-r * 7.0) * 1.1 + exp(-r * 2.4) * 0.22;
        vec3 c = mix(uA, vec3(1.0, 0.97, 0.9), exp(-r * 9.0)) * core + mix(uA, uB, r) * rays * smoothstep(0.9, 0.1, r) * (0.28 + uPulse * 0.25);
        gl_FragColor = vec4(c * smoothstep(1.0, 0.7, r), 1.0);
      }`,
  });
  const burst = new T.Mesh(new T.PlaneGeometry(34, 34), burstMat);
  burst.position.z = -0.5;
  portal.add(burst);

  // Light rigs along the nave.
  const heads = [
    new MovingHeads(root, { count: 5, from: new T.Vector3(-6.3, 10.8, -12), to: new T.Vector3(-6.3, 10.8, -70), length: 20, radius: 0.7, truss: false, aim: new T.Vector3(3, 0, -34), strength: 0.35 }),
    new MovingHeads(root, { count: 5, from: new T.Vector3(6.3, 10.8, -16), to: new T.Vector3(6.3, 10.8, -74), length: 20, radius: 0.7, truss: false, aim: new T.Vector3(-3, 0, -38), strength: 0.35 }),
  ];
  const lasers = new Lasers(root, {
    emitters: [new T.Vector3(-2.5, 5.6, -90), new T.Vector3(2.5, 5.6, -90)],
    perEmitter: 5,
    length: 110,
    minLevel: 2,
  });
  lasers.group.rotation.x = Math.PI / 2.1;

  // Motes drifting toward the camera sell the speed of the runway.
  const moteCount = 260;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) motePos.set([(rng() - 0.5) * 14, 0.3 + rng() * 9, -rng() * 90], i * 3);
  const moteGeo = new T.BufferGeometry();
  moteGeo.setAttribute("position", new T.BufferAttribute(motePos, 3).setUsage(T.DynamicDrawUsage));
  const motes = new T.Points(
    moteGeo,
    new T.PointsMaterial({ map: softDot(), size: 0.12, color: new T.Color(0xb9a8ff).multiplyScalar(0.9), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: true }),
  );
  root.add(motes);

  const sparks = new Sparks(root, 900, -7);
  const confetti = new Confetti(root, { count: 420, area: new T.Box3(new T.Vector3(-6, 0, -14), new T.Vector3(6, 9, 3)), ambient: 0.0 });
  show.onLevel((_, up) => {
    if (up) confetti.burst(160);
  });

  let last = 0;
  return {
    root,
    sparks,
    confetti,
    update(t: number, reduced: boolean) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      sky.update(t);
      heads.forEach((h) => h.update(t, show));
      lasers.update(t, show);
      // Ripple: each arch flashes as the beat wave travels toward the player.
      arches.forEach((a, i) => {
        const wave = Math.pow(Math.max(0, 1 - Math.abs(((show.beat * 2 - (arches.length - i) * 0.35) % 6) - 0.5)), 3);
        const c = i % 2 ? show.colorB : show.colorA;
        a.mat.color.copy(c).multiplyScalar(0.7 + show.intensity * 0.5 + wave * 1.1 + show.flash * 0.35);
      });
      edgeMat.color.setRGB(1, 0.78, 0.22).multiplyScalar(1.0 + show.pulse * 0.9);
      lineMat.color.copy(show.colorA).lerp(new T.Color(0x3a2a8a), 0.6).multiplyScalar(0.35 + show.pulse * 0.4);
      windowMat.color.copy(show.colorB).lerp(new T.Color(0x5a4aff), 0.6).multiplyScalar(0.7);
      glassMat.uniforms.uTime.value = t;
      glassMat.uniforms.uPulse.value = show.pulse;
      (glassMat.uniforms.uA.value as T.Color).copy(show.colorB);
      (glassMat.uniforms.uB.value as T.Color).copy(show.colorA);
      tipMat.color.setRGB(1, 0.8, 0.3).multiplyScalar(0.9 + show.pulse * 0.9);
      burstMat.uniforms.uTime.value = t;
      burstMat.uniforms.uPulse.value = show.pulse;
      (burstMat.uniforms.uB.value as T.Color).copy(show.colorA);
      ringMat.color.setRGB(1, 0.78, 0.28).multiplyScalar(1.5 + show.pulse * 1.2);
      if (!reduced) {
        ringA.rotation.z = t * 0.2;
        ringC.rotation.z = -t * 0.12;
        portal.scale.setScalar(1 + show.pulse * 0.025);
      }
      const speed = reduced ? 3 : 9 + show.level * 2;
      for (let i = 0; i < moteCount; i++) {
        let z = motePos[i * 3 + 2] + dt * speed;
        if (z > 6) z -= 96;
        motePos[i * 3 + 2] = z;
      }
      moteGeo.attributes.position.needsUpdate = true;
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}
