// Microphone beat sync. While a YouTube track plays through the speakers, we
// listen to the room, build an onset-strength envelope (spectral flux), and
// estimate the track's real tempo (autocorrelation) and beat phase (comb
// alignment). The game's beat grid is then gently pulled onto the music, so
// pictograms land on actual downbeats instead of a guessed grid.

export interface BeatEstimate {
  bpm: number;
  /** performance.now() timestamp of a detected beat */
  anchorMs: number;
  confidence: number; // 0..1
}

const HOP_MS = 23;          // ~43 fps envelope
const WINDOW_S = 12;        // seconds of envelope kept for analysis
const MIN_BPM = 70;
const MAX_BPM = 180;

export class BeatListener {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private prevSpec: Uint8Array | null = null;
  private env: { t: number; v: number }[] = [];
  private timer: number | null = null;
  private lastEstimate: BeatEstimate | null = null;
  active = false;
  error: string | null = null;

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      src.connect(this.analyser);
      this.timer = window.setInterval(() => this.sample(), HOP_MS);
      this.active = true;
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  stop() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => { /* already closed */ });
    this.ctx = null;
    this.active = false;
  }

  private sample() {
    if (!this.analyser) return;
    const n = this.analyser.frequencyBinCount;
    const spec = new Uint8Array(n);
    this.analyser.getByteFrequencyData(spec);
    // spectral flux over ~40Hz–5kHz (kick through snare/vocals)
    const lo = 2, hi = Math.min(n, 240);
    let flux = 0;
    if (this.prevSpec) {
      for (let i = lo; i < hi; i++) {
        const d = spec[i] - this.prevSpec[i];
        if (d > 0) flux += d;
      }
    }
    this.prevSpec = spec;
    const now = performance.now();
    this.env.push({ t: now, v: flux });
    const cutoff = now - WINDOW_S * 1000;
    while (this.env.length && this.env[0].t < cutoff) this.env.shift();
  }

  /** run the tempo/phase estimate; call every ~2s */
  estimate(): BeatEstimate | null {
    const env = this.env;
    if (env.length < 200) return this.lastEstimate;
    const vals = env.map((e) => e.v);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const x = vals.map((v) => Math.max(0, v - mean));
    const energy = x.reduce((a, b) => a + b * b, 0);
    if (energy < 1e-3) return this.lastEstimate; // silence

    // autocorrelation over the plausible tempo range
    const minLag = Math.floor((60 / MAX_BPM) * 1000 / HOP_MS);
    const maxLag = Math.ceil((60 / MIN_BPM) * 1000 / HOP_MS);
    let bestLag = 0, bestCorr = 0;
    const corrAt: number[] = [];
    for (let lag = minLag; lag <= maxLag && lag < x.length / 2; lag++) {
      let c = 0;
      for (let i = 0; i + lag < x.length; i++) c += x[i] * x[i + lag];
      corrAt[lag] = c;
      if (c > bestCorr) { bestCorr = c; bestLag = lag; }
    }
    if (!bestLag) return this.lastEstimate;
    // octave disambiguation: prefer the 85–170 BPM band when the half/double
    // period explains the signal nearly as well
    const bpmOf = (lag: number) => 60000 / (lag * HOP_MS);
    let lag = bestLag;
    if (bpmOf(lag) < 85 && corrAt[Math.round(lag / 2)] !== undefined
      && corrAt[Math.round(lag / 2)] > bestCorr * 0.72) {
      lag = Math.round(lag / 2);
    } else if (bpmOf(lag) > 170 && corrAt[lag * 2] !== undefined
      && corrAt[lag * 2] > bestCorr * 0.72) {
      lag = lag * 2;
    }
    const bpm = bpmOf(lag);
    const confidence = Math.min(1, corrAt[lag] / energy);

    // phase: comb over offsets, weighting recent onsets higher
    let bestPhase = 0, bestSum = -1;
    for (let ph = 0; ph < lag; ph++) {
      let s = 0;
      for (let i = ph; i < x.length; i += lag) {
        s += x[i] * (0.5 + 0.5 * (i / x.length));
      }
      if (s > bestSum) { bestSum = s; bestPhase = ph; }
    }
    // most recent sample index that sits on the beat grid
    const lastIdx = bestPhase + Math.floor((x.length - 1 - bestPhase) / lag) * lag;
    const anchorMs = env[lastIdx].t;

    this.lastEstimate = { bpm, anchorMs, confidence };
    return this.lastEstimate;
  }
}
