import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import { punchContact, type MotionState } from "../core/input";
import { boxVenue } from "../render/pt/box-venue";
import { Character } from "../render/character";
import { combinations, type PadCue } from "./charts";
import { announce } from "../core/settings";
import { PT, softDot } from "../render/pt/palette";
interface Cue extends PadCue {
  state: number;
}
const SIDE_COLOR = { L: PT.left, R: PT.right };

/** A focus mitt: padded disc with a target ring that lights up when live. */
function mitt(side: "L" | "R") {
  const g = new T.Group();
  const col = new T.Color(SIDE_COLOR[side]);
  const body = new T.Mesh(
    new T.CylinderGeometry(0.19, 0.2, 0.1, 40),
    new T.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.55, emissive: col, emissiveIntensity: 0.12 }),
  );
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const face = new T.Mesh(new T.CircleGeometry(0.165, 40), new T.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.6 }));
  face.position.z = 0.052;
  g.add(face);
  const target = new T.Mesh(new T.RingGeometry(0.075, 0.11, 40), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2) }));
  target.position.z = 0.055;
  g.add(target);
  const dot = new T.Mesh(new T.CircleGeometry(0.035, 24), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2) }));
  dot.position.z = 0.056;
  g.add(dot);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: col.clone().multiplyScalar(1.8), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.scale.setScalar(0.9);
  glow.position.z = 0.06;
  g.add(glow);
  return { g, glow, target: target.material as T.MeshBasicMaterial, dot: dot.material as T.MeshBasicMaterial, col };
}

/** First-person boxing glove that follows the player's wrist. */
function glove(side: "L" | "R") {
  const g = new T.Group();
  const col = new T.Color(SIDE_COLOR[side]);
  // glossy competition leather: deep color under a clear coat
  const leather = new T.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, emissive: col, emissiveIntensity: 0.05 });
  const fist = new T.Mesh(new T.SphereGeometry(0.13, 28, 20), leather);
  fist.scale.set(1, 1.15, 1.05);
  g.add(fist);
  const thumb = new T.Mesh(new T.CapsuleGeometry(0.045, 0.08, 4, 10), leather);
  thumb.position.set(side === "L" ? 0.1 : -0.1, -0.02, 0.05);
  thumb.rotation.z = side === "L" ? -0.6 : 0.6;
  g.add(thumb);
  const cuff = new T.Mesh(new T.CylinderGeometry(0.095, 0.1, 0.14, 24), new T.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.5 }));
  cuff.position.y = -0.17;
  g.add(cuff);
  const band = new T.Mesh(new T.TorusGeometry(0.1, 0.012, 8, 28), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.4) }));
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.12;
  g.add(band);
  return g;
}

