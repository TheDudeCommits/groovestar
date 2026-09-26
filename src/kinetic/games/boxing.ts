import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import { punchContact, type MotionState } from "../core/input";
import { studio } from "../render/worlds";
import { Character } from "../render/character";
import { material, mesh, COLORS, textPlane } from "../render/stage";
import { combinations, type PadCue } from "./charts";
import { announce } from "../core/settings";
interface Cue extends PadCue {
  state: number;
}
export class KineticBox extends KineticSession {
  private coach = new Character();
  private cues: Cue[];
  private pads: Record<"L" | "R", T.Group>;
  private armed = { L: true, R: true };
  private lastContact: Record<"L" | "R", { x: number; y: number } | null> = {
    L: null,
    R: null,
  };
  private recoils = { L: 0, R: 0 };
  private lastCue = -1;
  private visibleTarget: {
    side: string;
    x: number;
    y: number;
    r: number;
  } | null = null;
  constructor(o: KineticOpts) {
    super(o);
    this.duration = 60;
    studio(this.stage, "box");
    this.stage.camera.position.set(0, 1.5, 4.5);
    this.stage.camera.lookAt(0, 1.3, 0);
    this.stage.scene.add(this.coach.group);
    this.preparation = this.coach
      .load("blaze")
      .then(() => this.coach.play("Guard"));
    this.cues = combinations(this.seed, 60, this.config.difficulty).map(
      (c) => ({ ...c, state: 0 }),
    );
    const pad = (side: "L" | "R") => {
      const g = new T.Group();
      const m = material(side === "L" ? COLORS.blue : COLORS.coral, 0.5);
      const body = mesh(new T.SphereGeometry(0.18, 24, 16), m, g);
      body.scale.set(1, 1.22, 0.52);
      mesh(
        new T.TorusGeometry(0.11, 0.014, 8, 40),
        material(COLORS.paper),
        g,
        0,
        0,
        0.09,
      );
      const tx = textPlane(side, "#eeeae1", 0.055);
      tx.position.z = 0.11;
      g.add(tx);
      this.stage.scene.add(g);
      return g;
    };
    this.pads = { L: pad("L"), R: pad("R") };
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.coach.update(dt);
    const current = this.cues.find((c) => !c.state && c.at - t < 1.3);
    this.visibleTarget = null;
    for (const side of ["L", "R"] as const) {
      const active = current?.side === side && current.kind === "pad";
      const pad = this.pads[side];
      pad.visible = !!active;
      this.recoils[side] = Math.max(0, this.recoils[side] - dt * 5);
      pad.position.set(
        side === "L" ? -0.48 : 0.48,
        current?.high ? 1.67 : 1.09,
        0.52 - this.recoils[side] * 0.3,
      );
      pad.scale.setScalar(1 + this.recoils[side] * 0.14);
      if (active) this.coach.reach(side === "L" ? "R" : "L", pad.position);
      const hand = this.input.rig.hand(side);
      const shoulder = this.input.rig.joint(side === "L" ? "shL" : "shR");
      const last = this.lastContact[side];
      const leftTarget =
        !last ||
        (!!hand &&
          Math.hypot(
            (hand.x - last.x) * this.stage.camera.aspect,
            hand.y - last.y,
          ) > 0.11);
      if (
        leftTarget &&
        hand &&
        shoulder &&
        hand.rel < 0.85 &&
        Math.abs(hand.y - shoulder.y) < this.input.rig.torso * 0.65 &&
        Math.abs(hand.x - shoulder.x) * this.input.rig.aspect <
          this.input.rig.shoulderW * 0.85
      )
        this.armed[side] = true;
    }
    if (!current) return;
    const index = this.cues.indexOf(current);
    if (index !== this.lastCue) {
      this.lastCue = index;
      announce(
        current.kind === "slip"
          ? `Slip ${current.side === "L" ? "left" : "right"}`
          : current.side === "L"
            ? "Jab"
            : "Cross",
      );
    }
    const dtCue = t - current.at;
    if (current.kind === "slip") {
      this.coach.group.rotation.z = Math.sin(t * 3) * 0.02;
      this.coach.reach(
        current.side,
        new T.Vector3(current.side === "L" ? 0.45 : -0.45, 1.6, 0.55),
      );
      if (
        dtCue > -0.15 &&
        dtCue < 0.65 &&
        (!this.options.cameraOk ||
          (current.side === "L"
            ? input.lane < -0.4 || input.lean < -0.2
            : input.lane > 0.4 || input.lean > 0.2))
      ) {
        current.state = 1;
        this.hit(80, "CLEAN SLIP");
      }
    } else {
      const p = this.stage.project(this.pads[current.side].position);
      const target = { x: p.x, y: p.y, r: 0.075 };
      this.visibleTarget = { ...target, side: current.side };
      const hand = this.input.rig.hand(current.side);
      const correct = this.options.cameraOk
        ? punchContact({
            hand,
            side: current.side,
            expected: current.side,
            target,
            aspect: this.stage.camera.aspect,
            armed: this.armed[current.side],
            fresh: input.fresh,
            delta: dtCue,
          })
        : dtCue >= 0;
      if (dtCue > -0.25 && dtCue < 0.7 && correct) {
        current.state = 1;
        this.armed[current.side] = false;
        this.lastContact[current.side] = target;
        this.recoils[current.side] = 1;
        this.hit(Math.abs(dtCue) < 0.2 ? 100 : 70, "ON TARGET");
        this.coach.group.position.z = -0.05;
      }
    }
    this.coach.group.position.z *= 0.85;
    if (dtCue > 0.75 && !current.state) {
      current.state = 2;
      this.miss(
        current.kind === "slip" ? "RESET YOUR STANCE" : "FIND THE MITT",
      );
    }
  }
  protected hint() {
    const c = this.cues.find((c) => !c.state && c.at - this.elapsed < 1.3);
    return c
      ? c.kind === "slip"
        ? `SLIP ${c.side === "L" ? "LEFT" : "RIGHT"}`
        : `${c.side === "L" ? "LEFT" : "RIGHT"} ${c.high ? "HIGH" : "BODY"} · RETURN TO GUARD`
      : this.options.cameraOk
        ? "BREATHE · RETURN TO GUARD"
        : super.hint();
  }
  protected diagnostics() {
    return {
      coachReady: this.coach.ready,
      target: this.visibleTarget,
      cues: this.cues.length,
    };
  }
  stop() {
    this.coach.dispose();
    super.stop();
  }
}
