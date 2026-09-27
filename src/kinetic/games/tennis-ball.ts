import * as T from "three";

/** Who hit the ball last. */
export type Side = "you" | "luna";

// Court (meters): net at z = -7, your baseline at z = 4, hers at z = -18.
export const NET_Z = -7;
export const NET_H = 0.92;
export const NEAR_BASE = 4;
export const FAR_BASE = -18;
export const NEAR_SERVICE = -1.5;
export const FAR_SERVICE = -12.5;
export const HALF_W = 3.4;
export const G = 8.4;
export const BALL_R = 0.075;

export interface Ball {
  p: T.Vector3;
  v: T.Vector3;
  spin: number;
  bounces: number;
  /** who hit it last */
  by: Side;
  /** a serve must land in this box: [xMin, xMax, zMin, zMax] */
  box: [number, number, number, number] | null;
}

/** Simple court physics: gravity, spin (dip or float), bounce, and air drag. */
export function stepBall(b: Ball, dt: number) {
  const vh = Math.hypot(b.v.x, b.v.z);
  const ay = -G - b.spin * 0.22 * vh;
  b.v.y += ay * dt;
  const drag = 1 - 0.045 * dt;
  b.v.x *= drag;
  b.v.z *= drag;
  b.p.addScaledVector(b.v, dt);
}

/**
 * Launch velocity that carries a ball from p to land at (x, z), travelling
 * at horizontal speed vh with the given spin, clearing the net by `clear`.
 */
export function solveShot(p: T.Vector3, x: number, z: number, vh: number, spin: number, clear = 0.25) {
  const dx = x - p.x,
    dz = z - p.z;
  const d = Math.hypot(dx, dz);
  let speed = vh;
  for (let tries = 0; tries < 24; tries++) {
    const t = d / speed;
    const a = G + spin * 0.22 * speed;
    const vy = (BALL_R - p.y + 0.5 * a * t * t) / t;
    // clearance at the net
    const tn = Math.abs(dz) > 1e-3 ? (NET_Z - p.z) / (dz / t) : -1;
    const ok = tn <= 0 || tn >= t || p.y + vy * tn - 0.5 * a * tn * tn > NET_H + clear;
    if (ok || speed < 9) return new T.Vector3((dx / d) * speed, vy, (dz / d) * speed);
    speed *= 0.93;
  }
  const t = d / speed;
  const a = G + spin * 0.22 * speed;
  return new T.Vector3((dx / d) * speed, (BALL_R - p.y + 0.5 * a * t * t) / t, (dz / d) * speed);
}

