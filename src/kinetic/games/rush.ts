import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { rushVenue, rushProp } from "../render/pt/rush-venue";
import { Character } from "../render/character";
import { PT } from "../render/pt/palette";
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
  private ghostRunner: Character | null = null;
  private coins = 0;
  private courseBlock = 0;
  constructor(o: KineticOpts) {
    super(o, { bloom: 0.62, bloomThreshold: 0.86, exposure: 0.95 });
    this.duration = 90;
    this.world = rushVenue(this.stage, this.show);
    this.stage.camera.position.set(0, 2.8, 6.2);
    this.stage.camera.lookAt(0, 1.2, -7);
    this.runner.group.rotation.y = Math.PI;
    this.stage.scene.add(this.runner.group);
    if (this.stage.key) {
      this.stage.key.position.set(-2, 6, 7);
      this.stage.key.target.position.set(0, 1, 0);
    }
    this.preparation = this.runner.load(characterId()).then(() => this.runner.play("Run"));
    this.ghost = bestGhost("rush", this.seed, this.config.difficulty, this.config.lowImpact, !!o.endless);
    if (this.ghost) {
      const ghost = new Character({ style: "hologram", color: PT.cyan });
      ghost.group.rotation.y = Math.PI;
      this.stage.scene.add(ghost.group);
      void ghost.load(characterId()).then(() => ghost.play("Run"));
      this.ghostRunner = ghost;
    }
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
        object.add(rushProp(ob.kind));
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
    this.runner.update(dt * (this.jump > 0 ? 0.3 : 1) * (1 + this.show.level * 0.06));
    this.world.update(t * 8, t);
    if (this.ghost && this.ghostRunner) {
      const p = this.ghost.replay?.find((p) => p.t >= t);
      this.ghostRunner.update(dt);
      if (p) {
        this.ghostRunner.group.position.set(p.x * 2.75, p.y > 0 ? Math.sin((p.y / 0.95) * Math.PI) * 0.8 : 0, -1.6);
        this.ghostRunner.group.scale.y = p.action === "duck" ? 0.62 : 1;
      }
    }
    for (const ob of this.obstacles) {
      const diff = ob.at - t;
      ob.object.visible = !ob.done && diff < 10 && diff > -0.2;
      if (!ob.object.visible) continue;
      ob.object.position.set(ob.lane * 2.75, 0, -diff * 8);
      if (ob.kind === "coin" || ob.kind === "shield") ob.object.rotation.y = t * 3;
      if (ob.kind === "block")
        ob.object.traverse((m) => {
          if (m.userData.blink) m.visible = Math.sin(t * 10 + m.position.x * 3) > -0.2;
        });
      if (diff <= 0.08 && !ob.done) {
        ob.done = true;
        const inLane = Math.abs(this.lane - ob.lane) < 0.43;
        if (!inLane) continue;
        const at = new T.Vector3(ob.lane * 2.75, 1, 0.2);
        if (ob.kind === "coin") {
          this.coins++;
          this.hit(25, "NICE LINE");
          this.world.sparks.emit(at, PT.gold, 26, 4, 0.5);
        } else if (ob.kind === "shield") {
          this.shield = 8;
          this.hit(50, "SECOND WIND");
          this.world.sparks.emit(at, PT.cyan, 40, 5, 0.6);
        } else {
          const clear =
            ob.kind === "hurdle"
              ? this.jump > 0.1
              : ob.kind === "bar"
                ? this.duck
                : false;
          if (clear) {
            this.hit(100, "CLEAN CLEAR");
            this.world.sparks.emit(at, PT.magenta, 24, 4, 0.45);
          }
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
    return `${"♥".repeat(Math.max(0, this.lives))}   ◉ ${this.coins}`;
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
    this.ghostRunner?.dispose();
    super.stop();
  }
}
