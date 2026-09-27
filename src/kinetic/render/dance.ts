import * as T from "three";
import { Stage } from "./stage";
import { Character } from "./character";
import type { Pose } from "../../moves";
import type { TrackerLike } from "../../games/shared";
import type { StyleProfile } from "../../appearance";
import type { Song, ChoreoMove, SectionDef } from "../../songs";
import { ShowDirector } from "./pt/show";
import { HYPE_LEVELS, PT, alphaSafe } from "./pt/palette";
import { danceStage, type SectionKind } from "./pt/dance-stage";
import { settings } from "../core/settings";
import { coachLayers, NOVA, parseSlice, registerRoutine } from "../../dance/nova-routine";
import { Body3D } from "../../pose/body3d";
import { DanceSync } from "../../dance/sync";

type Judgment = "X" | "OK" | "GOOD" | "SUPER" | "PERFECT" | "YEAH";
const CALLOUT: Record<Judgment, [string, string, number]> = {
  YEAH: ["YEAH!", "perfect", 1.3],
  PERFECT: ["PERFECT", "perfect", 1],
  SUPER: ["SUPER", "great", 0.8],
  GOOD: ["GOOD", "good", 0.55],
  OK: ["OK", "good", 0.25],
  X: ["MISS", "miss", 0],
};

/** Where the two dancers stand: the coach, and you beside her. */
const COACH_X = 0.35;
const YOU = new T.Vector3(-1.05, 0, 0.35);

/** Camera framings the director cycles through, one per 8-bar phrase. */
const SHOTS: { pos: [number, number, number]; look: [number, number, number]; fov: number }[] = [
  { pos: [0.35, 1.05, 6.1], look: [0.35, 1.08, 0], fov: 31 },
  { pos: [-0.1, 0.66, 5.7], look: [0.25, 1.2, 0], fov: 32 },
  { pos: [1.5, 1.2, 5.8], look: [0.3, 1.06, 0], fov: 31 },
  { pos: [-1.0, 1.15, 5.9], look: [0.2, 1.08, 0], fov: 31 },
];

const GOLD = new T.Color(PT.gold),
  CYAN = new T.Color(PT.cyan),
  MAGENTA = new T.Color(PT.magenta),
  VIOLET = new T.Color(PT.violet);

/**
 * Dance Main Stage. Dance's clock, choreography and scorer stay authoritative;
 * this layer renders the venue, Nova (the coach, performing the routine's
 * motion-captured phrases on the beat) and you: a live avatar beside her that
 * copies your every move from the camera, lights up as you match her and
 * takes the calls.
 */
