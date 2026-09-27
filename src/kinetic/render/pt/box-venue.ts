import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Stage } from "../stage";
import { PT, neon } from "./palette";
import { MovingHeads, Crowd, Confetti, Sparks, LedWall, Lasers, neonTube } from "./fx";
import type { ShowDirector } from "./show";

/** Canvas art for the ring canvas: a star medallion and rings, no words. */
function ringCanvasTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1024;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(512, 512, 60, 512, 512, 720);
  g.addColorStop(0, "#2a1660");
  g.addColorStop(0.55, "#170b3a");
  g.addColorStop(1, "#0b0620");
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 1024);
  c.strokeStyle = "rgba(255,255,255,0.08)";
  c.lineWidth = 3;
  for (let i = 0; i < 1024; i += 64) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, 1024);
    c.stroke();
  }
  c.lineWidth = 10;
  c.strokeStyle = "#ff3fb4";
  c.beginPath();
  c.arc(512, 512, 250, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = "#3fe0ff";
  c.lineWidth = 6;
  c.beginPath();
  c.arc(512, 512, 285, 0, Math.PI * 2);
  c.stroke();
  // five-point star
  c.save();
  c.translate(512, 512);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 80 : 190,
      a = -Math.PI / 2 + (i * Math.PI) / 5;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  const sg = c.createLinearGradient(0, -190, 0, 190);
  sg.addColorStop(0, "#ffe680");
  sg.addColorStop(1, "#ff9a1a");
  c.fillStyle = sg;
  c.globalAlpha = 0.55;
  c.fill();
  c.restore();
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Big LED banner art: a chunky italic slogan over a magenta sweep. */
export function bannerTexture(text: string, sub = "") {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 1024, 256);
  g.addColorStop(0, "#2a0f6e");
  g.addColorStop(0.5, "#c0187e");
  g.addColorStop(1, "#1d0a52");
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 256);
  for (let i = -4; i < 20; i++) {
    c.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(63,224,255,0.08)";
    c.beginPath();
    c.moveTo(i * 90, 256);
    c.lineTo(i * 90 + 60, 256);
    c.lineTo(i * 90 + 160, 0);
    c.lineTo(i * 90 + 100, 0);
    c.fill();
  }
  c.font = 'italic 900 150px "Barlow Condensed", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  let px = 150;
  while (c.measureText(text).width > 940 && px > 60) {
    px -= 6;
    c.font = `italic 900 ${px}px "Barlow Condensed", sans-serif`;
  }
  c.lineWidth = 12;
  c.strokeStyle = "#12063a";
  c.strokeText(text, 512, sub ? 112 : 132);
  const tg = c.createLinearGradient(0, 60, 0, 200);
  tg.addColorStop(0, "#ffffff");
  tg.addColorStop(0.6, "#ffe0f4");
  tg.addColorStop(1, "#7fe7ff");
  c.fillStyle = tg;
  c.fillText(text, 512, sub ? 112 : 132);
  if (sub) {
    c.font = '800 44px "Barlow Condensed", sans-serif';
    c.fillStyle = "#ffd23e";
    c.fillText(sub, 512, 212);
  }
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/**
 * Boxing: a neon-roped ring in an open-air arena at dusk. The painted plate
 * carries the stands and skyline; the ring, crowd, truss and LED banner are
 * live and react to the show.
 */
