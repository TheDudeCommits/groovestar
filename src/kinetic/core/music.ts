import { AudioEngine } from "../../audio/engine";
import type { Song } from "../../songs";
import { settings } from "./settings";
const common = {
  artist: "GrooveStar Original",
  scene: "city" as const,
  difficulty: 1 as const,
  accent: "#f35d42",
  accent2: "#365ff5",
  coach: {
    skin: "#ae6e4a",
    hair: "#241f1b",
    top: "#f35d42",
    vest: "#eeeae1",
    pants: "#171917",
    glove: "#eeeae1",
    boots: "#eeeae1",
  },
  choreo: [],
  lyrics: [],
};
// Produced by tools/primetime/music/render.mjs; beats and sections follow the
// arrangement there (builds count as verses, breakdowns as bridges).
export const TRACKS: Song[] = [
  {
    ...common,
    id: "signal",
    title: "Signal",
    bpm: 112,
    beats: 176,
    root: 50,
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [-2, 3, 7],
      [-2, 2, 5],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 64, kind: "chorus" },
      { beat: 112, kind: "bridge" },
      { beat: 128, kind: "verse" },
      { beat: 144, kind: "chorus" },
      { beat: 172, kind: "outro" },
    ],
  },
  {
    ...common,
    id: "afterimage",
    title: "Afterimage",
    bpm: 128,
    beats: 192,
    root: 53,
    chords: [
      [0, 4, 7],
      [-1, 2, 7],
      [-3, 0, 4],
      [-3, 0, 5],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 64, kind: "chorus" },
      { beat: 112, kind: "bridge" },
      { beat: 128, kind: "verse" },
      { beat: 144, kind: "chorus" },
      { beat: 188, kind: "outro" },
    ],
  },
  {
    ...common,
    id: "velocity",
    title: "Velocity",
    bpm: 136,
    beats: 208,
    root: 45,
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [-2, 3, 7],
      [-2, 2, 5],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 64, kind: "chorus" },
      { beat: 128, kind: "bridge" },
      { beat: 144, kind: "verse" },
      { beat: 160, kind: "chorus" },
      { beat: 204, kind: "outro" },
    ],
  },
];
export class SessionMusic {
  private audio: HTMLAudioElement | null = null;
  private engine: AudioEngine | null = null;
  private stopped = false;
  private started = false;
  private paused = false;
  constructor(readonly track = TRACKS[0]) {}
  async start() {
    this.audio = new Audio(`/kinetic/audio/${this.track.id}.mp3`);
    this.audio.volume = settings().volume * 0.55;
    this.audio.preload = "auto";
    try {
      await this.audio.play();
      if (this.stopped) {
        this.audio.pause();
        return;
      }
      if (this.paused) this.audio.pause();
      this.started = true;
    } catch {
      if (this.stopped) return;
      this.audio = null;
      this.engine = new AudioEngine();
      this.engine.setVolume(settings().volume * 0.4);
      await this.engine.play(this.track, 0);
      this.started = true;
    }
  }
  beat(elapsed: number) {
    return this.audio && this.started && !this.audio.paused
      ? (this.audio.currentTime * this.track.bpm) / 60
      : (this.engine?.beat() ?? (elapsed * this.track.bpm) / 60);
  }
  pause() {
    this.paused = true;
    if (this.stopped) return;
    this.audio?.pause();
    // a closed context rejects suspend(); tracking loss can arrive after stop()
    if (this.engine && this.engine.ctx.state !== "closed")
      this.engine.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.stopped) return;
    this.paused = false;
    void this.audio?.play().catch(() => {});
    if (this.engine && this.engine.ctx.state !== "closed")
      this.engine.ctx.resume().catch(() => {});
  }
  energy(value: number) {
    if (this.engine) {
      this.engine.energy = value;
      this.engine.setBrightness(0.55 + value * 0.45);
    }
  }
  stop() {
    this.stopped = true;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.engine?.stop();
    if (this.engine && this.engine.ctx.state !== "closed")
      this.engine.ctx.close().catch(() => {});
  }
}
