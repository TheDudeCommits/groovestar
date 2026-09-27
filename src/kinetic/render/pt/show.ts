import * as T from "three";
import { HYPE_LEVELS } from "./palette";

/**
 * The Show Director. Games report the beat and how the player is doing; the
 * director turns that into a shared show state every venue effect reads:
 * a beat pulse, the current hype level and its palette, and one-shot cues
 * (a level-up, a drop) that trigger confetti, pyro and camera kicks.
 */
export class ShowDirector {
  beat = 0;
  /** 1 on the beat, decaying to 0 before the next one. */
  pulse = 0;
  /** 1 on every bar (4 beats), decaying over the bar. */
  barPulse = 0;
  /** Continuous 0..1 energy; each level is a fifth of it. */
  hype = 0.12;
  level = 0;
  /** Seconds since the last level change (drives flashes and banners). */
  sinceLevel = 99;
  /** Smoothed 0..1 hit flash used by lights. */
  flash = 0;
  readonly colorA = new T.Color(HYPE_LEVELS[0].colors[0]);
  readonly colorB = new T.Color(HYPE_LEVELS[0].colors[1]);
  private targetA = new T.Color(HYPE_LEVELS[0].colors[0]);
  private targetB = new T.Color(HYPE_LEVELS[0].colors[1]);
  private lastBeat = -1;
  private listeners: ((level: number, up: boolean) => void)[] = [];
  private beatListeners: ((beat: number) => void)[] = [];
  constructor(readonly reduced = false) {}
  onLevel(fn: (level: number, up: boolean) => void) {
    this.listeners.push(fn);
  }
  onBeat(fn: (beat: number) => void) {
    this.beatListeners.push(fn);
  }
  get levelName() {
    return HYPE_LEVELS[this.level].name;
  }
  /** A successful action: quality 0..1 (1 is perfect). */
  hit(quality = 1) {
    this.hype = Math.min(1, this.hype + 0.012 + 0.018 * quality);
    this.flash = Math.min(1, this.flash + 0.55 + 0.45 * quality);
  }
  miss() {
    this.hype = Math.max(0, this.hype - 0.035);
  }
  update(dt: number, beat: number) {
    this.beat = beat;
    const whole = Math.floor(beat);
    if (whole !== this.lastBeat && beat >= 0) {
      this.lastBeat = whole;
      for (const fn of this.beatListeners) fn(whole);
    }
    const frac = beat - Math.floor(beat);
    this.pulse = beat >= 0 ? Math.pow(1 - frac, 3) : 0;
    const bar = (beat / 4) % 1;
    this.barPulse = beat >= 0 ? Math.pow(1 - bar, 2) : 0;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    // Energy drains slowly so the show breathes with the player.
    this.hype = Math.max(0, this.hype - dt * 0.006);
    const next = Math.min(4, Math.floor(this.hype * 5));
    // Hysteresis: dropping a level needs a clear dip below the threshold.
    if (next > this.level || (next < this.level && this.hype < this.level / 5 - 0.04)) {
      const up = next > this.level;
      this.level = next;
      this.sinceLevel = 0;
      this.targetA.set(HYPE_LEVELS[next].colors[0]);
      this.targetB.set(HYPE_LEVELS[next].colors[1]);
      for (const fn of this.listeners) fn(next, up);
    }
    this.sinceLevel += dt;
    const k = 1 - Math.exp(-dt * 2.5);
    this.colorA.lerp(this.targetA, k);
    this.colorB.lerp(this.targetB, k);
  }
  /** 0..1 intensity multiplier for show elements that grow with hype. */
  get intensity() {
    return 0.45 + this.hype * 0.55;
  }
}
