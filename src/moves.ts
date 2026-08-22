// Pose & move library. One pose definition drives three systems, so they always
// agree: the coach's animated body, the pictogram cards, and the scoring target.
//
// Angle convention (screen plane, y-down):
//   shoulder/hip angle: 0 = limb pointing straight down, 90 = horizontally
//   outward from the body (each side mirrors automatically), 180 = straight up.
//   elbow/knee: added bend, 0 = straight. Positive continues the same rotation
//   direction as the shoulder angle (counterclockwise for viewer-right limbs).

export type ArrowDir = 'up' | 'down' | 'out' | 'in' | 'cw' | 'ccw';

export interface Pose {
  lean: number;              // torso lean, deg; + tips toward viewer-right
  crouch: number;            // 0..1, lowers pelvis & implies bent knees
  armL: [number, number];    // [shoulder, elbow]
  armR: [number, number];
  legL: [number, number];    // [hip, knee]
  legR: [number, number];
  arrowL?: ArrowDir;         // pictogram accent arrows
  arrowR?: ArrowDir;
}

export interface Move {
  id: string;
  pose: Pose;
  /** relative energy 0..1 — used to pick how much motion is expected */
  energy: number;
}

const STANCE: [number, number] = [8, 0];
const WIDE: [number, number] = [22, 0];

function pose(p: Partial<Pose>): Pose {
  return {
    lean: 0,
    crouch: 0,
    armL: [10, 5],
    armR: [10, 5],
    legL: STANCE,
    legR: STANCE,
    ...p,
  };
}

export const MOVES: Record<string, Move> = {};
function def(id: string, energy: number, p: Partial<Pose>): Move {
  const m = { id, energy, pose: pose(p) };
  MOVES[id] = m;
  return m;
}

