import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { tennisVenue, ptRacket } from "../render/pt/court-venue";
import { Character } from "../render/character";
import { PT, softDot } from "../render/pt/palette";
import { random } from "../core/records";
import { Body3D } from "../../pose/body3d";
import { sfx } from "../../games/sfx";

/*
 * Tennis, rebuilt like Wii Sports and Kinect Sports: you play the swing, the
 * game plays your feet. Your character runs to every ball on its own; what
 * you do with your arm decides the shot.
 *
 * - One racket, in whichever hand you swing with.
 * - Timing sets the direction: early pulls it cross-court, late pushes it
 *   down the line, on time goes where you swing.
 * - Swing speed is power. Swinging up puts topspin on it (dips in, kicks up),
 *   swinging down slices it (floats, stays low). A high ball hit downward is
 *   a smash; a slow upward swing is a lob.
 * - Luna chases every ball. She reaches what she can and returns it; fast,
 *   wide shots stretch her into errors. Real tennis scoring, serves and all.
 */

import { NET_Z, NET_H, NEAR_BASE, FAR_BASE, NEAR_SERVICE, FAR_SERVICE, HALF_W, G, BALL_R, type Ball, type Side, stepBall, solveShot } from "./tennis-ball";
/** Seconds of camera latency the swing timing accounts for. */
const LAG = 0.08;

type Phase = "serve" | "toss" | "flight" | "dead";

interface Plan {
  /** ideal contact point and time (session seconds) */
  at: T.Vector3;
  t: number;
  forehand: boolean;
}

interface Swing {
  hand: "L" | "R";
  t: number;
  rel: number;
  dx: number;
  dy: number;
}

/** Peak detector for a fast wrist sweep, in shoulder-widths per second. */
class SwingWatch {
  private armedAt = -1;
  private peak = 0;
  private dir: [number, number] = [0, 0];
  private peakT = 0;
  private lastFire = -9;
  constructor(readonly hand: "L" | "R") {}
  feed(rel: number, vx: number, vy: number, t: number, min: number): Swing | null {
    if (t - this.lastFire < 0.22) return null;
    if (rel >= min) {
      if (this.armedAt < 0) {
        this.armedAt = t;
        this.peak = 0;
      }
      if (rel > this.peak) {
        this.peak = rel;
        const n = Math.hypot(vx, vy) || 1;
        this.dir = [vx / n, vy / n];
        this.peakT = t;
      }
    }
    if (this.armedAt < 0) return null;
    if (rel < this.peak * 0.78 || t - this.armedAt > 0.14) {
      this.armedAt = -1;
      this.lastFire = t;
      return { hand: this.hand, t: this.peakT, rel: this.peak, dx: this.dir[0], dy: this.dir[1] };
    }
    return null;
  }
}

export class KineticTennis extends KineticSession {
  private world;
  private rnd: () => number;
  private you = new Character();
  private luna = new Character({ toon: { rimLeft: PT.magenta, rimRight: PT.gold } });
  private body = new Body3D();
  private racket = ptRacket(PT.cyan);
  private lunaRacket = ptRacket(PT.magenta);
  private ball: Ball = { p: new T.Vector3(0, 1, 3), v: new T.Vector3(), spin: 0, bounces: 0, by: "luna", box: null };
  private ballMesh: T.Group;
  private shadow: T.Mesh;
  private trail: T.Points;
  private trailPos: Float32Array;
  private marks: { mesh: T.Mesh; t: number }[] = [];
  private phase: Phase = "serve";
  private phaseAt = 0;
  private server: Side = "you";
  private faults = 0;
  private points: Record<Side, number> = { you: 0, luna: 0 };
  private games: Record<Side, number> = { you: 0, luna: 0 };
  private target = 3;
  private youPos = new T.Vector3(1.2, 0, 4.6);
  private youVel = new T.Vector3();
  private lunaPos = new T.Vector3(-1.2, 0, -18.6);
  private lunaVel = new T.Vector3();
  private lunaGoal = new T.Vector3(0, 0, -18.6);
  private lunaPlan: Plan | null = null;
  private lunaSwingAt = -1;
  private lunaReactAt = 0;
  private plan: Plan | null = null;
  private racketHand: "L" | "R" = "R";
  /** which hand you really play with, learned from your swings */
  private handScore = { L: 0, R: 1 };
  private watches = { L: new SwingWatch("L"), R: new SwingWatch("R") };
  private swingAnim = { t: -9, fore: true, power: 0 };
  private youMoves = false;
  private lunaMoves = false;
  private runT = 0;
  private lunaRunT = 0;
  private lastSwingNote = 0;
  private rally = 0;
  private tossed = false;
  private board: HTMLElement;
  private pop: HTMLElement;
  private popTimer = 0;
  private shake = 0;
  private hittableGlow: T.Sprite;
  private demoSwingAt = -1;
  private camX = 0;
  private swingLog: unknown[] = [];
  /** a ball got past you, but a swing already on its way may still count */
  private pendingLoss: { t: number; why: string } | null = null;
  /** when the current toss left the hand, for judging a late-reported serve */
  private tossAt = 0;

