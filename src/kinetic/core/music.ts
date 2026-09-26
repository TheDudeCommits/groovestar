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
export const TRACKS: Song[] = [
  {
    ...common,
    id: "signal",
    title: "Signal / 01",
    bpm: 112,
    beats: 168,
    root: 50,
    chords: [
      [0, 3, 7],
      [-5, 0, 3],
      [-2, 2, 5],
      [-7, -2, 2],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 48, kind: "chorus" },
      { beat: 80, kind: "verse" },
      { beat: 112, kind: "chorus" },
      { beat: 152, kind: "outro" },
    ],
  },
  {
    ...common,
    id: "afterimage",
    title: "Afterimage / 02",
    bpm: 128,
    beats: 192,
    root: 53,
    chords: [
      [0, 4, 7],
      [-3, 0, 4],
      [-5, -1, 2],
      [-7, -3, 0],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 48, kind: "chorus" },
      { beat: 96, kind: "verse" },
      { beat: 128, kind: "chorus" },
      { beat: 176, kind: "outro" },
    ],
  },
  {
    ...common,
    id: "velocity",
    title: "Velocity / 03",
    bpm: 136,
    beats: 204,
    root: 45,
    chords: [
      [0, 3, 7],
      [3, 7, 10],
      [-5, 0, 3],
      [-2, 2, 5],
    ],
    sections: [
      { beat: 0, kind: "intro" },
      { beat: 16, kind: "verse" },
      { beat: 48, kind: "chorus" },
      { beat: 96, kind: "verse" },
      { beat: 128, kind: "chorus" },
      { beat: 192, kind: "outro" },
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
    this.audio?.pause();
    void this.engine?.ctx.suspend();
  }
  resume() {
    if (this.stopped) return;
    this.paused = false;
    void this.audio?.play().catch(() => {});
    void this.engine?.ctx.resume();
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
    void this.engine?.ctx.close();
  }
}
