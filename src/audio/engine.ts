// Procedural song engine. Every song is synthesized live from its chord loop +
// section arrangement, so the whole game ships with zero audio assets and the
// beat clock is sample-accurate — visuals, pictograms and scoring all read
// time from here.

import type { Song, SectionDef } from '../songs';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private comp: DynamicsCompressorNode;
  private song: Song | null = null;
  /** 0..1 live intensity override for arcade games; null = section-driven */
  energy: number | null = null;
  private startTime = 0;
  private nextSixteenth = 0;         // index of next 16th note to schedule
  private timer: number | null = null;
  private noiseBuf: AudioBuffer;

  constructor() {
    this.ctx = new AudioContext();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    // brightness filter: games sweep it with body movement; neutral for dance
    this.bright = this.ctx.createBiquadFilter();
    this.bright.type = 'lowpass';
    this.bright.frequency.value = 18000;
    this.master.connect(this.bright).connect(this.comp).connect(this.ctx.destination);
    // shared white-noise buffer for drums
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private bright: BiquadFilterNode;

  get spb() { return this.song ? 60 / this.song.bpm : 0.5; }

  setVolume(v: number) { this.master.gain.value = v; }

  /** 0..1 movement-driven master brightness (lowpass 500Hz..16kHz) */
  setBrightness(v: number) {
    const f = 500 * Math.pow(32, Math.max(0, Math.min(1, v)));
    this.bright.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  /** player-action note: a pentatonic pluck over the CURRENT chord, quantized
   *  to the next 16th so every hit lands musically on the grid. `tone` climbs
   *  with the combo, so streaks literally play a rising melody. */
  pluck(tone: number, gain = 0.12) {
    if (!this.song) return;
    const stepNow = ((this.ctx.currentTime - this.startTime) / this.spb) * 4;
    const step = Math.max(0, Math.ceil(stepNow));
    const t = this.stepTime(step);
    const bar = Math.floor(step / 16);
    const chord = this.song.chords[bar % this.song.chords.length];
    const penta = [0, 2, 4, 7, 9];
    const deg = penta[tone % 5] + 12 * Math.min(2, Math.floor(tone / 5));
    this.lead(t, mtof(this.song.root + chord[0] + 12 + deg), this.spb * 0.3, gain);
  }

  /** current position in beats (fractional); negative during count-in */
  beat(): number {
    if (!this.song) return 0;
    return (this.ctx.currentTime - this.startTime) / this.spb;
  }

  sectionAt(beat: number): SectionDef['kind'] {
    if (!this.song) return 'intro';
    let kind: SectionDef['kind'] = 'intro';
    for (const s of this.song.sections) if (beat >= s.beat) kind = s.kind;
    return kind;
  }

  async play(song: Song, countInBeats = 4) {
    await this.ctx.resume();
    this.song = song;
    this.startTime = this.ctx.currentTime + countInBeats * (60 / song.bpm);
    this.nextSixteenth = -countInBeats * 4;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.song = null;
  }

  get finished(): boolean {
    return !!this.song && this.beat() >= this.song.beats;
  }

  // ---- scheduling ----------------------------------------------------------
  private pump() {
    if (!this.song) return;
    const ahead = this.ctx.currentTime + 0.14;
    while (this.startTime + (this.nextSixteenth / 4) * this.spb < ahead) {
      if (this.nextSixteenth >= 0 && this.nextSixteenth < this.song.beats * 4) {
        this.scheduleStep(this.nextSixteenth);
      } else if (this.nextSixteenth < 0 && this.nextSixteenth % 4 === 0) {
        // count-in ticks
        this.tick(this.stepTime(this.nextSixteenth), 1600, 0.25);
      }
      this.nextSixteenth++;
    }
  }

  private stepTime(step: number) { return this.startTime + (step / 4) * this.spb; }

  private scheduleStep(step: number) {
    const song = this.song!;
    const beat = step / 4;              // fractional beat
    const beatInBar = Math.floor(beat) % 4;
    const sixteenth = step % 16;        // position in bar (16ths)
    const bar = Math.floor(beat / 4);
    const kind = this.sectionAt(beat);
    const t = this.stepTime(step);
    const chord = song.chords[bar % song.chords.length];
    const root = song.root + chord[0];

    // Dynamic layering: when `energy` is set (arcade games drive it from
    // combo/fever every frame), it overrides the section-based arrangement.
    // Dance mode leaves it null and hears exactly what it always heard.
    const e = this.energy;
    const drums = e === null ? kind !== 'bridge' : e > 0.18;
    const full = e === null ? kind === 'chorus' || kind === 'outro' : e > 0.62;
    const gainMul = e === null ? 1 : 0.7 + e * 0.5;

    // kick: four on the floor
    if (drums && sixteenth % 4 === 0) this.kick(t);
    // clap/snare on 2 & 4
    if (drums && (sixteenth === 4 || sixteenth === 12)) this.clap(t, (full ? 0.5 : 0.35) * gainMul);
    // hats: offbeat 8ths in verse, 16ths in chorus
    if ((e === null ? kind !== 'intro' : e > 0.32) && (full ? step % 1 === 0 : step % 2 === 1)) {
      this.hat(t, (sixteenth % 4 === 2 ? 0.16 : 0.08) * gainMul);
    }
    // bass: root 8ths with octave pop
    if ((e === null ? kind !== 'intro' : e > 0.12) && step % 2 === 0) {
      const oct = sixteenth === 14 ? 12 : 0;
      this.bass(t, mtof(song.root - 12 + chord[0] + oct), this.spb * 0.45, (full ? 0.34 : 0.26) * gainMul);
    }
    // pad: chord on bar start
    if (sixteenth === 0) this.pad(t, chord.map((c) => mtof(song.root + c)), this.spb * 3.9, kind === 'bridge' ? 0.16 : 0.1);
    // arp lead in chorus/bridge: up-down 16ths
    if ((e === null ? full || kind === 'bridge' : e > 0.5) && step % 1 === 0) {
      const seq = [0, 1, 2, 1];
      const n = chord[seq[sixteenth % 4]] + 12;
      if (sixteenth % 2 === 0) this.lead(t, mtof(song.root + n + (kind === 'bridge' ? 0 : 12)), this.spb * 0.22, (kind === 'bridge' ? 0.07 : 0.1) * gainMul);
    }
    // sparkle pluck answering in verse
    if (kind === 'verse' && (sixteenth === 6 || sixteenth === 10)) {
      this.lead(t, mtof(root + 24 + (sixteenth === 10 ? 7 : 3)), this.spb * 0.3, 0.05);
    }
    // top layer at peak energy: octave chime answering every other 16th
    if (e !== null && e > 0.85 && sixteenth % 4 === 3) {
      this.lead(t, mtof(song.root + chord[(sixteenth / 4 | 0) % chord.length] + 24), this.spb * 0.18, 0.07);
    }
    // riser into each chorus
    const next = song.sections.find((s) => s.beat === Math.floor(beat) + 1);
    if (next?.kind === 'chorus' && sixteenth === 0) this.riser(t, this.spb * 4);
    // crash on section starts
    if (song.sections.some((s) => s.beat === beat)) this.crash(t);
  }

  // ---- instruments ---------------------------------------------------------
  private env(t: number, a: number, d: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.master);
    return g;
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    o.connect(this.env(t, 0.002, 0.24, 0.85));
    o.start(t); o.stop(t + 0.3);
  }

  private noise(t: number, dur: number, peak: number, filter: (f: BiquadFilterNode) => void) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    filter(f);
    const g = this.env(t, 0.003, dur, peak);
    src.connect(f).connect(g);
    src.start(t); src.stop(t + dur + 0.05);
  }

  private clap(t: number, peak: number) {
    this.noise(t, 0.16, peak, (f) => { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.9; });
    this.noise(t + 0.012, 0.1, peak * 0.6, (f) => { f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2; });
  }

  private hat(t: number, peak: number) {
    this.noise(t, 0.045, peak, (f) => { f.type = 'highpass'; f.frequency.value = 8000; });
  }

  private crash(t: number) {
    this.noise(t, 0.9, 0.22, (f) => { f.type = 'highpass'; f.frequency.value = 5000; });
  }

  private tick(t: number, freq: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    o.connect(this.env(t, 0.001, 0.07, peak));
    o.start(t); o.stop(t + 0.09);
  }

  private bass(t: number, freq: number, dur: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.env(t, 0.004, dur, peak);
    o.connect(f).connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private pad(t: number, freqs: number[], dur: number, peak: number) {
    for (const fr of freqs) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1400;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak / freqs.length, t + 0.4);
        g.gain.setValueAtTime(peak / freqs.length, t + dur * 0.7);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(this.master);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  private lead(t: number, freq: number, dur: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3600;
    o.connect(f).connect(this.env(t, 0.005, dur, peak));
    o.start(t); o.stop(t + dur + 0.05);
  }

  private riser(t: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2800, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);
  }

  /** short celebratory sting for gold moves */
  goldSting() {
    const t = this.ctx.currentTime;
    [0, 4, 7, 12].forEach((n, i) => {
      this.lead(t + i * 0.06, mtof((this.song?.root ?? 60) + 12 + n), 0.35, 0.12);
    });
    this.crash(t);
  }
}
