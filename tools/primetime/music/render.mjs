// GrooveStar Primetime soundtrack: original compositions rendered from pure
// DSP (no samples). Punchy drums, sidechain-pumped supersaw chords, plucks,
// a lead hook, risers into every drop, reverb and ping-pong delay, then a
// soft-clip and look-ahead limiter to a loud, clean master.
//
//   node tools/primetime/music/render.mjs [trackId...]
// Writes public/kinetic/audio/<id>.mp3 (needs ffmpeg with libmp3lame).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { TRACKS } from "./tracks.mjs";

const SR = 44100;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
}

/** Topology-preserving state-variable filter (Simper). */
class SVF {
  constructor() {
    this.a = 0;
    this.b = 0;
  }
  run(v0, cutoff, q, mode) {
    const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)),
      a2 = g * a1,
      a3 = g * a2;
    const v3 = v0 - this.b;
    const v1 = a1 * this.a + a2 * v3;
    const v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a;
    this.b = 2 * v2 - this.b;
    return mode === "lp" ? v2 : mode === "bp" ? v1 : v0 - k * v1 - v2;
  }
}

function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Stereo buffer bus with sends. */
class Bus {
  constructor(n) {
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  add(i, v, pan = 0) {
    if (i < 0 || i >= this.L.length) return;
    const l = Math.cos(((pan + 1) * Math.PI) / 4),
      r = Math.sin(((pan + 1) * Math.PI) / 4);
    this.L[i] += v * l * 1.4142;
    this.R[i] += v * r * 1.4142;
  }
}

/** Freeverb. */
function reverb(L, R, room = 0.84, damp = 0.35, width = 1) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const n = L.length;
  const outL = new Float32Array(n),
    outR = new Float32Array(n);
  for (const [src, dst, spread] of [
    [L, outL, 0],
    [R, outR, 23],
  ]) {
    const cb = combs.map((c) => ({ buf: new Float32Array(c + spread), i: 0, store: 0 }));
    const ab = aps.map((a) => ({ buf: new Float32Array(a + spread), i: 0 }));
    for (let s = 0; s < n; s++) {
      const input = (L[s] + R[s]) * 0.015;
      let o = 0;
      for (const c of cb) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = input + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        o += y;
      }
      for (const a of ab) {
        const b = a.buf[a.i];
        a.buf[a.i] = o + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        o = b - o;
      }
      dst[s] = o;
    }
    void src;
  }
  if (width < 1) {
    for (let s = 0; s < n; s++) {
      const m = (outL[s] + outR[s]) / 2;
      outL[s] = m + (outL[s] - m) * width;
      outR[s] = m + (outR[s] - m) * width;
    }
  }
  return [outL, outR];
}

/** Ping-pong delay with a darkening feedback loop. */
function delay(L, R, seconds, feedback = 0.38) {
  const d = Math.round(seconds * SR);
  const n = L.length;
  const lineL = new Float32Array(n),
    lineR = new Float32Array(n);
  const oL = new Float32Array(n),
    oR = new Float32Array(n);
  const fl = new SVF(),
    fr = new SVF();
  for (let s = 0; s < n; s++) {
    const inp = (L[s] + R[s]) * 0.5;
    const tapL = s >= d ? lineL[s - d] : 0;
    const tapR = s >= d ? lineR[s - d] : 0;
    lineL[s] = inp + fl.run(tapR, 4500, 0.7, "lp") * feedback;
    lineR[s] = fr.run(tapL, 4500, 0.7, "lp") * feedback;
    oL[s] = tapL;
    oR[s] = tapR;
  }
  return [oL, oR];
}

