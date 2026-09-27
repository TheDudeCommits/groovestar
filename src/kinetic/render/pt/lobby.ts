import * as T from "three";
import { Stage } from "../stage";
import { Character } from "../character";
import { ShowDirector } from "./show";
import { danceVenue } from "./dance-venue";
import { characterId, settings } from "../../core/settings";

export type LobbyShot = "home" | "result" | "cast";

/**
 * The menu lobby: Nova dancing on the main stage behind the interface.
 * The show runs on its own clock and cycles through hype levels so the
 * lights, lasers and confetti keep the menu alive.
 */
export function lobbyScene(host: HTMLElement, shot: LobbyShot = "home") {
  const stage = new Stage(host, { primetime: { fog: 0x120826, fogDensity: 0.022, bloom: 0.55, bloomThreshold: 0.9, vignette: 0.62, key: 1.7 } });
  const reduced = settings().reducedMotion;
  const show = new ShowDirector(reduced);
  const venue = danceVenue(stage, show, { crowdFront: false });
  venue.pedestal.visible = false;
  const nova = new Character();
  stage.scene.add(nova.group);
  const cam = stage.camera;
  const narrow = () => host.clientWidth / Math.max(1, host.clientHeight) < 1.1;
  const frame = () => {
    if (shot === "home") {
      if (narrow()) {
        cam.position.set(0, 1.35, 6.2);
        cam.lookAt(0, 1.25, 0);
      } else {
        // Nova stands in the left third, clear of the card carousel.
        const aspect = host.clientWidth / Math.max(1, host.clientHeight);
        const shift = 1.5 + Math.max(0, 1.78 - aspect) * 0.9;
        cam.position.set(shift + 0.55, 1.2, 4.5);
        cam.lookAt(shift, 1.22, 0);
      }
    } else if (shot === "result") {
      cam.position.set(narrow() ? 0 : 2.2, 1.5, 5.8);
      cam.lookAt(narrow() ? 0 : 1.55, 1.35, 0);
    } else {
      cam.position.set(0, 1.0, 2.7);
      cam.lookAt(0, 0.95, 0);
    }
  };
  frame();
  if (stage.key) {
    stage.key.position.set(-1.5, 5, 7);
    stage.key.target.position.set(0, 1, 0);
  }
  const dances = ["Dance", "Dance2", "Dance3"];
  let danceIndex = 0,
    nextSwitch = 0;
  void nova.load(characterId()).then(() => {
    nova.play(shot === "result" ? "Celebrate" : shot === "cast" ? "Idle" : "Dance");
  });
  let raf = 0,
    live = true,
    last = performance.now();
  const t0 = performance.now();
  const loop = () => {
    if (!live || !host.isConnected) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(),
      dt = Math.min(0.05, (now - last) / 1000),
      t = (now - t0) / 1000;
    last = now;
    // Synthetic 120 BPM show that breathes between Warm-up and Encore.
    show.hype = reduced ? 0.3 : 0.28 + 0.36 * (0.5 + 0.5 * Math.sin(t / 9));
    show.update(dt, t * 2);
    if (shot === "home" && nova.ready && t > nextSwitch) {
      nextSwitch = t + 9;
      nova.play(dances[danceIndex++ % dances.length], 0.5);
    }
    if (shot === "result" && nova.ready && t > nextSwitch) {
      nextSwitch = t + 4;
      nova.play(danceIndex++ % 2 ? "Dance2" : "Celebrate", 0.4);
    }
    nova.update(reduced ? 0 : dt);
    venue.update(t);
    if (!reduced) cam.position.x += Math.sin(t * 0.25) * 0.0008;
    stage.post(t, show);
    stage.render();
  };
  const onResize = () => frame();
  window.addEventListener("resize", onResize);
  loop();
  return () => {
    live = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    nova.dispose();
    stage.dispose();
  };
}
