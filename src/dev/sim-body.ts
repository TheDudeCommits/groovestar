// Dev and QA only: a kinematic stand-in for a player in front of a webcam.
//
// SimBody poses a 1.7 m humanoid (hands placed by two-bone IK, torso lean,
// crouch, jump, sidestep) and turns it into what MediaPipe's pose landmarker
// reports: 33 normalized image landmarks from a virtual 4:3 webcam, plus
// hip-centered world landmarks in meters. SimSource adds what a real camera
// adds: 30 fps sampling, pipeline latency, jitter, lag and lost wrists on
// fast swings. Games receive these frames through PoseTracker exactly like
// camera results, so bots exercise the full input chain (filters, rig,
// detectors, hit tests), not just game logic.
//
// Frames: subject space has the player at the origin on the floor, facing +Z
// (toward the camera), +Y up. The player's LEFT side is +X, which a camera
// facing them sees on the right of the raw (unmirrored) image, as MediaPipe
// does. World landmarks follow MediaPipe: x toward image right, y down,
// z smaller when closer to the camera, origin between the hips.

export type V3 = [number, number, number];

export interface SimLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

export interface SimFrame {
  /** capture time (performance.now ms) */
  ts: number;
  lms: SimLandmark[];
  world: SimLandmark[];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Rotate v by yaw (about +Y), then roll (about +Z), then pitch (about +X). */
function rotate(v: V3, yaw: number, roll: number, pitch: number): V3 {
  // pitch: leaning forward (toward the camera, +Z) is positive
  let [x, y, z] = v;
  let c = Math.cos(pitch),
    s = Math.sin(pitch);
  [y, z] = [y * c - z * s, y * s + z * c];
  // roll: leaning toward the player's left (+X) is positive
  c = Math.cos(roll);
  s = Math.sin(roll);
  [x, y] = [x * c + y * s, -x * s + y * c];
  c = Math.cos(yaw);
  s = Math.sin(yaw);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}

/** Two-bone IK: elbow (or knee) position for a limb from a to target. */
function twoBone(a: V3, target: V3, l1: number, l2: number, pole: V3): [V3, V3] {
  const toT = sub(target, a);
  const d = Math.min(Math.max(len(toT), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  const dir = norm(toT);
  const end = add(a, mul(dir, d));
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const p = sub(pole, mul(dir, dot(pole, dir)));
  const perp = len(p) > 1e-6 ? norm(p) : norm(cross(dir, [1, 0, 0]));
  return [add(add(a, mul(dir, along)), mul(perp, h)), end];
}

export interface SimCamera {
  /** camera position in subject space (m) */
  pos: V3;
  /** point it looks at */
  look: V3;
  /** horizontal field of view, degrees */
  hfov: number;
  aspect: number;
}

export const DEFAULT_CAMERA: SimCamera = { pos: [0, 1.15, 2.7], look: [0, 1.05, 0], hfov: 64, aspect: 4 / 3 };

/** A posable body. Every field is a target the bot sets each frame. */
export class SimBody {
  // proportions (meters)
  readonly shoulderHalf = 0.185;
  readonly hipHalf = 0.095;
  readonly upperArm = 0.29;
  readonly foreArm = 0.255;
  readonly thigh = 0.44;
  readonly shin = 0.43;
  readonly hipY = 0.93;
  readonly spine = 0.5; // hip center to shoulder line

  /** floor position of the player (m), subject space */
  root: V3 = [0, 0, 0];
  /** whole-body yaw (rad); positive turns the chest toward the player's left */
  yaw = 0;
  /** torso twist on top of yaw (rad) */
  twist = 0;
  /** sideways lean (rad), positive toward the player's left (+X) */
  leanSide = 0;
  /** forward lean (rad), positive toward the camera */
  leanFwd = 0;
  /** hips lowered by this much (m) */
  crouch = 0;
  /** airborne height (m) */
  jump = 0;
  /** wrist targets in subject space (m); null = relaxed at the side */
  hand: Record<"L" | "R", V3 | null> = { L: null, R: null };
  /** optional elbow hints: the elbow bends toward these (subject space) */
  elbow: Record<"L" | "R", V3 | null> = { L: null, R: null };
  /** foot offsets from the root (m) */
  foot: Record<"L" | "R", V3> = { L: [0.12, 0, 0.02], R: [-0.12, 0, 0.02] };

  hipCenter(): V3 {
    return add(this.root, [0, this.hipY - this.crouch + this.jump, 0]);
  }

  /** Shoulder position in subject space. */
  shoulder(side: "L" | "R"): V3 {
    const s = side === "L" ? 1 : -1;
    return add(this.hipCenter(), rotate([s * this.shoulderHalf, this.spine, 0], this.yaw + this.twist, this.leanSide, this.leanFwd));
  }

  /** A comfortable hand position relative to the chest, for bots. */
  chestPoint(dx: number, dy: number, dz: number): V3 {
    return add(this.hipCenter(), rotate([dx, this.spine + dy, dz], this.yaw + this.twist, this.leanSide, this.leanFwd));
  }

  /** All 33 joints in subject space. */
  joints(): V3[] {
    const hc = this.hipCenter();
    const torso = (v: V3) => add(hc, rotate(v, this.yaw + this.twist, this.leanSide, this.leanFwd));
    const pelvis = (v: V3) => add(hc, rotate(v, this.yaw, 0, 0));
    const J: V3[] = new Array(33);
    // head: nose slightly in front of the neck
    const head = (v: V3) => torso([v[0], this.spine + 0.17 + v[1], 0.02 + v[2]]);
    J[0] = head([0, 0, 0.1]);
    J[1] = head([0.018, 0.035, 0.085]);
    J[2] = head([0.032, 0.036, 0.08]);
    J[3] = head([0.046, 0.035, 0.07]);
    J[4] = head([-0.018, 0.035, 0.085]);
    J[5] = head([-0.032, 0.036, 0.08]);
    J[6] = head([-0.046, 0.035, 0.07]);
    J[7] = head([0.075, 0.02, 0.0]);
    J[8] = head([-0.075, 0.02, 0.0]);
    J[9] = head([0.025, -0.035, 0.085]);
    J[10] = head([-0.025, -0.035, 0.085]);
    for (const side of ["L", "R"] as const) {
      const s = side === "L" ? 1 : -1;
      const S = torso([s * this.shoulderHalf, this.spine, 0]);
      const relaxed = torso([s * (this.shoulderHalf + 0.05), this.spine - 0.52, 0.06]);
      const target = this.hand[side] ?? relaxed;
      // elbows hang down and a little out and back
      const hint = this.elbow[side];
      const pole: V3 = hint ? sub(hint, lerp3(S, target, 0.5)) : [s * 0.35, -1, -0.35];
      const [E, W] = twoBone(S, target, this.upperArm, this.foreArm, len(pole) > 1e-4 ? pole : [s * 0.35, -1, -0.35]);
      const fore = norm(sub(W, E));
      const out: V3 = norm(cross(fore, [0, 0, 1]));
      const tip = add(W, mul(fore, 0.085));
      const iS = side === "L" ? 0 : 1;
      J[11 + iS] = S;
      J[13 + iS] = E;
      J[15 + iS] = W;
      J[17 + iS] = add(tip, mul(out, -0.025 * s));
      J[19 + iS] = add(tip, mul(out, 0.02 * s));
      J[21 + iS] = add(add(W, mul(fore, 0.04)), mul(out, 0.035 * s));
      const H = pelvis([s * this.hipHalf, 0, 0]);
      const ankle = add(add(this.root, this.foot[side]), [0, 0.08 + this.jump * 0.95, 0]);
      const [K, A] = twoBone(H, ankle, this.thigh, this.shin, [0, 0, 1]);
      J[23 + iS] = H;
      J[25 + iS] = K;
      J[27 + iS] = A;
      J[29 + iS] = add(A, [0, -0.06, -0.06]);
      J[31 + iS] = add(A, [0, -0.07, 0.15]);
    }
    return J;
  }
}

/** Projects a posed body through a virtual webcam into MediaPipe results. */
export function landmarksFor(body: SimBody, cam: SimCamera): { lms: SimLandmark[]; world: SimLandmark[] } {
  const J = body.joints();
  const fwd = norm(sub(cam.look, cam.pos));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const tx = Math.tan((cam.hfov * Math.PI) / 360);
  const ty = tx / cam.aspect;
  const hc = lerp3(J[23], J[24], 0.5);
  const hipDepth = dot(sub(hc, cam.pos), fwd);
  const lms: SimLandmark[] = [];
  const world: SimLandmark[] = [];
  for (const P of J) {
    const d = sub(P, cam.pos);
    const zc = Math.max(0.05, dot(d, fwd));
    const x = 0.5 + (dot(d, right) / zc / tx) * 0.5;
    const y = 0.5 - (dot(d, up) / zc / ty) * 0.5;
    const inside = x > -0.02 && x < 1.02 && y > -0.02 && y < 1.02;
    lms.push({ x, y, z: (zc - hipDepth) / (2 * zc * tx), visibility: inside ? 0.98 : 0.12, presence: inside ? 0.99 : 0.2 });
    // world: x toward image right, y down, z grows away from the camera
    const r = sub(P, hc);
    world.push({ x: dot(r, right), y: -dot(r, up), z: dot(r, fwd), visibility: inside ? 0.98 : 0.12, presence: 0.99 });
  }
  return { lms, world };
}

/** Deterministic noise so QA runs are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface SimCameraModel {
  fps: number;
  /** capture to result (ms): exposure, transfer and inference */
  latencyMs: number;
  /** image-space jitter, fraction of the frame */
  jitter: number;
  /** world-space jitter (m); depth gets 2.5x */
  worldJitter: number;
  /** wrists lag and fade when they move faster than this (m/s) */
  blurSpeed: number;
}

export const REAL_WEBCAM: SimCameraModel = { fps: 30, latencyMs: 85, jitter: 0.0035, worldJitter: 0.012, blurSpeed: 3.2 };

/**
 * Samples a SimBody like a webcam plus MediaPipe: fixed frame rate, delayed
 * delivery, correlated jitter, and motion-blurred wrists.
 */
export class SimSource {
  private queue: SimFrame[] = [];
  private nextCapture = 0;
  private rand = rng(7);
  private drift: number[] = new Array(33 * 3).fill(0);
  private lastWrist: Record<number, { p: V3; t: number; out: SimLandmark; outW: SimLandmark } | undefined> = {};
  constructor(
    readonly body: SimBody,
    public cam: SimCamera = DEFAULT_CAMERA,
    public model: SimCameraModel = REAL_WEBCAM,
    /** called before each capture so a bot can pose the body for time t */
    public pose: (t: number) => void = () => {},
  ) {}

  private gauss() {
    const u = Math.max(1e-9, this.rand()),
      v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Advance to `now`; returns the newest frame whose result has arrived. */
  poll(now: number): SimFrame | null {
    const period = 1000 / this.model.fps;
    if (!this.nextCapture) this.nextCapture = now;
    while (this.nextCapture <= now) {
      const t = this.nextCapture;
      this.pose(t);
      this.queue.push(this.capture(t));
      this.nextCapture += period;
    }
    let out: SimFrame | null = null;
    while (this.queue.length && this.queue[0].ts + this.model.latencyMs <= now) out = this.queue.shift()!;
    return out;
  }

  private capture(t: number): SimFrame {
    const { lms, world } = landmarksFor(this.body, this.cam);
    const J = this.body.joints();
    // correlated jitter: a slow random walk plus white noise per landmark
    for (let i = 0; i < 33; i++) {
      for (let a = 0; a < 3; a++) {
        const k = i * 3 + a;
        this.drift[k] = this.drift[k] * 0.85 + this.gauss() * 0.5;
      }
      const j = this.model.jitter * (i >= 15 && i <= 22 ? 1.6 : 1);
      lms[i].x += (this.drift[i * 3] * 0.6 + this.gauss() * 0.4) * j;
      lms[i].y += (this.drift[i * 3 + 1] * 0.6 + this.gauss() * 0.4) * j;
      const w = this.model.worldJitter;
      world[i].x += (this.drift[i * 3] * 0.6 + this.gauss() * 0.4) * w;
      world[i].y += (this.drift[i * 3 + 1] * 0.6 + this.gauss() * 0.4) * w;
      world[i].z += (this.drift[i * 3 + 2] * 0.6 + this.gauss() * 0.4) * w * 2.5;
    }
    // fast hands blur: MediaPipe's estimate trails the real wrist and its
    // confidence drops, sometimes for a whole frame
    for (const i of [15, 16, 17, 18, 19, 20, 21, 22]) {
      const prev = this.lastWrist[i];
      const speed = prev ? len(sub(J[i], prev.p)) / Math.max(1e-3, (t - prev.t) / 1000) : 0;
      if (prev && speed > this.model.blurSpeed) {
        const k = Math.max(0.35, this.model.blurSpeed / speed);
        lms[i].x = prev.out.x + (lms[i].x - prev.out.x) * k;
        lms[i].y = prev.out.y + (lms[i].y - prev.out.y) * k;
        world[i].x = prev.outW.x + (world[i].x - prev.outW.x) * k;
        world[i].y = prev.outW.y + (world[i].y - prev.outW.y) * k;
        world[i].z = prev.outW.z + (world[i].z - prev.outW.z) * k;
        const vis = this.rand() < 0.12 ? 0.3 : 0.62;
        lms[i].visibility = Math.min(lms[i].visibility, vis);
        world[i].visibility = lms[i].visibility;
      }
      this.lastWrist[i] = { p: J[i], t, out: { ...lms[i] }, outW: { ...world[i] } };
    }
    return { ts: t, lms, world };
  }
}