// ---- core library ----------------------------------------------------------
def('idle',       0.1, {});
def('sway_l',     0.4, { lean: -10, armL: [35, 20], armR: [95, 35], legL: WIDE, legR: WIDE, arrowR: 'out' });
def('sway_r',     0.4, { lean: 10,  armL: [95, 35], armR: [35, 20], legL: WIDE, legR: WIDE, arrowL: 'out' });
def('clap_up',    0.8, { armL: [155, 15], armR: [155, 15], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'up' });
def('v_up',       0.7, { armL: [135, 0], armR: [135, 0], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'up' });
def('t_pose',     0.5, { armL: [90, 0], armR: [90, 0], legL: WIDE, legR: WIDE });
def('point_up_r', 0.6, { lean: -6, armL: [20, 10], armR: [168, 0], arrowR: 'up' });
def('point_up_l', 0.6, { lean: 6,  armL: [168, 0], armR: [20, 10], arrowL: 'up' });
def('punch_r',    0.7, { lean: 4, armL: [30, 100], armR: [95, 0], legL: WIDE, legR: WIDE, arrowR: 'out' });
def('punch_l',    0.7, { lean: -4, armL: [95, 0], armR: [30, 100], legL: WIDE, legR: WIDE, arrowL: 'out' });
def('pump',       0.8, { crouch: 0.25, armL: [55, 110], armR: [55, 110], legL: [25, 20], legR: [25, 20], arrowL: 'down', arrowR: 'down' });
def('hips_l',     0.4, { lean: -12, crouch: 0.1, armL: [15, 80], armR: [15, 80], legL: [30, 5], legR: [12, 8] });
def('hips_r',     0.4, { lean: 12, crouch: 0.1, armL: [15, 80], armR: [15, 80], legL: [12, 8], legR: [30, 5] });
def('wave_r',     0.5, { armL: [12, 8], armR: [110, 55], arrowR: 'cw' });
def('wave_l',     0.5, { armL: [110, 55], armR: [12, 8], arrowL: 'ccw' });
def('lasso',      0.8, { lean: 8, crouch: 0.15, armL: [40, 90], armR: [150, 55], legL: WIDE, legR: [30, 18], arrowR: 'cw' });
def('slide_l',    0.6, { lean: -14, crouch: 0.2, armL: [80, 10], armR: [120, 30], legL: [38, 10], legR: [16, 22], arrowL: 'out', arrowR: 'out' });
def('slide_r',    0.6, { lean: 14, crouch: 0.2, armL: [120, 30], armR: [80, 10], legL: [16, 22], legR: [38, 10], arrowL: 'out', arrowR: 'out' });
def('cross_arms', 0.5, { armL: [45, 115], armR: [45, 115], legL: WIDE, legR: WIDE, arrowL: 'in', arrowR: 'in' });
def('hi_five_r',  0.6, { lean: -5, armL: [25, 15], armR: [130, 20], legL: WIDE, legR: WIDE, arrowR: 'up' });
def('hi_five_l',  0.6, { lean: 5, armL: [130, 20], armR: [25, 15], legL: WIDE, legR: WIDE, arrowL: 'up' });
def('muscle',     0.6, { armL: [95, 95], armR: [95, 95], legL: WIDE, legR: WIDE });
def('reach_fwd',  0.5, { crouch: 0.1, armL: [70, 30], armR: [70, 30], legL: [25, 15], legR: [25, 15], arrowL: 'down', arrowR: 'down' });
def('squat_pump', 0.9, { crouch: 0.45, armL: [90, 70], armR: [90, 70], legL: [32, 40], legR: [32, 40], arrowL: 'down', arrowR: 'down' });
def('star_jump',  1.0, { armL: [140, 0], armR: [140, 0], legL: [35, 0], legR: [35, 0], arrowL: 'up', arrowR: 'up' });
// letter poses (Y.M.C.A.-style chorus)
def('letter_g',   0.8, { lean: -6, armL: [90, 80], armR: [160, 10], legL: WIDE, legR: WIDE, arrowR: 'up' });
def('letter_r',   0.8, { lean: 6, armL: [160, 10], armR: [90, 60], legL: WIDE, legR: [34, 24], arrowL: 'up' });
def('letter_v',   0.9, { armL: [142, 0], armR: [142, 0], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'up' });
// ---- groove tier (chill, verse-friendly) -----------------------------------
def('snap_l',     0.35, { lean: -8, armL: [70, 95], armR: [15, 30], legL: WIDE, legR: WIDE });
def('snap_r',     0.35, { lean: 8, armL: [15, 30], armR: [70, 95], legL: WIDE, legR: WIDE });
def('shoulder_l', 0.4,  { lean: -10, armL: [30, 105], armR: [30, 105], legL: [28, 6], legR: [14, 6] });
def('shoulder_r', 0.4,  { lean: 10, armL: [30, 105], armR: [30, 105], legL: [14, 6], legR: [28, 6] });
def('hair_comb',  0.45, { lean: 6, armL: [20, 15], armR: [150, 95], arrowR: 'ccw' });
def('swim_l',     0.5,  { lean: -8, armL: [95, 25], armR: [65, 60], legL: WIDE, legR: WIDE, arrowL: 'out' });
def('swim_r',     0.5,  { lean: 8, armL: [65, 60], armR: [95, 25], legL: WIDE, legR: WIDE, arrowR: 'out' });
def('monkey_l',   0.55, { armL: [120, 70], armR: [30, 70], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'down' });
def('monkey_r',   0.55, { armL: [30, 70], armR: [120, 70], legL: WIDE, legR: WIDE, arrowL: 'down', arrowR: 'up' });
def('hip_bump_l', 0.45, { lean: -13, crouch: 0.1, armL: [55, 100], armR: [40, 90], legL: [32, 4], legR: [10, 10] });
def('hip_bump_r', 0.45, { lean: 13, crouch: 0.1, armL: [40, 90], armR: [55, 100], legL: [10, 10], legR: [32, 4] });
def('step_touch_l', 0.4, { lean: -6, armL: [40, 10], armR: [40, 10], legL: [34, 0], legR: [10, 6], arrowL: 'out', arrowR: 'out' });
def('step_touch_r', 0.4, { lean: 6, armL: [40, 10], armR: [40, 10], legL: [10, 6], legR: [34, 0], arrowL: 'out', arrowR: 'out' });
def('roll_arms',  0.5,  { crouch: 0.08, armL: [55, 115], armR: [70, 110], legL: WIDE, legR: WIDE, arrowL: 'cw', arrowR: 'cw' });
def('shimmy',     0.5,  { lean: 4, crouch: 0.15, armL: [45, 55], armR: [45, 55], legL: [26, 12], legR: [26, 12] });
def('sprinkler',  0.6,  { lean: 7, armL: [95, 120], armR: [95, 5], legL: WIDE, legR: WIDE, arrowR: 'out' });
def('disco_up_r', 0.6,  { lean: -8, armL: [25, 60], armR: [150, 0], legL: WIDE, legR: [26, 10], arrowR: 'up' });
def('disco_up_l', 0.6,  { lean: 8, armL: [150, 0], armR: [25, 60], legL: [26, 10], legR: WIDE, arrowL: 'up' });
def('disco_down_l', 0.55, { lean: 8, armL: [40, 0], armR: [120, 40], legL: WIDE, legR: WIDE, arrowL: 'down' });
def('disco_down_r', 0.55, { lean: -8, armL: [120, 40], armR: [40, 0], legL: WIDE, legR: WIDE, arrowR: 'down' });
def('box_arms',   0.4,  { armL: [70, 90], armR: [70, 90], legL: WIDE, legR: WIDE });
def('wipe_l',     0.45, { lean: -5, armL: [110, 45], armR: [20, 20], legL: WIDE, legR: WIDE, arrowL: 'ccw' });
def('wipe_r',     0.45, { lean: 5, armL: [20, 20], armR: [110, 45], legL: WIDE, legR: WIDE, arrowR: 'cw' });
def('egyptian_l', 0.5,  { armL: [95, 85], armR: [40, 115], legL: WIDE, legR: WIDE, arrowL: 'out', arrowR: 'in' });
def('egyptian_r', 0.5,  { armL: [40, 115], armR: [95, 85], legL: WIDE, legR: WIDE, arrowL: 'in', arrowR: 'out' });
def('robot_l',    0.45, { armL: [90, 90], armR: [90, -90], legL: WIDE, legR: WIDE });
def('robot_r',    0.45, { armL: [90, -90], armR: [90, 90], legL: WIDE, legR: WIDE });
def('twist_l',    0.5,  { lean: -11, crouch: 0.16, armL: [35, 95], armR: [50, 95], legL: [24, 14], legR: [24, 14] });
def('twist_r',    0.5,  { lean: 11, crouch: 0.16, armL: [50, 95], armR: [35, 95], legL: [24, 14], legR: [24, 14] });
def('prayer',     0.35, { armL: [50, 118], armR: [50, 118], legL: WIDE, legR: WIDE, arrowL: 'in', arrowR: 'in' });
// ---- power tier (chorus-friendly) ------------------------------------------
def('raise_roof', 0.75, { armL: [140, 35], armR: [140, 35], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'up' });
def('touchdown',  0.75, { armL: [165, 0], armR: [165, 0], legL: WIDE, legR: WIDE, arrowL: 'up', arrowR: 'up' });
def('cactus',     0.6,  { armL: [90, 90], armR: [90, 90], legL: WIDE, legR: WIDE });
def('punch_up_2', 0.8,  { crouch: 0.1, armL: [160, 5], armR: [160, 5], legL: [26, 14], legR: [26, 14], arrowL: 'up', arrowR: 'up' });
def('punch_dn_l', 0.65, { lean: -8, crouch: 0.14, armL: [25, 0], armR: [60, 80], legL: [30, 14], legR: [16, 10], arrowL: 'down' });
def('punch_dn_r', 0.65, { lean: 8, crouch: 0.14, armL: [60, 80], armR: [25, 0], legL: [16, 10], legR: [30, 14], arrowR: 'down' });
def('uppercut_l', 0.75, { lean: -7, crouch: 0.12, armL: [85, 110], armR: [30, 60], legL: [28, 16], legR: [16, 8], arrowL: 'up' });
def('uppercut_r', 0.75, { lean: 7, crouch: 0.12, armL: [30, 60], armR: [85, 110], legL: [16, 8], legR: [28, 16], arrowR: 'up' });
def('chop_l',     0.7,  { lean: -6, armL: [100, 20], armR: [35, 75], legL: WIDE, legR: WIDE, arrowL: 'down' });
def('chop_r',     0.7,  { lean: 6, armL: [35, 75], armR: [100, 20], legL: WIDE, legR: WIDE, arrowR: 'down' });
def('archer_l',   0.7,  { lean: -5, armL: [90, 0], armR: [80, 115], legL: [30, 10], legR: [14, 8], arrowL: 'out' });
def('archer_r',   0.7,  { lean: 5, armL: [80, 115], armR: [90, 0], legL: [14, 8], legR: [30, 10], arrowR: 'out' });
def('dab_l',      0.8,  { lean: -10, armL: [60, 130], armR: [130, 0], legL: [26, 12], legR: [12, 6], arrowR: 'up' });
def('dab_r',      0.8,  { lean: 10, armL: [130, 0], armR: [60, 130], legL: [12, 6], legR: [26, 12], arrowL: 'up' });
def('whip_l',     0.7,  { lean: -4, crouch: 0.08, armL: [80, 15], armR: [20, 45], legL: WIDE, legR: WIDE, arrowL: 'out' });
def('whip_r',     0.7,  { lean: 4, crouch: 0.08, armL: [20, 45], armR: [80, 15], legL: WIDE, legR: WIDE, arrowR: 'out' });
def('floss_l',    0.75, { lean: 9, crouch: 0.08, armL: [45, 25], armR: [55, 30], legL: [22, 8], legR: [22, 8], arrowL: 'out', arrowR: 'in' });
def('floss_r',    0.75, { lean: -9, crouch: 0.08, armL: [55, 30], armR: [45, 25], legL: [22, 8], legR: [22, 8], arrowL: 'in', arrowR: 'out' });
def('swing_low',  0.8,  { crouch: 0.4, armL: [30, 25], armR: [30, 25], legL: [30, 35], legR: [30, 35], arrowL: 'down', arrowR: 'down' });
def('lunge_l',    0.75, { lean: -14, crouch: 0.22, armL: [95, 0], armR: [120, 25], legL: [42, 6], legR: [18, 26] });
def('lunge_r',    0.75, { lean: 14, crouch: 0.22, armL: [120, 25], armR: [95, 0], legL: [18, 26], legR: [42, 6] });
def('clap_side_l', 0.6, { lean: -9, armL: [120, 45], armR: [125, 40], legL: [28, 8], legR: [12, 8], arrowL: 'out', arrowR: 'out' });
def('clap_side_r', 0.6, { lean: 9, armL: [125, 40], armR: [120, 45], legL: [12, 8], legR: [28, 8], arrowL: 'out', arrowR: 'out' });
def('crowd_l',    0.7,  { lean: -12, armL: [150, 10], armR: [140, 15], legL: [30, 6], legR: [12, 8], arrowL: 'up', arrowR: 'up' });
def('crowd_r',    0.7,  { lean: 12, armL: [140, 15], armR: [150, 10], legL: [12, 8], legR: [30, 6], arrowL: 'up', arrowR: 'up' });
def('helicopter', 0.85, { lean: 5, armL: [30, 40], armR: [170, 10], legL: WIDE, legR: WIDE, arrowR: 'cw' });
def('run_man_l',  0.85, { lean: 3, crouch: 0.12, armL: [60, 100], armR: [25, 95], legL: [65, 85], legR: [12, 6], arrowL: 'up' });
def('run_man_r',  0.85, { lean: -3, crouch: 0.12, armL: [25, 95], armR: [60, 100], legL: [12, 6], legR: [65, 85], arrowR: 'up' });
def('knee_up_l',  0.7,  { armL: [45, 85], armR: [95, 30], legL: [70, 80], legR: [10, 4], arrowL: 'up' });
def('knee_up_r',  0.7,  { armL: [95, 30], armR: [45, 85], legL: [10, 4], legR: [70, 80], arrowR: 'up' });
def('kick_l',     0.75, { lean: 5, armL: [85, 10], armR: [85, 10], legL: [55, 5], legR: [10, 6], arrowL: 'out' });
def('kick_r',     0.75, { lean: -5, armL: [85, 10], armR: [85, 10], legL: [10, 6], legR: [55, 5], arrowR: 'out' });
// ---- gold move finishers ---------------------------------------------------
def('gold_sky',   1.0, { lean: -4, armL: [30, 20], armR: [175, 0], legL: [30, 0], legR: [14, 10], arrowR: 'up' });
def('gold_star',  1.0, { armL: [145, 0], armR: [145, 0], legL: [36, 0], legR: [36, 0], arrowL: 'up', arrowR: 'up' });
def('gold_bow',   1.0, { lean: 0, crouch: 0.3, armL: [95, 20], armR: [95, 20], legL: [28, 30], legR: [28, 30] });
def('gold_hero',  1.0, { lean: -8, armL: [40, 30], armR: [165, 15], legL: [34, 0], legR: [14, 12], arrowR: 'up' });
def('gold_x',     1.0, { armL: [150, 55], armR: [150, 55], legL: [34, 0], legR: [34, 0], arrowL: 'in', arrowR: 'in' });
def('gold_kneel', 1.0, { lean: 6, crouch: 0.42, armL: [110, 15], armR: [160, 0], legL: [30, 45], legR: [40, 30], arrowR: 'up' });