  constructor(o: KineticOpts) {
    super(o, { bloom: 0.55, bloomThreshold: 0.86, exposure: 1.0 });
    this.duration = Infinity;
    this.rnd = random(this.seed);
    this.target = this.config.difficulty === "flow" ? 2 : 3;
    this.world = tennisVenue(this.stage, this.show);
    this.stage.setFov(46);
    this.stage.camera.position.set(0, 3.7, 12.6);
    this.stage.camera.lookAt(0, 0.6, -8);
    this.you.group.rotation.y = Math.PI;
    this.stage.scene.add(this.you.group, this.luna.group, this.racket, this.lunaRacket);
    this.racket.scale.setScalar(0.62);
    this.lunaRacket.scale.setScalar(0.62);
    if (this.stage.key) {
      this.stage.key.position.set(-4, 9, 6);
      this.stage.key.target.position.set(0, 0.5, -6);
      this.stage.key.shadow.camera.left = -10;
      this.stage.key.shadow.camera.right = 10;
      this.stage.key.shadow.camera.top = 16;
      this.stage.key.shadow.camera.bottom = -16;
      this.stage.key.shadow.camera.updateProjectionMatrix();
    }
    this.preparation = Promise.all([
      this.you.load("nova").then(async () => {
        await this.you.loadMoves();
        this.youMoves = true;
      }),
      this.luna.load("luna").then(async () => {
        await this.luna.loadMoves();
        this.lunaMoves = true;
      }),
    ]);
    // ball, its shadow on the court, a short comet trail and a "now" glow
    this.ballMesh = new T.Group();
    this.ballMesh.add(new T.Mesh(new T.SphereGeometry(0.1, 20, 14), new T.MeshBasicMaterial({ color: new T.Color(0xe4ff5a).multiplyScalar(1.6) })));
    const halo = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(0xc8ff3a).multiplyScalar(1.1), blending: T.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.55);
    this.ballMesh.add(halo);
    this.hittableGlow = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(PT.cyan).multiplyScalar(1.4), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.hittableGlow.scale.setScalar(1.1);
    this.ballMesh.add(this.hittableGlow);
    this.stage.scene.add(this.ballMesh);
    this.shadow = new T.Mesh(new T.CircleGeometry(0.11, 20), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.stage.scene.add(this.shadow);
    this.trailPos = new Float32Array(18 * 3);
    const tg = new T.BufferGeometry();
    tg.setAttribute("position", new T.BufferAttribute(this.trailPos, 3).setUsage(T.DynamicDrawUsage));
    this.trail = new T.Points(tg, new T.PointsMaterial({ map: softDot(), size: 0.16, color: new T.Color(0xd8ff5a).multiplyScalar(0.9), transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.stage.scene.add(this.trail);
    // scoreboard and shot callouts
    this.board = document.createElement("div");
    this.board.className = "tn-board";
    this.pop = document.createElement("div");
    this.pop.className = "tn-pop";
    this.host.append(this.board, this.pop);
    this.newPoint(0);
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { gsGame: unknown }).gsGame = this;
  }

  // ---- points, games and serves -------------------------------------------

  private get servingFromRight() {
    return (this.points.you + this.points.luna) % 2 === 0;
  }

  private newPoint(t: number) {
    this.phase = "serve";
    this.phaseAt = t;
    this.faults = 0;
    this.rally = 0;
    this.plan = null;
    this.lunaPlan = null;
    this.tossed = false;
    this.pendingLoss = null;
    const right = this.servingFromRight;
    // you serve from your right (+x) on even points; Luna from her right (-x)
    if (this.server === "you") {
      this.youPos.set(right ? 1.2 : -1.2, 0, 4.6);
      this.lunaPos.set(right ? -2.2 : 2.2, 0, -18.4);
    } else {
      this.lunaPos.set(right ? -1.2 : 1.2, 0, -18.6);
      this.youPos.set(right ? 2.2 : -2.2, 0, 4.4);
    }
    this.lunaGoal.copy(this.lunaPos);
    this.youVel.set(0, 0, 0);
    this.lunaVel.set(0, 0, 0);
    this.ball.p.set(this.server === "you" ? this.youPos.x + 0.35 : this.lunaPos.x - 0.3, 1.0, this.server === "you" ? this.youPos.z - 0.3 : this.lunaPos.z + 0.3);
    this.ball.v.set(0, 0, 0);
    this.ball.bounces = 0;
    this.renderBoard();
  }

  private callScore() {
    const names = ["0", "15", "30", "40"];
    const a = this.points.you,
      b = this.points.luna;
    if (a >= 3 && b >= 3) return a === b ? "DEUCE" : a > b ? "AD YOU" : "AD LUNA";
    return `${names[Math.min(3, a)]} – ${names[Math.min(3, b)]}`;
  }

  private renderBoard() {
    this.board.innerHTML = `<div class="tn-row"><b>YOU</b><i>${this.games.you}</i></div><div class="tn-row tn-luna"><b>LUNA</b><i>${this.games.luna}</i></div><div class="tn-call">${this.callScore()}</div>`;
  }

  private award(to: Side, t: number, why: string) {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.phaseAt = t;
    this.points[to]++;
    if (to === "you") {
      this.hits++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += 100 + this.rally * 20;
      this.show.hit(1);
      sfx.crowd("cheer", 0.9);
      this.say(why, "win");
    } else {
      this.misses++;
      this.combo = 0;
      this.show.miss();
      sfx.crowd("ooh", 0.8);
      this.say(why, "lose");
    }
    const a = this.points.you,
      b = this.points.luna;
    if ((a >= 4 || b >= 4) && Math.abs(a - b) >= 2) {
      const winner: Side = a > b ? "you" : "luna";
      this.games[winner]++;
      this.points = { you: 0, luna: 0 };
      this.server = this.server === "you" ? "luna" : "you";
      if (winner === "you") this.score += 500;
      window.setTimeout(() => this.say(winner === "you" ? "GAME" : "GAME LUNA", winner === "you" ? "win" : "lose"), 900);
      if (this.games[winner] >= this.target) {
        window.setTimeout(() => this.finish(), 2200);
        this.renderBoard();
        return;
      }
    }
    this.renderBoard();
  }

  private say(text: string, kind: "win" | "lose" | "info" | "perfect") {
    this.pop.textContent = text;
    this.pop.dataset.kind = kind;
    this.pop.classList.remove("show");
    void this.pop.offsetWidth;
    this.pop.classList.add("show");
    clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.pop.classList.remove("show"), 1300);
  }

  // ---- prediction ----------------------------------------------------------

  /**
   * Where the ball will be comfortable to hit on a side after it bounces:
   * descending through hip height, or the last point before it gets past.
   */
  private predictContact(side: Side, from: Ball): { p: T.Vector3; t: number } | null {
    const b: Ball = { ...from, p: from.p.clone(), v: from.v.clone() };
    const dt = 1 / 120;
    let t = 0,
      bounced = false,
      peakY = 0;
    for (let i = 0; i < 600; i++) {
      stepBall(b, dt);
      t += dt;
      if (b.p.y <= BALL_R && b.v.y < 0) {
        if (bounced) return null;
        bounced = true;
        b.p.y = BALL_R;
        b.v.y = -b.v.y * (0.7 + 0.08 * b.spin);
        b.v.x *= 0.86 + 0.05 * b.spin;
        b.v.z *= 0.86 + 0.05 * b.spin;
        b.spin *= 0.5;
        continue;
      }
      if (!bounced) continue;
      peakY = Math.max(peakY, b.p.y);
      const past = side === "you" ? b.p.z > NEAR_BASE + 2.2 : b.p.z < FAR_BASE - 2.2;
      if ((b.v.y < 0 && b.p.y < 1.05) || past) return { p: b.p.clone(), t };
    }
    return null;
  }

  // ---- frame ---------------------------------------------------------------

  protected step(dt: number, t: number, input: MotionState) {
    this.world.update(t);
    this.body.update(this.options.cameraOk ? this.options.tracker.latestWorld : null, performance.now());
    const swing = this.readSwing(t, input);
    this.updateYou(dt, t, swing);
    if (this.pendingLoss && t - this.pendingLoss.t > 0.32) {
      const why = this.pendingLoss.why;
      this.pendingLoss = null;
      this.award("luna", t, why);
    }
    this.updateLuna(dt, t);
    this.updateBall(dt, t);
    this.updateCamera(dt, t);
    this.updateMarks(t);
  }

  /** Swings from either hand; the racket follows the hand you play with. */
  private readSwing(t: number, input: MotionState): Swing | null {
    if (!this.options.cameraOk) return this.demoSwing(t);
    if (!input.fresh) return null;
    const min = this.config.difficulty === "flow" ? 2.6 : 3.0;
    let best: Swing | null = null;
    for (const h of ["L", "R"] as const) {
      const s = this.input.rig.hand(h);
      if (!s || s.vis < 0.4) continue;
      const ev = this.watches[h].feed(s.rel, s.vx, s.vy, t, min);
      if (ev && (!best || ev.rel > best.rel)) best = ev;
    }
    return best;
  }

  /** Demo autopilot swings on time. */
  private demoSwing(t: number): Swing | null {
    const p = this.plan;
    if (this.phase === "toss" && this.server === "you" && t - this.phaseAt > 0.55 && this.demoSwingAt < this.phaseAt) {
      this.demoSwingAt = t;
      return { hand: "R", t, rel: 7, dx: -0.3, dy: 0.9 };
    }
    if (!p || this.demoSwingAt >= p.t - 0.5) return null;
    if (t >= p.t - 0.02) {
      this.demoSwingAt = t;
      return { hand: "R", t: p.t + (this.rnd() - 0.5) * 0.16, rel: 5 + this.rnd() * 4, dx: p.forehand ? -0.9 : 0.9, dy: -0.35 };
    }
    return null;
  }

  private updateYou(dt: number, t: number, swing: Swing | null) {
    const b = this.ball;
    // serve: raise a hand to toss, or it tosses itself after a moment
    if (this.phase === "serve" && this.server === "you") {
      const up = this.options.cameraOk && (["L", "R"] as const).some((h) => {
        const s = this.input.rig.hand(h),
          sh = this.input.rig.joint(h === "L" ? "shL" : "shR");
        return !!s && !!sh && s.vis > 0.5 && s.y < sh.y - this.input.rig.torso * 0.35;
      });
      if (t - this.phaseAt > (up ? 0.5 : 1.7)) {
        this.phase = "toss";
        this.phaseAt = t;
        this.tossAt = t;
        b.p.set(this.youPos.x + 0.3, 1.1, this.youPos.z - 0.35);
        b.v.set(0, 5.4, 0);
        b.spin = 0;
        b.bounces = 0;
      }
    }
    if (this.phase === "toss" && this.server === "you" && b.p.y < 0.6 && b.v.y < 0) {
      // let it drop: toss again
      this.phase = "serve";
      this.phaseAt = t - 1.8;
    }
    if (swing) this.onSwing(swing, t);
    // run to the ball
    let goal = new T.Vector3(0, 0, 4.4);
    if (this.phase === "serve" || this.phase === "toss") goal = this.youPos.clone();
    else if (this.plan) {
      const side = this.plan.forehand ? (this.racketHand === "R" ? 1 : -1) : this.racketHand === "R" ? -1 : 1;
      goal = new T.Vector3(this.plan.at.x - side * 0.85, 0, Math.max(0.5, this.plan.at.z + 0.35));
    }
    const maxV = 7.2,
      acc = 22;
    const want = goal.clone().sub(this.youPos);
    want.y = 0;
    const dist = want.length();
    const desired = dist > 0.02 ? want.multiplyScalar(Math.min(maxV, dist * 6) / dist) : new T.Vector3();
    this.youVel.lerp(desired, 1 - Math.exp(-dt * (acc / maxV) * 3));
    if (this.phase !== "serve" && this.phase !== "toss") this.youPos.addScaledVector(this.youVel, dt);
    this.youPos.x = Math.max(-6.5, Math.min(6.5, this.youPos.x));
    this.you.group.position.copy(this.youPos);
    const speed = this.youVel.length();
    // pose: run or ready stance, the racket arm follows yours
    if (this.youMoves) {
      this.runT += dt * (0.6 + speed * 0.18);
      const run = Math.min(1, speed / 3);
      const st = t - this.swingAnim.t;
      const swingW = st >= 0 && st < 0.7 ? Math.min(1, st / 0.06) * Math.min(1, (0.7 - st) / 0.25) : 0;
      this.you.timeline([
        ["BoxBounce", t * 0.8, Math.max(0, 1 - run) * (1 - swingW)],
        ["Run", this.runT, run * (1 - swingW)],
        [this.swingAnim.fore ? "Slash" : "SlashL", 0.25 + Math.max(0, st) * (0.9 + this.swingAnim.power * 0.5), swingW],
      ]);
      const side = this.racketHand;
      if (this.options.cameraOk && this.body.live(performance.now()) && swingW < 0.5) this.you.drive(this.body, "back", { overlay: true, arms: [side], legs: false, torso: false, blend: 1 });
      this.you.group.rotation.set(0, Math.PI + Math.max(-0.4, Math.min(0.4, -this.youVel.x * 0.05)), 0);
    }
    this.placeRacket(this.you, this.racket, this.racketHand, true);
  }

  /** Put a racket in a character's hand, along the forearm. */
  private placeRacket(c: Character, r: T.Group, hand: "L" | "R", youSide: boolean) {
    const hb = c.boneWorld(hand === "L" ? "LeftHand" : "RightHand"),
      fb = c.boneWorld(hand === "L" ? "LeftForeArm" : "RightForeArm");
    if (!hb || !fb) return;
    const along = hb.clone().sub(fb).normalize();
    const facing = new T.Vector3(0, 0, youSide ? -1 : 1);
    // tilt the head a little up from the forearm, like a real grip
    const up = along.clone().lerp(new T.Vector3(0, 1, 0), 0.25).normalize();
    const normal = facing.clone().sub(up.clone().multiplyScalar(facing.dot(up))).normalize();
    const x = new T.Vector3().crossVectors(up, normal).normalize();
    const m = new T.Matrix4().makeBasis(x, up, normal);
    r.quaternion.setFromRotationMatrix(m);
    r.position.copy(hb).addScaledVector(up, 0.17);
  }

  /** The racket stays in your playing hand; the other hand moving along doesn't steal it. */
  private learnHand(h: "L" | "R") {
    this.handScore.L *= 0.9;
    this.handScore.R *= 0.9;
    this.handScore[h] += 1;
    const other = this.racketHand === "L" ? "R" : "L";
    if (this.handScore[other] > this.handScore[this.racketHand] + 2) this.racketHand = other;
  }

  private onSwing(sw: Swing, t: number) {
    const real = sw.t - (this.options.cameraOk ? LAG : 0);
    const b = this.ball;
    this.swingLog.push({ t: +t.toFixed(2), real: +real.toFixed(2), hand: sw.hand, rel: +sw.rel.toFixed(1), dx: +sw.dx.toFixed(2), dy: +sw.dy.toFixed(2), phase: this.phase, by: b.by, planT: this.plan ? +this.plan.t.toFixed(2) : null, fore: this.plan?.forehand, y: +b.p.y.toFixed(2) });
    if (this.swingLog.length > 14) this.swingLog.shift();
    // serving: hit the toss near the top of its flight
    if (this.phase === "toss" && this.server === "you") {
      // where the toss was when you actually swung
      const ts = Math.max(0, real - this.tossAt);
      const yAt = 1.1 + 5.4 * ts - 0.5 * G * ts * ts,
        vyAt = 5.4 - G * ts;
      if (yAt < 1.4) return;
      this.learnHand(sw.hand);
      this.swingAnim = { t, fore: true, power: Math.min(1, sw.rel / 10) };
      const right = this.servingFromRight;
      const box: [number, number, number, number] = right ? [-HALF_W, 0, FAR_SERVICE, NET_Z] : [0, HALF_W, FAR_SERVICE, NET_Z];
      const power = Math.min(1, Math.max(0, (sw.rel - 2.6) / 8));
      const topErr = Math.abs(vyAt) / 5.4; // 0 at the top of the toss
      b.p.y = Math.max(b.p.y, Math.min(yAt, 2.9));
      const err = (topErr * 0.9 + (1 - Math.min(1, sw.rel / 5)) * 0.4) * (this.faults ? 0.5 : 1);
      const tx = (right ? -1.7 : 1.7) + sw.dx * 0.6 + (this.rnd() - 0.5) * err * 2.4;
      const tz = FAR_SERVICE + 1.2 + (this.rnd() - 0.5) * err * 3 + (this.rnd() < err * 0.5 ? -2.2 : 0);
      const vh = (this.faults ? 15 : 17) + power * 12;
      b.v.copy(solveShot(b.p, tx, tz, vh, 0.2, 0.05 + (1 - err) * 0.2));
      if (this.rnd() < err * 0.35) b.v.y -= 1.2; // into the net
      b.spin = 0.2;
      b.by = "you";
      b.box = box;
      b.bounces = 0;
      this.phase = "flight";
      this.phaseAt = t;
      this.plan = null;
      this.rally = 0;
      sfx.racket(0.5 + power * 0.5);
      this.world.sparks.emit(b.p.clone(), 0xe4ff5a, 26, 4, 0.45);
      this.lunaPlanFor(t);
      return;
    }
    // rally: is there a ball to hit?
    const p = this.plan;
    if (this.phase !== "flight" || !p || b.by === "you") return;
    if (this.pendingLoss && real > this.pendingLoss.t + 0.08) return;
    const d = real - p.t;
    const win = this.config.difficulty === "flow" ? 0.4 : this.config.difficulty === "athlete" ? 0.34 : 0.28;
    // a take-back moves the other way: only the swing toward the ball counts
    const handSign = sw.hand === "R" ? 1 : -1;
    const forward = p.forehand ? -handSign : handSign;
    if (sw.dx * forward < -0.35) return;
    if (d < -win) {
      if (t - this.lastSwingNote > 1.2 && d > -1) {
        this.lastSwingNote = t;
        this.say("EARLY", "info");
      }
      return;
    }
    if (d > win) return;
    this.learnHand(sw.hand);
    this.hitBall(sw, d, win, t);
  }

  /** Turn your swing into a shot. */
  private hitBall(sw: Swing, d: number, win: number, t: number) {
    const b = this.ball,
      p = this.plan!;
    const fore = p.forehand;
    this.swingAnim = { t, fore, power: Math.min(1, sw.rel / 10) };
    const quality = 1 - Math.min(1, Math.abs(d) / win);
    const sweet = Math.abs(d) < 0.08;
    this.pendingLoss = null;
    // the ball kept flying while your swing was on its way through the
    // camera: bring it back within reach of the racket
    const past = b.p.clone().sub(p.at);
    if (past.length() > 0.6) b.p.copy(p.at).addScaledVector(past.normalize(), 0.6);
    if (b.p.y < 0.35) b.p.y = 0.35;
    const hand = sw.hand === "R" ? 1 : -1;
    // timing: early pulls across, late pushes out; on time follows the swing
    const early = Math.max(-1, Math.min(1, -d / 0.22));
    const pull = (fore ? -hand : hand) * early;
    // the swing path counts too: more across the body pulls, straighter pushes
    const neutral = fore ? -hand * 0.8 : hand * 0.8;
    // a clean hit finds the open court, away from Luna
    const open = this.lunaPos.x > 0 ? -1 : 1;
    const assist = (sweet ? 0.4 : 0.12 + quality * 0.12) * open;
    const aim = Math.max(-1, Math.min(1, pull * 0.8 + (sw.dx - neutral) * 0.3 + assist));
    const power = Math.max(0, Math.min(1, (sw.rel - 2.6) / 8.5));
    const up = -sw.dy; // screen y grows down
    let spin = up > 0.25 ? Math.min(1, up * 1.3) : up < -0.25 ? Math.max(-0.7, up * 1.1) : 0;
    let vh = 13.5 + power * 13 + (sweet ? 2 : 0);
    let depth = 2.2 + power * 2.2 + spin * 1.2;
    let clear = 0.3 + Math.max(0, spin) * 0.6;
    let label = "";
    if (b.p.y > 1.75 && sw.dy > 0.35 && sw.rel > 4.5) {
      // smash: flat, fast and steep
      vh = 26 + power * 6;
      spin = 0;
      depth = 4 + power * 3;
      clear = 0.08;
      label = "SMASH!";
      this.shake = 1;
    } else if (sw.rel < 4.2 && up > 0.55) {
      // lob: high and deep
      vh = 11 + power * 3;
      spin = 0.35;
      depth = 1.2;
      clear = 3.4;
      label = "LOB";
    }
    // mishits lose power and accuracy
    const err = (1 - quality) * 1.8;
    const tx = aim * (HALF_W - 0.35) + (this.rnd() - 0.5) * err;
    const tz = FAR_BASE + depth + (this.rnd() - 0.5) * err * 1.4;
    vh *= 0.78 + 0.22 * quality;
    b.v.copy(solveShot(b.p, tx, tz, vh, spin, clear * (0.4 + 0.6 * quality)));
    b.spin = spin;
    b.by = "you";
    b.box = null;
    b.bounces = 0;
    this.plan = null;
    this.rally++;
    this.hits++;
    this.score += Math.round(20 + power * 30 + quality * 30);
    this.show.hit(0.4 + quality * 0.5);
    sfx.racket(0.35 + power * 0.65);
    const at = b.p.clone();
    this.world.sparks.emit(at, sweet ? PT.gold : 0xe4ff5a, sweet ? 44 : 24, 4.5, 0.5);
    if (label) this.say(label, "perfect");
    else if (sweet) this.say("PERFECT", "perfect");
    const kmh = Math.round(Math.hypot(b.v.x, b.v.y, b.v.z) * 3.6 * 1.5);
    if (power > 0.75 && !label) window.setTimeout(() => this.say(`${kmh} KM/H`, "info"), 120);
    this.lunaPlanFor(t);
  }

  // ---- Luna ----------------------------------------------------------------

  private lunaPlanFor(t: number) {
    const c = this.predictContact("luna", this.ball);
    const diff = this.config.difficulty;
    this.lunaReactAt = t + (diff === "expert" ? 0.1 : diff === "athlete" ? 0.18 : 0.26) + this.rnd() * 0.08;
    if (!c) {
      this.lunaPlan = null;
      return;
    }
    const forehand = c.p.x <= this.lunaPos.x + 0.3;
    this.lunaPlan = { at: c.p, t: t + c.t, forehand };
    // her right hand is on the court's -x side as she faces you
    const side = forehand ? -1 : 1;
    this.lunaGoal.set(c.p.x - side * 0.8, 0, Math.min(-8.5, c.p.z - 0.3));
  }

  private updateLuna(dt: number, t: number) {
    const diff = this.config.difficulty;
    const maxV = diff === "expert" ? 7.2 : diff === "athlete" ? 6.0 : 4.9;
    const goal = t >= this.lunaReactAt ? this.lunaGoal : this.lunaPos;
    const want = goal.clone().sub(this.lunaPos);
    want.y = 0;
    const dist = want.length();
    const desired = dist > 0.02 ? want.multiplyScalar(Math.min(maxV, dist * 6) / dist) : new T.Vector3();
    this.lunaVel.lerp(desired, 1 - Math.exp(-dt * 8));
    if (this.phase === "flight" || this.phase === "dead") this.lunaPos.addScaledVector(this.lunaVel, dt);
    this.lunaPos.x = Math.max(-6.5, Math.min(6.5, this.lunaPos.x));
    this.luna.group.position.copy(this.lunaPos);
    this.luna.group.scale.setScalar(1.22);
    // her serve
    if (this.phase === "serve" && this.server === "luna" && t - this.phaseAt > 1.2) {
      this.lunaSwingAt = t;
      this.phase = "toss";
      this.phaseAt = t;
      this.ball.v.set(0, 4.6, 0);
    }
    if (this.phase === "toss" && this.server === "luna" && t - this.phaseAt > 0.5) this.lunaServe(t);
    // return the ball when it reaches her
    const p = this.lunaPlan;
    if (p && this.phase === "flight" && this.ball.by === "you" && this.ball.bounces === 1) {
      if (this.lunaSwingAt < p.t - 1 && t > p.t - 0.5) this.lunaSwingAt = t;
      if (t >= p.t) this.lunaReturn(t);
    }
    const speed = this.lunaVel.length();
    if (this.lunaMoves) {
      this.lunaRunT += dt * (0.6 + speed * 0.18);
      const st = t - this.lunaSwingAt;
      const w = st >= 0 && st < 1.2 ? Math.min(1, st / 0.1) * Math.min(1, (1.2 - st) / 0.3) : 0;
      const run = Math.min(1, speed / 3) * (1 - w);
      this.luna.timeline([
        ["BoxBounce", t * 0.8, Math.max(0, 1 - run - w)],
        ["Run", this.lunaRunT, run],
        [p?.forehand === false ? "SlashL" : "Slash", Math.max(0, st), w],
      ]);
      this.luna.group.rotation.set(0, Math.max(-0.5, Math.min(0.5, this.lunaVel.x * 0.06)), 0);
    }
    this.placeRacket(this.luna, this.lunaRacket, "R", false);
  }

  private lunaServe(t: number) {
    const b = this.ball;
    const right = this.servingFromRight;
    b.p.set(this.lunaPos.x - 0.2, 2.5, this.lunaPos.z + 0.4);
    const diff = this.config.difficulty;
    const vh = diff === "expert" ? 22 : diff === "athlete" ? 19 : 15.5;
    const tx = (right ? 1.6 : -1.6) + (this.rnd() - 0.5) * 1.2;
    const tz = NEAR_SERVICE - 1.2 - this.rnd() * 1.5;
    b.v.copy(solveShot(b.p, tx, tz, vh, 0.15, 0.12));
    b.spin = 0.15;
    b.by = "luna";
    b.box = right ? [0, HALF_W, NET_Z, NEAR_SERVICE] : [-HALF_W, 0, NET_Z, NEAR_SERVICE];
    b.bounces = 0;
    this.phase = "flight";
    this.phaseAt = t;
    sfx.racket(0.7);
    this.planYou(t);
  }

  private lunaReturn(t: number) {
    const b = this.ball,
      p = this.lunaPlan!;
    this.lunaPlan = null;
    const reach = Math.hypot(this.lunaPos.x - (p.at.x - (p.forehand ? -0.8 : 0.8)), this.lunaPos.z - Math.min(-8.5, p.at.z - 0.3));
    this.lunaGoal.set(0, 0, -18.6);
    if (reach > 1.25) return; // too far: the ball goes past her
    const diff = this.config.difficulty;
    const incoming = Math.hypot(b.v.x, b.v.z);
    const stretch = Math.min(1, reach / 1.25);
    // pressure: running wide, a fast ball, and a long rally all cause errors
    const errChance = (diff === "expert" ? 0.03 : diff === "athlete" ? 0.06 : 0.1) + stretch * 0.16 + Math.max(0, incoming - 16) * 0.025 + Math.max(0, this.rally - 5) * 0.04;
    const error = this.rnd() < errChance;
    b.p.copy(p.at);
    const vh = (diff === "expert" ? 19 : diff === "athlete" ? 16.5 : 14) + this.rnd() * 3 - stretch * 2;
    // aim away from you on the harder levels
    const away = this.youPos.x > 0 ? -1 : 1;
    let tx = diff === "flow" ? (this.rnd() - 0.5) * 3.2 : away * (1.2 + this.rnd() * 1.8) * (this.rnd() < 0.75 ? 1 : -0.5);
    let tz = NEAR_BASE - 1.4 - this.rnd() * 3.2;
    let clear = 0.35;
    if (error) {
      if (this.rnd() < 0.5) {
        clear = -0.25; // into the net
      } else if (this.rnd() < 0.5) tz = NEAR_BASE + 0.6 + this.rnd(); // long
      else tx = (tx >= 0 ? 1 : -1) * (HALF_W + 0.4 + this.rnd() * 0.8); // wide
    }
    const spin = this.rnd() < 0.6 ? 0.45 : -0.3;
    b.v.copy(solveShot(b.p, tx, tz, vh, spin, clear));
    b.spin = spin;
    b.by = "luna";
    b.box = null;
    b.bounces = 0;
    this.rally++;
    sfx.racket(0.6);
    this.world.sparks.emit(b.p.clone(), PT.magenta, 18, 3.5, 0.4);
    this.planYou(t);
  }

  private planYou(t: number) {
    const c = this.predictContact("you", this.ball);
    if (!c) {
      this.plan = null;
      return;
    }
    const hand = this.racketHand === "R" ? 1 : -1;
    const forehand = (c.p.x - this.youPos.x) * hand >= -0.25;
    this.plan = { at: c.p, t: t + c.t, forehand };
  }

  // ---- ball ----------------------------------------------------------------

  private updateBall(dt: number, t: number) {
    const b = this.ball;
    if (this.phase === "serve") {
      // the server holds the ball
      if (this.server === "you") {
        const h = this.you.boneWorld(this.racketHand === "R" ? "LeftHand" : "RightHand");
        if (h) b.p.copy(h);
      } else {
        const h = this.luna.boneWorld("LeftHand");
        if (h) b.p.copy(h);
      }
    } else if (this.phase === "dead") {
      if (b.p.y > BALL_R || Math.abs(b.v.y) > 0.3) this.physics(dt, t, false);
      if (t - this.phaseAt > 1.9 && !this.stopped) this.newPoint(t);
    } else this.physics(dt, t, true);
    this.ballMesh.position.copy(b.p);
    this.shadow.position.set(b.p.x, 0.02, b.p.z);
    (this.shadow.material as T.MeshBasicMaterial).opacity = Math.max(0.1, 0.5 - b.p.y * 0.12);
    // trail
    for (let i = this.trailPos.length / 3 - 1; i > 0; i--) {
      this.trailPos[i * 3] = this.trailPos[(i - 1) * 3];
      this.trailPos[i * 3 + 1] = this.trailPos[(i - 1) * 3 + 1];
      this.trailPos[i * 3 + 2] = this.trailPos[(i - 1) * 3 + 2];
    }
    this.trailPos.set([b.p.x, b.p.y, b.p.z], 0);
    this.trail.geometry.attributes.position.needsUpdate = true;
    // glow when it's yours to hit
    const p = this.plan;
    const near = p && this.phase === "flight" && b.by === "luna" ? Math.max(0, 1 - Math.abs(t - p.t) / 0.45) : 0;
    (this.hittableGlow.material as T.SpriteMaterial).opacity = near * 0.9;
    this.hittableGlow.scale.setScalar(0.45 + near * 0.35);
  }

  private physics(dt: number, t: number, live: boolean) {
    const b = this.ball;
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const prevZ = b.p.z;
      stepBall(b, dt / steps);
      // the net
      if ((prevZ - NET_Z) * (b.p.z - NET_Z) < 0 && b.p.y < NET_H + BALL_R && Math.abs(b.p.x) < 5) {
        b.p.z = NET_Z + (prevZ > NET_Z ? 0.05 : -0.05);
        b.v.set(b.v.x * 0.1, Math.min(0, b.v.y) * 0.2, -b.v.z * 0.08);
        if (live) {
          sfx.net();
          this.pointAfterFault(b.by, t, "NET");
        }
        live = false;
      }
      if (b.p.y <= BALL_R && b.v.y < 0) {
        b.p.y = BALL_R;
        const sp = Math.abs(b.v.y);
        b.v.y = -b.v.y * (0.7 + 0.08 * b.spin);
        b.v.x *= 0.86 + 0.05 * b.spin;
        b.v.z *= 0.86 + 0.05 * b.spin;
        b.spin *= 0.5;
        if (sp > 1) sfx.bounce(Math.min(1, sp / 8));
        if (live) {
          this.onBounce(t);
          live = this.phase === "flight";
        }
      }
    }
    // a ball that gets past a player who never touched it
    if (live && this.phase === "flight") {
      if (b.by === "luna" && b.bounces >= 1 && b.p.z > NEAR_BASE + 4.5) this.pendingLoss ??= { t, why: this.rally ? "WINNER LUNA" : "ACE" };
      if (b.by === "you" && b.bounces >= 1 && b.p.z < FAR_BASE - 4.5) this.award("you", t, this.rally <= 1 ? "ACE!" : "WINNER!");
    }
  }