export function boxVenue(stage: Stage, show: ShowDirector) {
  const root = new T.Group();
  stage.scene.add(root);
  stage.scene.fog = new T.FogExp2(0x06030e, 0.03);
  stage.scene.background = new T.Color(0x030108);
  stage.scene.children.filter((c) => c instanceof T.HemisphereLight).forEach((h) => ((h as T.HemisphereLight).intensity = 0.3));
  // Arena bowl: dark tiers rising behind the ring.
  const tierMat = new T.MeshStandardMaterial({ color: 0x0a0714, roughness: 0.8, metalness: 0.2 });
  for (let k = 0; k < 5; k++) {
    const tier = new T.Mesh(new T.CylinderGeometry(9 + k * 1.6, 9 + k * 1.6, 0.9, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76), tierMat);
    tier.material.side = T.DoubleSide;
    tier.position.set(0, -0.2 + k * 0.9, 0.5);
    root.add(tier);
  }

  // Arena floor around the ring.
  const floor = new T.Mesh(new T.CircleGeometry(40, 48), new T.MeshStandardMaterial({ color: 0x0b0618, roughness: 0.35, metalness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.62;
  root.add(floor);

  // The ring: canvas, apron with LED strip, posts, ropes.
  const ring = new T.Group();
  root.add(ring);
  const canvasTop = new T.Mesh(new T.BoxGeometry(7.4, 0.6, 7), [
    new T.MeshStandardMaterial({ color: 0x120a2c, roughness: 0.6 }),
    new T.MeshStandardMaterial({ color: 0x120a2c, roughness: 0.6 }),
    new T.MeshStandardMaterial({ map: ringCanvasTexture(), roughness: 0.75 }),
    new T.MeshStandardMaterial({ color: 0x120a2c }),
    new T.MeshStandardMaterial({ color: 0x120a2c, roughness: 0.6 }),
    new T.MeshStandardMaterial({ color: 0x120a2c, roughness: 0.6 }),
  ]);
  canvasTop.position.set(0, -0.3, 0.2);
  canvasTop.receiveShadow = true;
  ring.add(canvasTop);
  const apronMat = neon(PT.magenta, 1.8);
  const apron: T.BufferGeometry[] = [];
  for (const [w, d, x, z] of [
    [7.5, 0.06, 0, 3.72],
    [7.5, 0.06, 0, -3.32],
    [0.06, 7.1, -3.72, 0.2],
    [0.06, 7.1, 3.72, 0.2],
  ]) {
    const g = new T.BoxGeometry(w, 0.07, d);
    g.translate(x, -0.08, z);
    apron.push(g);
  }
  ring.add(new T.Mesh(mergeGeometries(apron)!, apronMat));
  const postMat = new T.MeshStandardMaterial({ color: 0x1a1430, roughness: 0.3, metalness: 0.85 });
  const padMat = [new T.MeshStandardMaterial({ color: PT.right, roughness: 0.45 }), new T.MeshStandardMaterial({ color: PT.left, roughness: 0.45 })];
  const posts: T.BufferGeometry[] = [];
  const corners: [number, number][] = [
    [-3.4, -2.9],
    [3.4, -2.9],
    [-3.4, 3.3],
    [3.4, 3.3],
  ];
  corners.forEach(([x, z], i) => {
    const g = new T.CylinderGeometry(0.09, 0.11, 1.75, 12);
    g.translate(x, 0.87, z);
    posts.push(g);
    const pad = new T.Mesh(new T.BoxGeometry(0.28, 1.3, 0.28), padMat[i % 2]);
    pad.position.set(x, 0.85, z);
    ring.add(pad);
  });
  ring.add(new T.Mesh(mergeGeometries(posts)!, postMat));
  const ropes: T.Mesh[] = [];
  const ropeColors = [PT.cyan, PT.white, PT.magenta];
  [0.48, 0.92, 1.36].forEach((y, k) => {
    const pts = [
      new T.Vector3(-3.4, y, 3.3),
      new T.Vector3(-3.4, y, -2.9),
      new T.Vector3(3.4, y, -2.9),
      new T.Vector3(3.4, y, 3.3),
    ];
    for (let s = 0; s < 3; s++) {
      const m = neonTube(ring, [pts[s], pts[s + 1]], ropeColors[k], { radius: 0.028, intensity: 1.6, segments: 4 });
      ropes.push(m);
    }
  });
  // Spotlight pool on the canvas where the coach stands.
  const pool = new T.Mesh(
    new T.CircleGeometry(1.5, 48),
    new T.MeshBasicMaterial({ color: new T.Color(0xbfd8ff).multiplyScalar(0.14), transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.012, 0.1);
  ring.add(pool);

  // Stands of fans around the ring, lit by phone lights and light sticks.
  const crowd = new Crowd(root, {
    count: 260,
    seed: 17,
    scale: 1.0,
    area: (r) => {
      const k = Math.floor(r() * 5);
      const a = Math.PI + (r() - 0.5) * 2.3,
        rad = 9.3 + k * 1.6 + r() * 0.4;
      const x = Math.sin(a) * rad,
        z = 0.5 + Math.cos(a) * rad;
      return { x, y: 0.25 + k * 0.9, z, ry: Math.atan2(-x, -z + 0.5) };
    },
  });
  // The ring is lit from a square rig overhead; the arena stays dark.
  const rigMat = neon(0xfff1e0, 2.4);
  const rig: T.BufferGeometry[] = [];
  for (const [w, d, x, z] of [
    [7.6, 0.18, 0, 3.6],
    [7.6, 0.18, 0, -3.2],
    [0.18, 6.8, -3.8, 0.2],
    [0.18, 6.8, 3.8, 0.2],
  ]) {
    const g = new T.BoxGeometry(w, 0.1, d);
    g.translate(x, 6.4, z);
    rig.push(g);
  }
  root.add(new T.Mesh(mergeGeometries(rig)!, rigMat));
  const ringLight = new T.SpotLight(0xfff4ea, 9, 18, 0.62, 0.55, 1.2);
  ringLight.position.set(0, 7.2, 0.4);
  ringLight.target.position.set(0, 0, 0.2);
  ringLight.castShadow = true;
  ringLight.shadow.mapSize.set(1024, 1024);
  root.add(ringLight, ringLight.target);

  // Truss with moving heads and the LED banner above the ring.
  const heads = new MovingHeads(root, {
    count: 6,
    from: new T.Vector3(-5.5, 6.2, -5.4),
    to: new T.Vector3(5.5, 6.2, -5.4),
    length: 11,
    radius: 0.9,
    aim: new T.Vector3(0, 0, 1),
    strength: 0.55,
  });
  const heads2 = new MovingHeads(root, {
    count: 4,
    from: new T.Vector3(-8, 7.5, -8),
    to: new T.Vector3(8, 7.5, -8),
    length: 18,
    radius: 1.2,
    truss: false,
    aim: new T.Vector3(0, 12, 12),
    strength: 0.35,
    sweep: 1.6,
  });
  const banner = new LedWall(root, { width: 6.4, height: 1.6, position: new T.Vector3(0, 4.05, -6.4), grid: 64, mode: "bars", brightness: 1.1 });
  const bannerFrame = new T.Mesh(new T.BoxGeometry(6.8, 1.95, 0.25), postMat);
  bannerFrame.position.set(0, 4.05, -6.55);
  root.add(bannerFrame);
  const sideScreens = [-1, 1].map((s) => {
    const w = new LedWall(root, { width: 2.6, height: 4.2, position: new T.Vector3(s * 7.4, 3.6, -3.4), grid: 40, mode: s < 0 ? "bars" : "rings", brightness: 1 });
    w.mesh.rotation.y = -s * 0.45;
    return w;
  });
  const lasers = new Lasers(root, { emitters: [new T.Vector3(-6, 6.2, -6), new T.Vector3(6, 6.2, -6)], perEmitter: 5, length: 40, minLevel: 2 });

  const sparks = new Sparks(root, 700, -6);
  const confetti = new Confetti(root, { count: 420, area: new T.Box3(new T.Vector3(-5, 0, -4), new T.Vector3(5, 7, 3)), ambient: 0 });
  show.onLevel((_, up) => {
    if (up) confetti.burst(180);
  });
  let last = 0;
  const modes = ["bars", "chevrons", "rings"] as const;
  show.onBeat((b) => {
    if (b > 0 && b % 16 === 0) banner.setMode(modes[(b / 16) % modes.length]);
  });
  return {
    root,
    sparks,
    confetti,
    update(t: number) {
      const dt = Math.min(0.05, Math.max(0, t - last));
      last = t;
      heads.update(t, show);
      heads2.update(t * 0.7, show);
      banner.update(t, show);
      sideScreens.forEach((w) => w.update(t, show));
      lasers.update(t, show);
      crowd.update(show);
      apronMat.color.copy(show.colorA).multiplyScalar(1.1 + show.pulse * 1.1);
      ropes.forEach((r, i) => {
        const c = [show.colorB, new T.Color(PT.white), show.colorA][Math.floor(i / 3)];
        (r.material as T.MeshBasicMaterial).color.copy(c).multiplyScalar(0.75 + show.pulse * 0.6 + show.flash * 0.4);
      });
      (pool.material as T.MeshBasicMaterial).color.setRGB(0.75, 0.85, 1).multiplyScalar(0.12 + show.pulse * 0.06);
      rigMat.color.setRGB(1, 0.95, 0.88).multiplyScalar(2.1 + show.pulse * 0.6 + show.flash * 0.8);
      ringLight.intensity = 9 + show.flash * 4;
      sparks.update(dt);
      confetti.update(dt, t);
    },
  };
}