export function render(tr) {
  const spb = 60 / tr.bpm;
  const beats = tr.bars * 4;
  const seconds = beats * spb + 3.5;
  const N = Math.ceil(seconds * SR);
  const drums = new Bus(N),
    music = new Bus(N),
    fx = new Bus(N),
    verbSend = new Bus(N),
    delaySend = new Bus(N);
  const duck = new Float32Array(N).fill(1);
  const rnd = rng(tr.seed);
  const T = (beat) => Math.round(beat * spb * SR);
  const noise = () => rnd() * 2 - 1;

  // ---------------------------------------------------------------- drums --
  const kick = (beat, vel = 1) => {
    const s0 = T(beat);
    let ph = 0;
    const n = Math.round(0.42 * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = 46 + 150 * Math.exp(-t * 32) + 30 * Math.exp(-t * 180);
      ph += f / SR;
      const amp = t < 0.01 ? 1 : Math.exp(-(t - 0.01) * 6.5);
      let v = Math.sin(TAU * ph) * amp;
      v += noise() * Math.exp(-t * 900) * 0.35;
      v = Math.tanh(v * 1.8) * 0.55 * vel;
      drums.add(s0 + i, v, 0);
    }
    // sidechain: everything musical ducks under the kick
    const rel = Math.round(spb * 0.72 * SR);
    for (let i = 0; i < rel; i++) {
      const k = i / rel;
      const g = 1 - tr.pump * Math.pow(1 - k, 2.2);
      if (s0 + i < N) duck[s0 + i] = Math.min(duck[s0 + i], g);
    }
  };
  const clap = (beat, vel = 1) => {
    const s0 = T(beat);
    const bp = new SVF();
    for (const [off, len] of [
      [0, 0.012],
      [0.009, 0.012],
      [0.019, 0.013],
      [0.03, 0.2],
    ]) {
      const a = Math.round(off * SR),
        n = Math.round(len * SR);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const env = len > 0.1 ? Math.exp(-t * 16) : Math.exp(-t * 180);
        const v = bp.run(noise(), 1500, 0.9, "bp") * env * 1.6 * vel;
        drums.add(s0 + a + i, v, 0.05);
        verbSend.add(s0 + a + i, v * 0.3, 0);
      }
    }
  };
  const snare = (beat, vel = 1) => {
    const s0 = T(beat);
    const bp = new SVF();
    const n = Math.round(0.18 * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const v = (bp.run(noise(), 2400, 0.8, "bp") * 0.9 + Math.sin(TAU * 190 * t) * 0.5 * Math.exp(-t * 40)) * Math.exp(-t * 20) * vel;
      drums.add(s0 + i, v * 0.8, -0.05);
      verbSend.add(s0 + i, v * 0.15, 0);
    }
  };
  const hat = (beat, open = false, vel = 1, pan = 0.2) => {
    const s0 = T(beat);
    const hp = new SVF();
    const n = Math.round((open ? 0.32 : 0.06) * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const v = hp.run(noise(), 8000, 0.7, "hp") * Math.exp(-t * (open ? 11 : 75)) * 0.5 * vel;
      drums.add(s0 + i, v, pan);
    }
  };
  const crash = (beat) => {
    const s0 = T(beat);
    const hp = new SVF();
    const n = Math.round(2.6 * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const v = hp.run(noise(), 5200, 0.6, "hp") * Math.exp(-t * 1.5) * 0.28;
      drums.add(s0 + i, v, (rnd() - 0.5) * 0.4);
      verbSend.add(s0 + i, v * 0.25, 0);
    }
  };
  const impact = (beat) => {
    const s0 = T(beat);
    const n = Math.round(1.6 * SR);
    const lp = new SVF();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const boom = Math.sin(TAU * (38 + 40 * Math.exp(-t * 8)) * t) * Math.exp(-t * 2.4);
      const air = lp.run(noise(), 900 + 6000 * Math.exp(-t * 3), 0.7, "lp") * Math.exp(-t * 2.2) * 0.4;
      fx.add(s0 + i, (boom * 0.9 + air) * 0.8, 0);
      verbSend.add(s0 + i, air * 0.5, 0);
    }
  };
  const riser = (beat, lengthBeats) => {
    const s0 = T(beat);
    const n = Math.round(lengthBeats * spb * SR);
    const bp = new SVF();
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const f = 300 * Math.pow(30, k);
      const nz = bp.run(noise(), f, 1.2, "bp") * (0.05 + 0.5 * k * k);
      ph += (110 * Math.pow(4, k)) / SR;
      const saw = (2 * (ph % 1) - 1) * 0.05 * k * k;
      fx.add(s0 + i, nz + saw, Math.sin(k * 20) * 0.3 * k);
      verbSend.add(s0 + i, nz * 0.4, 0);
    }
  };

  // ---------------------------------------------------------------- synths --
  const sawVoice = (f, ph0, n, out) => {
    let ph = ph0;
    const dt = f / SR;
    for (let i = 0; i < n; i++) {
      out[i] += 2 * ph - 1 - blep(ph, dt);
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  };
  /** Supersaw chord: 7 detuned saws per note, spread wide, low-passed. */
  const supersaw = (beat, notes, lengthBeats, o = {}) => {
    const s0 = T(beat);
    const n = Math.round(lengthBeats * spb * SR);
    const rel = Math.round((o.release ?? 0.22) * SR);
    const detune = [-0.19, -0.11, -0.05, 0, 0.05, 0.11, 0.19];
    const bufL = new Float32Array(n + rel),
      bufR = new Float32Array(n + rel);
    notes.forEach((m, ni) => {
      detune.forEach((d, vi) => {
        const tmp = new Float32Array(n + rel);
        sawVoice(mtof(m + d * (o.spread ?? 1)), rnd(), n + rel, tmp);
        const pan = ((vi / (detune.length - 1)) * 2 - 1) * 0.85;
        const l = Math.cos(((pan + 1) * Math.PI) / 4),
          r = Math.sin(((pan + 1) * Math.PI) / 4);
        for (let i = 0; i < tmp.length; i++) {
          bufL[i] += tmp[i] * l;
          bufR[i] += tmp[i] * r;
        }
        void ni;
      });
    });
    const fL = new SVF(),
      fR = new SVF();
    const att = Math.round((o.attack ?? 0.012) * SR);
    for (let i = 0; i < n + rel; i++) {
      const env = Math.min(1, i / Math.max(1, att)) * (i < n ? 1 : Math.exp(-(i - n) / (rel * 0.3)));
      const cut = (o.cutoff ?? 4200) * (o.open ? 0.4 + 0.6 * Math.min(1, i / (n * 0.9)) : 1);
      const g = (o.gain ?? 0.05) * env;
      const vl = fL.run(bufL[i], cut, 0.7, "lp") * g,
        vr = fR.run(bufR[i], cut, 0.7, "lp") * g;
      if (s0 + i < N) {
        music.L[s0 + i] += vl;
        music.R[s0 + i] += vr;
        verbSend.L[s0 + i] += vl * (o.verb ?? 0.25);
        verbSend.R[s0 + i] += vr * (o.verb ?? 0.25);
      }
    }
  };
  /** Plucky saw with a snapping filter envelope. */
  const pluck = (beat, m, lengthBeats, o = {}) => {
    const s0 = T(beat);
    const n = Math.round(Math.min(lengthBeats * spb, 0.5) * SR) + Math.round(0.15 * SR);
    const tmp = new Float32Array(n);
    sawVoice(mtof(m), rnd(), n, tmp);
    sawVoice(mtof(m + 0.08), rnd(), n, tmp);
    const f = new SVF();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const cut = 500 + (o.bright ?? 5200) * Math.exp(-t * 22);
      const v = f.run(tmp[i] * 0.5, cut, 1.2, "lp") * Math.exp(-t * (o.decay ?? 7)) * (o.gain ?? 0.16);
      const pan = o.pan ?? 0;
      music.add(s0 + i, v, pan);
      delaySend.add(s0 + i, v * (o.delay ?? 0.35), 0);
      verbSend.add(s0 + i, v * 0.18, 0);
    }
  };
  /** Lead: detuned saws, gentle vibrato, filtered. */
  const lead = (beat, m, lengthBeats, o = {}) => {
    const s0 = T(beat);
    const n = Math.round(lengthBeats * spb * SR);
    const rel = Math.round(0.12 * SR);
    const f = new SVF();
    const phs = [rnd(), rnd(), rnd()];
    const dets = [-0.07, 0, 0.07];
    for (let i = 0; i < n + rel; i++) {
      const t = i / SR;
      const vib = t > 0.14 ? Math.sin(TAU * 5.6 * t) * 0.13 * Math.min(1, (t - 0.14) * 4) : 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const fr = mtof(m + dets[k] + vib);
        const dt = fr / SR;
        v += 2 * phs[k] - 1 - blep(phs[k], dt);
        phs[k] += dt;
        if (phs[k] >= 1) phs[k] -= 1;
      }
      const env = Math.min(1, i / (0.006 * SR)) * (i < n ? 1 : Math.exp(-(i - n) / (rel * 0.35)));
      v = f.run(v / 3, o.cutoff ?? 3600, 0.9, "lp") * env * (o.gain ?? 0.15);
      music.add(s0 + i, v, 0);
      delaySend.add(s0 + i, v * 0.28, 0);
      verbSend.add(s0 + i, v * 0.3, 0);
    }
  };
  /** Bass: saw + sub, filter snap, saturation. Mono. */
  const bass = (beat, m, lengthBeats, o = {}) => {
    const s0 = T(beat);
    const n = Math.round(lengthBeats * spb * SR);
    const rel = Math.round(0.02 * SR);
    const tmp = new Float32Array(n + rel);
    sawVoice(mtof(m), rnd(), n + rel, tmp);
    const f = new SVF();
    let sub = 0;
    for (let i = 0; i < n + rel; i++) {
      const t = i / SR;
      sub += mtof(m - 12) / SR;
      const env = Math.min(1, i / (0.003 * SR)) * (i < n ? 1 : Math.exp(-(i - n) / (rel * 0.3)));
      const cut = (o.cutoff ?? 260) + (o.snap ?? 1500) * Math.exp(-t * 16);
      const v = Math.tanh((f.run(tmp[i], cut, 1.1, "lp") * 0.9 + Math.sin(TAU * sub) * 0.55) * 1.4) * env * (o.gain ?? 0.24);
      music.add(s0 + i, v, 0);
    }
  };
  /** Soft pad for intros and breakdowns. */
  const pad = (beat, notes, lengthBeats) =>
    supersaw(beat, notes, lengthBeats, { attack: 0.5, release: 1.2, cutoff: 2400, gain: 0.075, verb: 0.5, spread: 0.7 });

  // ------------------------------------------------------------ arrangement --
  const chordAt = (bar) => tr.progression[bar % tr.progression.length];
  const notesOf = (bar, octave = 0) => chordAt(bar).map((d) => tr.root + d + octave);
  for (const sec of tr.arrangement) {
    for (let bar = sec.from; bar < sec.to; bar++) {
      const b0 = bar * 4;
      const kind = sec.kind;
      const lastOfSec = bar === sec.to - 1;
      const chord = notesOf(bar, 12);
      // drums
      const drumsOn = kind === "verse" || kind === "drop" || kind === "drop2" || (kind === "build" && !lastOfSec);
      if (drumsOn) for (let k = 0; k < 4; k++) kick(b0 + k, kind === "build" ? 0.9 : 1);
      if (kind === "verse" || kind === "drop" || kind === "drop2") {
        clap(b0 + 1);
        clap(b0 + 3);
        for (let k = 0; k < 8; k++) hat(b0 + k * 0.5 + (k % 2 ? tr.swing : 0), k % 2 === 1 && kind !== "verse", k % 2 ? 1 : 0.55, k % 2 ? 0.25 : -0.2);
        if (kind !== "verse") for (let k = 0; k < 16; k += 1) if (k % 4 === 3) hat(b0 + k * 0.25, false, 0.4, 0.35);
      }
      if (kind === "intro" && bar >= sec.to - 2) for (let k = 0; k < 8; k++) hat(b0 + k * 0.5, false, 0.45, 0.2);
      if (kind === "build") {
        const total = (sec.to - sec.from) * 4;
        const beatIn = (bar - sec.from) * 4;
        for (let k = 0; k < 4; k++) {
          const at = beatIn + k;
          const div = at < total * 0.5 ? 1 : at < total * 0.75 ? 2 : 4;
          for (let j = 0; j < div; j++) snare(b0 + k + j / div, 0.35 + 0.65 * (at / total));
        }
        if (bar === sec.from) riser(b0, total);
      }
      if ((kind === "drop" || kind === "drop2") && bar === sec.from) {
        crash(b0);
        impact(b0);
      }
      if ((kind === "drop" || kind === "drop2") && bar === sec.from + 8) crash(b0);
      // bass
      if (kind === "verse" || kind === "drop" || kind === "drop2" || (kind === "build" && !lastOfSec)) {
        const r = tr.root + tr.bassNotes[bar % tr.bassNotes.length] - 24;
        if (tr.bassStyle === "offbeat") for (let k = 0; k < 4; k++) bass(b0 + k + 0.5, r + (k === 3 && bar % 2 ? 12 : 0), 0.42);
        else for (let k = 0; k < 16; k++) bass(b0 + k * 0.25, r + (k % 8 === 6 ? 12 : 0), 0.22, { gain: k % 4 === 0 ? 0.25 : 0.18 });
      }
      // chords
      if (kind === "drop" || kind === "drop2") {
        if (tr.chordStyle === "stabs") for (const at of [0, 0.75, 1.5, 2.5, 3.25]) supersaw(b0 + at, chord, 0.45, { gain: 0.11, cutoff: 6500 });
        else supersaw(b0, chord, 4, { gain: 0.095, cutoff: kind === "drop2" ? 7500 : 6500 });
      }
      if (kind === "intro" || kind === "break") pad(b0, notesOf(bar, 0), 4);
      if (kind === "build") supersaw(b0, chord, 4, { gain: 0.07, cutoff: 900 + 4800 * ((bar - sec.from + 1) / (sec.to - sec.from)), open: true });
      // arp plucks
      if (kind === "verse" || kind === "build" || kind === "drop2" || (kind === "intro" && bar >= sec.from + 1)) {
        const tones = [...chord, chord[0] + 12];
        const pat = tr.arp;
        for (let k = 0; k < 16; k++) {
          if (pat[k % pat.length] < 0) continue;
          const m = tones[pat[k % pat.length] % tones.length] + (kind === "drop2" ? 12 : 0);
          pluck(b0 + k * 0.25, m, 0.25, { gain: kind === "intro" ? 0.12 : kind === "drop2" ? 0.11 : 0.17, bright: kind === "intro" ? 2200 : 6200, pan: k % 2 ? 0.3 : -0.3 });
        }
      }
      // hook
      if (kind === "drop" || kind === "drop2" || (kind === "break" && bar >= sec.from + 2)) {
        const phraseBar = (bar - sec.from) % 4;
        for (const [at, m, len] of tr.hook) {
          if (Math.floor(at / 4) !== phraseBar) continue;
          lead(b0 + (at % 4), m + (kind === "break" ? -12 : 0), len * 0.95, { gain: kind === "break" ? 0.16 : 0.24, cutoff: kind === "break" ? 2600 : 5200 });
        }
      }
      if (kind === "outro" && bar === sec.from) {
        impact(b0);
        supersaw(b0, chord, 6, { gain: 0.04, release: 2.5, cutoff: 3000, verb: 0.6 });
        kick(b0);
      } else if (kind === "outro") pad(b0, notesOf(bar, 0), 4);
    }
  }

  // ------------------------------------------------------------------- mix --
  const [dL, dR] = delay(delaySend.L, delaySend.R, spb * 0.75, 0.42);
  const [rL, rR] = reverb(verbSend.L, verbSend.R, 0.86, 0.3);
  const L = new Float32Array(N),
    R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const g = duck[i];
    L[i] = drums.L[i] + (music.L[i] + dL[i] * 0.5) * g + rL[i] * 1.1 * (0.5 + 0.5 * g) + fx.L[i];
    R[i] = drums.R[i] + (music.R[i] + dR[i] * 0.5) * g + rR[i] * 1.1 * (0.5 + 0.5 * g) + fx.R[i];
  }
  // gentle glue: highpass rumble, then loudness normalize, soft clip and limit
  const hpL = new SVF(),
    hpR = new SVF();
  let sum = 0;
  for (let i = 0; i < N; i++) {
    L[i] = hpL.run(L[i], 28, 0.7, "hp");
    R[i] = hpR.run(R[i], 28, 0.7, "hp");
    sum += L[i] * L[i] + R[i] * R[i];
  }
  const rms = Math.sqrt(sum / (2 * N));
  const gain = Math.pow(10, -10.5 / 20) / Math.max(1e-6, rms);
  const look = Math.round(0.004 * SR);
  const env = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.tanh(L[i] * gain * 0.9) / 0.9,
      b = Math.tanh(R[i] * gain * 0.9) / 0.9;
    L[i] = a;
    R[i] = b;
    env[i] = Math.max(Math.abs(a), Math.abs(b));
  }
  let g = 1;
  const ceiling = Math.pow(10, -1 / 20);
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    let peak = 0;
    for (let j = i; j < Math.min(N, i + look); j += 4) peak = Math.max(peak, env[j]);
    const want = peak > ceiling ? ceiling / peak : 1;
    g = want < g ? want : g + (want - g) * 0.0007;
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), i * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), i * 4 + 2);
  }
  return { pcm: out, seconds };
}

function wavHeader(bytes) {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}

const only = process.argv.slice(2);
fs.mkdirSync("tools/primetime/scratch/music", { recursive: true });
for (const tr of TRACKS) {
  if (only.length && !only.includes(tr.id)) continue;
  const t0 = Date.now();
  const { pcm, seconds } = render(tr);
  const wav = `tools/primetime/scratch/music/${tr.id}.wav`;
  fs.writeFileSync(wav, Buffer.concat([wavHeader(pcm.length), pcm]));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "192k", `public/kinetic/audio/${tr.id}.mp3`]);
  console.log(tr.id, `${seconds.toFixed(1)}s`, `${((Date.now() - t0) / 1000).toFixed(1)}s render`);
}
