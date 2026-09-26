import * as T from "three";
import { Stage } from "./stage";
import { Character } from "./character";
import { HandRig } from "../../pose/rig";
import { characterId } from "../core/settings";
import type { Pose } from "../../moves";
import type { TrackerLike } from "../../games/shared";
import type { StyleProfile } from "../../appearance";
import { ShowDirector } from "./pt/show";
import { HYPE_LEVELS, PT } from "./pt/palette";
import { danceVenue } from "./pt/dance-venue";
import { settings } from "../core/settings";

type Judgment = "X" | "OK" | "GOOD" | "SUPER" | "PERFECT" | "YEAH";
const CALLOUT: Record<Judgment, [string, string, number]> = {
  YEAH: ["YEAH!", "perfect", 1.3],
  PERFECT: ["PERFECT", "perfect", 1],
  SUPER: ["SUPER", "great", 0.8],
  GOOD: ["GOOD", "good", 0.55],
  OK: ["OK", "good", 0.25],
  X: ["MISS", "miss", 0],
};

/**
 * Dance Main Stage. Dance's clock, choreography and scorer stay authoritative;
 * this layer renders the Primetime venue, the player's dancer (driven by
 * tracking) and the hologram coach performing the routine.
 */
export class DancePresentation {
  readonly host = document.createElement("div");
  readonly stage: Stage;
  readonly show: ShowDirector;
  readonly primetime = true;
  private venue;
  private player = new Character();
  private coach = new Character({ style: "hologram", color: PT.cyan });
  private rig = new HandRig();
  private alive = true;
  private last = performance.now();
  private lastPoseAt = -1e9;
  private judgeEl = document.createElement("div");
  private bannerEl = document.createElement("div");
  private judgeTimer = 0;
  private bannerTimer = 0;
  ready = false;
  constructor(parent: HTMLElement, style: StyleProfile | null) {
    this.host.className = "kinetic-dance-layer pt-dance";
    parent.prepend(this.host);
    parent.classList.add("pt-dance-on");
    this.stage = new Stage(this.host, { primetime: { fog: 0x120826, fogDensity: 0.02, bloom: 0.66, bloomThreshold: 0.84, exposure: 1.0 } });
    this.show = new ShowDirector(settings().reducedMotion);
    this.venue = danceVenue(this.stage, this.show);
    this.stage.camera.userData.referenceFov = 36;
    this.stage.camera.fov = 36;
    this.stage.camera.position.set(0, 1.5, 7.6);
    this.stage.camera.lookAt(0, 1.6, 0);
    this.stage.camera.updateProjectionMatrix();
    if (this.stage.key) {
      this.stage.key.position.set(-2, 6, 7);
      this.stage.key.target.position.set(0, 1, 0);
    }
    this.stage.scene.add(this.player.group, this.coach.group);
    this.coach.group.scale.setScalar(0.95);
    this.coach.group.position.set(3.7, 0.67, -3.3);
    this.coach.groundY = 0.67;
    this.judgeEl.className = "pt-judgment pt-dance-judgment";
    this.bannerEl.className = "pt-level-banner";
    this.host.append(this.judgeEl, this.bannerEl);
    this.show.onLevel((level, up) => {
      if (!up) return;
      this.bannerEl.innerHTML = `<small>HYPE LEVEL ${level + 1}</small><b>${HYPE_LEVELS[level].name}!</b>`;
      this.bannerEl.classList.remove("show");
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add("show");
      clearTimeout(this.bannerTimer);
      this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), 1900);
    });
    void Promise.all([this.player.load(characterId()), this.coach.load("nova")]).then(() => {
      if (!this.alive) return;
      if (style && localStorage.getItem("gs-char") === "auto") this.player.applyLook(style);
      this.ready = true;
    });
  }
  /** Feedback for a scored move: callout, sparks and hype. */
  judge(j: Judgment) {
    const [text, tier, quality] = CALLOUT[j] ?? CALLOUT.OK;
    if (j === "X") this.show.miss();
    else this.show.hit(Math.min(1, quality));
    this.venue.judged(quality, new T.Vector3(0, 1.3, 0.3));
    this.judgeEl.textContent = text;
    this.judgeEl.dataset.tier = tier;
    this.judgeEl.classList.remove("show");
    void this.judgeEl.offsetWidth;
    this.judgeEl.classList.add("show");
    clearTimeout(this.judgeTimer);
    this.judgeTimer = window.setTimeout(() => this.judgeEl.classList.remove("show"), 650);
  }
  /** Screen rectangle of the LED wall, for placing a music video on it. */
  screenRect() {
    const box = new T.Box3().setFromObject(this.venue.led.mesh);
    const pts = [
      new T.Vector3(box.min.x, box.min.y, box.max.z),
      new T.Vector3(box.max.x, box.max.y, box.max.z),
      new T.Vector3(box.min.x, box.max.y, box.min.z),
      new T.Vector3(box.max.x, box.min.y, box.min.z),
    ].map((p) => this.stage.project(p));
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    const xs = pts.map((p) => p.x * w),
      ys = pts.map((p) => p.y * h);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  update(tracker: TrackerLike, pose: Pose, camera: boolean, beat = 0) {
    const now = performance.now(),
      dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    this.show.update(dt, beat);
    this.venue.update(now / 1000);
    if (this.ready) {
      this.rig.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now, tracker.aspect ?? 4 / 3);
      // Brief tracking gaps keep the dancer on stage: hold the last pose, then
      // relax into an idle stance instead of vanishing or snapping to the rig.
      if (this.rig.hasPose) this.lastPoseAt = now;
      this.player.group.visible = !camera || now - this.lastPoseAt < 4000;
      if (!camera) this.player.choreo(pose);
      else if (this.rig.hasPose) this.player.tracked(this.rig);
      else this.player.relax(now - this.lastPoseAt);
      this.coach.group.visible = camera;
      this.coach.choreo(pose);
      this.coach.update(dt);
    }
    this.stage.post(now / 1000, this.show);
    this.stage.render();
  }
  dispose() {
    this.alive = false;
    clearTimeout(this.judgeTimer);
    clearTimeout(this.bannerTimer);
    this.host.parentElement?.classList.remove("pt-dance-on");
    this.player.dispose();
    this.coach.dispose();
    this.stage.dispose();
    this.host.remove();
  }
}

export function broadcastFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}
