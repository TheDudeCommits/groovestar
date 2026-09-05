import * as T from "three";
import { batchStatic } from "./batch";
import { Stage, block, material, textPlane, mesh, COLORS } from "./stage";
export function studio(stage: Stage, type = "dance") {
  stage.floor(100);
  const ink = material(0x252a26),
    chalk = material(0xf8f5e9),
    red = material(COLORS.coral),
    blue = material(COLORS.blue);
  const set = new T.Group();
  stage.scene.add(set);
  block(set, 25, 0.2, 13, 0, -0.08, 0, material(0xdbd7cd));
  for (let i = 0; i < 6; i++) {
    block(set, 0.14, 7, 0.14, -8 + i * 3.2, 3.5, -4, ink);
    block(set, 3, 0.06, 0.15, -6.5 + i * 3.2, 6.8, -4, ink);
  }
  const panel = block(
    set,
    6,
    5,
    0.18,
    2,
    2.5,
    -4.3,
    type === "box" ? red : type === "fruit" ? material(0xbbcc9e) : blue,
  );
  const tx = textPlane(
    type === "box"
      ? "STAY SHARP"
      : type === "fruit"
        ? "FRESH ENERGY"
        : "MAKE YOUR MOVE",
    "#eeeae1",
    0.9,
  );
  tx.position.set(2, 3.9, -4.18);
  set.add(tx);
  const number = textPlane(
    type === "box" ? "03" : type === "fruit" ? "05" : "01",
    "#171917",
    1.4,
  );
  number.position.set(-3.5, 2.5, -4.15);
  set.add(number);
  for (const x of [-3.3, 3.3])
    for (let i = 0; i < 3; i++) {
      const o = block(
        set,
        0.025,
        0.012,
        14,
        x + i * 0.08,
        0.035,
        0,
        i === 1 ? red : ink,
      );
    }
  const circle = new T.Mesh(
    new T.RingGeometry(1.65, 1.68, 96),
    new T.MeshBasicMaterial({ color: COLORS.ink, side: T.DoubleSide }),
  );
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.03;
  set.add(circle);
  if (type === "box") {
    for (const x of [-3.3, 3.3])
      for (const z of [-2.8, 3.2]) block(set, 0.1, 1.6, 0.1, x, 0.8, z, ink);
    for (const y of [0.45, 0.9, 1.35])
      for (const x of [-3.3, 3.3])
        block(set, 0.045, 0.035, 6, x, y, 0.2, y === 0.9 ? red : chalk);
    for (const y of [0.45, 0.9, 1.35])
      block(set, 6.6, 0.035, 0.04, 0, y, -2.8, y === 0.9 ? red : chalk);
  }
  batchStatic(set);
  return set;
}
export function bladeWorld(stage: Stage) {
  const set = new T.Group();
  stage.scene.add(set);
  const ink = material(0x151d29, 0.5, 0.4),
    light = new T.MeshStandardMaterial({
      color: 0x365ff5,
      emissive: 0x365ff5,
      emissiveIntensity: 4,
    });
  const coral = new T.MeshStandardMaterial({
    color: 0xf35d42,
    emissive: 0xf35d42,
    emissiveIntensity: 3,
  });
  const floor = block(
    set,
    9,
    0.25,
    105,
    0,
    -0.15,
    -45,
    material(0x30394a, 0.22, 0.55),
  );
  const arches: T.Object3D[] = [];
  for (let i = 0; i < 16; i++) {
    const z = -i * 6;
    const arch = new T.Group();
    set.add(arch);
    arch.position.z = z;
    for (const s of [-1, 1]) {
      const rib = block(arch, 0.55, 8, 0.7, s * 6.2, 3.5, 0, ink);
      rib.rotation.z = s * -0.23;
      block(
        arch,
        0.045,
        7,
        0.1,
        s * 5.88,
        3.5,
        0.38,
        i % 3 === 0 ? coral : light,
      );
      block(arch, 0.09, 0.03, 5.2, s * 3.8, 0.015, -2, light);
    }
    block(arch, 12, 0.35, 0.7, 0, 7.5, 0, ink);
    block(arch, 9, 0.035, 0.08, 0, 7.26, 0.4, light);
    arches.push(arch);
  }
  const gridDim = material(0x344258),
    gridBar = material(0x61758e);
  for (let i = 0; i < 30; i++)
    block(set, 7.6, 0.02, 0.03, 0, 0.01, -i * 3, i % 4 ? gridDim : gridBar);
  const sun = mesh(
    new T.TorusGeometry(4.8, 0.35, 16, 96),
    coral,
    set,
    0,
    3,
    -48,
  );
  const portal = mesh(
    new T.TorusGeometry(4.2, 0.075, 12, 80),
    light,
    set,
    0,
    3,
    -47.8,
  );
  const glow = new T.Mesh(
    new T.PlaneGeometry(50, 30),
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { color: { value: new T.Color(0x405cf5) } },
      vertexShader:
        "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:
        "varying vec2 vUv;uniform vec3 color;void main(){float d=length((vUv-.5)*vec2(1.3,1.));float a=pow(max(0.,1.-d*2.),3.)*.8;gl_FragColor=vec4(color,a);}",
    }),
  );
  glow.position.set(0, 4, -70);
  set.add(glow);
  for (const s of [-1, 1]) {
    const beam = block(set, 0.15, 0.035, 70, s * 3.7, 0.055, -31, coral);
    const wash = new T.PointLight(0x365ff5, 28, 16, 1.6);
    wash.position.set(s * 3, 3, -6);
    set.add(wash);
  }
  const strips: T.Object3D[] = [];
  for (let i = 0; i < 12; i++) {
    const line = block(
      set,
      0.045,
      10,
      0.045,
      Math.sin(i) * 12,
      5,
      -20 - i * 3,
      light,
    );
    line.rotation.z = (i - 6) * 0.18;
    strips.push(line);
  }
  const architecture = new T.Group();
  set.add(architecture);
  for (const child of [...set.children])
    if (
      child !== architecture &&
      child !== portal &&
      child !== glow &&
      !strips.includes(child) &&
      !(child instanceof T.Light)
    )
      architecture.attach(child);
  batchStatic(architecture);
  return {
    set,
    arches,
    light,
    coral,
    portal,
    update(beat: number, reduced: boolean) {
      const p = Math.max(0, 1 - (beat % 1));
      const phrase = Math.floor(beat / 32) % 4;
      light.emissiveIntensity = 2.2 + p * 0.8;
      coral.emissiveIntensity = 2.8 + p * 0.7;
      glow.material.uniforms.color.value.set(
        phrase === 2 ? 0x98565e : 0x405cf5,
      );
      if (!reduced) {
        portal.rotation.z = beat * 0.025;
        for (let i = 0; i < strips.length; i++)
          strips[i].rotation.z =
            (i - 6) * 0.18 + Math.sin((beat / 16) * Math.PI) * 0.08;
      }
    },
  };
}
export function cityWorld(stage: Stage) {
  const root = new T.Group();
  stage.scene.add(root);
  const road = material(0x9a9f8e),
    terracotta = material(0xc07852),
    cream = material(0xe2d9c3),
    ink = material(0x293e34),
    glass = material(0x4f6860, 0.3, 0.2),
    chalk = material(0xf4edda),
    red = material(COLORS.coral),
    leaf = material(0x678359);
  const chunks: T.Group[] = [];
  for (let chunk = 0; chunk < 3; chunk++) {
    const g = new T.Group();
    root.add(g);
    chunks.push(g);
    block(g, 10, 0.2, 72, 0, -0.15, -36, road);
    for (let i = 0; i < 12; i++) {
      const z = -i * 6;
      for (const x of [-1.45, 1.45])
        block(g, 0.045, 0.02, 2, x, 0.015, z, chalk);
      for (const side of [-1, 1]) {
        const x = side * (7 + (i % 3) * 1.1),
          h = 5 + ((i * 7 + chunk * 3) % 8);
        block(g, 4, h, 4, x, h / 2, z, i % 3 ? cream : terracotta);
        block(g, 4.15, 0.16, 4.15, x, h + 0.08, z, ink);
        for (let f = 0; f < Math.floor(h / 1.5); f++)
          for (const wx of [-1.05, 0, 1.05]) {
            block(g, 0.56, 0.84, 0.06, x + wx, 1.3 + f * 1.5, z + 2.04, glass);
            block(
              g,
              0.07,
              0.84,
              0.66,
              x - side * 2.04,
              1.3 + f * 1.5,
              z + wx,
              glass,
            );
          }
        block(g, 1.6, 2.05, 0.06, x, 0.99, z + 2.07, ink);
        if (i % 2 === 0) {
          block(g, 4.2, 0.15, 1.6, x, 2.35, z + 2.3, red);
          block(g, 0.75, 0.55, 1.7, side * 4.9, 0.26, z + 1.2, terracotta);
          const tree = mesh(
            new T.IcosahedronGeometry(0.85, 1),
            leaf,
            g,
            side * 4.9,
            2.4,
            z + 1.2,
          );
          tree.scale.set(0.8, 1.3, 0.8);
          block(g, 0.12, 2, 0.12, side * 4.9, 1, z + 1.2, ink);
        }
        if (i % 4 === 1) {
          block(g, 0.09, 4, 0.09, side * 4.6, 2, z, ink);
          block(g, 0.7, 0.12, 0.25, side * 4.35, 4, z, chalk);
        }
      }
    }
    batchStatic(g);
  }
  const arch = new T.Group();
  root.add(arch);
  for (const side of [-1, 1])
    block(arch, 0.5, 8, 0.5, side * 4.7, 4, 0, terracotta);
  block(arch, 10, 0.7, 0.5, 0, 8, 0, terracotta);
  const banner = textPlane("GROOVE CITY", "#171917", 1.35);
  banner.position.set(0, 6.6, 0.3);
  arch.add(banner);
  return {
    root,
    buildings: chunks,
    update(distance: number) {
      chunks.forEach((g, i) => {
        g.position.z = ((distance - i * 72 + 216) % 216) - 120;
      });
      arch.position.z = -70 + (distance % 160);
    },
  };
}
