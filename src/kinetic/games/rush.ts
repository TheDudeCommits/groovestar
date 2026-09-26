import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { cityWorld } from "../render/worlds";
import { Character } from "../render/character";
import { material, mesh, block, COLORS } from "../render/stage";
import { course, type CourseObstacle } from "./charts";
import { bestGhost, type RunRecord } from "../core/records";
import { characterId } from "../core/settings";
interface Obstacle extends CourseObstacle {
  object: T.Group;
  done: boolean;
}
export class KineticRush extends KineticSession {
  private runner = new Character();
  private world;
  private obstacles: Obstacle[];
  private lane = 0;
  private targetLane = 0;
  private jump = 0;
  private duck = false;
  private shield = 0;
  private lives = 3;
  private ghost?: RunRecord;
  private ghostMesh: T.Mesh;
  private coins = 0;
  private courseBlock = 0;
  constructor(o: KineticOpts) {
    super(o);
    this.duration = 90;
    this.world = cityWorld(this.stage);
    this.stage.camera.position.set(0, 2.8, 6.2);
    this.stage.camera.lookAt(0, 1.2, -7);
    this.runner.group.rotation.y = Math.PI;
    this.stage.scene.add(this.runner.group);
    this.preparation = this.runner
      .load(characterId())
      .then(() => this.runner.play("Run"));
    this.ghost = bestGhost(
      "rush",
      this.seed,
      this.config.difficulty,
      this.config.lowImpact,
      !!o.endless,
    );
    this.ghostMesh = mesh(
      new T.ConeGeometry(0.28, 0.7, 6),
      new T.MeshBasicMaterial({
        color: COLORS.blue,
        transparent: true,
        opacity: 0.3,
      }),
      this.stage.scene,
      0,
      0.6,
      0,
    );
    this.ghostMesh.visible = !!this.ghost;
    this.obstacles = [];
    this.appendCourse();
  }
  private appendCourse() {
    const index = this.courseBlock++;
    const generated = course(
      index === 0 ? this.seed : `${this.seed}:segment:${index}`,
      90,
      this.config.difficulty,
    ).map((ob) => ({ ...ob, at: ob.at + index * 90 }));
    this.obstacles.push(
      ...generated.map((ob) => {
        const object = new T.Group();
        this.stage.scene.add(object);
        const ink = material(COLORS.ink),
          red = material(COLORS.coral),
          chalk = material(COLORS.paper);
        if (ob.kind === "block") {
          block(object, 1.9, 1.65, 1.0, 0, 0.825, 0, red);
          for (let i = 0; i < 3; i++)
            block(object, 1.94, 0.12, 0.04, 0, 0.4 + i * 0.45, 0.52, chalk);
        } else if (ob.kind === "hurdle") {
          for (const x of [-0.9, 0.9])
            block(object, 0.07, 0.6, 0.08, x, 0.3, 0, ink);
          block(object, 1.9, 0.18, 0.15, 0, 0.62, 0, red);
        } else if (ob.kind === "bar") {
          for (const x of [-0.93, 0.93])
            block(object, 0.075, 2.4, 0.1, x, 1.2, 0, ink);
          block(object, 1.94, 0.27, 0.2, 0, 1.48, 0, red);
        } else {
          const m = new T.MeshStandardMaterial({
            color: ob.kind === "coin" ? 0xd9b966 : COLORS.blue,
            emissive: ob.kind === "coin" ? 0x72542e : COLORS.blue,
            emissiveIntensity: 0.2,
            metalness: 0.7,
            roughness: 0.3,
          });
          mesh(new T.TorusGeometry(0.23, 0.07, 8, 24), m, object, 0, 1, 0);
        }
        object.visible = false;
        return { ...ob, object, done: false };
      }),
    );
  }

