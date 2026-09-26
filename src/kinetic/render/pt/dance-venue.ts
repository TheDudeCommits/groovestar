import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon } from "./palette";
import { backdrop, MovingHeads, Lasers, LedWall, Crowd, Confetti, Sparks, Pyro, glossFloor, crowdStrip, haze, neonTube } from "./fx";
import type { ShowDirector } from "./show";

/**
 * Dance Main Stage: a round mirror stage in front of a giant curved LED
 * wall, truss lights and lasers, pyro at the stage corners and an arena
 * of fans. The hologram coach stands on a pedestal stage right.
 */
export function danceVenue(stage: Stage, show: ShowDirector, o: { crowdFront?: boolean } = {}) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x120826, 0.02);
  backdrop(root, "/kinetic/pt/plate-home.webp", { radius: 40, height: 34, arc: 2.0, y: -6, center: new T.Vector3(0, 0, 8), brightness: 0.55 });

  // Round mirror stage with neon rings and a lit lip.
  const stageR = 4.2;
  const mirror = glossFloor(root, new T.CircleGeometry(stageR, 96), { resolution: 0.45, strength: 0.62, tint: 0x9a90c0, blur: 0.004 });
  mirror.position.y = 0.001;
  const lip = new T.Mesh(
    new T.CylinderGeometry(stageR + 0.04, stageR + 0.3, 1.1, 96, 1, true),
    new T.MeshStandardMaterial({ color: 0x0c0818, roughness: 0.4, metalness: 0.6 }),
  );
  lip.position.y = -0.55;
  root.add(lip);
  const outerRing = new T.Mesh(new T.TorusGeometry(stageR, 0.035, 10, 160), neon(PT.magenta, 2.2));
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.02;
  const midRing = new T.Mesh(new T.TorusGeometry(2.6, 0.013, 8, 140), neon(PT.violet, 1.4));
  midRing.rotation.x = -Math.PI / 2;
  midRing.position.y = 0.02;
  const spotRing = new T.Mesh(new T.TorusGeometry(1.15, 0.022, 8, 120), neon(PT.cyan, 2));
  spotRing.rotation.x = -Math.PI / 2;
  spotRing.position.set(0, 0.022, 0.1);
  root.add(outerRing, midRing, spotRing);
  const lipGlow = new T.Mesh(new T.TorusGeometry(stageR + 0.28, 0.03, 8, 160), neon(PT.cyan, 1.6));
  lipGlow.rotation.x = -Math.PI / 2;
  lipGlow.position.y = -1.05;
  root.add(lipGlow);
  const floor = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshStandardMaterial({ color: 0x06040c, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.1;
  root.add(floor);
  // spotlight pool where the player dances
  const pool = new T.Mesh(
    new T.CircleGeometry(1.25, 64),
    new T.MeshBasicMaterial({ color: new T.Color(0xa8d8ff).multiplyScalar(0.3), transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.012, 0.1);
  root.add(pool);

  // Giant curved LED wall with towers.
  const led = new LedWall(root, { width: 17, height: 6.2, position: new T.Vector3(0, 3.9, -6.2), curve: 0.9, grid: 118, mode: "city", brightness: 0.82 });
  const towerMat = new T.MeshStandardMaterial({ color: 0x14102a, roughness: 0.45, metalness: 0.75 });
  const towerParts: T.BufferGeometry[] = [];
  const barParts: T.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const tower = new T.BoxGeometry(1, 9, 1);
    tower.translate(s * 9.6, 4, -5.2);
    towerParts.push(tower);
    for (let i = 0; i < 7; i++) {
      const bar = new T.BoxGeometry(0.55, 0.12, 0.12);
      bar.translate(s * 9.6, 0.8 + i * 1.15, -4.66);
      barParts.push(bar);
    }
  }
  const header = new T.BoxGeometry(20, 0.5, 0.6);
  header.translate(0, 7.3, -6.4);
  towerParts.push(header);
  root.add(new T.Mesh(mergeGeometries(towerParts)!, towerMat));
  const barMat = neon(PT.magenta, 2);
  root.add(new T.Mesh(mergeGeometries(barParts)!, barMat));
  // Side LED columns.
  const columns = [-1, 1].map((s) => {
    const w = new LedWall(root, { width: 2.2, height: 6.6, position: new T.Vector3(s * 11.8, 3.3, -3.2), grid: 30, mode: s < 0 ? "bars" : "chevrons", brightness: 0.95 });
    w.mesh.rotation.y = -s * 0.55;
    return w;
  });

  // Truss and moving heads.
  const heads = [
    new MovingHeads(root, { count: 8, from: new T.Vector3(-8.4, 7.9, -3.4), to: new T.Vector3(8.4, 7.9, -3.4), length: 13, radius: 0.85, aim: new T.Vector3(0, 0, 1.5), strength: 0.8 }),
    new MovingHeads(root, { count: 6, from: new T.Vector3(-6.4, 4.7, -1.2), to: new T.Vector3(6.4, 4.7, -1.2), length: 9, radius: 0.7, aim: new T.Vector3(0, 0, 0.6), strength: 0.5 }),
  ];
  const lasers = new Lasers(root, {
    emitters: [new T.Vector3(-9.2, 6.8, -4.8), new T.Vector3(9.2, 6.8, -4.8), new T.Vector3(-9.2, 1.2, -4.8), new T.Vector3(9.2, 1.2, -4.8)],
    perEmitter: 6,
    length: 70,
    minLevel: 2,
  });
  haze(root, {
    positions: [new T.Vector3(-4, 1.5, -3.5), new T.Vector3(4, 1.3, -3.2), new T.Vector3(0, 3.2, -4.5), new T.Vector3(-7, 0.6, -1), new T.Vector3(7, 0.6, -1)],
    size: 8,
    color: 0x6a3cff,
    opacity: 0.07,
  });

  // Audience: silhouettes on the arena floor and a foreground strip.
  const crowd = new Crowd(root, {
    count: 170,
    seed: 9,
    area: (r) => {
      const x = (r() - 0.5) * 30,
        z = 4.8 + r() * 7;
      if (Math.abs(x) < 5.2 && z < 6.2) return null;
      return { x, y: -1.1, z, ry: Math.PI };
    },
  });
  const strip = o.crowdFront === false ? null : crowdStrip(root, { width: 10.3, height: 4.4, position: new T.Vector3(0, 0.72, 4.8), brightness: 1.1 });

  // Hologram pedestal for the coach, stage right.
  const pedestal = new T.Group();
  pedestal.position.set(2.75, 0, -0.9);
  root.add(pedestal);
  const pedTop = new T.Mesh(new T.CylinderGeometry(0.62, 0.7, 0.12, 48), new T.MeshStandardMaterial({ color: 0x0e1030, roughness: 0.3, metalness: 0.8 }));
  pedTop.position.y = 0.06;
  pedestal.add(pedTop);
  const pedRing = new T.Mesh(new T.TorusGeometry(0.64, 0.02, 8, 64), neon(PT.cyan, 2.4));
  pedRing.rotation.x = -Math.PI / 2;
  pedRing.position.y = 0.125;
  pedestal.add(pedRing);
  const cone = new T.Mesh(
    new T.CylinderGeometry(0.62, 0.62, 2.1, 48, 1, true),
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime;
        void main(){ float a = pow(1.0 - vUv.y, 2.2) * 0.28 * (0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 4.0));
          gl_FragColor = vec4(vec3(0.25, 0.85, 1.0) * a, 1.0); }`,
    }),
  );
  cone.position.y = 1.15;
  pedestal.add(cone);

  // Pyro at the stage front corners, confetti cannons, hit sparks.
  const pyro = new Pyro(root, [new T.Vector3(-3.4, 0.05, 1.8), new T.Vector3(3.4, 0.05, 1.8), new T.Vector3(-4.8, 0.05, -2.5), new T.Vector3(4.8, 0.05, -2.5)]);
  const confetti = new Confetti(root, { count: 700, area: new T.Box3(new T.Vector3(-7, -0.5, -4), new T.Vector3(7, 8.5, 4.5)), ambient: 0.28 });
  const sparks = new Sparks(root, 600, -5);
  show.onLevel((level, up) => {
    if (!up) return;
    confetti.burst(220);
    confetti.burst(60, new T.Vector3(-4.6, 0.2, 1.5), 7);
    confetti.burst(60, new T.Vector3(4.6, 0.2, 1.5), 7);
    if (level >= 2) pyro.fire(1.1);
    led.setMode(level >= 3 ? "rings" : level >= 2 ? "bars" : "city");
  });
  // Big-beat cues: pyro on phrase downbeats at Headliner and above.
  show.onBeat((b) => {
    if (b > 0 && b % 16 === 0 && show.level >= 2) pyro.fire(0.6);
  });
  // A line of light tubes along the stage front.
  const frontTube = neonTube(root, [new T.Vector3(-5, -1.04, 4.6), new T.Vector3(5, -1.04, 4.6)], PT.gold, { radius: 0.03, intensity: 1.8, segments: 4 });

  let last = 0;
  return {
    root,
    led,
    sparks,
    confetti,
    pedestal,
    /** A dance judgment landed: sparks at the dancer, stage light flash. */
    judged(quality: number, at: T.Vector3) {
      if (quality <= 0) return;
      sparks.emit(at, quality >= 1 ? PT.gold : PT.cyan, Math.round(10 + 26 * quality), 3 + quality * 2.5, 0.6);
      if (quality >= 1.2) {
        confetti.burst(90);
        pyro.fire(0.5);
      }
    },
    update(t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      led.update(t, show);
      columns.forEach((c) => c.update(t, show));
      heads[0].update(t, show);
      heads[1].update(t * 0.8 + 3, show);
      lasers.update(t, show);
      crowd.update(show);
      strip?.update(show);
      (outerRing.material as T.MeshBasicMaterial).color.copy(show.colorA).multiplyScalar(1.4 + show.pulse * 1.4);
      (spotRing.material as T.MeshBasicMaterial).color.copy(show.colorB).multiplyScalar(1.3 + show.pulse * 2);
      (midRing.material as T.MeshBasicMaterial).color.copy(show.colorA).lerp(show.colorB, 0.5).multiplyScalar(0.9);
      (lipGlow.material as T.MeshBasicMaterial).color.copy(show.colorB).multiplyScalar(1.1 + show.barPulse * 0.8);
      (frontTube.material as T.MeshBasicMaterial).color.setRGB(1, 0.8, 0.3).multiplyScalar(1.2 + show.pulse);
      barMat.color.copy(show.colorA).multiplyScalar(1.3 + show.pulse * 1.2);
      (pool.material as T.MeshBasicMaterial).color.setRGB(0.66, 0.85, 1).multiplyScalar(0.22 + show.pulse * 0.12 + show.flash * 0.15);
      ((cone.material as T.ShaderMaterial).uniforms.uTime.value = t);
      pyro.update(dt);
      confetti.update(dt, t);
      sparks.update(dt);
    },
  };
}
