// YouTube import: the official IFrame player is the audio/video source (shown
// as a dimmed backdrop panel, Just-Dance-video-background style) and a beat
// clock derived from player time drives choreography, pictograms and scoring.

import type { SectionDef } from './songs';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady?: () => void }
}

export function parseYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    ?? url.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) { resolve(); return; }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiPromise;
}

export class YouTubeSource {
  holder: HTMLDivElement;
  private player: any = null;
  duration = 0;
  title = '';
  error: string | null = null;

  constructor() {
    this.holder = document.createElement('div');
    this.holder.className = 'yt-holder';
    const inner = document.createElement('div');
    this.holder.appendChild(inner);
    document.getElementById('app')!.appendChild(this.holder);
  }

  async load(videoId: string): Promise<boolean> {
    await loadApi();
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      this.player = new window.YT.Player(this.holder.firstChild, {
        videoId,
        playerVars: {
          autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0,
          iv_load_policy: 3, modestbranding: 1, playsinline: 1,
        },
        events: {
          onReady: () => {
            this.duration = this.player.getDuration() || 0;
            this.title = this.player.getVideoData?.()?.title ?? '';
            // some live streams / broken videos report 0
            if (this.duration < 30) { this.error = 'Video too short or unavailable.'; done(false); }
            else done(true);
          },
          onError: (e: any) => {
            const code = e?.data;
            this.error = code === 101 || code === 150
              ? 'This video does not allow embedding — try another one.'
              : code === 2 ? 'Invalid video link.' : 'Video unavailable.';
            done(false);
          },
        },
      });
      setTimeout(() => { if (!settled) { this.error = 'YouTube took too long to load.'; done(false); } }, 15000);
    });
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(t: number) { this.player?.seekTo(t, true); }
  time(): number { return this.player?.getCurrentTime?.() ?? 0; }
  get ended(): boolean { return this.player?.getPlayerState?.() === 0; }
  setBounds(x: number, y: number, w: number, h: number) {
    Object.assign(this.holder.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const ifr = this.holder.querySelector('iframe') as HTMLIFrameElement | null;
    if (ifr) { ifr.width = String(w); ifr.height = String(h); }
  }
  destroy() {
    try { this.player?.destroy(); } catch { /* already gone */ }
    this.holder.remove();
  }
}

/** SongClock backed by the YouTube player's playhead */
export class YouTubeClock {
  private est = 0;
  private lastRaw = -1;
  private lastPerf = 0;
  finishedFlag = false;

  /** current tempo (mutable — mic beat-sync nudges it toward the real tempo) */
  bpm: number;
  readonly baseBpm: number;
  /** integrated beat phase — bpm changes only affect the future, not the past */
  private beatAccum = 0;
  private lastEstForBeat = 0;
  /** true once the mic listener has locked onto the track */
  synced = false;
  /** true when no reliable BPM was known up front — mic sync may adopt any tempo */
  freeTempo = false;

  constructor(
    private src: YouTubeSource,
    bpm: number,
    private sections: SectionDef[],
    private totalBeats: number,
    private leadBeats = 4,
  ) {
    this.bpm = bpm;
    this.baseBpm = bpm;
  }

  /** smoothed playhead → beats; player time only ticks ~4×/s, so interpolate */
  beat(): number {
    const raw = this.src.time();
    const now = performance.now();
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      // hard resync on big jumps (seek), gentle pull otherwise
      if (Math.abs(raw - this.est) > 0.35) this.est = raw;
      else this.est += (raw - this.est) * 0.25;
      this.lastPerf = now;
    } else {
      this.est += (now - this.lastPerf) / 1000;
      this.lastPerf = now;
    }
    // integrate beats so a tempo correction doesn't teleport the grid
    const dt = this.est - this.lastEstForBeat;
    if (dt < -0.5 || dt > 2) {
      // seek/restart: rebuild from absolute time at the current tempo
      this.beatAccum = (this.est * this.bpm) / 60;
    } else if (dt > 0) {
      this.beatAccum += (dt * this.bpm) / 60;
    }
    this.lastEstForBeat = this.est;
    return this.beatAccum - this.leadBeats;
  }

  /** un-corrected beat grid at the base tempo — used for karaoke timing */
  videoBeat(): number {
    return (this.est * this.baseBpm) / 60 - this.leadBeats;
  }

  /**
   * Apply a mic beat-sync estimate: pull tempo toward the detected BPM and
   * nudge the grid phase so integer beats land on detected beats. All
   * corrections are rate-limited so the gameplay grid never jumps.
   */
  applySync(est: { bpm: number; anchorMs: number; confidence: number }) {
    if (est.confidence < 0.12) return;
    // tempo: accept the detected bpm (or its half/double) if within 12% of the
    // known tempo — or, with no known tempo, adopt whatever octave lands in
    // the danceable 85-170 band
    const cands = [est.bpm, est.bpm * 2, est.bpm / 2];
    let detected: number | null = null;
    for (const c of cands) {
      if (Math.abs(c / this.baseBpm - 1) < 0.12) { detected = c; break; }
    }
    if (detected === null && this.freeTempo && est.confidence > 0.2) {
      detected = cands.find((c) => c >= 85 && c <= 170) ?? est.bpm;
    }
    if (detected !== null) {
      const step = this.freeTempo ? 1.2 : 0.35;
      this.bpm += Math.max(-step, Math.min(step, detected - this.bpm));
      // phase: what fractional beat does the detected beat land on?
      const dtSec = (performance.now() - est.anchorMs) / 1000;
      const anchorBeat = this.beatAccum - (dtSec * this.bpm) / 60;
      const frac = ((anchorBeat % 1) + 1) % 1;
      const delta = frac <= 0.5 ? -frac : 1 - frac; // shortest path to the grid
      this.beatAccum += Math.max(-0.03, Math.min(0.03, delta));
      this.synced = Math.abs(delta) < 0.15 && est.confidence > 0.18;
    }
  }

  sectionAt(beat: number): SectionDef['kind'] {
    let kind: SectionDef['kind'] = 'intro';
    for (const s of this.sections) if (beat >= s.beat) kind = s.kind;
    return kind;
  }

  get finished(): boolean {
    return this.src.ended || this.beat() >= this.totalBeats;
  }

  stop() { this.src.pause(); }

  restart() {
    this.est = 0; this.lastRaw = -1;
    this.src.seek(0);
    this.src.play();
  }

  // small celebration sting (the video keeps playing underneath)
  private sting: AudioContext | null = null;
  goldSting() {
    this.sting ??= new AudioContext();
    const c = this.sting, t = c.currentTime;
    [0, 4, 7, 12].forEach((n, i) => {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 440 * Math.pow(2, (n + 12) / 12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.3);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.35);
    });
  }
}
