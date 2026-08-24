// SFX — synthesized sound effects for the movement suite. Zero audio assets,
// matching the procedural song engine: every sound is built from oscillators
// and filtered noise at call time. The AudioContext is created lazily on the
// first play call (game launches are clicks, so autoplay policy is satisfied).
//
//   sfx.slice(combo)  bright swipe, pitch climbs with the combo
//   sfx.hit(strength) weighted impact thud
//   sfx.whoosh()      air movement without contact
//   sfx.miss()        soft dull thump, never punishing
//   sfx.pop(step)     pentatonic score ping (0,1,2... climbs)
//   sfx.tick() / sfx.go()       countdown
//   sfx.bell()        boxing round bell
//   sfx.fanfare(big)  results sting
//   sfx.count()       score count-up tick

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 5;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** one enveloped oscillator */
  private tone(freq: number, opts: { to?: number; type?: OscillatorType; gain?: number; attack?: number; decay: number; delay?: number }) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.5, t0 + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.decay);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + opts.decay + 0.05);
  }

  /** filtered noise burst */
  private hiss(opts: { freq: number; to?: number; q?: number; gain?: number; decay: number; type?: BiquadFilterType; delay?: number }) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.decay);
    f.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.4, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.decay + 0.05);
  }

  slice(combo = 0) {
    const lift = Math.min(12, combo) * 40;
    this.hiss({ freq: 1800 + lift * 4, to: 5200 + lift * 8, gain: 0.32, decay: 0.12 });
    this.tone(760 + lift, { to: 1150 + lift, type: 'triangle', gain: 0.16, decay: 0.14 });
  }

  whoosh() {
    this.hiss({ freq: 500, to: 2200, gain: 0.14, decay: 0.16, q: 0.8 });
  }

  hit(strength = 1) {
    this.tone(150 + strength * 60, { to: 55, gain: 0.55 * (0.5 + strength * 0.5), decay: 0.16 + strength * 0.08 });
    this.hiss({ freq: 2600, gain: 0.2 * strength, decay: 0.05, type: 'highpass' });
  }

  miss() {
    this.tone(130, { to: 70, type: 'triangle', gain: 0.22, decay: 0.2 });
  }

  bomb() {
    this.tone(90, { to: 30, gain: 0.7, decay: 0.5 });
    this.hiss({ freq: 900, to: 120, gain: 0.5, decay: 0.45, q: 0.7 });
  }

  /** pentatonic ping; step climbs 0,1,2... resets on combo break */
  pop(step = 0) {
    const penta = [0, 2, 4, 7, 9];
    const midi = 76 + penta[step % 5] + 12 * Math.floor(step / 5);
    const f = 440 * Math.pow(2, (Math.min(midi, 100) - 69) / 12);
    this.tone(f, { type: 'triangle', gain: 0.18, decay: 0.22 });
    this.tone(f * 2, { gain: 0.05, decay: 0.14 });
  }

  tick() {
    this.tone(880, { type: 'square', gain: 0.1, decay: 0.07 });
  }

  go() {
    for (const [f, d] of [[523, 0], [659, 0], [784, 0]] as const) {
      this.tone(f, { type: 'triangle', gain: 0.2, decay: 0.5, delay: d });
    }
    this.hiss({ freq: 3000, to: 6000, gain: 0.18, decay: 0.3 });
  }

  bell() {
    for (const f of [1180, 1187, 2360]) {
      this.tone(f, { gain: f > 2000 ? 0.08 : 0.22, decay: 1.1 });
    }
  }

  fanfare(big = false) {
    const notes = big ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, { type: 'triangle', gain: 0.22, decay: 0.5, delay: i * 0.11 }));
    if (big) this.hiss({ freq: 4000, to: 8000, gain: 0.16, decay: 0.6, delay: 0.3 });
  }

  count() {
    this.tone(1320, { type: 'square', gain: 0.05, decay: 0.03 });
  }
}

export const sfx = new Sfx();
