import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { alley, pin } from "../render/sports";
import { material, mesh, COLORS } from "../render/stage";
import { announce } from "../core/settings";
interface PinBody {
  object: T.Group;
  x: number;
  z: number;
  vx: number;
  vz: number;
  down: boolean;
  fall: number;
}
export class KineticBowl extends KineticSession {
  private pins: PinBody[] = [];
  private ball: T.Mesh;
  private guide: T.Mesh;
  private phase: "aim" | "roll" | "settle" = "aim";
  private phaseAt = 0;
  private aim = 0;
  private roll = { x: 0, z: 1, vx: 0, speed: 8 };
  private armed = { L: false, R: false };
  private frameIndex = 0;
  private attempt = 0;
  private downBefore = 0;
  private player = 0;
  private totals = [0, 0];
  private frameScores: number[][] = [[], []];
  private players: number;
  constructor(o: KineticOpts) {
    super(o);
    this.duration = Infinity;
    this.players = o.players ?? 1;
    alley(this.stage);
    this.stage.camera.position.set(0, 3.1, 5);
    this.stage.camera.lookAt(0, 0.3, -10);
    this.ball = mesh(
      new T.SphereGeometry(0.29, 32, 24),
      material(COLORS.blue, 0.16, 0.55),
      this.stage.scene,
    );
    this.guide = mesh(
      new T.ConeGeometry(0.12, 0.035, 3),
      material(COLORS.coral),
      this.stage.scene,
      0,
      0.06,
      -2,
    );
    this.rack();
  }
  private rack() {
    let index = 0;
    for (let row = 0; row < 4; row++)
      for (let col = 0; col <= row; col++) {
        const x = (col - row / 2) * 0.52,
          z = -14 - row * 0.48;
        let body = this.pins[index++];
        if (!body) {
          const object = pin();
          this.stage.scene.add(object);
          body = { object, x, z, vx: 0, vz: 0, down: false, fall: 0 };
          this.pins.push(body);
        }
        Object.assign(body, { x, z, vx: 0, vz: 0, down: false, fall: 0 });
        body.object.position.set(x, 0.03, z);
        body.object.rotation.set(0, 0, 0);
      }
    this.downBefore = 0;
  }
  protected resultDetails() {
    return this.totals
      .slice(0, this.players)
      .map((n, i) => ({ label: `PLAYER ${i + 1}`, value: `${n} POINTS` }));
  }

  protected step(dt: number, t: number, input: MotionState) {
    this.guide.visible = this.phase === "aim";
    if (this.phase === "aim") {
      this.aim = this.options.cameraOk
        ? input.lane * 0.85
        : Math.sin(t * 0.7) * 0.25;
      this.ball.position.set(this.aim, 0.29, 0.7);
      this.ball.visible = true;
      this.guide.position.x = this.aim;
      if (this.options.cameraOk) {
        for (const side of ["L", "R"] as const) {
          const h = this.input.rig.hand(side),
            hip = this.input.rig.hips();
          if (!h || !hip || h.vis < 0.55) continue;
          if (h.y > hip.y - 0.02 && h.rel < 0.85) this.armed[side] = true;
          if (input.fresh && this.armed[side] && h.rel > 1.2 && h.vy < -0.06) {
            this.release(
              t,
              Math.min(12, 6 + h.rel),
              Math.max(-0.7, Math.min(0.7, h.vx * 0.65)),
            );
            this.armed.L = this.armed.R = false;
            break;
          }
        }
      } else if (t - this.phaseAt > 1.8) this.release(t, 9, Math.sin(t) * 0.11);
    } else {
      if (this.phase === "roll") {
        const prevZ = this.roll.z;
        this.roll.z -= this.roll.speed * dt;
        this.roll.x += this.roll.vx * dt;
        this.ball.position.set(
          this.roll.x,
          Math.abs(this.roll.x) > 1.72 ? 0.04 : 0.29,
          this.roll.z,
        );
        this.ball.rotation.x -= (dt * this.roll.speed) / 0.29;
        if (Math.abs(this.roll.x) <= 1.72) {
          for (const p of this.pins) {
            if (p.down) continue;
            if (
              p.z <= prevZ + 0.3 &&
              p.z >= this.roll.z - 0.3 &&
              Math.abs(p.x - this.roll.x) < 0.43
            )
              this.knock(p, (p.x - this.roll.x) * 4, -this.roll.speed * 0.38);
          }
        }
        if (this.roll.z < -18) {
          this.phase = "settle";
          this.phaseAt = t;
          this.ball.visible = false;
        }
      }
      for (const p of this.pins) {
        if (!p.down) continue;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.vx *= Math.exp(-dt * 2.4);
        p.vz *= Math.exp(-dt * 2.4);
        p.fall = Math.min(1, p.fall + dt * 2.5);
        p.object.position.set(p.x, 0.03, p.z);
        p.object.rotation.x = p.fall * Math.PI * 0.48;
        p.object.rotation.z = p.fall * p.vx * 0.15;
        for (const q of this.pins) {
          if (q.down) continue;
          if (
            Math.hypot(p.x - q.x, p.z - q.z) < 0.48 &&
            Math.hypot(p.vx, p.vz) > 0.35
          )
            this.knock(q, p.vx * 0.6 + (q.x - p.x) * 2, p.vz * 0.72);
        }
      }
      if (this.phase === "settle" && t - this.phaseAt > 1.4) this.scoreThrow(t);
    }
  }
  private knock(p: PinBody, vx: number, vz: number) {
    p.down = true;
    p.vx = vx;
    p.vz = vz;
  }
  private release(t: number, speed: number, curve: number) {
    this.phase = "roll";
    this.phaseAt = t;
    this.roll = { x: this.aim, z: 0.7, vx: curve, speed };
  }
  private scoreThrow(t: number) {
    const down = this.pins.filter((p) => p.down).length,
      gained = down - this.downBefore;
    this.attempt++;
    if (gained) {
      this.hits++;
      this.combo++;
      this.bestCombo = Math.max(this.combo, this.bestCombo);
    } else {
      this.misses++;
      this.combo = 0;
    }
    const strike = down === 10 && this.attempt === 1,
      spare = down === 10 && this.attempt === 2;
    this.judge(strike ? "STRIKE" : spare ? "SPARE" : `${gained} DOWN`);
    this.downBefore = down;
    if (down === 10 || this.attempt === 2) {
      const points = strike ? 15 : spare ? 12 : down;
      this.frameScores[this.player].push(points);
      this.totals[this.player] += points;
      this.score = this.totals[0];
      this.attempt = 0;
      if (this.players === 2 && this.player === 0) this.player = 1;
      else {
        this.player = 0;
        this.frameIndex++;
      }
      if (this.frameIndex >= 5) {
        this.finish();
        return;
      }
      this.rack();
      if (this.players === 2) announce(`Player ${this.player + 1}. Your turn.`);
    }
    this.phase = "aim";
    this.phaseAt = t;
  }
  protected hint() {
    return `PLAYER ${this.player + 1} · FRAME ${this.frameIndex + 1}/5 · THROW ${this.attempt + 1}/2 · ${this.totals[this.player]} POINTS · LOWER YOUR HAND, THEN SWING FORWARD`;
  }
  protected diagnostics() {
    return {
      phase: this.phase,
      frame: this.frameIndex,
      player: this.player,
      totals: this.totals,
      pinsDown: this.pins.filter((p) => p.down).length,
      scoring: "5-frame arcade: strike 15, spare 12, otherwise pinfall",
    };
  }
}
