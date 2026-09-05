// Original GrooveStar compositions and effects. No third-party audio samples.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd(),
  rate = 44100;
fs.mkdirSync("public/kinetic/audio", { recursive: true });
function random(seed) {
  let a = seed;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
}
function wav(name, left, right = left) {
  const b = Buffer.alloc(44 + left.length * 4);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  for (let i = 0; i < left.length; i++) {
    b.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, left[i])) * 32767),
      44 + i * 4,
    );
    b.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, right[i])) * 32767),
      46 + i * 4,
    );
  }
  fs.writeFileSync(name, b);
}
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const tracks = [
  {
    id: "signal",
    bpm: 112,
    beats: 168,
    root: 50,
    chords: [
      [0, 3, 7],
      [-5, 0, 3],
      [-2, 2, 5],
      [-7, -2, 2],
    ],
  },
  {
    id: "afterimage",
    bpm: 128,
    beats: 192,
    root: 53,
    chords: [
      [0, 4, 7],
      [-3, 0, 4],
      [-5, -1, 2],
      [-7, -3, 0],
    ],
  },
  {
    id: "velocity",
    bpm: 136,
    beats: 204,
    root: 45,
    chords: [
      [0, 3, 7],
      [3, 7, 10],
      [-5, 0, 3],
      [-2, 2, 5],
    ],
  },
];
for (let ti = 0; ti < tracks.length; ti++) {
  const tr = tracks[ti],
    spb = 60 / tr.bpm,
    seconds = tr.beats * spb,
    N = Math.ceil((seconds + 1) * rate),
    L = new Float32Array(N),
    R = new Float32Array(N),
    rnd = random(103 + ti);
  const add = (at, dur, fn, gain = 1, pan = 0) => {
    const start = Math.floor(at * rate),
      n = Math.floor(dur * rate);
    for (let i = 0; i < n && start + i < N; i++) {
      if (start + i < 0) continue;
      const t = i / rate,
        v = fn(t, i) * gain;
      L[start + i] += v * (1 - pan * 0.55);
      R[start + i] += v * (1 + pan * 0.55);
    }
  };
  const kick = (at) =>
    add(
      at,
      0.38,
      (t) =>
        Math.sin(2 * Math.PI * (46 * t + 5.8 * (1 - Math.exp(-t * 38)))) *
          Math.exp(-t * 12) +
        0.11 * (rnd() * 2 - 1) * Math.exp(-t * 240),
      0.8,
    );
  const snare = (at) => {
    add(
      at,
      0.22,
      (t) =>
        ((rnd() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 185 * t) * 0.3) *
        Math.exp(-t * 24),
      0.34,
    );
    for (let j = 0; j < 3; j++)
      add(
        at + j * 0.011,
        0.055,
        (t) => (rnd() * 2 - 1) * Math.exp(-t * 75),
        0.08,
        ti ? -0.12 : 0.12,
      );
  };
  const hat = (at, open = false) =>
    add(
      at,
      open ? 0.22 : 0.06,
      (t) =>
        ((rnd() * 2 - 1) * 0.6 + Math.sin(t * 2 * Math.PI * 9100) * 0.1) *
        Math.exp(-t * (open ? 24 : 105)),
      open ? 0.09 : 0.055,
      Math.floor(at * 9) % 2 ? 0.35 : -0.35,
    );
  for (let beat = 0; beat < tr.beats; beat++) {
    const bar = Math.floor(beat / 4),
      offset = beat % 4,
      section = beat < 16 ? 0 : bar % 16 >= 12 ? 1 : 2,
      last = beat > tr.beats - 12;
    const chord = tr.chords[Math.floor(bar / 2) % 4];
    if (!last && (section === 2 || offset === 0)) kick(beat * spb);
    if (!last && section > 0 && (offset === 1 || offset === 3))
      snare(beat * spb);
    if (section > 0 && !last) {
      hat(beat * spb);
      hat((beat + 0.5) * spb, offset === 3 && bar % 4 === 3);
      if (ti === 2 && bar % 4 === 3) hat((beat + 0.75) * spb);
    }
    if (section > 0 && !last) {
      const pattern =
        ti === 0 ? [0, 0.75] : ti === 1 ? [0, 0.5, 0.75] : [0, 0.5];
      for (const p of pattern) {
        const f = midi(tr.root + chord[0] - 12 + (offset === 3 ? 7 : 0));
        const at = (beat + p) * spb;
        add(
          at,
          spb * 0.45,
          (t) => {
            const env = (1 - Math.exp(-t * 160)) * Math.exp(-t * 9);
            return (
              (Math.sin(2 * Math.PI * f * t) +
                0.22 * Math.sin(4 * Math.PI * f * t) +
                0.09 * Math.sin(6 * Math.PI * f * t)) *
              env
            );
          },
          0.19,
        );
      }
    }
    if (offset === 0) {
      for (let ci = 0; ci < chord.length; ci++) {
        const f = midi(tr.root + chord[ci] + 12);
        add(
          beat * spb,
          spb * 3.8,
          (t) => {
            const env = (1 - Math.exp(-t * 12)) * Math.exp(-t * 1.7);
            return (
              (Math.sin(
                2 * Math.PI * f * t +
                  1.1 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 6),
              ) +
                0.2 * Math.sin(2 * Math.PI * f * 1.002 * t)) *
              env
            );
          },
          section === 2 ? 0.1 : 0.15,
          (ci - 1) * 0.55,
        );
      }
    }
    if (beat >= 16 && beat < tr.beats - 8 && !(bar % 16 >= 12)) {
      const melody =
        ti === 0
          ? [0, 7, 3, 10, 7, 3, 2, 7]
          : ti === 1
            ? [0, 4, 7, 11, 7, 4, 2, 9]
            : [0, 3, 7, 12, 10, 7, 3, 2];
      for (let j = 0; j < 2; j++) {
        if (section === 1 && j) continue;
        const note = tr.root + 12 + melody[(beat * 2 + j) % 8],
          f = midi(note),
          at = (beat + j * 0.5) * spb;
        const fn = (t) =>
          Math.sin(
            2 * Math.PI * f * t +
              0.45 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 12),
          ) *
          (1 - Math.exp(-t * 250)) *
          Math.exp(-t * 8);
        add(at, 0.7, fn, 0.1, j ? 0.3 : -0.3);
        add(at + spb * 0.75, 0.7, fn, 0.027, j ? -0.5 : 0.5);
      }
    }
    if (beat > 16 && beat % 32 === 0)
      add(beat * spb, 1.2, (t) => (rnd() * 2 - 1) * Math.exp(-t * 5), 0.13);
  }
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const time = i / rate,
      frac = (time / spb) % 1,
      duck = 0.66 + 0.34 * (1 - Math.exp(-frac * 12));
    const fade = Math.min(
      1,
      time / 0.08,
      Math.max(0, (seconds + 0.5 - time) / 1.5),
    );
    L[i] = Math.tanh(L[i] * duck * 1.4) * fade;
    R[i] = Math.tanh(R[i] * duck * 1.4) * fade;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  for (let i = 0; i < N; i++) {
    L[i] *= 0.88 / Math.max(0.1, peak);
    R[i] *= 0.88 / Math.max(0.1, peak);
  }
  const temp = path.join("/tmp", `groovestar-${tr.id}.wav`);
  wav(temp, L, R);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    temp,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "160k",
    `public/kinetic/audio/${tr.id}.mp3`,
  ]);
  console.log("Composed", tr.id, seconds.toFixed(2), "seconds");
}
const files = fs.readdirSync("public/sfx").filter((x) => x.endsWith(".mp3"));
let si = 0;
for (const file of files) {
  const rnd = random(700 + si++),
    name = file.replace(".mp3", ""),
    isSweep = /swipe|slice|throw/.test(name),
    isTone = /combo|critical|tick|tock|popup|progress|start|over/.test(name),
    duration = /progress|over|start/.test(name) ? 1.5 : isSweep ? 0.3 : 0.4;
  const data = new Float32Array(Math.ceil(duration * rate));
  let low = 0,
    phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate,
      noise = rnd() * 2 - 1;
    low += 0.1 * (noise - low);
    let v;
    if (isSweep) {
      v =
        (noise - low) *
          Math.sin((Math.PI * t) / duration) *
          Math.exp(-t * 6) *
          0.4 +
        low * 0.15;
    } else if (isTone) {
      const f = 280 + si * 17;
      v =
        (Math.sin(2 * Math.PI * f * t) +
          0.3 * Math.sin(2 * Math.PI * f * 1.5 * t)) *
        Math.exp(-t * 8) *
        0.35;
      if (duration > 1)
        v +=
          0.18 *
          Math.sin(2 * Math.PI * f * 2 * t) *
          Math.exp(-Math.max(0, t - 0.2) * 5) *
          (t > 0.2 ? 1 : 0);
    } else {
      phase += (2 * Math.PI * (55 + 95 * Math.exp(-t * 30))) / rate;
      v =
        (Math.sin(phase) * 0.55 +
          low * 0.75 +
          noise * Math.exp(-t * 80) * 0.25) *
        Math.exp(-t * 15);
    }
    data[i] = Math.tanh(v) * Math.min(1, t * 1000);
  }
  const temp = "/tmp/groovestar-effect.wav";
  wav(temp, data);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    temp,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "96k",
    "-ac",
    "1",
    `public/sfx/${file}`,
  ]);
}
console.log("Created", files.length, "original rendered effect samples");
