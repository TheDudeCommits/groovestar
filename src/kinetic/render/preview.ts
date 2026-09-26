import * as T from "three";
import { Stage, block, material, COLORS } from "./stage";
import { Character } from "./character";
import { studio, bladeWorld, cityWorld } from "./worlds";
import { court, alley, racket, pin, fruitSculpture } from "./sports";
import { characterId, settings } from "../core/settings";
export function livePreview(
  host: HTMLElement,
  kind = "dance",
  id = characterId(),
) {
  if (kind === "box") return boxingPreview(host, id);
  const stage = new Stage(host, {
      dark: kind === "blade",
      bloom: kind === "blade",
    }),
    person = new Character();
  let update: (t: number) => void = () => {};
  if (kind === "blade") {
    const w = bladeWorld(stage);
    stage.camera.position.set(0, 2.5, 9);
    stage.camera.lookAt(0, 2, -20);
    update = (t) => w.update(t * 2, settings().reducedMotion);
    for (let i = 0; i < 7; i++) {
      const cube = block(
        stage.scene,
        0.7,
        0.7,
        0.7,
        i % 2 ? -0.8 : 0.8,
        1.5 + (i % 3) * 0.4,
        -i * 3,
        material(i % 2 ? COLORS.blue : COLORS.coral, 0.2, 0.4),
      );
      cube.rotation.z = Math.PI * 0.03;
    }
  } else if (kind === "rush") {
    const w = cityWorld(stage);
    stage.camera.position.set(4, 2.5, 5.7);
    stage.camera.lookAt(0, 1, -3);
    person.group.rotation.y = Math.PI;
    stage.scene.add(person.group);
    void person.load(id).then(() => person.play("Run"));
    update = (t) => w.update(t * 3);
  } else if (kind === "tennis") {
    court(stage);
    stage.camera.position.set(4.5, 3.4, 5);
    stage.camera.lookAt(0, 1, -5);
    const r = racket();
    stage.scene.add(r);
    r.position.set(0.8, 1.1, 0.5);
    r.rotation.z = -0.35;
    stage.scene.add(person.group);
    void person.load(id).then(() => person.play("Guard"));
  } else if (kind === "bowl") {
    alley(stage);
    stage.camera.position.set(3, 2.8, 3.5);
    stage.camera.lookAt(0, 0.6, -8);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col <= row; col++) {
        const p = pin();
        p.position.set((col - row / 2) * 0.52, 0, -12 - row * 0.48);
        stage.scene.add(p);
      }
    const ball = new T.Mesh(
      new T.SphereGeometry(0.38, 32, 24),
      material(COLORS.blue, 0.15, 0.5),
    );
    ball.position.set(-0.5, 0.38, -1);
    stage.scene.add(ball);
  } else if (kind === "fruit") {
    studio(stage, "fruit");
    stage.camera.position.set(2, 1.8, 5.7);
    stage.camera.lookAt(0, 1.45, 0);
    const fruit = fruitSculpture();
    stage.scene.add(fruit);
    update = (t) => {
      fruit.rotation.y = Math.sin(t * 0.25) * 0.18;
    };
  } else {
    studio(stage);
    stage.camera.position.set(1.7, 1.55, 3.7);
    stage.camera.lookAt(0, 1, 0);
    stage.scene.add(person.group);
    person.group.rotation.y = -0.12;
    void person.load(id).then(() => {
      if (localStorage.getItem("gs-char") === "auto") {
        try {
          const s = JSON.parse(localStorage.getItem("gs-style") ?? "null");
          if (s) person.applyLook(s);
        } catch {}
      }
      person.play(
        kind === "celebrate" ? "Celebrate" : kind === "cast" ? "Idle" : "Dance",
      );
    });
  }
  let raf = 0,
    last = performance.now(),
    live = true;
  const loop = () => {
    if (!live || !host.isConnected) return;
    raf = requestAnimationFrame(loop);
    const t = performance.now(),
      dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    person.update(settings().reducedMotion ? 0 : dt);
    update(t / 1000);
    stage.render();
  };
  loop();
  return () => {
    live = false;
    cancelAnimationFrame(raf);
    person.dispose();
    stage.dispose();
  };
}
function boxingPreview(host: HTMLElement, id: string) {
  const stage = new Stage(host),
    p = new Character();
  studio(stage, "box");
  stage.camera.position.set(1.2, 1.65, 4);
  stage.camera.lookAt(0, 1, 0);
  stage.scene.add(p.group);
  void p.load(id === "nova" ? "blaze" : id).then(() => p.play("Guard"));
  let raf = 0,
    last = performance.now();
  const loop = () => {
    const now = performance.now();
    p.update(
      settings().reducedMotion ? 0 : Math.min(0.05, (now - last) / 1000),
    );
    last = now;
    stage.render();
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    p.dispose();
    stage.dispose();
  };
}
