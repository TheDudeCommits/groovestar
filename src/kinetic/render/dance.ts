import * as T from "three";
import { Stage } from "./stage";
import { Character } from "./character";
import type { Pose } from "../../moves";
import type { TrackerLike } from "../../games/shared";
import type { StyleProfile } from "../../appearance";
import type { Song, ChoreoMove, SectionDef } from "../../songs";
import { ShowDirector } from "./pt/show";
import { HYPE_LEVELS, alphaSafe } from "./pt/palette";
import { danceStage, type SectionKind } from "./pt/dance-stage";
import { settings } from "../core/settings";
import { coachLayers, NOVA, parseSlice, registerRoutine } from "../../dance/nova-routine";

type Judgment = "X" | "OK" | "GOOD" | "SUPER" | "PERFECT" | "YEAH";
const CALLOUT: Record<Judgment, [string, string, number]> = {
  YEAH: ["YEAH!", "perfect", 1.3],
  PERFECT: ["PERFECT", "perfect", 1],
  SUPER: ["SUPER", "great", 0.8],
  GOOD: ["GOOD", "good", 0.55],
  OK: ["OK", "good", 0.25],
  X: ["MISS", "miss", 0],
};

/** Camera framings the director cycles through, one per 8-bar phrase. */
const SHOTS: { pos: [number, number, number]; look: [number, number, number]; fov: number }[] = [
  { pos: [0.5, 1.02, 5.4], look: [0.5, 1.1, 0], fov: 31 },
  { pos: [0.1, 0.62, 5.0], look: [0.45, 1.22, 0], fov: 32 },
  { pos: [1.55, 1.2, 5.05], look: [0.55, 1.08, 0], fov: 31 },
  { pos: [-0.75, 1.15, 5.2], look: [0.4, 1.08, 0], fov: 31 },
];

/**
 * Dance Main Stage. Dance's clock, choreography and scorer stay authoritative;
 * this layer renders the venue and Nova, the coach, performing the routine's
 * motion-captured phrases in time with the song.
 */
