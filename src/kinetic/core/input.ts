import { HandRig } from "../../pose/rig";
import type { TrackerLike } from "../../games/shared";
export interface MotionState {
  tracked: boolean;
  fresh: boolean;
  lane: number;
  rise: boolean;
  duck: boolean;
  lean: number;
  energy: number;
  poseAge: number;
}
export class MotionInput {
  readonly rig = new HandRig();
  private center: number | null = null;
  private baseY: number | null = null;
  private baseTorso = 0.2;
  private lastPose: unknown = null;
  private lastSeen = -1e6;
  private baseKnees: number | null = null;
  private jumpLatch = false;
  state: MotionState = {
    tracked: false,
    fresh: false,
    lane: 0,
    rise: false,
    duck: false,
    lean: 0,
    energy: 0,
    poseAge: Infinity,
  };
  constructor(
    readonly tracker: TrackerLike,
    public lowImpact = false,
  ) {}
  reset() {
    this.center = null;
    this.baseY = null;
    this.baseKnees = null;
    this.jumpLatch = false;
  }
  update(now: number): MotionState {
    this.tracker.update();
    const lms = this.tracker.latestLandmarks;
    const fresh = !!lms && lms !== this.lastPose;
    if (fresh) {
      this.lastSeen = now;
      this.lastPose = lms;
    }
    const aspect = this.tracker.aspect ?? 4 / 3;
    this.rig.update(lms, this.tracker.latestWorld ?? null, now, aspect);
    const age = now - this.lastSeen;
    const tracked =
      !!lms &&
      age < 240 &&
      [11, 12, 23, 24].every((i) => (lms[i]?.visibility ?? 0) > 0.45);
    this.state = {
      ...this.state,
      tracked,
      fresh,
      poseAge: age,
      energy: this.tracker.latest.energy,
      rise: false,
    };
    if (!tracked) return this.state;
    const hips = this.rig.hips();
    const a = this.rig.joint("shL"),
      b = this.rig.joint("shR");
    if (!hips || !a || !b) return this.state;
    const sw = this.rig.shoulderW;
    this.center ??= hips.x;
    this.baseY ??= hips.y;
    this.baseTorso = this.rig.torso;
    const lane = Math.max(
      -1,
      Math.min(
        1,
        ((hips.x - this.center) * aspect) / (sw * (this.lowImpact ? 0.5 : 0.7)),
      ),
    );
    const above = (this.baseY - hips.y) / Math.max(0.08, this.baseTorso);
    const lean = (((a.x + b.x) / 2 - hips.x) * aspect) / Math.max(0.06, sw);
    const knees = [this.rig.joint("kneeL"), this.rig.joint("kneeR")];
    const kneeY = Math.min(
      ...knees.filter((k) => k && k.vis > 0.45).map((k) => k!.y),
    );
    if (Number.isFinite(kneeY)) this.baseKnees ??= kneeY;
    const wrists = [this.rig.hand("L"), this.rig.hand("R")];
    const raised = wrists.some(
      (h) =>
        h && h.vis > 0.5 && h.y < Math.min(a.y, b.y) - this.baseTorso * 0.25,
    );
    const kneeRaised =
      this.baseKnees !== null &&
      Number.isFinite(kneeY) &&
      this.baseKnees - kneeY > this.baseTorso * 0.22;
    const jump = this.lowImpact ? kneeRaised || raised : above > 0.13;
    this.state = {
      ...this.state,
      lane,
      lean,
      duck: above < -(this.lowImpact ? 0.16 : 0.23),
      rise: jump && !this.jumpLatch,
    };
    this.jumpLatch = jump;
    return this.state;
  }
}
/** Contact is based on observed (filtered) positions, never extrapolated hands. */
export function padContact(
  hand: {
    x: number;
    y: number;
    vis: number;
    rel: number;
    zVel: number | null;
  } | null,
  target: { x: number; y: number; r: number },
  aspect: number,
  armed: boolean,
) {
  if (!hand || hand.vis < 0.55 || !armed) return false;
  const distance = Math.hypot((hand.x - target.x) * aspect, hand.y - target.y);
  return (
    distance <= target.r &&
    (hand.zVel !== null ? hand.zVel > 0.25 : hand.rel > 1.35)
  );
}
export function segmentCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number,
) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy) <= r;
}
export function punchContact(o: {
  hand: Parameters<typeof padContact>[0];
  side: "L" | "R";
  expected: "L" | "R";
  target: { x: number; y: number; r: number };
  aspect: number;
  armed: boolean;
  fresh: boolean;
  delta: number;
}) {
  return (
    o.side === o.expected &&
    o.fresh &&
    o.delta > -0.25 &&
    o.delta < 0.7 &&
    padContact(o.hand, o.target, o.aspect, o.armed)
  );
}
export function cutContact(o: {
  base: { x: number; y: number };
  tip: { x: number; y: number };
  previous: { x: number; y: number };
  target: { x: number; y: number };
  aspect: number;
  dir: number;
  vx: number;
  vy: number;
  speed: number;
  visibility: number;
  fresh: boolean;
  delta: number;
}) {
  if (
    !o.fresh ||
    o.visibility < 0.55 ||
    o.speed < 1.2 ||
    o.delta < -0.32 ||
    o.delta > 0.38
  )
    return false;
  const crossed =
    segmentCircle(
      o.base.x * o.aspect,
      o.base.y,
      o.tip.x * o.aspect,
      o.tip.y,
      o.target.x * o.aspect,
      o.target.y,
      0.09,
    ) ||
    segmentCircle(
      o.previous.x * o.aspect,
      o.previous.y,
      o.tip.x * o.aspect,
      o.tip.y,
      o.target.x * o.aspect,
      o.target.y,
      0.09,
    );
  const [dx, dy] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ][o.dir] ?? [0, 0];
  return (
    crossed && (o.vx * dx + o.vy * dy) / (Math.hypot(o.vx, o.vy) || 1) > 0.2
  );
}
