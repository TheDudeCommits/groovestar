import { Stage } from "../render/stage";
import { MotionInput, type MotionState } from "./input";
import { settings, announce } from "./settings";
import { gameDef, type GameId } from "./catalog";
import {
  dailySeed,
  saveRun,
  type RunRecord,
  type ReplayPoint,
} from "./records";
import { SessionMusic, TRACKS } from "./music";
import type { GameSessionOpts, Game } from "../../games/shared";
import { sfx } from "../../games/sfx";
export interface KineticOpts extends GameSessionOpts {
  id: GameId;
  seed?: string;
  track?: number;
  endless?: boolean;
  players?: number;
  onRecord?: (r: RunRecord) => void;
  onQuit?: () => void;
  onRestart?: () => void;
}
export abstract class KineticSession implements Game {
  readonly host = document.createElement("div");
  readonly stage: Stage;
  readonly input: MotionInput;
  readonly config = settings();
  readonly seed: string;
  readonly music: SessionMusic;
  protected preparation: Promise<unknown> = Promise.resolve();
  protected elapsed = 0;
  private activeSeconds = 0;
  private frameTimes: number[] = [];
  protected duration = 90;
  protected score = 0;
  protected hits = 0;
  protected misses = 0;
  protected combo = 0;
  protected bestCombo = 0;
  protected replay: ReplayPoint[] = [];
  protected stopped = false;
  protected paused = false;
  protected trackingLost = false;
  private raf = 0;
  private last = 0;
  private replayAt = 0;
  private hud: HTMLElement;
  private pauseLayer: HTMLElement;
  private judgeEl: HTMLElement;
  private statusEl: HTMLElement;
  private judgeTimer = 0;
  private started = false;
  private pausedByUser = false;
  constructor(
    readonly options: KineticOpts,
    dark = false,
  ) {
    this.seed = options.seed ?? dailySeed(options.id);
    this.host.className = `kinetic-game ${dark ? "is-dark" : ""}`;
    document.getElementById("app")!.appendChild(this.host);
    this.stage = new Stage(this.host, { dark, bloom: dark });
    this.input = new MotionInput(options.tracker, this.config.lowImpact);
    this.music = new SessionMusic(TRACKS[options.track ?? 0]);
    this.hud = document.createElement("div");
    this.hud.className = "k-hud";
    this.hud.innerHTML = `<div><span class="k-eyebrow">${gameDef(options.id).title} ${options.cameraOk ? "" : "· DEMO"}</span><strong data-score>0</strong><span data-detail>FIND YOUR RHYTHM</span></div><div class="k-hud-right"><button data-pause aria-label="Pause game">Ⅱ</button><strong data-time>90</strong><span data-combo>READY</span></div>`;
    this.host.appendChild(this.hud);
    this.judgeEl = document.createElement("div");
    this.judgeEl.className = "k-judgment";
    this.judgeEl.setAttribute("aria-live", "polite");
    this.host.appendChild(this.judgeEl);
    this.statusEl = document.createElement("div");
    this.statusEl.className = "k-game-status";
    this.host.appendChild(this.statusEl);
    this.pauseLayer = document.createElement("div");
    this.pauseLayer.className = "k-pause";
    this.pauseLayer.hidden = true;
    this.pauseLayer.setAttribute("role", "dialog");
    this.pauseLayer.setAttribute("aria-label", "Pause session");
    this.pauseLayer.innerHTML =
      '<span class="k-eyebrow">TAKE A BREATH</span><h2>In your own time.</h2><p>Stand in your play area when you are ready.</p><button data-resume class="k-primary">Resume ↗</button><button data-recalibrate>Recalibrate position</button><button data-restart>Restart session</button><button data-quit>Back to game</button>';
    this.host.appendChild(this.pauseLayer);
    this.pauseLayer
      .querySelector("[data-restart]")!
      .addEventListener("click", () => {
        this.stop();
        options.onRestart?.();
      });
    this.hud
      .querySelector("[data-pause]")!
      .addEventListener("click", () => this.togglePause());
    this.pauseLayer
      .querySelector("[data-resume]")!
      .addEventListener("click", () => this.togglePause());
    this.pauseLayer
      .querySelector("[data-recalibrate]")!
      .addEventListener("click", () => {
        this.input.reset();
        this.togglePause();
      });
    this.pauseLayer
      .querySelector("[data-quit]")!
      .addEventListener("click", () => {
        this.stop();
        options.onQuit?.();
      });
    window.addEventListener("keydown", this.key);
    document.addEventListener("visibilitychange", this.visibility);
    this.host.addEventListener("gs-context", (e) => {
      if ((e as CustomEvent).detail === "lost") {
        this.pause(true);
        this.statusEl.textContent =
          "Graphics interrupted. Recovering your scene.";
      } else
        this.statusEl.textContent = "Graphics restored. Resume when ready.";
    });
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.statusEl.textContent = "Getting your session ready…";
    void this.preparation
      .catch(() => {
        this.statusEl.textContent =
          "Character unavailable. Your session can still be played.";
      })
      .then(() => {
        if (this.stopped) return;
        this.last = performance.now();
        void this.music.start();
        announce("Find your rhythm. Let’s go.");
        this.raf = requestAnimationFrame(this.frame);
      });
  }
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.togglePause();
    }
  };
  private visibility = () => {
    if (document.hidden && !this.paused) this.pause(true);
  };
  private frame = (now: number) => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.frame);
    const frameTime = now - this.last;
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    const dt = Math.min(0.1, Math.max(0, frameTime / 1000));
    this.last = now;
    const input = this.input.update(now);
    const lost = this.options.cameraOk && !input.tracked;
    if (lost !== this.trackingLost) {
      this.trackingLost = lost;
      if (lost) this.music.pause();
      else if (!this.paused) this.music.resume();
    }
    if (!this.paused && !lost && !this.stage.contextLost) {
      this.elapsed += dt;
      if (this.options.cameraOk && input.energy > 0.15)
        this.activeSeconds += dt;
      this.step(dt, this.elapsed, input);
      if (this.stopped) return;
      this.music.energy(input.energy);
      if (this.elapsed - this.replayAt > 0.1) {
        this.replayAt = this.elapsed;
        this.replay.push(this.replayPoint(input));
      }
      if (this.elapsed >= this.duration && !this.options.endless) this.finish();
    }
    if (this.stopped) return;
    this.statusEl.textContent = lost
      ? "Step back into frame · your round is paused"
      : this.paused
        ? ""
        : this.hint();
    this.updateHud();
    this.stage.render();
    (window as unknown as { gsKinetic: unknown }).gsKinetic = {
      id: this.options.id,
      demo: !this.options.cameraOk,
      elapsed: this.elapsed,
      score: this.score,
      hits: this.hits,
      misses: this.misses,
      paused: this.paused || lost,
      poseAge:
        this.options.cameraOk && Number.isFinite(input.poseAge)
          ? input.poseAge
          : null,
      frameMs: this.stage.frameMs,
      frames: this.stage.frames,
      phone:
        (this.options.tracker as unknown as { stats?: unknown }).stats ?? null,
      drawCalls: this.stage.renderer.info.render.calls,
      frameP95: this.frameTimes.length
        ? this.frameTimes.slice().sort((a, b) => a - b)[
            Math.floor(this.frameTimes.length * 0.95)
          ]
        : 0,
      ...this.diagnostics(),
    };
  };
  protected abstract step(
    dt: number,
    elapsed: number,
    input: MotionState,
  ): void;
  protected hint(): string {
    return this.options.cameraOk
      ? ""
      : "DEMO · Camera-free preview · Records disabled";
  }
  protected diagnostics(): Record<string, unknown> {
    return {};
  }
  protected resultDetails(): RunRecord["details"] {
    return undefined;
  }
  protected replayPoint(input: MotionState): ReplayPoint {
    return {
      t: this.elapsed,
      x: input.lane,
      y: input.duck ? 1 : 0,
      action: input.rise ? "rise" : undefined,
      score: this.score,
    };
  }
  protected updateHud() {
    (this.hud.querySelector("[data-score]") as HTMLElement).textContent =
      String(this.score);
    (this.hud.querySelector("[data-time]") as HTMLElement).textContent = this
      .options.endless
      ? String(Math.floor(this.elapsed))
      : Number.isFinite(this.duration)
        ? String(Math.max(0, Math.ceil(this.duration - this.elapsed)))
        : "PLAY";
    (this.hud.querySelector("[data-combo]") as HTMLElement).textContent =
      this.combo > 1 ? `${this.combo} COMBO` : "FIND YOUR FLOW";
    (this.hud.querySelector("[data-detail]") as HTMLElement).textContent =
      `${this.hits} CLEAN · ${this.misses} MISSED`;
  }
  protected hit(points = 100, text = "ON POINT") {
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.combo, this.bestCombo);
    this.score += points + Math.min(this.combo, 20) * 5;
    this.judge(text);
    sfx.hit(0.7);
  }
  protected miss(text = "KEEP MOVING") {
    this.misses++;
    this.combo = 0;
    this.judge(text, false);
  }
  protected judge(text: string, good = true) {
    this.judgeEl.textContent = text;
    this.judgeEl.classList.toggle("is-miss", !good);
    this.judgeEl.classList.remove("show");
    void this.judgeEl.offsetWidth;
    this.judgeEl.classList.add("show");
    clearTimeout(this.judgeTimer);
    this.judgeTimer = window.setTimeout(
      () => this.judgeEl.classList.remove("show"),
      650,
    );
  }
  pause(value: boolean) {
    this.paused = value;
    this.pausedByUser = value;
    this.pauseLayer.hidden = !value;
    if (value) this.music.pause();
    else if (!this.trackingLost) this.music.resume();
    if (value)
      (this.pauseLayer.querySelector("[data-resume]") as HTMLElement).focus();
  }
  private togglePause() {
    this.pause(!this.paused);
  }
  protected finish() {
    if (this.stopped) return;
    const record: RunRecord = {
      version: 2,
      id: this.options.id,
      score: this.score,
      seconds: this.elapsed,
      hits: this.hits,
      misses: this.misses,
      combo: this.bestCombo,
      seed: this.seed,
      difficulty: this.config.difficulty,
      lowImpact: this.config.lowImpact,
      camera: this.options.cameraOk,
      track: this.options.track ?? 0,
      players: this.options.players ?? 1,
      details: this.resultDetails(),
      endless: !!this.options.endless,
      activeSeconds: this.activeSeconds,
      date: new Date().toISOString(),
      replay: this.replay,
    };
    saveRun(record);
    this.options.onRecord?.(record);
    this.stop();
    this.options.onExit(
      record.score,
      `${record.hits} clean moves · ${Math.round((record.hits / Math.max(1, record.hits + record.misses)) * 100)}% accuracy · Best combo ${record.combo}`,
    );
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.judgeTimer);
    window.removeEventListener("keydown", this.key);
    document.removeEventListener("visibilitychange", this.visibility);
    this.music.stop();
    sfx.saberHumStop();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.stage.dispose();
    this.host.remove();
    delete (window as unknown as { gsKinetic?: unknown }).gsKinetic;
  }
}