export class DancePresentation {
  readonly host = document.createElement("div");
  readonly stage: Stage;
  readonly show: ShowDirector;
  readonly primetime = true;
  private venue;
  private coach = new Character({ toon: { rim: 0.75, outlineWidth: 0.0036 } });
  private alive = true;
  private last = performance.now();
  private judgeEl = document.createElement("div");
  private bannerEl = document.createElement("div");
  private judgeTimer = 0;
  private bannerTimer = 0;
  private routine: ChoreoMove[] = [];
  private sections: SectionDef[] = [{ beat: 0, kind: "intro" }];
  private groove = "Dance3";
  private shot = 0;
  private camPos = new T.Vector3(...SHOTS[0].pos);
  private camLook = new T.Vector3(...SHOTS[0].look);
  private camFov = SHOTS[0].fov;
  private shadow: T.Mesh;
  private motion = 0;
  private lastHand = new T.Vector3();
  ready = false;
  /** A YouTube song plays on the LED wall, behind a transparent canvas. */
  readonly videoWall: boolean;
  constructor(parent: HTMLElement, _style: StyleProfile | null, o: { videoWall?: boolean } = {}) {
    this.videoWall = !!o.videoWall;
    this.host.className = `kinetic-dance-layer pt-dance${this.videoWall ? " pt-video" : ""}`;
    parent.prepend(this.host);
    parent.classList.add("pt-dance-on");
    this.stage = new Stage(this.host, {
      alpha: this.videoWall,
      primetime: { fog: 0x05030c, fogDensity: 0.028, bloom: 0.62, bloomRadius: 0.5, bloomThreshold: 0.86, exposure: 1.0, vignette: 0.62 },
    });
    this.show = new ShowDirector(settings().reducedMotion);
    this.venue = danceStage(this.stage, this.show, { videoWall: this.videoWall });
    this.stage.camera.userData.referenceFov = SHOTS[0].fov;
    this.placeCamera(0, true);
    this.stage.scene.add(this.coach.group);
    // soft contact shadow grounds the dancer on the mirror floor
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new T.Mesh(new T.PlaneGeometry(1.5, 1.1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.stage.scene.add(this.shadow);
    this.judgeEl.className = "pt-judgment pt-dance-judgment";
    this.bannerEl.className = "pt-level-banner";
    this.host.append(this.judgeEl, this.bannerEl);
    this.show.onLevel((level, up) => {
      if (!up) return;
      this.bannerEl.innerHTML = `<b>${HYPE_LEVELS[level].name}!</b>`;
      this.bannerEl.classList.remove("show");
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add("show");
      clearTimeout(this.bannerTimer);
      this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), 1600);
      if (level >= 3) this.venue.moment(0.8);
    });
    void this.coach.load("nova").then(async () => {
      await this.coach.loadMoves();
      if (!this.alive) return;
      if (this.videoWall) alphaSafe(this.stage.scene);
      this.ready = true;
    });
  }
  /** The song's routine and structure drive the coach, lights and camera. */
  setSong(song: Pick<Song, "choreo" | "sections" | "bpm">) {
    this.routine = [...song.choreo].sort((a, b) => a.beat - b.beat);
    registerRoutine(this.routine);
    this.sections = [...song.sections].sort((a, b) => a.beat - b.beat);
    // groove between moves with the verse's first clip, else a mellow default
    const first = this.routine.map((m) => parseSlice(m.move)).find(Boolean);
    this.groove = first?.clip.id ?? (NOVA.Dance3 ? "Dance3" : Object.keys(NOVA)[0]);
  }
  /** Feedback for a scored move: callout, sparks and hype. */
  judge(j: Judgment, gold = false) {
    const [text, tier, quality] = CALLOUT[j] ?? CALLOUT.OK;
    if (j === "X") this.show.miss();
    else this.show.hit(Math.min(1, quality));
    const hand = this.coach.handWorld("R") ?? new T.Vector3(0, 1.3, 0.3);
    this.venue.judged(quality, hand);
    if (j === "YEAH" || (gold && j !== "X")) this.venue.moment(1);
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
    const box = new T.Box3().setFromObject(this.venue.wall.mesh);
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
  /**
   * Where to place the video so it fills the visible part of the LED wall
   * (cover fit, 16:9); the 3D scene masks everything outside the wall.
   */
  videoRect() {
    const r = this.screenRect();
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    const x0 = Math.max(0, r.x),
      y0 = Math.max(0, r.y),
      x1 = Math.min(w, r.x + r.w),
      y1 = Math.min(h, r.y + r.h);
    const cw = Math.max(1, x1 - x0),
      ch = Math.max(1, y1 - y0);
    const vw = Math.max(cw, (ch * 16) / 9),
      vh = (vw * 9) / 16;
    return { x: Math.round(x0 + (cw - vw) / 2), y: Math.round(y0 + (ch - vh) / 2), w: Math.round(vw), h: Math.round(vh) };
  }
  private sectionAt(beat: number): SectionDef {
    let s = this.sections[0];
    for (const x of this.sections) if (x.beat <= beat) s = x;
    return s;
  }
  private placeCamera(dt: number, snap = false) {
    const shot = SHOTS[this.shot % SHOTS.length];
    const reduced = settings().reducedMotion;
    const k = snap ? 1 : 1 - Math.exp(-dt * (reduced ? 0.6 : 0.9));
    this.camPos.lerp(new T.Vector3(...shot.pos), k);
    this.camLook.lerp(new T.Vector3(...shot.look), k);
    this.camFov += (shot.fov - this.camFov) * k;
    const cam = this.stage.camera;
    const t = performance.now() / 1000;
    const sway = reduced ? 0 : 1;
    cam.position.set(this.camPos.x + Math.sin(t * 0.31) * 0.12 * sway, this.camPos.y + Math.sin(t * 0.23) * 0.04 * sway, this.camPos.z);
    cam.lookAt(this.camLook);
    const kick = reduced ? 0 : this.show.pulse * (this.venue.section === "chorus" ? 0.55 : 0.2);
    this.stage.camera.userData.referenceFov = this.camFov - kick;
    const w = this.host.clientWidth || 1,
      h = this.host.clientHeight || 1;
    cam.fov = T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad((this.camFov - kick) / 2)) * Math.max(1, 1.4 / (w / h))));
    cam.updateProjectionMatrix();
  }
  update(_tracker: TrackerLike, _pose: Pose, camera: boolean, beat = 0) {
    void camera;
    const now = performance.now(),
      dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    this.show.update(dt, beat);
    const sec = this.sectionAt(Math.max(0, beat));
    this.venue.setSection(sec.kind as SectionKind, sec.beat);
    // a new framing every 8 bars
    const phrase = Math.floor(Math.max(0, beat) / 32);
    if (phrase !== this.shot) this.shot = phrase;
    this.placeCamera(dt);
    if (this.ready) {
      this.coach.timeline(coachLayers(this.routine, beat, this.groove));
      this.coach.group.updateMatrixWorld(true);
      const hand = this.coach.handWorld("R", new T.Vector3());
      if (hand) {
        this.motion = this.motion * 0.9 + Math.min(1, hand.distanceTo(this.lastHand) / Math.max(0.001, dt) / 4) * 0.1;
        this.lastHand.copy(hand);
      }
      const hips = this.coach.rigBone("Hips");
      if (hips) {
        const p = hips.getWorldPosition(new T.Vector3());
        this.shadow.position.set(p.x, 0.01, p.z);
        this.venue.follow.target.position.set(p.x, 0.9, p.z);
      }
    }
    this.venue.update(now / 1000, dt, this.motion);
    this.stage.post(now / 1000, this.show);
    this.stage.render();
  }
  dispose() {
    this.alive = false;
    clearTimeout(this.judgeTimer);
    clearTimeout(this.bannerTimer);
    this.host.parentElement?.classList.remove("pt-dance-on");
    this.coach.dispose();
    this.stage.dispose();
    this.host.remove();
  }
}

export function broadcastFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}