export class DancePresentation {
  readonly host = document.createElement("div");
  readonly stage: Stage;
  readonly show: ShowDirector;
  readonly primetime = true;
  private venue;
  private coach = new Character({ toon: { rim: 0.75, outlineWidth: 0.0036 } });
  private you = new Character({ toon: { rim: 1.1, rimLeft: PT.cyan, rimRight: PT.violet, outlineWidth: 0.0036 } });
  private body = new Body3D();
  readonly sync = new DanceSync();
  private alive = true;
  private last = performance.now();
  private judgeEl = document.createElement("div");
  private bannerEl = document.createElement("div");
  private tagEl = document.createElement("div");
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
  private youShadow: T.Mesh;
  private ring: T.Mesh;
  private ringMat: T.ShaderMaterial;
  private motion = 0;
  private lastHand = new T.Vector3();
  private youReady = false;
  private cameraOn = true;
  private lastSparkle = 0;
  private flashYou = 0;
  private flashColor = new T.Color(1, 1, 1);
  private beat = 0;
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
      primetime: { fog: 0x05030c, fogDensity: 0.026, bloom: 0.62, bloomRadius: 0.5, bloomThreshold: 0.86, exposure: 1.0, vignette: 0.6 },
    });
    this.show = new ShowDirector(settings().reducedMotion);
    this.venue = danceStage(this.stage, this.show, { videoWall: this.videoWall });
    this.stage.camera.userData.referenceFov = SHOTS[0].fov;
    this.placeCamera(0, true);
    this.coach.group.position.x = COACH_X;
    this.stage.scene.add(this.coach.group, this.you.group);
    this.you.group.position.copy(YOU);
    this.you.group.scale.setScalar(0.94);
    this.you.groundY = 0;
    // soft contact shadows ground both dancers on the mirror floor
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const shadowTex = new T.CanvasTexture(cv);
    const makeShadow = () => {
      const m = new T.Mesh(new T.PlaneGeometry(1.5, 1.1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.01;
      this.stage.scene.add(m);
      return m;
    };
    this.shadow = makeShadow();
    this.youShadow = makeShadow();
    // your sync ring: a light on the floor that fills and warms as you match
    this.ringMat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { uColor: { value: new T.Color(PT.cyan) }, uFill: { value: 0 }, uPulse: { value: 0 }, uK: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uFill; uniform float uPulse; uniform float uK;
        void main(){
          vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
          float a = atan(p.x, -p.y) / 6.2831853 + 0.5;
          float band = smoothstep(0.035, 0.0, abs(r - 0.82));
          float lit = step(a, uFill);
          float glow = exp(-abs(r - 0.82) * 14.0) * 0.35;
          float inner = smoothstep(0.8, 0.0, r) * 0.18 * uFill;
          vec3 c = uColor * (band * (0.25 + lit * 1.4) + glow * (0.3 + uFill) + inner) * (1.0 + uPulse * 0.6) * uK;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.ring = new T.Mesh(new T.PlaneGeometry(1.7, 1.7), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(YOU.x, 0.015, YOU.z);
    this.stage.scene.add(this.ring);
    this.judgeEl.className = "pt-judgment pt-dance-judgment";
    this.bannerEl.className = "pt-level-banner";
    this.tagEl.className = "pt-you-tag";
    this.tagEl.textContent = "YOU";
    this.host.append(this.judgeEl, this.bannerEl, this.tagEl);
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
    void this.you.load("nova").then(async () => {
      await this.you.loadMoves();
      if (!this.alive) return;
      if (this.videoWall) alphaSafe(this.stage.scene);
      this.youReady = true;
    });
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { gsGame: unknown }).gsGame = this;
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
  /** The live match for the scorer: 0..1, or null while you're not tracked. */
  liveScore(): number | null {
    return this.cameraOn && this.body.live(performance.now()) ? this.sync.last.score : null;
  }
  /** Feedback for a scored move: a callout over you, sparks and hype. */
  judge(j: Judgment, gold = false) {
    const [text, tier, quality] = CALLOUT[j] ?? CALLOUT.OK;
    if (j === "X") this.show.miss();
    else this.show.hit(Math.min(1, quality));
    const at = this.you.handWorld("R") ?? YOU.clone().add(new T.Vector3(0, 1.3, 0.3));
    const head = this.you.rigBone("Head")?.getWorldPosition(new T.Vector3()) ?? YOU.clone().add(new T.Vector3(0, 1.6, 0));
    this.venue.judged(quality, at);
    if (quality > 0) this.venue.sparks.emit(head.clone().add(new T.Vector3(0, 0.35, 0)), quality > 0.9 ? PT.gold : quality > 0.7 ? PT.cyan : PT.violet, Math.round(14 + quality * 30), 3.2, 0.7);
    if (j === "YEAH" || (gold && j !== "X")) this.venue.moment(1);
    this.flashYou = quality > 0 ? 0.6 + quality * 0.4 : 0;
    this.flashColor.copy(quality > 0.9 ? GOLD : quality > 0.7 ? CYAN : VIOLET);
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
  update(tracker: TrackerLike, _pose: Pose, camera: boolean, beat = 0) {
    const now = performance.now(),
      dt = Math.min(0.06, (now - this.last) / 1000);
    this.last = now;
    this.beat = beat;
    this.cameraOn = camera;
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
      this.sync.sampleCoach(this.coach, now);
      const hand = this.coach.handWorld("R", new T.Vector3());
      if (hand) {
        this.motion = this.motion * 0.9 + Math.min(1, hand.distanceTo(this.lastHand) / Math.max(0.001, dt) / 4) * 0.1;
        this.lastHand.copy(hand);
      }
      const hips = this.coach.rigBone("Hips");
      if (hips) {
        const p = hips.getWorldPosition(new T.Vector3());
        this.shadow.position.set(p.x, 0.01, p.z);
        this.venue.follow.target.position.set((p.x + YOU.x) / 2, 0.9, p.z);
      }
    }
    this.updateYou(tracker, camera, now, dt, beat);
    this.venue.update(now / 1000, dt, this.motion);
    this.stage.post(now / 1000, this.show);
    this.stage.render();
  }
  /** You: the avatar copies the camera; without a camera it grooves. */
  private updateYou(tracker: TrackerLike, camera: boolean, now: number, dt: number, beat: number) {
    if (!this.youReady) return;
    this.body.update(camera ? tracker.latestWorld : null, now);
    const live = camera && this.body.live(now);
    if (live) {
      this.you.drive(this.body, "front", { blend: 0.55, legs: true, now });
      if (this.ready) this.sync.compare(this.body, now);
    } else {
      // demo or lost tracking: dance the routine a beat behind the coach
      this.you.timeline(coachLayers(this.routine, beat - 0.25, this.groove));
    }
    this.you.group.updateMatrixWorld(true);
    const hips = this.you.rigBone("Hips");
    if (hips) {
      const p = hips.getWorldPosition(new T.Vector3());
      this.youShadow.position.set(p.x, 0.01, p.z);
    }
    // the ring and rim tell you how in sync you are, all the time
    const m = live ? this.sync.meter : 0.55 + Math.sin(beat * Math.PI) * 0.1;
    const color = m > 0.72 ? GOLD.clone().lerp(new T.Color(1, 1, 1), (m - 0.72) * 1.5) : m > 0.45 ? CYAN.clone().lerp(GOLD, (m - 0.45) / 0.27) : MAGENTA.clone().lerp(CYAN, Math.max(0, m - 0.2) / 0.25);
    (this.ringMat.uniforms.uColor.value as T.Color).copy(color);
    this.ringMat.uniforms.uFill.value = Math.max(0, Math.min(1, (m - 0.15) / 0.7));
    this.ringMat.uniforms.uPulse.value = this.show.pulse;
    this.flashYou = Math.max(0, this.flashYou - dt * 2.5);
    const rimA = VIOLET.clone().lerp(color, 0.7).lerp(this.flashColor, this.flashYou * 0.8);
    const rimB = CYAN.clone().lerp(color, 0.5).lerp(this.flashColor, this.flashYou * 0.8);
    this.you.setRim(rimA, rimB, 1 + m * 0.8 + this.flashYou * 1.5);
    // sparkle trails off your hands while you're really on it
    if (live && this.sync.meter > 0.7 && now - this.lastSparkle > 90) {
      this.lastSparkle = now;
      for (const s of ["L", "R"] as const) {
        const h = this.you.handWorld(s);
        if (h) this.venue.sparks.emit(h, this.sync.meter > 0.82 ? PT.gold : PT.cyan, 3, 1.4, 0.45);
      }
    }
    // the callout and the tag ride above your head
    const head = this.you.rigBone("Head")?.getWorldPosition(new T.Vector3());
    if (head) {
      const p = this.stage.project(head.clone().add(new T.Vector3(0, 0.42, 0)));
      this.judgeEl.style.left = `${(p.x * 100).toFixed(2)}%`;
      this.judgeEl.style.top = `${(p.y * 100).toFixed(2)}%`;
      const q = this.stage.project(head.clone().add(new T.Vector3(0, 0.26, 0)));
      this.tagEl.style.left = `${(q.x * 100).toFixed(2)}%`;
      this.tagEl.style.top = `${(q.y * 100).toFixed(2)}%`;
      this.tagEl.classList.toggle("on", beat < 16);
    }
  }
  /** Dev and QA: what a bot dancer needs (the coach's pose, relative to her hips). */
  botView() {
    const hips = this.coach.rigBone("Hips")?.getWorldPosition(new T.Vector3());
    if (!this.ready || !hips) return null;
    const rel = (name: string) => {
      const p = this.coach.rigBone(name)?.getWorldPosition(new T.Vector3());
      return p ? [p.x - hips.x, p.y - hips.y, p.z - hips.z] : null;
    };
    return {
      game: "dance",
      beat: this.beat,
      hipsY: hips.y,
      // the coach's own sides; a mirroring player copies her right with their left
      handR: rel("RightHand"),
      handL: rel("LeftHand"),
      elbowR: rel("RightForeArm"),
      elbowL: rel("LeftForeArm"),
      sync: this.sync.last.score,
      meter: this.sync.meter,
    };
  }
  dispose() {
    this.alive = false;
    clearTimeout(this.judgeTimer);
    clearTimeout(this.bannerTimer);
    this.host.parentElement?.classList.remove("pt-dance-on");
    this.coach.dispose();
    this.you.dispose();
    this.stage.dispose();
    this.host.remove();
    const w = window as unknown as { gsGame?: unknown };
    if (w.gsGame === this) delete w.gsGame;
  }
}

export function broadcastFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}
