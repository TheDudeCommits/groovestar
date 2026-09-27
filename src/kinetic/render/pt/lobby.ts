import * as T from "three";
import { Stage } from "../stage";
import { Character } from "../character";
import { ShowDirector } from "./show";
import { danceStage, type SectionKind } from "./dance-stage";
import { characterId, settings } from "../../core/settings";
import { novaRoutine, coachLayers } from "../../../dance/nova-routine";
import type { SectionDef } from "../../../songs";

export type LobbyShot = "home" | "result" | "cast";

/**
 * The menu lobby: Nova dancing on the main stage behind the interface. The
 * show runs a synthetic 120 BPM song whose verses and choruses recolor the
 * lights and switch the LED wall, and Nova dances motion-captured phrases.
 */
export function lobbyScene(host: HTMLElement, shot: LobbyShot = "home") {
  const stage = new Stage(host, { primetime: { fog: 0x05030c, fogDensity: 0.028, bloom: 0.6, bloomRadius: 0.5, bloomThreshold: 0.86, vignette: 0.62 } });
  const reduced = settings().reducedMotion;
  const show = new ShowDirector(reduced);
  const venue = danceStage(stage, show, { lobby: true });
  const nova = new Character({ toon: { rim: 0.75, outlineWidth: 0.0036 } });
  stage.scene.add(nova.group);
  const cam = stage.camera;
  const narrow = () => host.clientWidth / Math.max(1, host.clientHeight) < 1.1;
  const frame = () => {
    if (shot === "home") {
      if (narrow()) {
        cam.position.set(0, 1.25, 6.4);
        cam.lookAt(0, 1.2, 0);
      } else {
        // Nova stands in the left third, clear of the card carousel.
        const aspect = host.clientWidth / Math.max(1, host.clientHeight);
        const shift = 1.55 + Math.max(0, 1.78 - aspect) * 0.9;
        cam.position.set(shift + 0.45, 1.05, 4.9);
        cam.lookAt(shift, 1.18, 0);
      }
    } else if (shot === "result") {
      cam.position.set(narrow() ? 0 : 2.2, 1.35, 5.8);
      cam.lookAt(narrow() ? 0 : 1.55, 1.3, 0);
    } else {
      cam.position.set(0, 1.0, 2.9);
      cam.lookAt(0, 0.95, 0);
    }
  };
  frame();
  // A song-shaped timeline for the show: 8-beat intro, then verses and choruses.
  const sections: SectionDef[] = [{ beat: 0, kind: "intro" }];
  for (let b = 8, i = 0; b < 520; b += 32, i++) sections.push({ beat: b, kind: i % 2 ? "chorus" : "verse" });
  const routine = novaRoutine({ sections, totalBeats: 520, bpm: 120, seed: "lobby", difficulty: 2 });
  const sectionAt = (beat: number) => {
    let s = sections[0];
    for (const x of sections) if (x.beat <= beat) s = x;
    return s;
  };
  let movesReady = false;
  void nova.load(characterId()).then(async () => {
    if (shot === "cast") {
      nova.play("Idle");
      return;
    }
    await nova.loadMoves();
    movesReady = true;
    if (shot === "result") nova.play("Celebrate");
  });
  let raf = 0,
    live = true,
    last = performance.now();
  const t0 = performance.now();
  let nextSwitch = 0,
    resultIndex = 0;
  const loop = () => {
    if (!live || !host.isConnected) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(),
      dt = Math.min(0.05, (now - last) / 1000),
      t = (now - t0) / 1000;
    last = now;
    const beat = (t * 2) % 520;
    show.hype = reduced ? 0.3 : 0.3 + 0.34 * (0.5 + 0.5 * Math.sin(t / 9));
    show.update(dt, beat);
    const sec = sectionAt(beat);
    venue.setSection(sec.kind as SectionKind, sec.beat);
    if (shot === "home" && movesReady) nova.timeline(coachLayers(routine, beat, "Dance3"));
    else if (shot === "result" && nova.ready && t > nextSwitch) {
      nextSwitch = t + 4.5;
      nova.play(["Celebrate", "Victory", "Dance2", "FistPump"][resultIndex++ % 4], 0.4);
    }
    nova.update(reduced ? 0 : dt);
    venue.update(t, dt, 0.45);
    if (!reduced) cam.position.x += Math.sin(t * 0.25) * 0.0008;
    stage.post(t, show);
    stage.render();
  };
  const onResize = () => frame();
  window.addEventListener("resize", onResize);
  loop();
  void T;
  return () => {
    live = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    nova.dispose();
    stage.dispose();
  };
}
