import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon } from "./palette";
import { Confetti, Sparks } from "./fx";
import { nebulaWall } from "./court-venue";
import type { ShowDirector } from "./show";

/**
 * Cosmic bowling lane at game scale. Real bowling proportions, enlarged 1.6x
 * so the pins read from the approach: a 1.7 m lane with rounded gutters,
 * aiming arrows and dots, a pin deck, the pit and a masking arch, with
 * neighbor lanes and a nebula mural beyond. The foul line is z = 0 and the
 * pins stand toward -z.
 */
export const LANE = {
  halfWidth: 0.85,
  gutter: 0.34,
  gutterDepth: 0.1,
  foul: 0,
  end: -17.2,
  headPin: -15.4,
  spacing: 0.49,
  ballR: 0.18,
  pinH: 0.62,
};

/** The ten pin spots, head pin first (standard numbering 1-10). */
export function pinSpots() {
  const spots: T.Vector3[] = [];
  const row = LANE.spacing * Math.sin(Math.PI / 3);
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) spots.push(new T.Vector3((i - r / 2) * LANE.spacing, 0, LANE.headPin - r * row));
  return spots;
}

export function bowlLane(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x05020d, 0.02);
  stage.scene.background = new T.Color(0x030108);
  const nebula = nebulaWall(root, { width: 30, height: 12, position: new T.Vector3(0, 5.2, -24) });
  const hall = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: 0x07040f, roughness: 0.8 }));
  hall.rotation.x = -Math.PI / 2;
  hall.position.set(0, -0.62, -10);
  root.add(hall);
  const L = LANE.end - LANE.foul;
  const laneMat = new T.ShaderMaterial({
    fog: true,
    uniforms: { ...T.UniformsLib.fog, uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new T.Color(PT.violet) }, uB: { value: new T.Color(PT.cyan) }, uLen: { value: Math.abs(L) } },
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPulse; uniform vec3 uA; uniform vec3 uB; uniform float uLen;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float along = vUv.y * uLen;          // meters from the foul line
        float boards = smoothstep(0.0, 0.06, abs(fract(vUv.x * 39.0) - 0.5));
        vec3 wood = mix(vec3(0.006, 0.004, 0.014), vec3(0.016, 0.01, 0.03), boards);
        // a glossy strip of oil down the middle catches the lights
        float oil = smoothstep(0.5, 0.0, abs(vUv.x - 0.5)) * smoothstep(12.0, 3.0, along);
        vec3 c = wood + vec3(0.012, 0.01, 0.028) * oil;
        // UV galaxy print
        vec2 p = vec2(vUv.x * 3.0, along * 0.35);
        float n = sin(p.x * 2.1 + sin(p.y * 0.6 + uTime * 0.2) * 2.0) * sin(p.y * 0.5 - uTime * 0.15);
        c += mix(uA, uB, 0.5 + 0.5 * n) * 0.02 * (0.7 + 0.3 * uPulse);
        float star = step(0.9975, hash(floor(vec2(vUv.x * 80.0, along * 6.0))));
        c += vec3(0.8, 0.9, 1.0) * star * 0.4;
        // aiming arrows 4.6 m out, in a shallow V, every fifth board
        float bx = vUv.x * 39.0;
        float k = mod(floor(bx) - 4.0, 5.0);
        float col = abs(floor(bx) - 19.0);
        float at = 4.6 + col * 0.09;
        float arrow = step(k, 0.5) * step(abs(along - at), 0.22) * step(abs(fract(bx) - 0.5), 0.5 - (along - at + 0.22) * 1.0);
        c += uB * arrow * 1.4;
        // guide dots 2 m out
        float dot1 = step(k, 0.5) * step(length(vec2((fract(bx) - 0.5) * 0.4, along - 2.1)), 0.06);
        c += uB * dot1 * 1.2;
        // pin deck: lighter wood past the head pin line
        float deck = smoothstep(uLen - 2.4, uLen - 2.2, along);
        c = mix(c, vec3(0.05, 0.036, 0.08) + mix(uA, uB, 0.5) * 0.02, deck * 0.8);
        // foul line
        c += vec3(1.0, 0.25, 0.5) * step(abs(along - 0.02), 0.025) * 1.5;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  const lane = new T.Mesh(new T.PlaneGeometry(LANE.halfWidth * 2, Math.abs(L)).rotateX(-Math.PI / 2).translate(0, 0, L / 2), laneMat);
  root.add(lane);
  // approach: a darker floor where you stand
  const approach = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshStandardMaterial({ color: 0x0b0718, roughness: 0.55, metalness: 0.2 }));
  approach.rotation.x = -Math.PI / 2;
  approach.position.set(0, -0.001, 2.5);
  root.add(approach);
  // rounded gutters and capping on both sides, neon lined
  const gutterMat = new T.MeshStandardMaterial({ color: 0x151027, roughness: 0.35, metalness: 0.6, side: T.DoubleSide });
  const gutterGeo: T.BufferGeometry[] = [];
  const capGeo: T.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const shape = new T.Shape();
    const w = LANE.gutter,
      d = LANE.gutterDepth;
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(w / 2, -d * 2, w, 0);
    const pts = shape.getPoints(10).map((p) => new T.Vector3(p.x, p.y, 0));
    const g = new T.BufferGeometry();
    const pos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      pos.push(a.x, a.y, 0, b.x, b.y, 0, a.x, a.y, L, b.x, b.y, 0, b.x, b.y, L, a.x, a.y, L);
    }
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.translate(s > 0 ? LANE.halfWidth : -LANE.halfWidth - LANE.gutter, 0, 0);
    gutterGeo.push(g);
    const cap = new T.BoxGeometry(0.14, 0.05, Math.abs(L) + 4);
    cap.translate(s * (LANE.halfWidth + LANE.gutter + 0.07), 0.02, L / 2 + 2);
    capGeo.push(cap);
  }
  root.add(new T.Mesh(mergeGeometries(gutterGeo)!, gutterMat));
  const capMat = neon(PT.magenta, 1.3);
  root.add(new T.Mesh(mergeGeometries(capGeo)!, capMat));
  // the pit behind the deck and a kickback wall each side
  const pit = new T.Mesh(new T.BoxGeometry(LANE.halfWidth * 2 + LANE.gutter * 2 + 0.3, 0.02, 2.2), new T.MeshBasicMaterial({ color: 0x010003 }));
  pit.position.set(0, -0.58, LANE.end - 1.1);
  root.add(pit);
  const kickMat = new T.MeshStandardMaterial({ color: 0x0e0a1e, roughness: 0.4, metalness: 0.7 });
  for (const s of [-1, 1]) {
    const k = new T.Mesh(new T.BoxGeometry(0.08, 0.55, 3.2), kickMat);
    k.position.set(s * (LANE.halfWidth + LANE.gutter + 0.12), 0.2, LANE.end + 0.5);
    root.add(k);
    const trim = new T.Mesh(new T.BoxGeometry(0.1, 0.03, 3.2), neon(PT.cyan, 1.4));
    trim.position.set(s * (LANE.halfWidth + LANE.gutter + 0.12), 0.48, LANE.end + 0.5);
    root.add(trim);
  }
  // masking arch over the pit
  const archMat = neon(PT.cyan, 1.8);
  const arch = new T.CatmullRomCurve3([
    new T.Vector3(-1.4, 0, LANE.end - 0.4),
    new T.Vector3(-1.4, 1.5, LANE.end - 0.4),
    new T.Vector3(0, 2.1, LANE.end - 0.4),
    new T.Vector3(1.4, 1.5, LANE.end - 0.4),
    new T.Vector3(1.4, 0, LANE.end - 0.4),
  ]);
  root.add(new T.Mesh(new T.TubeGeometry(arch, 36, 0.04, 6, false), archMat));
  const mask = new T.Mesh(new T.PlaneGeometry(3.2, 1.1), new T.MeshBasicMaterial({ color: 0x05020c }));
  mask.position.set(0, 1.6, LANE.end - 0.45);
  root.add(mask);
  // deck glow under the pins
  const deckGlow = new T.Mesh(new T.PlaneGeometry(2.4, 2.6), new T.MeshBasicMaterial({ color: new T.Color(PT.violet).multiplyScalar(0.45), transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  deckGlow.rotation.x = -Math.PI / 2;
  deckGlow.position.set(0, 0.004, LANE.headPin - 0.7);
  root.add(deckGlow);
  // neighbor lanes, dimmer, for a sense of place
  for (const s of [-1, 1]) {
    const n = new T.Mesh(new T.PlaneGeometry(LANE.halfWidth * 2, Math.abs(L)).rotateX(-Math.PI / 2).translate(s * 2.9, -0.005, L / 2), laneMat);
    root.add(n);
    const a2 = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(arch.points.map((p) => p.clone().add(new T.Vector3(s * 2.9, 0, 0)))), 36, 0.035, 6, false), neon(PT.violet, 1.1));
    root.add(a2);
  }
  // ceiling light bars rushing toward the pins
  const barMat = neon(PT.violet, 1.3);
  const bars: T.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new T.BoxGeometry(9, 0.05, 0.1);
    g.translate(0, 4.2, 2 - i * 2.4);
    bars.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(bars)!, barMat));
  // spot on the pins
  const spot = new T.SpotLight(0xf4eeff, 9, 14, 0.42, 0.6, 1.3);
  spot.position.set(0, 4.5, LANE.headPin + 2.5);
  spot.target.position.set(0, 0, LANE.headPin - 0.6);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  root.add(spot, spot.target);
  const sparks = new Sparks(root, 800, -6);
  const confetti = new Confetti(root, { count: 360, area: new T.Box3(new T.Vector3(-3, 0, -18), new T.Vector3(3, 5, 2)), ambient: 0 });
  let last = 0;
  return {
    root,
    sparks,
    confetti,
    spot,
    update(t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      laneMat.uniforms.uTime.value = t;
      nebula.update(t, show);
      laneMat.uniforms.uPulse.value = show.pulse;
      (laneMat.uniforms.uA.value as T.Color).copy(show.colorA);
      (laneMat.uniforms.uB.value as T.Color).copy(show.colorB);
      capMat.color.copy(show.colorA).multiplyScalar(1.1 + show.pulse * 0.8);
      archMat.color.copy(show.colorB).multiplyScalar(1.3 + show.pulse);
      barMat.color.copy(show.colorA).lerp(show.colorB, 0.5 + 0.5 * Math.sin(t)).multiplyScalar(0.8 + show.pulse * 0.6);
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}
