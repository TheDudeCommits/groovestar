import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon, seeded, softDot } from "./palette";
import { skyDome, glossFloor, Sparks, Confetti } from "./fx";
import type { ShowDirector } from "./show";

const CHUNK = 72;

/** Facade shader: dark towers with a procedural grid of lit windows. */
function facadeMaterial() {
  return new T.ShaderMaterial({
    fog: true,
    uniforms: { ...T.UniformsLib.fog, uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new T.Color(PT.magenta) }, uB: { value: new T.Color(PT.cyan) } },
    vertexShader: `varying vec3 vP; varying vec3 vN;
      #include <fog_pars_vertex>
      void main(){ vP = position; vN = normal; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vP; varying vec3 vN; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 n = abs(vN);
        vec2 uv = n.x > 0.5 ? vP.zy : vP.xy;
        vec3 base = mix(vec3(0.02, 0.012, 0.05), vec3(0.07, 0.03, 0.14), clamp(vP.y / 30.0, 0.0, 1.0));
        if (n.y > 0.5) { gl_FragColor = vec4(base * 0.6, 1.0); return; }
        vec2 cell = floor(uv / vec2(1.3, 1.9));
        vec2 f = fract(uv / vec2(1.3, 1.9));
        float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78) * step(2.2, vP.y);
        float r = h(cell + floor(vP.x * 0.02 + vP.z * 0.013) * 7.0);
        float lit = step(0.74, r) * (0.8 + 0.2 * sin(uTime * 0.7 + r * 60.0));
        vec3 wc = r > 0.95 ? uA : r > 0.9 ? uB : vec3(1.0, 0.72, 0.42);
        vec3 c = base + win * lit * wc * 0.75 + win * (1.0 - lit) * vec3(0.03, 0.025, 0.08);
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
}

/** Neon shop sign art with no words: a symbol in glowing tubes. */
function signTexture(kind: number, color: string) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d")!;
  c.fillStyle = "rgba(10,4,24,0.92)";
  c.beginPath();
  c.roundRect(8, 8, 240, 240, 26);
  c.fill();
  c.lineCap = "round";
  c.lineJoin = "round";
  const stroke = (w: number, a: number) => {
    c.strokeStyle = color;
    c.globalAlpha = a;
    c.lineWidth = w;
    c.stroke();
  };
  c.beginPath();
  if (kind === 0) {
    // crown
    c.moveTo(56, 176);
    c.lineTo(48, 84);
    c.lineTo(96, 128);
    c.lineTo(128, 70);
    c.lineTo(160, 128);
    c.lineTo(208, 84);
    c.lineTo(200, 176);
    c.closePath();
  } else if (kind === 1) {
    // music note
    c.arc(96, 176, 26, 0, Math.PI * 2);
    c.moveTo(122, 176);
    c.lineTo(122, 64);
    c.lineTo(190, 50);
    c.lineTo(190, 150);
    c.moveTo(216, 150);
    c.arc(190, 150, 26, 0, Math.PI * 2);
  } else if (kind === 2) {
    // vinyl
    c.arc(128, 128, 84, 0, Math.PI * 2);
    c.moveTo(152, 128);
    c.arc(128, 128, 24, 0, Math.PI * 2);
  } else {
    // star
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 40 : 92,
        a = -Math.PI / 2 + (i * Math.PI) / 5;
      c.lineTo(128 + Math.cos(a) * r, 136 + Math.sin(a) * r);
    }
    c.closePath();
  }
  stroke(26, 0.25);
  stroke(12, 0.6);
  c.strokeStyle = "#fff";
  c.globalAlpha = 0.9;
  c.lineWidth = 4;
  c.stroke();
  c.globalAlpha = 1;
  c.strokeStyle = color;
  c.lineWidth = 6;
  c.beginPath();
  c.roundRect(14, 14, 228, 228, 22);
  c.stroke();
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** Warm shopfront glass with mullions and a few silhouettes inside. */
function shopTexture() {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#ffcf8a");
  g.addColorStop(0.55, "#ff8a4a");
  g.addColorStop(1, "#6a1f4a");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 128);
  c.fillStyle = "rgba(30,8,40,0.75)";
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 48 + (i % 2) * 10;
    c.beginPath();
    c.arc(x, 70, 9, 0, Math.PI * 2);
    c.fill();
    c.fillRect(x - 12, 80, 24, 48);
  }
  c.fillStyle = "#1a0a24";
  for (const x of [0, 84, 170, 250]) c.fillRect(x, 0, 6, 128);
  c.fillRect(0, 0, 256, 8);
  c.fillRect(0, 120, 256, 8);
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** The GROOVE CITY gate sign. */
function gateTexture() {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const c = cv.getContext("2d")!;
  c.font = 'italic 900 170px "Barlow Condensed", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = "#ffb020";
  c.shadowBlur = 30;
  c.lineWidth = 10;
  c.strokeStyle = "#ff8a1a";
  c.strokeText("GROOVE CITY", 512, 136);
  c.shadowBlur = 0;
  const g = c.createLinearGradient(0, 50, 0, 220);
  g.addColorStop(0, "#fffbe0");
  g.addColorStop(1, "#ffd23e");
  c.fillStyle = g;
  c.fillText("", 512, 136);
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/**
 * Rush: Groove City at dusk. Neon towers and shopfronts scroll past on a
 * rain-slick avenue under string lights, toward a golden gate and a skyline
 * lit by fireworks.
 */
export function rushVenue(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x1c0a28, 0.0085);
  stage.scene.background = new T.Color(0x12071f);
  const sky = skyDome(root, { top: 0x07031a, horizon: 0x7a1e52, bottom: 0x12071f, stars: 0.7 });
  // Synthwave sun on the horizon, and a far skyline in silhouette.
  const sunMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        vec3 top = vec3(1.0, 0.86, 0.32), bot = vec3(1.0, 0.18, 0.55);
        vec3 c = mix(bot, top, smoothstep(-0.9, 0.9, p.y)) * 0.8;
        float band = step(0.0, sin((p.y + uTime * 0.05) * 28.0) + 0.9 + p.y * 1.4);
        float disc = smoothstep(1.0, 0.985, r) * (p.y > -0.1 ? 1.0 : band);
        float glow = smoothstep(1.9, 0.9, r) * 0.1;
        gl_FragColor = vec4(c * disc + bot * glow * (1.0 + uPulse * 0.3), max(disc, glow));
      }`,
  });
  const sun = new T.Mesh(new T.PlaneGeometry(90, 90), sunMat);
  sun.position.set(0, 18, -185);
  root.add(sun);
  const skyline: T.BufferGeometry[] = [];
  const srng = seeded(77);
  for (let i = 0; i < 70; i++) {
    const w = 3 + srng() * 7, h = 8 + srng() * 38;
    const g = new T.BoxGeometry(w, h, 3);
    g.translate((i - 35) * 5.2 + srng() * 3, h / 2 - 1, -160 - srng() * 12);
    skyline.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(skyline)!, new T.MeshBasicMaterial({ color: 0x0a0414, fog: false })));

  // Wet avenue: a mirror for the neon, darker sidewalks with glowing curbs.
  const road = glossFloor(root, new T.PlaneGeometry(10.5, 220), { resolution: 0.38, strength: 0.55, tint: 0x9a86b0, blur: 0.006 });
  road.position.set(0, 0, -90);
  const walk = new T.Mesh(new T.PlaneGeometry(40, 240), new T.MeshStandardMaterial({ color: 0x120a1e, roughness: 0.45, metalness: 0.4 }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, -0.01, -90);
  root.add(walk);
  const curbMat = neon(PT.cyan, 1.8);
  const curbL = new T.Mesh(new T.BoxGeometry(0.1, 0.12, 240), curbMat);
  curbL.position.set(-5.3, 0.06, -90);
  const curbR = curbL.clone();
  curbR.position.x = 5.3;
  root.add(curbL, curbR);

  const facade = facadeMaterial();
  const signMats = [
    [0, "#ffd23e"],
    [1, "#3fe0ff"],
    [2, "#ff3fb4"],
    [3, "#b58cff"],
  ].map(([k, col]) => new T.MeshBasicMaterial({ map: signTexture(k as number, col as string), color: new T.Color(1.35, 1.35, 1.35), transparent: true }));
  const stripMat = neon(PT.magenta, 2.0);
  const warmMat = new T.MeshBasicMaterial({ map: shopTexture(), color: new T.Color(1.1, 1.1, 1.1) });
  const boardMats = [0, 1, 2, 3].map((k) => new T.MeshBasicMaterial({ map: signTexture(k, ["#ff3fb4", "#3fe0ff", "#ffd23e", "#b58cff"][k]), color: new T.Color(1.25, 1.25, 1.25), transparent: true }));
  const awningMats = [neon(PT.cyan, 1.2), neon(PT.magenta, 1.2), neon(PT.gold, 1.0)];
  const bulbMat = new T.MeshBasicMaterial({ color: new T.Color(1, 0.8, 0.45).multiplyScalar(2.0) });
  const wireMat = new T.MeshBasicMaterial({ color: 0x1a1024 });
  const palmTrunk = new T.MeshStandardMaterial({ color: 0x2a1a2a, roughness: 0.8 });
  const palmLeaf = new T.MeshStandardMaterial({ color: 0x0f3a3a, roughness: 0.7, emissive: 0x0a2a2a, emissiveIntensity: 0.4, side: T.DoubleSide });
  const rng = seeded(31);
  const chunks: T.Group[] = [];
  for (let chunk = 0; chunk < 3; chunk++) {
    const g = new T.Group();
    root.add(g);
    chunks.push(g);
    const towers: T.BufferGeometry[] = [],
      signs: T.BufferGeometry[][] = [[], [], [], []],
      strips: T.BufferGeometry[] = [],
      warm: T.BufferGeometry[] = [],
      awnings: T.BufferGeometry[][] = [[], [], []],
      bulbs: T.BufferGeometry[] = [],
      boards: T.BufferGeometry[][] = [[], [], [], []],
      wires: T.BufferGeometry[] = [],
      trunks: T.BufferGeometry[] = [],
      leaves: T.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const z = -i * 6;
      for (const side of [-1, 1]) {
        const w = 5 + rng() * 2.5,
          h = 9 + rng() * 22,
          d = 5.5;
        const x = side * (8.2 + w / 2 + rng() * 1.5);
        const tower = new T.BoxGeometry(w, h, d);
        tower.translate(x, h / 2, z - 3);
        towers.push(tower);
        // shopfront glow and awning at street level
        const shop = new T.PlaneGeometry(d * 0.7, 1.8);
        shop.rotateY(-side * Math.PI / 2);
        shop.translate(x - side * (w / 2 + 0.02), 1.3, z - 3);
        warm.push(shop);
        const awn = new T.BoxGeometry(1.3, 0.12, d * 0.85);
        awn.translate(x - side * (w / 2 + 0.62), 2.7, z - 3);
        awnings[(i + (side > 0 ? 1 : 0)) % 3].push(awn);
        // big LED billboards angled toward the runner
        if ((i + chunk) % 4 === 1 && h > 16) {
          const bw = 6.4,
            bh = 1.6;
          const b = new T.PlaneGeometry(bw, bh * 2);
          b.rotateY(-side * Math.PI / 2 + side * 0.5);
          b.translate(x - side * (w / 2 + 0.8), 9 + rng() * 5, z - 3);
          boards[(i + chunk + (side > 0 ? 1 : 0)) % 4].push(b);
        }
        // vertical neon edge
        if (rng() < 0.6) {
          const st = new T.BoxGeometry(0.12, h * 0.8, 0.12);
          st.translate(x - side * (w / 2 + 0.05), h * 0.45, z - 3 + d / 2 - 0.1);
          strips.push(st);
        }
        // symbol sign
        if (rng() < 0.75) {
          const size = 2 + rng() * 1.6;
          const sg = new T.PlaneGeometry(size, size);
          sg.rotateY(-side * Math.PI / 2);
          sg.translate(x - side * (w / 2 + 0.06), 4.2 + rng() * Math.max(1, h - 9), z - 3 + (rng() - 0.5) * 2);
          signs[Math.floor(rng() * 4)].push(sg);
        }
      }
      // string lights across the avenue
      if (i % 2 === 0) {
        const pts: T.Vector3[] = [];
        for (let k = 0; k <= 16; k++) {
          const u = k / 16;
          pts.push(new T.Vector3(-7.8 + u * 15.6, 7.2 - Math.sin(u * Math.PI) * 1.4, z - 1));
        }
        wires.push(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.015, 3, false));
        for (let k = 1; k < 16; k++) {
          const b = new T.SphereGeometry(0.09, 6, 4);
          b.translate(pts[k].x, pts[k].y - 0.12, pts[k].z);
          bulbs.push(b);
        }
      }
      // palms along the sidewalk
      if (i % 3 === 1)
        for (const side of [-1, 1]) {
          const px = side * 6.4,
            pz = z - 2;
          const trunk = new T.CylinderGeometry(0.1, 0.18, 6.5, 6);
          trunk.translate(px, 3.25, pz);
          trunks.push(trunk);
          for (let f = 0; f < 7; f++) {
            const leaf = new T.ConeGeometry(0.35, 2.6, 3);
            leaf.scale(1, 1, 0.12);
            leaf.translate(0, 1.3, 0);
            leaf.rotateZ(1.2 + rng() * 0.3);
            leaf.rotateY((f / 7) * Math.PI * 2);
            leaf.translate(px, 6.4, pz);
            leaves.push(leaf);
          }
        }
    }
    const add = (geos: T.BufferGeometry[], mat: T.Material) => {
      if (!geos.length) return;
      const m = new T.Mesh(mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)))!, mat);
      g.add(m);
    };
    add(towers, facade);
    signs.forEach((geos, k) => add(geos, signMats[k]));
    add(strips, stripMat);
    add(warm, warmMat);
    awnings.forEach((geos, k) => add(geos, awningMats[k]));
    add(bulbs, bulbMat);
    boards.forEach((geos, k) => add(geos, boardMats[k]));
    add(wires, wireMat);
    add(trunks, palmTrunk);
    add(leaves, palmLeaf);
    // lane dashes
    const dashes: T.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++)
      for (const x of [-1.45, 1.45]) {
        const d = new T.BoxGeometry(0.08, 0.02, 2.4);
        d.translate(x, 0.012, -i * 6);
        dashes.push(d);
      }
    add(dashes, neon(0xf2e8ff, 0.8));
  }

  // The golden gate over the avenue.
  const gate = new T.Group();
  root.add(gate);
  const gateMetal = new T.MeshStandardMaterial({ color: 0x2a1640, roughness: 0.3, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const p = new T.Mesh(new T.BoxGeometry(0.9, 11, 0.9), gateMetal);
    p.position.set(s * 6.2, 5.5, 0);
    gate.add(p);
    const tube = new T.Mesh(new T.BoxGeometry(0.1, 10.5, 0.1), neon(PT.gold, 2.2));
    tube.position.set(s * 5.72, 5.4, 0.46);
    gate.add(tube);
  }
  const archCurve = new T.CatmullRomCurve3([
    new T.Vector3(-6.2, 10.6, 0.5),
    new T.Vector3(-3.5, 12.8, 0.5),
    new T.Vector3(0, 13.6, 0.5),
    new T.Vector3(3.5, 12.8, 0.5),
    new T.Vector3(6.2, 10.6, 0.5),
  ]);
  gate.add(new T.Mesh(new T.TubeGeometry(archCurve, 40, 0.12, 8, false), neon(PT.gold, 2.4)));
  const beam = new T.Mesh(new T.BoxGeometry(13.2, 1.8, 0.7), gateMetal);
  beam.position.set(0, 10.4, 0);
  gate.add(beam);
  const gateSign = new T.Mesh(new T.PlaneGeometry(10.5, 2.6), new T.MeshBasicMaterial({ map: gateTexture(), transparent: true, color: new T.Color(1.15, 1.15, 1.15), depthWrite: false }));
  gateSign.position.set(0, 12.2, 0.6);
  gateSign.visible = false;
  gate.add(gateSign);

  // Fireworks over the skyline on phrase boundaries and level-ups.
  const fireworks = new Sparks(root, 1400, -3.2);
  (fireworks.mesh.material as T.ShaderMaterial).uniforms.uSize.value = 0.35;
  const colors = [PT.magenta, PT.gold, PT.cyan, 0xff7a3a, PT.violet];
  let fwIndex = 0;
  const firework = (big = false) => {
    const at = new T.Vector3((rng() - 0.5) * 70, 26 + rng() * 16, -120 - rng() * 30);
    fireworks.emit(at, colors[fwIndex++ % colors.length], big ? 160 : 90, big ? 16 : 11, 1.8);
  };
  show.onBeat((b) => {
    if (b % 8 === 0) firework(false);
    if (b % 16 === 0 && show.level >= 2) firework(true);
  });
  const sparks = new Sparks(root, 500, -8);
  const confetti = new Confetti(root, { count: 360, area: new T.Box3(new T.Vector3(-5, 0, -12), new T.Vector3(5, 8, 4)), ambient: 0 });
  show.onLevel((_, up) => {
    if (up) {
      confetti.burst(160);
      firework(true);
      firework(true);
    }
  });

  // Speed streaks along the sidewalks.
  const streakCount = 90;
  const streakPos = new Float32Array(streakCount * 3);
  for (let i = 0; i < streakCount; i++) streakPos.set([(rng() < 0.5 ? -1 : 1) * (5.6 + rng() * 2), 0.3 + rng() * 5, -rng() * 80], i * 3);
  const streakGeo = new T.BufferGeometry();
  streakGeo.setAttribute("position", new T.BufferAttribute(streakPos, 3).setUsage(T.DynamicDrawUsage));
  const streaks = new T.Points(
    streakGeo,
    new T.PointsMaterial({ map: softDot(), size: 0.18, color: new T.Color(0xffc8f0).multiplyScalar(1.2), transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
  );
  root.add(streaks);

  let last = 0,
    lastDistance = 0;
  return {
    root,
    sparks,
    confetti,
    update(distance: number, t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      const speed = Math.max(0, distance - lastDistance);
      lastDistance = distance;
      sky.update(t);
      sunMat.uniforms.uTime.value = t;
      sunMat.uniforms.uPulse.value = show.pulse;
      chunks.forEach((g, i) => {
        g.position.z = ((distance - i * CHUNK + CHUNK * 3) % (CHUNK * 3)) - 120;
      });
      gate.position.z = -110 + (distance % 160);
      facade.uniforms.uTime.value = t;
      (facade.uniforms.uA.value as T.Color).copy(show.colorA);
      (facade.uniforms.uB.value as T.Color).copy(show.colorB);
      stripMat.color.copy(show.colorA).multiplyScalar(1.1 + show.pulse * 0.9);
      curbMat.color.copy(show.colorB).multiplyScalar(0.9 + show.pulse * 0.6);
      bulbMat.color.setRGB(1, 0.78, 0.42).multiplyScalar(1.4 + show.pulse * 0.9);
      for (let i = 0; i < streakCount; i++) {
        let z = streakPos[i * 3 + 2] + speed * 1.6;
        if (z > 8) z -= 88;
        streakPos[i * 3 + 2] = z;
      }
      streakGeo.attributes.position.needsUpdate = true;
      fireworks.update(dt);
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}

/** Obstacle and pickup models for Rush. */
export function rushProp(kind: string) {
  const g = new T.Group();
  if (kind === "block") {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = "#ff5a2a";
    for (let i = -2; i < 8; i++) {
      c.beginPath();
      c.moveTo(i * 48, 128);
      c.lineTo(i * 48 + 24, 128);
      c.lineTo(i * 48 + 72, 0);
      c.lineTo(i * 48 + 48, 0);
      c.fill();
    }
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    const board = new T.Mesh(new T.BoxGeometry(1.9, 0.9, 0.18), new T.MeshStandardMaterial({ map: tex, emissive: 0xff4a1a, emissiveIntensity: 0.25, emissiveMap: tex, roughness: 0.5 }));
    board.position.y = 1.0;
    g.add(board);
    const frame = new T.MeshStandardMaterial({ color: 0x1a1030, metalness: 0.7, roughness: 0.3 });
    for (const x of [-0.85, 0.85]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.1, 1.5, 0.1), frame);
      leg.position.set(x, 0.75, 0);
      g.add(leg);
    }
    const glowBar = new T.Mesh(new T.BoxGeometry(1.94, 0.06, 0.2), neon(0xff6a3a, 2.4));
    glowBar.position.y = 1.48;
    g.add(glowBar);
    for (const x of [-0.7, 0, 0.7]) {
      const lamp = new T.Mesh(new T.SphereGeometry(0.07, 10, 8), neon(0xffb020, 3));
      lamp.position.set(x, 1.58, 0);
      lamp.userData.blink = true;
      g.add(lamp);
    }
  } else if (kind === "hurdle") {
    for (const x of [-0.9, 0.9]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.07, 0.6, 0.08), new T.MeshStandardMaterial({ color: 0x1a1030 }));
      leg.position.set(x, 0.3, 0);
      g.add(leg);
    }
    const bar = new T.Mesh(new T.BoxGeometry(1.9, 0.16, 0.14), neon(PT.magenta, 2.2));
    bar.position.y = 0.62;
    g.add(bar);
  } else if (kind === "bar") {
    for (const x of [-0.93, 0.93]) {
      const post = new T.Mesh(new T.BoxGeometry(0.08, 2.4, 0.1), new T.MeshStandardMaterial({ color: 0x1a1030, metalness: 0.7, roughness: 0.3 }));
      post.position.set(x, 1.2, 0);
      g.add(post);
    }
    const bar = new T.Mesh(new T.BoxGeometry(1.94, 0.26, 0.2), neon(PT.cyan, 2.2));
    bar.position.y = 1.48;
    g.add(bar);
  } else if (kind === "coin") {
    const disc = new T.Mesh(
      new T.CylinderGeometry(0.3, 0.3, 0.05, 36),
      new T.MeshStandardMaterial({ color: 0x14100c, roughness: 0.25, metalness: 0.6, emissive: 0x3a2a08, emissiveIntensity: 0.4 }),
    );
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
    const label = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.056, 24), neon(PT.gold, 2.2));
    label.rotation.x = Math.PI / 2;
    g.add(label);
    const rim = new T.Mesh(new T.TorusGeometry(0.3, 0.025, 8, 36), neon(0xffc040, 2.6));
    g.add(rim);
    g.position.y = 1;
  } else {
    const orb = new T.Mesh(new T.IcosahedronGeometry(0.28, 2), new T.MeshStandardMaterial({ color: 0x0a2a3a, emissive: PT.cyan, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.4 }));
    g.add(orb);
    const ring = new T.Mesh(new T.TorusGeometry(0.42, 0.02, 8, 40), neon(PT.cyan, 2.4));
    g.add(ring);
    g.position.y = 1;
  }
  return g;
}