// ---- skeleton geometry -----------------------------------------------------
export interface Skeleton {
  pelvis: [number, number]; neck: [number, number]; head: [number, number];
  shL: [number, number]; elL: [number, number]; wrL: [number, number];
  shR: [number, number]; elR: [number, number]; wrR: [number, number];
  hipL: [number, number]; kneeL: [number, number]; ankL: [number, number];
  hipR: [number, number]; kneeR: [number, number]; ankR: [number, number];
}

const TORSO = 1.0, HEAD_OFF = 0.36, SH_W = 0.27, HIP_W = 0.17;
const UARM = 0.44, FARM = 0.42, THIGH = 0.52, SHIN = 0.5;
const D = Math.PI / 180;

/** limb direction for side s (+1 viewer-right, -1 viewer-left) */
function dir(angle: number, s: number): [number, number] {
  return [s * Math.sin(angle * D), Math.cos(angle * D)];
}

export function forward(p: Pose): Skeleton {
  const crouchDrop = p.crouch * 0.22;
  const pelvis: [number, number] = [0, crouchDrop];
  const leanS = Math.sin(p.lean * D), leanC = Math.cos(p.lean * D);
  const up: [number, number] = [leanS, -leanC];
  const neck: [number, number] = [pelvis[0] + up[0] * TORSO, pelvis[1] + up[1] * TORSO];
  const head: [number, number] = [neck[0] + up[0] * HEAD_OFF, neck[1] + up[1] * HEAD_OFF];
  const right: [number, number] = [leanC, leanS]; // torso-right axis

  function arm(side: number, a: [number, number]) {
    const sh: [number, number] = [neck[0] + right[0] * SH_W * side - up[0] * 0.06, neck[1] + right[1] * SH_W * side - up[1] * 0.06];
    const ud = dir(a[0], side);
    const el: [number, number] = [sh[0] + ud[0] * UARM, sh[1] + ud[1] * UARM];
    const fd = dir(a[0] + a[1], side);
    const wr: [number, number] = [el[0] + fd[0] * FARM, el[1] + fd[1] * FARM];
    return { sh, el, wr };
  }
  function leg(side: number, l: [number, number]) {
    const hip: [number, number] = [pelvis[0] + right[0] * HIP_W * side, pelvis[1] + right[1] * HIP_W * side];
    const td = dir(l[0], side);
    const knee: [number, number] = [hip[0] + td[0] * THIGH, hip[1] + td[1] * THIGH];
    const sd = dir(l[0] - l[1] * 0.9, side); // knee bends backward-ish
    const ank: [number, number] = [knee[0] + sd[0] * SHIN, knee[1] + sd[1] * SHIN];
    return { hip, knee, ank };
  }

  const aL = arm(-1, p.armL), aR = arm(1, p.armR);
  const lL = leg(-1, p.legL), lR = leg(1, p.legR);
  return {
    pelvis, neck, head,
    shL: aL.sh, elL: aL.el, wrL: aL.wr,
    shR: aR.sh, elR: aR.el, wrR: aR.wr,
    hipL: lL.hip, kneeL: lL.knee, ankL: lL.ank,
    hipR: lR.hip, kneeR: lR.knee, ankR: lR.ank,
  };
}

// ---- interpolation ---------------------------------------------------------
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l2 = (x: [number, number], y: [number, number]): [number, number] => [lerp(x[0], y[0], t), lerp(x[1], y[1], t)];
  return {
    lean: lerp(a.lean, b.lean, t),
    crouch: lerp(a.crouch, b.crouch, t),
    armL: l2(a.armL, b.armL), armR: l2(a.armR, b.armR),
    legL: l2(a.legL, b.legL), legR: l2(a.legR, b.legR),
  };
}

/** springy ease with slight overshoot — poses "snap" onto the beat like the reference */
export function snapEase(t: number): number {
  const c = 1.70158 * 0.6;
  const u = Math.min(1, Math.max(0, t));
  const v = u - 1;
  return 1 + v * v * ((c + 1) * v + c);
}

/** scoring feature vector: arm angles dominate, like the reference's hand tracking */
export function poseFeatures(p: Pose): number[] {
  return [
    p.armL[0], p.armL[0] + p.armL[1],
    p.armR[0], p.armR[0] + p.armR[1],
    p.lean * 2.5,
  ];
}
