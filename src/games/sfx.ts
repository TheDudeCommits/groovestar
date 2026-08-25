// SFX — sample-first sound engine for the movement suite. Real recorded
// one-shots live in /public/sfx (mono mp3, ~270KB total) and are lazily
// decoded on first use; until a buffer is ready, a small synth fallback
// covers the call so the game is never silent. Variants are rotated and
// slightly pitch-randomized so rapid slicing never sounds machine-gunned.

const LIB: Record<string, string[]> = {
  slice: ['clean-slice-1', 'clean-slice-2', 'clean-slice-3'],
  swipe: ['sword-swipe-1', 'sword-swipe-3', 'sword-swipe-5'],
  impact_melon: ['impact-watermelon'],
  impact_orange: ['impact-orange'],
  impact_apple: ['impact-apple'],
  impact_lime: ['impact-kiwifruit'],
  impact_berry: ['impact-plum'],
  impact_pineapple: ['impact-pineapple'],
  impact_dragon: ['dragonfruit'],
  impact_gold: ['critical'],
  impact_coconut: ['impact-coconut-more-attack'],
  crack: ['impact-coconut'],
  splat: ['splatter-medium-1'],
  bomb: ['bomb-explode'],
  throw: ['throw-fruit'],
  combo: ['combo'],
  comboUp: ['combo-6', 'combo-7', 'combo-8'],
  critical: ['critical'],
  freeze: ['bonus-banana-freeze'],
  frenzy: ['bonus-banana-frenzy'],
  fever: ['bonus-firework-explode'],
  bossHit: ['pome-slice-1'],
  bossDown: ['pome-slice-3'],
  tick: ['time-tick'],
  tock: ['time-tock'],
  start: ['game-start'],
  over: ['game-over'],
  results: ['progress-complete'],
  popup: ['popup-1'],
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = false;
  private variant = new Map<string, number>();

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 5;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.loadAll();
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private loadAll() {
    if (this.loading) return;
    this.loading = true;
    const names = new Set(Object.values(LIB).flat());
    for (const n of names) {
      fetch(`/sfx/${n}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => this.ctx!.decodeAudioData(ab))
        .then((buf) => this.buffers.set(n, buf))
        .catch(() => { /* fallback synth covers it */ });
    }
  }

  /** play a library sound; returns false if its buffer is not decoded yet */
  private play(name: string, gain = 1, rate = 1): boolean {
    const ctx = this.ensure();
    if (!ctx || !this.master) return false;
    const files = LIB[name];
    if (!files) return false;
    const idx = (this.variant.get(name) ?? Math.floor(Math.random() * files.length)) % files.length;
    this.variant.set(name, idx + 1);
    const buf = this.buffers.get(files[idx]) ?? this.buffers.get(files[(idx + 1) % files.length]);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  // ---- synth fallbacks (only heard before buffers decode) -------------------

  private tone(freq: number, opts: { to?: number; type?: OscillatorType; gain?: number; decay: number; delay?: number }) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.5, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.decay);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + opts.decay + 0.05);
  }

  private hiss(opts: { freq: number; to?: number; gain?: number; decay: number; type?: BiquadFilterType }) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.4, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.decay + 0.05);
  }

  // ---- game API -------------------------------------------------------------

  /** fruit cut: clean slice layered with the fruit's own impact */
  slice(combo = 0, kind?: string) {
    const ok = this.play('slice', 0.9);
    if (kind && LIB[`impact_${kind}`]) this.play(`impact_${kind}`, 0.8);
    else if (ok && kind) this.play('splat', 0.5);
    if (!ok) this.hiss({ freq: 1800 + combo * 40, to: 5200, gain: 0.3, decay: 0.12 });
  }

  /** air swing without contact — throttle at the call site */
  whoosh() {
    if (!this.play('swipe', 0.55)) this.hiss({ freq: 500, to: 2200, gain: 0.13, decay: 0.16 });
  }

  hit(strength = 1) {
    if (!this.play('splat', 0.6 + strength * 0.4)) {
      this.tone(150 + strength * 60, { to: 55, gain: 0.5 * strength, decay: 0.2 });
    }
  }

  miss() {
    this.tone(130, { to: 70, type: 'triangle', gain: 0.16, decay: 0.2 });
  }

  bomb() {
    if (!this.play('bomb', 1)) {
      this.tone(90, { to: 30, gain: 0.7, decay: 0.5 });
      this.hiss({ freq: 900, to: 120, gain: 0.5, decay: 0.45 });
    }
  }

  /** combo milestone stingers escalate through the recorded set */
  pop(step = 0) {
    const name = step >= 6 ? 'comboUp' : 'combo';
    if (!this.play(name, 0.8, 1 + Math.min(0.2, step * 0.02))) {
      this.tone(660 + step * 40, { type: 'triangle', gain: 0.16, decay: 0.2 });
    }
  }

  critical() {
    if (!this.play('critical', 0.9)) this.hit(0.9);
  }

  /** hard shell taking a knock without splitting */
  crack() {
    if (!this.play('crack', 0.85)) this.hit(0.4);
  }

  freeze() {
    if (!this.play('freeze', 0.9)) this.tone(880, { to: 220, gain: 0.2, decay: 0.5 });
  }

  frenzy() {
    if (!this.play('frenzy', 0.9)) this.hiss({ freq: 3000, to: 6000, gain: 0.16, decay: 0.3 });
  }

  bossHit(n = 0) {
    if (!this.play('bossHit', 0.85, 1 + n * 0.03)) this.hit(0.5);
  }

  bossDown() {
    if (!this.play('bossDown', 1)) this.hit(1);
  }

  throwUp() {
    this.play('throw', 0.4);
  }

  tick() {
    if (!this.play('tick', 0.7)) this.tone(880, { type: 'square', gain: 0.08, decay: 0.07 });
  }

  count() {
    this.tone(1320, { type: 'square', gain: 0.035, decay: 0.03 });
  }

  go() {
    if (!this.play('start', 0.9)) {
      for (const [f, d] of [[523, 0], [659, 0], [784, 0]] as const) this.tone(f, { type: 'triangle', gain: 0.16, decay: 0.5, delay: d });
    }
  }

  bell() {
    for (const f of [1180, 1187, 2360]) this.tone(f, { gain: f > 2000 ? 0.05 : 0.14, decay: 1.1 });
  }

  fanfare(big = false) {
    if (big) {
      if (!this.play('fever', 0.9)) this.play('results', 0.9);
    } else if (!this.play('comboUp', 0.8)) {
      [523, 659, 784].forEach((f, i) => this.tone(f, { type: 'triangle', gain: 0.16, decay: 0.5, delay: i * 0.11 }));
    }
  }

  resultsSting() {
    this.play('results', 0.9);
  }

  gameOver() {
    this.play('over', 0.9);
  }

  popup() {
    this.play('popup', 0.6);
  }

  // ---- persistent saber hum -------------------------------------------------

  private hums: Partial<Record<'L' | 'R', { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode }>> = {};

  /** continuous lightsaber hum; level 0..1 follows swing speed */
  saberHum(h: 'L' | 'R', level: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    let hum = this.hums[h];
    if (!hum) {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.value = 62;
      osc2.frequency.value = 62 * 1.008;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 340;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.master);
      osc1.start();
      osc2.start();
      hum = { osc1, osc2, gain };
      this.hums[h] = hum;
    }
    const t = ctx.currentTime;
    hum.gain.gain.setTargetAtTime(0.028 + level * 0.075, t, 0.06);
    hum.osc1.frequency.setTargetAtTime(62 + level * 46, t, 0.05);
    hum.osc2.frequency.setTargetAtTime((62 + level * 46) * 1.008, t, 0.05);
  }

  saberHumStop() {
    const ctx = this.ctx;
    for (const h of ['L', 'R'] as const) {
      const hum = this.hums[h];
      if (!hum || !ctx) continue;
      hum.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      const { osc1, osc2 } = hum;
      setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch { /* stopped */ } }, 400);
      this.hums[h] = undefined;
    }
  }
}

export const sfx = new Sfx();
