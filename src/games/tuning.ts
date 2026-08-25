// Every movement-suite threshold lives here, in one tunable object, so a
// real-camera tuning session never needs a deploy. Speeds are expressed in
// SHOULDER-WIDTHS PER SECOND (the rig divides by the live shoulder width),
// which makes every threshold independent of how far the player stands from
// the camera. World-space values are meters per second.
//
// Live tuning from the console (persists in localStorage):
//   gsTune('swing.minSpeed', 5.5)   set one value
//   gsTune()                        print the current table
//   gsTuneReset()                   back to defaults

const DEFAULTS = {
  rig: {
    lookaheadMs: 70,        // velocity extrapolation to cancel camera latency
    minCutoff: 1.1,         // One-Euro: smoothing floor
    beta: 3.2,              // One-Euro: speed responsiveness
  },
  swing: {
    minSpeed: 4.5,          // shoulder-widths/s to count as a swing
    peakHoldMs: 110,        // wait this long after crossing to find the peak
    refractoryMs: 180,      // per-hand cooldown between swing events
  },
  punch: {
    minZVel: 2.0,           // m/s toward the camera (worldLandmarks path)
    frontMargin: 0.1,       // wrist this many meters in front of the shoulder
    fallbackExtRate: 2.6,   // shoulder-widths/s of arm foreshortening (no-world path)
    fallbackShort: 1.5,     // 2D arm/shoulder ratio that reads as aimed at camera
    fullStrength: 4.0,      // m/s that maps to strength 1.0
    refractoryMs: 240,
  },
  fruit: {
    sliceRel: 3.0,          // shoulder-widths/s for a hand to cut fruit
    trailMs: 110,           // swept-collision window (kills tunneling)
    chainMs: 900,           // combo chain window between slices
    predictBoostMs: 30,     // extra saber lookahead on top of the rig's
  },
  body: {
    laneFullSW: 1.0,        // sidestep of this many shoulder widths = full lane
    centerAdaptPerSec: 0.05,// how fast the neutral standing spot re-centers
    jumpVel: 1.6,           // hip rise, torso-lengths/s
    jumpRise: 0.45,         // or hip this far above baseline (torso lengths)
    jumpHoldMs: 350,        // minimum airborne latch so jumps read cleanly
    duckDrop: 0.5,          // hip below baseline, torso lengths
    duckSquash: 0.78,       // or torso compressed to this fraction of normal
    duckHoldMs: 250,
  },
};

type Tree = { [k: string]: number | Tree };
export type Tuning = typeof DEFAULTS;

const KEY = 'gs-tune';

function clone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }

function merge(base: Tree, over: Tree) {
  for (const k of Object.keys(over)) {
    const b = base[k], o = over[k];
    if (typeof b === 'object' && typeof o === 'object') merge(b, o);
    else if (typeof b === 'number' && typeof o === 'number') base[k] = o;
  }
}

function load(): Tuning {
  const t = clone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) merge(t as unknown as Tree, JSON.parse(raw));
  } catch { /* bad JSON, run defaults */ }
  return t;
}

/** live tuning table — detectors read fields at use time, never cache them */
export const TUNING: Tuning = load();

function overrides(): Tree {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

export function gsTune(path?: string, value?: number): unknown {
  if (path === undefined) return clone(TUNING);
  const parts = path.split('.');
  let node: Tree = TUNING as unknown as Tree;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== 'object') return `no such group: ${path}`;
    node = node[p] as Tree;
  }
  const leaf = parts[parts.length - 1];
  if (typeof node[leaf] !== 'number') return `no such value: ${path}`;
  if (value === undefined) return node[leaf];
  node[leaf] = value;
  const ov = overrides();
  let on: Tree = ov;
  for (const p of parts.slice(0, -1)) {
    if (typeof on[p] !== 'object') on[p] = {};
    on = on[p] as Tree;
  }
  on[leaf] = value;
  localStorage.setItem(KEY, JSON.stringify(ov));
  return value;
}

export function gsTuneReset() {
  localStorage.removeItem(KEY);
  merge(TUNING as unknown as Tree, clone(DEFAULTS) as unknown as Tree);
}

declare global {
  // eslint-disable-next-line no-var
  var gsTune: typeof import('./tuning').gsTune;
  // eslint-disable-next-line no-var
  var gsTuneReset: typeof import('./tuning').gsTuneReset;
}
globalThis.gsTune = gsTune;
globalThis.gsTuneReset = gsTuneReset;