  protected step(dt: number, t: number, input: MotionState) {
    if (this.options.endless && t > this.courseBlock * 90 - 12)
      this.appendCourse();
    this.obstacles = this.obstacles.filter((o) => {
      if (o.at > t - 2) return true;
      o.object.traverse((m) => {
        if (m instanceof T.Mesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((x) => x.dispose());
        }
      });
      o.object.removeFromParent();
      return false;
    });
    if (this.options.cameraOk) {
      this.targetLane = input.lane < -0.4 ? -1 : input.lane > 0.4 ? 1 : 0;
      if (input.rise && this.jump <= 0) this.jump = 0.95;
      this.duck = input.duck;
    } else {
      const next = this.obstacles.find(
        (o) => !o.done && o.at - t < 1.25 && o.kind !== "coin",
      );
      if (next) {
        if (next.kind === "block") {
          const blocked = this.obstacles
            .filter((o) => o.at === next.at && o.kind === "block")
            .map((o) => o.lane);
          this.targetLane = [-1, 0, 1].find((l) => !blocked.includes(l)) ?? 0;
        } else {
          this.targetLane = next.lane;
          if (next.kind === "hurdle" && next.at - t < 0.35) this.jump = 0.65;
          this.duck = next.kind === "bar" && next.at - t < 0.6;
        }
      } else this.duck = false;
    }
    this.lane += (this.targetLane - this.lane) * Math.min(1, dt * 9);
    this.jump = Math.max(0, this.jump - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.runner.group.position.x = this.lane * 2.75;
    this.runner.group.position.y =
      this.jump > 0 ? Math.sin((this.jump / 0.95) * Math.PI) * 0.8 : 0;
    this.runner.group.scale.y = this.duck ? 0.62 : 1;
    this.runner.group.rotation.z = -(this.targetLane - this.lane) * 0.15;
    this.runner.update(dt * (this.jump > 0 ? 0.3 : 1));
    this.world.update(t * 8);
    if (this.ghost) {
      const p = this.ghost.replay?.find((p) => p.t >= t);
      if (p) {
        this.ghostMesh.position.set(
          p.x * 2.75,
          0.5 + (p.y > 0 ? Math.sin((p.y / 0.95) * Math.PI) * 0.8 : 0),
          -1.3,
        );
        this.ghostMesh.scale.y = p.action === "duck" ? 0.6 : 1;
      }
    }
    for (const ob of this.obstacles) {
      const diff = ob.at - t;
      ob.object.visible = !ob.done && diff < 10 && diff > -0.2;
      if (!ob.object.visible) continue;
      ob.object.position.set(ob.lane * 2.75, 0, -diff * 8);
      if (ob.kind === "coin" || ob.kind === "shield")
        ob.object.rotation.y = t * 2;
      if (diff <= 0.08 && !ob.done) {
        ob.done = true;
        const inLane = Math.abs(this.lane - ob.lane) < 0.43;
        if (!inLane) continue;
        if (ob.kind === "coin") {
          this.coins++;
          this.hit(25, "NICE LINE");
        } else if (ob.kind === "shield") {
          this.shield = 8;
          this.hit(50, "SECOND WIND");
        } else {
          const clear =
            ob.kind === "hurdle"
              ? this.jump > 0.1
              : ob.kind === "bar"
                ? this.duck
                : false;
          if (clear) this.hit(100, "CLEAN CLEAR");
          else if (this.shield > 0) {
            this.shield = 0;
            this.judge("SAVED BY SECOND WIND");
          } else {
            this.lives--;
            this.miss("RESET · KEEP GOING");
            if (this.lives <= 0) {
              this.finish();
              return;
            }
          }
        }
      }
    }
  }
  protected replayPoint(_input: MotionState) {
    return {
      t: this.elapsed,
      x: this.lane,
      y: this.jump,
      action: this.duck ? "duck" : this.jump > 0 ? "rise" : undefined,
      score: this.score,
    };
  }
  protected hint() {
    return `${this.lives} CHANCES · ${this.coins} COINS${this.shield > 0 ? " · SECOND WIND" : ""}${this.config.lowImpact ? " · RAISE A KNEE TO CLEAR" : ""}`;
  }
  protected diagnostics() {
    return {
      runnerReady: this.runner.ready,
      lane: this.lane,
      jump: this.jump,
      duck: this.duck,
      lives: this.lives,
      obstacles: this.obstacles.length,
      ghost: !!this.ghost,
    };
  }
  stop() {
    this.runner.dispose();
    super.stop();
  }
}