  private pointAfterFault(by: Side, t: number, why: string) {
    const serve = !!this.ball.box && this.rally === 0;
    if (serve && this.faults === 0) {
      // first serve fault: serve again
      this.faults = 1;
      this.say(why === "NET" ? "NET · FAULT" : "FAULT", "info");
      this.phase = "dead";
      this.phaseAt = t;
      window.setTimeout(() => {
        if (this.stopped) return;
        this.phase = "serve";
        this.phaseAt = this.elapsed;
        this.plan = null;
        this.lunaPlan = null;
      }, 1100);
      return;
    }
    const other: Side = by === "you" ? "luna" : "you";
    this.award(other, t, serve ? "DOUBLE FAULT" : why === "NET" ? "NET" : "OUT");
  }

  private onBounce(t: number) {
    const b = this.ball;
    b.bounces++;
    const mark = new T.Mesh(new T.RingGeometry(0.1, 0.16, 24), new T.MeshBasicMaterial({ color: new T.Color(0xe4ff5a).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(b.p.x, 0.02, b.p.z);
    this.stage.scene.add(mark);
    this.marks.push({ mesh: mark, t });
    if (b.bounces === 1) {
      // in or out?
      const onTheirSide = b.by === "you" ? b.p.z < NET_Z : b.p.z > NET_Z;
      let inside = onTheirSide && Math.abs(b.p.x) <= HALF_W + BALL_R && (b.by === "you" ? b.p.z >= FAR_BASE - BALL_R : b.p.z <= NEAR_BASE + BALL_R);
      if (b.box) inside = onTheirSide && b.p.x >= b.box[0] - BALL_R && b.p.x <= b.box[1] + BALL_R && b.p.z >= b.box[2] - BALL_R && b.p.z <= b.box[3] + BALL_R;
      if (!inside) {
        (mark.material as T.MeshBasicMaterial).color.set(0xff4060);
        this.pointAfterFault(b.by, t, "OUT");
        return;
      }
      b.box = null;
      if (b.by === "luna" && !this.plan) this.planYou(t);
    } else if (b.bounces === 2) {
      if (b.by === "luna") this.pendingLoss ??= { t, why: "POINT LUNA" };
      else this.award("you", t, this.rally <= 1 ? "ACE!" : "WINNER!");
    }
  }

  private updateMarks(t: number) {
    this.marks = this.marks.filter((m) => {
      const age = t - m.t;
      if (age > 1.2) {
        m.mesh.removeFromParent();
        m.mesh.geometry.dispose();
        (m.mesh.material as T.Material).dispose();
        return false;
      }
      (m.mesh.material as T.MeshBasicMaterial).opacity = 1 - age / 1.2;
      m.mesh.scale.setScalar(1 + age * 1.5);
      return true;
    });
  }

  private updateCamera(dt: number, t: number) {
    this.shake = Math.max(0, this.shake - dt * 3);
    const cam = this.stage.camera;
    const reduced = this.config.reducedMotion;
    const j = reduced ? 0 : this.shake;
    this.camX += (this.youPos.x * 0.72 - this.camX) * (1 - Math.exp(-dt * 3));
    const x = this.camX;
    cam.position.set(x + (Math.random() - 0.5) * j * 0.08, 3.7 + (Math.random() - 0.5) * j * 0.06, 12.6);
    cam.lookAt(x * 0.55, 0.6, -8);
    void t;
  }

  protected hint() {
    return "";
  }

  protected resultDetails() {
    return [
      { label: "GAMES", value: `${this.games.you} – ${this.games.luna}` },
      { label: this.games.you > this.games.luna ? "RESULT" : "LUNA WINS", value: this.games.you > this.games.luna ? "YOU WIN" : "NEXT TIME" },
    ];
  }

  protected diagnostics() {
    return {
      phase: this.phase,
      server: this.server,
      points: this.points,
      games: this.games,
      rally: this.rally,
      racketHand: this.racketHand,
      plan: this.plan ? { t: +this.plan.t.toFixed(2), forehand: this.plan.forehand } : null,
      swings: this.swingLog,
    };
  }

  /** Dev and QA: what a bot player needs. */
  botView() {
    const now = performance.now();
    const toNow = (s: number) => now + (s - this.elapsed) * 1000;
    return {
      game: "tennis",
      phase: this.phase,
      server: this.server,
      ball: { y: this.ball.p.y, vy: this.ball.v.y, by: this.ball.by },
      contactAt: this.plan && this.phase === "flight" && this.ball.by === "luna" ? toNow(this.plan.t) : null,
      forehand: this.plan?.forehand ?? true,
      hand: this.racketHand,
      tossTopAt: this.phase === "toss" && this.server === "you" ? toNow(this.phaseAt + 5.4 / G) : null,
    };
  }

  stop() {
    this.you.dispose();
    this.luna.dispose();
    clearTimeout(this.popTimer);
    super.stop();
  }
}
