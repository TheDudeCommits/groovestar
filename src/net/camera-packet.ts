import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
const legacyIndices = [
  0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28,
];
export interface CameraPacket {
  version: 1 | 2;
  sequence: number;
  capturedAt: number | null;
  aspect: number;
  landmarks: NormalizedLandmark[];
  world: NormalizedLandmark[] | null;
}
const finitePoint = (p: unknown, bound: number): p is number[] =>
  Array.isArray(p) &&
  p.length === 4 &&
  p.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < bound,
  );
const points = (ps: number[][]): NormalizedLandmark[] =>
  ps.map((p) => ({
    x: p[0],
    y: p[1],
    z: p[2],
    visibility: Math.max(0, Math.min(1, p[3])),
  }));
export function decodeCameraPacket(
  value: unknown,
  previousSequence = -1,
): CameraPacket | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.t !== "pose" || (r.v !== undefined && r.v !== 1 && r.v !== 2))
    return null;
  const version = r.v === 2 ? 2 : 1;
  if (
    version === 2 &&
    (!Number.isSafeInteger(r.seq) ||
      Number(r.seq) < 0 ||
      Number(r.seq) <= previousSequence)
  )
    return null;
  let landmarks: NormalizedLandmark[];
  if (version === 2 && Array.isArray(r.points)) {
    if (r.points.length !== 33 || !r.points.every((p) => finitePoint(p, 5)))
      return null;
    landmarks = points(r.points);
  } else {
    if (
      !Array.isArray(r.d) ||
      r.d.length !== legacyIndices.length * 4 ||
      !r.d.every(
        (n) =>
          typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 20000,
      )
    )
      return null;
    landmarks = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 0,
    }));
    legacyIndices.forEach((idx, k) => {
      const d = r.d as number[];
      landmarks[idx] = {
        x: d[k * 4] / 1000,
        y: d[k * 4 + 1] / 1000,
        z: d[k * 4 + 2] / 1000,
        visibility: Math.max(0, Math.min(1, d[k * 4 + 3] / 100)),
      };
    });
  }
  const world =
    version === 2 &&
    Array.isArray(r.world) &&
    r.world.length === 33 &&
    r.world.every((p) => finitePoint(p, 20))
      ? points(r.world)
      : null;
  return {
    version,
    sequence: version === 2 ? Number(r.seq) : -1,
    capturedAt:
      typeof r.capturedAt === "number" && Number.isFinite(r.capturedAt)
        ? r.capturedAt
        : null,
    aspect:
      typeof r.aspect === "number" && r.aspect > 0.3 && r.aspect < 4
        ? r.aspect
        : 4 / 3,
    landmarks,
    world,
  };
}
