import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import { segmentCircle, type MotionState } from "../core/input";
import { tennisVenue, ptRacket } from "../render/pt/court-venue";
import { Character } from "../render/character";
import { PT, softDot } from "../render/pt/palette";
import { random } from "../core/records";
export class KineticTennis extends KineticSession {
  private opponent = new Character({ toon: { rimLeft: PT.magenta, rimRight: PT.gold } });
  private ball: T.Group;
  private world;
  private oppRacket = ptRacket(PT.magenta);
  private rackets = { L: ptRacket(PT.left), R: ptRacket(PT.right) };
  private previous: Record<"L" | "R", { x: number; y: number } | null> = {
    L: null,
    R: null,
  };
  private rnd: () => number;
  private z = -13;
  private x = 0;
  private vx = 0;
  private vz = 4;
  private aiX = 0;
  private rally = 0;
  private mine = 0;
  private theirs = 0;
  private resetAt = 0;
  constructor(o: KineticOpts) {
    super(o, { bloom: 0.6, bloomThreshold: 0.85, exposure: 1.0 });
    this.duration = Infinity;
    this.rnd = random(this.seed);
    this.world = tennisVenue(this.stage, this.show);
    this.stage.camera.position.set(0, 2.6, 5.8);
    this.stage.camera.lookAt(0, 1, -6);
    this.stage.scene.add(this.opponent.group, this.oppRacket, ...Object.values(this.rackets));
    this.opponent.group.position.z = -14;
    this.opponent.group.scale.setScalar(1.15);
    if (this.stage.key) {
      this.stage.key.position.set(-3, 8, -4);
      this.stage.key.target.position.set(0, 1, -14);
    }
    this.preparation = this.opponent.load("luna").then(() => this.opponent.play("Idle"));
    this.ball = new T.Group();
    const core = new T.Mesh(new T.SphereGeometry(0.13, 24, 16), new T.MeshBasicMaterial({ color: new T.Color(0xd8ff5a).multiplyScalar(1.8) }));
    const halo = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(0xc8ff3a).multiplyScalar(1.4), blending: T.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.8);
    this.ball.add(core, halo);
    this.stage.scene.add(this.ball);
    this.serve();
  }
  private serve() {
    this.z = -13;
    this.x = (this.rnd() - 0.5) * 1.4;
    this.vx = (this.rnd() - 0.5) * 0.3;
    this.vz =
      this.config.difficulty === "expert"
        ? 5.7
        : this.config.difficulty === "athlete"
          ? 4.8
          : 4;
    this.rally = 0;
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.opponent.update(dt);
    this.world.update(t);
    const hand = this.opponent.handWorld("R");
    if (hand) {
      this.oppRacket.position.copy(hand);
      this.oppRacket.rotation.set(0, 0, 0.5);
      this.oppRacket.scale.setScalar(1.15);
    }
    if (t < this.resetAt) {
      this.ball.visible = false;
      return;
    }
    this.ball.visible = true;
    this.z += this.vz * dt;
    this.x = Math.max(-2.5, Math.min(2.5, this.x + this.vx * dt));
    const progress = (this.z + 13) / 14;
    const y =
      0.95 + Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 0.75;
    this.ball.position.set(this.x, y, this.z);
    const target = this.stage.project(this.ball.position);
    for (const side of ["L", "R"] as const) {
      const h = this.input.rig.hand(side),
        r = this.rackets[side];
      r.visible = !this.options.cameraOk || (!!h && h.vis > 0.5);
      let px = side === "L" ? 0.34 : 0.66,
        py = 0.64;
      if (this.options.cameraOk && h) {
        px = h.x;
        py = h.y;
      } else if (!this.options.cameraOk && this.vz > 0) {
        px = target.x;
        py = target.y;
        r.visible = side === "R";
      }
      r.position.copy(this.stage.unproject(px, py, 0.8));
      r.position.y -= 0.28;
      r.rotation.z = side === "L" ? 0.22 : -0.22;
      r.rotation.x = -0.2;
      if (this.z > -0.3 && this.z < 1.7 && this.vz > 0) {
        const prev = this.previous[side];
        const contact = this.options.cameraOk
          ? input.fresh &&
            h &&
            h.vis > 0.55 &&
            h.rel > 0.95 &&
            prev &&
            segmentCircle(
              prev.x * this.stage.camera.aspect,
              prev.y,
              px * this.stage.camera.aspect,
              py,
              target.x * this.stage.camera.aspect,
              target.y,
              0.095,
            )
          : this.z > 0.65;
        if (contact) {
          this.rally++;
          this.hit(60, "CLEAN RETURN");
          this.world.sparks.emit(this.ball.position.clone(), 0xd8ff5a, 30, 4.5, 0.5);
          this.vz = -(5 + Math.min(3, this.rally * 0.28));
          this.vx =
            this.options.cameraOk && h
              ? Math.max(-1.2, Math.min(1.2, h.vx * 1.5))
              : (this.rnd() - 0.5) * 2.2;
        }
      }
      if (input.fresh || !this.options.cameraOk)
        this.previous[side] = { x: px, y: py };
    }
    this.aiX +=
      (this.x - this.aiX) *
      Math.min(1, dt * (this.config.difficulty === "expert" ? 2.5 : 1.05));
    this.opponent.group.position.x = this.aiX;
    if (this.z < -13 && this.vz < 0) {
      if (
        Math.abs(this.aiX - this.x) > 0.42 ||
        (this.rally > 3 && this.rnd() < 0.17)
      ) {
        this.point(true, t);
      } else {
        this.vz = 4 + Math.min(3, this.rally * 0.35);
        this.vx = (this.rnd() - 0.5) * 0.35;
        this.opponent.reach("L", new T.Vector3(this.x - this.aiX, 1.2, 0.45));
      }
    }
    if (this.z > 1.7 && this.vz > 0) this.point(false, t);
  }
  private point(mine: boolean, t: number) {
    if (mine) {
      this.mine++;
      this.judge("YOUR POINT");
    } else {
      this.theirs++;
      this.miss("NEXT BALL. YOU’VE GOT THIS.");
    }
    if (this.mine >= 5 || this.theirs >= 5) {
      this.finish();
      return;
    }
    this.resetAt = t + 1.5;
    this.serve();
  }
  protected resultDetails() {
    return [{ label: "YOU / LUNA", value: `${this.mine} / ${this.theirs}` }];
  }
  protected hint() {
    return `${this.mine} – ${this.theirs}`;
  }
  protected diagnostics() {
    return {
      ball: this.stage.project(this.ball.position),
      mine: this.mine,
      theirs: this.theirs,
      rally: this.rally,
    };
  }
  stop() {
    this.opponent.dispose();
    super.stop();
  }
}
