import * as T from "three";
import { Stage, block, material, mesh, textPlane, COLORS } from "./stage";
export function racket(color = COLORS.coral) {
  const g = new T.Group();
  const frame = mesh(
    new T.TorusGeometry(0.29, 0.024, 10, 40),
    material(color, 0.25, 0.4),
    g,
    0,
    0.28,
    0,
  );
  frame.scale.y = 1.3;
  const string = material(0xeeeae1);
  for (let i = -3; i <= 3; i++) {
    const length = Math.sqrt(1 - (i / 4) ** 2);
    block(g, 0.009, length * 0.72, 0.008, i * 0.069, 0.28, 0, string);
    block(g, length * 0.54, 0.009, 0.008, 0, 0.28 + i * 0.086, 0, string);
  }
  block(g, 0.055, 0.36, 0.06, 0, -0.29, 0, material(COLORS.ink));
  return g;
}
export function court(stage: Stage) {
  stage.floor(100, 0xe6e2d6);
  const g = new T.Group();
  stage.scene.add(g);
  block(g, 11, 0.1, 22, 0, -0.02, -7, material(0x607b5d));
  const chalk = material(COLORS.paper);
  for (const x of [-4.5, 4.5]) block(g, 0.035, 0.01, 18, x, 0.045, -7, chalk);
  for (const z of [2, -7, -16]) block(g, 9, 0.01, 0.035, 0, 0.045, z, chalk);
  for (const z of [-2, -12]) block(g, 7, 0.01, 0.035, 0, 0.045, z, chalk);
  block(g, 0.035, 0.01, 10, 0, 0.045, -7, chalk);
  for (const x of [-4.7, 4.7])
    block(g, 0.07, 1.1, 0.07, x, 0.55, -7, material(COLORS.ink));
  for (let i = 0; i < 38; i++)
    block(g, 0.01, 0.82, 0.02, -4.6 + i * 0.25, 0.45, -7, material(0x353c31));
  for (let i = 0; i < 7; i++)
    block(g, 9.4, 0.009, 0.02, 0, 0.12 + i * 0.13, -7, material(0x353c31));
  block(g, 9.4, 0.045, 0.025, 0, 0.89, -7, chalk);
  const panel = block(g, 20, 5, 0.2, 0, 2.5, -21, material(COLORS.blue));
  const tx = textPlane("GOOD THINGS / IN MOTION", "#eeeae1", 1.4);
  tx.position.set(0, 3, -20.85);
  g.add(tx);
  for (const x of [-8, 8]) {
    block(g, 0.15, 8, 0.15, x, 4, -11, material(COLORS.ink));
    block(g, 2, 0.2, 0.4, x, 8, -11, chalk);
  }
  return g;
}
export function pin() {
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
  const g = new T.Group();
  mesh(
    new T.LatheGeometry(
      profile.map(([x, y]) => new T.Vector2(x, y)),
      24,
    ),
    material(COLORS.paper, 0.25),
    g,
  );
  for (const y of [0.59, 0.66])
    mesh(
      new T.CylinderGeometry(0.076, 0.08, 0.034, 24),
      material(COLORS.coral),
      g,
      0,
      y,
      0,
    );
  return g;
}
export function alley(stage: Stage) {
  stage.floor(120, 0x32382f);
  const g = new T.Group();
  stage.scene.add(g);
  const wood = material(0xcaae7a, 0.24),
    dark = material(0x252c25),
    chalk = material(COLORS.paper);
  for (const lane of [-1, 0, 1]) {
    const x = lane * 4.8;
    block(g, 3.55, 0.1, 25, x, -0.025, -10, wood);
    for (let i = -5; i <= 5; i++)
      block(g, 0.012, 0.01, 25, x + i * 0.29, 0.032, -10, material(0xb89a65));
    for (const s of [-1, 1])
      block(g, 0.38, 0.1, 25, x + s * 1.96, -0.05, -10, dark);
    for (const dz of [-1.5, -3])
      for (let i = -2; i <= 2; i++)
        mesh(
          new T.ConeGeometry(0.045, 0.012, 3),
          material(COLORS.ink),
          g,
          x + i * 0.45,
          0.043,
          dz + Math.abs(i) * 0.13,
        );
  }
  block(g, 20, 6, 0.3, 0, 3, -23, material(COLORS.coral));
  const tx = textPlane("ON A ROLL", "#171917", 1.7);
  tx.position.set(0, 3.5, -22.8);
  g.add(tx);
  for (const x of [-6, 0, 6]) {
    const n = textPlane(x === 0 ? "07" : x < 0 ? "06" : "08", "#eeeae1", 0.5);
    n.position.set(x, 1.7, -22.7);
    g.add(n);
  }
  for (let i = 0; i < 5; i++) {
    block(g, 18, 0.15, 0.2, 0, 6, -i * 5, dark);
    block(g, 13, 0.05, 0.2, 0, 5.84, -i * 5, chalk);
  }
  return g;
}
export function fruitSculpture() {
  const group = new T.Group();
  const colors = [0xf35d42, 0xdfa63d, 0xbbcc9e, 0xe67438, 0xb8b2d4];
  for (let i = 0; i < 7; i++) {
    const fruit = new T.Group();
    group.add(fruit);
    fruit.position.set(
      Math.sin(i * 2.4) * 1.5,
      1.4 + Math.cos(i * 1.8) * 0.9,
      Math.cos(i) * 0.6,
    );
    const body = mesh(
      new T.SphereGeometry(i === 2 ? 0.45 : 0.31, 32, 24),
      material(colors[i % colors.length], 0.36),
      fruit,
    );
    body.scale.y = i % 3 ? 1 : 0.82;
    const stem = block(
      fruit,
      0.045,
      0.16,
      0.045,
      0,
      0.35,
      0,
      material(0x564530),
    );
    stem.rotation.z = 0.2;
    const leaf = mesh(
      new T.SphereGeometry(0.12, 12, 8),
      material(0x567452),
      fruit,
      0.12,
      0.4,
      0,
    );
    leaf.scale.set(1.4, 0.1, 0.6);
    leaf.rotation.z = 0.45;
  }
  return group;
}