export class KineticBox extends KineticSession {
  private coach = new Character();
  private world;
  private cues: Cue[];
  private pads: Record<"L" | "R", ReturnType<typeof mitt>>;
  private gloves: Record<"L" | "R", T.Group>;
  private punchAt = { L: -9, R: -9 };
  private armed = { L: true, R: true };
  private lastContact: Record<"L" | "R", { x: number; y: number } | null> = { L: null, R: null };
  private recoils = { L: 0, R: 0 };
  private lastCue = -1;
  private shake = 0;
  private visibleTarget: { side: string; x: number; y: number; r: number } | null = null;
  constructor(o: KineticOpts) {
    super(o, { fog: 0x06030e, fogDensity: 0.03, bloom: 0.7, bloomThreshold: 0.82, exposure: 1.0, vignette: 0.6 });
    this.duration = 60;
    this.world = boxVenue(this.stage, this.show);
    this.stage.camera.position.set(0, 1.5, 4.5);
    this.stage.camera.lookAt(0, 1.3, 0);
    this.stage.scene.add(this.coach.group);
    if (this.stage.key) {
      this.stage.key.intensity = 1.2;
      this.stage.key.position.set(-1.5, 5, 5);
      this.stage.key.target.position.set(0, 1, 0);
    }
    this.preparation = this.coach.load("blaze").then(() => this.coach.play("Idle"));
    this.cues = combinations(this.seed, 60, this.config.difficulty).map((c) => ({ ...c, state: 0 }));
    this.pads = { L: mitt("L"), R: mitt("R") };
    this.gloves = { L: glove("L"), R: glove("R") };
    for (const s of ["L", "R"] as const) this.stage.scene.add(this.pads[s].g, this.gloves[s]);
  }
  private punchFx(side: "L" | "R", at: T.Vector3) {
    const col = SIDE_COLOR[side];
    this.world.sparks.emit(at, col, 40, 5.5, 0.55);
    this.world.sparks.emit(at, 0xfff0c0, 18, 3.5, 0.3);
    this.shake = Math.min(1, this.shake + 0.5);
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.coach.update(dt);
    this.world.update(t);
    const current = this.cues.find((c) => !c.state && c.at - t < 1.3);
    this.visibleTarget = null;
    for (const side of ["L", "R"] as const) {
      const active = current?.side === side && current.kind === "pad";
      const pad = this.pads[side];
      this.recoils[side] = Math.max(0, this.recoils[side] - dt * 5);
      const target = new T.Vector3(side === "L" ? -0.48 : 0.48, current?.high && active ? 1.67 : 1.09, 0.52 - this.recoils[side] * 0.3);
      // Between cues the coach holds both mitts up beside the shoulders.
      const rest = new T.Vector3(side === "L" ? -0.44 : 0.44, 1.4 + Math.sin(t * 3 + (side === "L" ? 0 : 1.5)) * 0.02, 0.3);
      pad.g.position.lerp(active ? target : rest, active ? 0.35 : 0.2);
      pad.g.scale.setScalar(1 + this.recoils[side] * 0.14);
      const live = active ? 0.6 + 0.4 * Math.sin(t * 14) : 0;
      (pad.glow.material as T.SpriteMaterial).opacity = active ? 0.55 + live * 0.35 : 0;
      pad.target.color.copy(pad.col).multiplyScalar(active ? 2.6 + live : 0.7);
      pad.dot.color.copy(pad.col).multiplyScalar(active ? 3 : 0.7);
      this.coach.reach(side === "L" ? "R" : "L", pad.g.position.clone().sub(this.coach.group.position).add(new T.Vector3(0, 0, -0.08)), active ? 1 : 0.75);
      const hand = this.input.rig.hand(side);
      const shoulder = this.input.rig.joint(side === "L" ? "shL" : "shR");
      const last = this.lastContact[side];
      const leftTarget = !last || (!!hand && Math.hypot((hand.x - last.x) * this.stage.camera.aspect, hand.y - last.y) > 0.11);
      if (
        leftTarget &&
        hand &&
        shoulder &&
        hand.rel < 0.85 &&
        Math.abs(hand.y - shoulder.y) < this.input.rig.torso * 0.65 &&
        Math.abs(hand.x - shoulder.x) * this.input.rig.aspect < this.input.rig.shoulderW * 0.85
      )
        this.armed[side] = true;
      // First-person gloves: tracked wrists, or a scripted jab in the demo.
      const gl = this.gloves[side];
      if (this.options.cameraOk) {
        gl.visible = !!hand && hand.vis > 0.5;
        if (hand) gl.position.lerp(this.stage.unproject(hand.x, hand.y + 0.06, 2.3), 0.6);
      } else {
        const k = Math.max(0, 1 - (t - this.punchAt[side]) * 4);
        const guard = this.stage.unproject(side === "L" ? 0.34 : 0.66, 0.9, 2.5);
        gl.position.copy(guard.lerp(pad.g.position.clone().add(new T.Vector3(0, 0, 0.25)), Math.sin(k * Math.PI * 0.5)));
      }
      gl.rotation.set(-0.35, 0, side === "L" ? 0.25 : -0.25);
      gl.scale.setScalar(0.82);
    }
    // Camera: breathing sway plus a kick on every clean punch.
    this.shake = Math.max(0, this.shake - dt * 5);
    const reduced = this.config.reducedMotion;
    this.stage.camera.position.set(
      reduced ? 0 : Math.sin(t * 0.6) * 0.04 + (Math.random() - 0.5) * this.shake * 0.05,
      1.5 + (reduced ? 0 : Math.sin(t * 1.2) * 0.015 + (Math.random() - 0.5) * this.shake * 0.04),
      4.5,
    );
    this.stage.camera.lookAt(0, 1.3, 0);
    if (!current) return;
    const index = this.cues.indexOf(current);
    if (index !== this.lastCue) {
      this.lastCue = index;
      announce(current.kind === "slip" ? `Slip ${current.side === "L" ? "left" : "right"}` : current.side === "L" ? "Jab" : "Cross");
    }
    const dtCue = t - current.at;
    if (current.kind === "slip") {
      this.coach.group.rotation.z = Math.sin(t * 3) * 0.02;
      this.coach.reach(current.side, new T.Vector3(current.side === "L" ? 0.45 : -0.45, 1.6, 0.55));
      if (
        dtCue > -0.15 &&
        dtCue < 0.65 &&
        (!this.options.cameraOk ||
          (current.side === "L" ? input.lane < -0.4 || input.lean < -0.2 : input.lane > 0.4 || input.lean > 0.2))
      ) {
        current.state = 1;
        this.hit(80, "CLEAN SLIP");
      }
    } else {
      const p = this.stage.project(this.pads[current.side].g.position);
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
        this.punchAt[current.side] = t;
        this.hit(Math.abs(dtCue) < 0.2 ? 100 : 70, Math.abs(dtCue) < 0.2 ? "PERFECT" : "ON TARGET");
        this.punchFx(current.side, this.pads[current.side].g.position.clone().add(new T.Vector3(0, 0, 0.1)));
        this.coach.group.position.z = -0.05;
      }
    }
    this.coach.group.position.z *= 0.85;
    if (dtCue > 0.75 && !current.state) {
      current.state = 2;
      this.miss(current.kind === "slip" ? "RESET YOUR STANCE" : "MISS");
    }
  }
  protected hint() {
    const c = this.cues.find((c) => !c.state && c.at - this.elapsed < 1.3);
    return c
      ? c.kind === "slip"
        ? `SLIP ${c.side === "L" ? "LEFT" : "RIGHT"}`
        : `${c.side === "L" ? "LEFT" : "RIGHT"} ${c.high ? "HIGH" : "BODY"}`
      : super.hint();
  }
  protected diagnostics() {
    return { coachReady: this.coach.ready, target: this.visibleTarget, cues: this.cues.length };
  }
  stop() {
    this.coach.dispose();
    super.stop();
  }
}
