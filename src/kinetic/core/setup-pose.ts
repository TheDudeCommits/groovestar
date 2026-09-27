// Checks for the one-pose calibration: is the body in frame, and are both
// hands raised? Landmarks are raw MediaPipe image coordinates (y grows down).

export interface SetupLandmark {
  x: number;
  y: number;
  visibility?: number;
}
type Wrist = 15 | 16;

const seen = (lms: SetupLandmark[], i: number) => (lms[i]?.visibility ?? 0) > 0.5;

export const inFrame = (lms: SetupLandmark[], i: number) =>
  seen(lms, i) && lms[i].x > 0.025 && lms[i].x < 0.975 && lms[i].y > 0.01 && lms[i].y < 0.98;

export function torsoLength(lms: SetupLandmark[]) {
  return Math.max(0.05, Math.abs((lms[23].y + lms[24].y) / 2 - (lms[11].y + lms[12].y) / 2));
}

/**
 * A wrist raised past the top edge still counts as raised when its elbow is
 * visible above the shoulder. Players with low cameras hit this often.
 */
export function raisedOutOfFrame(lms: SetupLandmark[], wrist: Wrist) {
  const elbow = wrist - 2,
    shoulder = wrist - 4;
  return !inFrame(lms, wrist) && seen(lms, elbow) && lms[elbow].y < lms[shoulder].y;
}

export function handRaised(lms: SetupLandmark[], wrist: Wrist) {
  return (inFrame(lms, wrist) && lms[wrist].y < lms[wrist - 4].y - torsoLength(lms) * 0.28) || raisedOutOfFrame(lms, wrist);
}

export function bodyInFrame(lms: SetupLandmark[], required: number[]) {
  return required.every((i) => inFrame(lms, i) || ((i === 15 || i === 16) && raisedOutOfFrame(lms, i)));
}

export const starPose = (lms: SetupLandmark[]) => handRaised(lms, 15) && handRaised(lms, 16);
