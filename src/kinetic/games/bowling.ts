import * as T from "three";
import * as C from "cannon-es";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { bowlLane, LANE, pinSpots } from "../render/pt/bowl-venue";
import { ptPin } from "../render/pt/court-venue";
import { PT } from "../render/pt/palette";
import { Character } from "../render/character";
import { Body3D } from "../../pose/body3d";
import { sfx } from "../../games/sfx";
import { announce } from "../core/settings";
import { bowlingTotals } from "./bowl-score";

/*
 * Bowling, thrown by your arm.
 *
 * The ball sits in your character's hand, and her arm follows yours. Swing
 * it back behind you, then bring it through: the ball leaves the hand at the
 * bottom of your forward swing. How fast your hand is moving is how fast the
 * ball rolls; the way your swing travels across your body sets its line, and
 * a swing that curves at the release puts hook on it. Step left or right
 * before you bowl to move along the foul line. Nothing is thrown without a
 * real backswing, so waving an arm never bowls by accident.
 *
 * Pins are rigid bodies (cannon-es), so they scatter, spin and take each
 * other down. Ten frames, standard scoring with strikes and spares.
 */

type Phase = "aim" | "roll" | "settle" | "result";

interface Pin {
  body: C.Body;
  mesh: T.Group;
  spot: T.Vector3;
  down: boolean;
  gone: boolean;
}

const PIN_COM = 0.23;
const BALL_KG = 8;

/**
 * Watches one arm for a bowling swing, as a pendulum: the hand swings back
 * while it's low (the backswing, which a camera sees as the hand moving away
 * from it), then swings through toward the camera and rises past the hip:
 * that's the release. Real players do anything from a textbook backswing
 * behind the hip to a kettlebell swing between the legs; both have this
 * shape. A plain raise of the arm has no backswing, so it never bowls.
 */
class ThrowWatch {
  backAt = -9;
  private fwdPeak = 0;
  private hist: { t: number; vx: number }[] = [];
  constructor(readonly hand: "L" | "R") {}
  reset() {
    this.backAt = -9;
    this.fwdPeak = 0;
    this.hist = [];
  }
  /** Returns a release when the hand comes through after a backswing. */
  feed(body: Body3D, t: number): { speed: number; vx: number; vz: number; curve: number; hand: "L" | "R" } | null {
    const w = body.get(this.hand === "L" ? "wrL" : "wrR", 0.2),
      hl = body.get("hipL", 0.3),
      hr = body.get("hipR", 0.3);
    if (!w) return null;
    const hipY = hl && hr ? (hl.y + hr.y) / 2 : 0;
    const y = w.y - hipY;
    const speed = Math.hypot(w.vx, w.vy, w.vz);
    this.hist.push({ t, vx: w.vx });
    while (this.hist.length && t - this.hist[0].t > 0.35) this.hist.shift();
    // backswing: low and moving away from the camera
    if (y < 0.22 && w.vz < -0.7) {
      this.backAt = t;
      this.fwdPeak = 0;
    }
    if (t - this.backAt > 1.2) return null;
    if (w.vz > 0) this.fwdPeak = Math.max(this.fwdPeak, speed);
    // release: swinging through toward the camera, rising past the hip
    if (t - this.backAt > 0.1 && w.vz > 0.9 && w.vy > 0.25 && y > -0.06 && y < 0.55) {
      const early = this.hist.find((h) => t - h.t < 0.2) ?? this.hist[0];
      const out = { speed: Math.max(this.fwdPeak, speed), vx: w.vx, vz: w.vz, curve: w.vx - (early?.vx ?? w.vx), hand: this.hand };
      this.reset();
      return out;
    }
    return null;
  }
}

export class KineticBowl extends KineticSession {
  private lane;
  // the lane is 1.6x real size, so gravity is too: pins fall like real pins
  private world = new C.World({ gravity: new C.Vec3(0, -9.81 * 1.6, 0) });
  private pins: Pin[] = [];
  private ball: C.Body;
  private ballMesh: T.Mesh;
  private you = new Character();
  private body3d = new Body3D();
  private moves = false;
  private phase: Phase = "aim";
  private phaseAt = 0;
  private ballHand: "L" | "R" = "R";
  private watches = { L: new ThrowWatch("L"), R: new ThrowWatch("R") };
  private stand = 0;
  private hook = 0;
  private released = 0;
  private lunge = 0;
  private guide: T.Mesh;
  private camPos = new T.Vector3(0, 1.8, 3.8);
  private camLook = new T.Vector3(0, 0.3, -9);
  private slowmo = 1;
  private hitPins = false;
  private players: number;
  private player = 0;
  private frames: number[][][];
  private frameNo = 0;
  private roll = 0;
  private standingBefore = 10;
  private card: HTMLElement;
  private pop: HTMLElement;
  private popTimer = 0;
  private demoAt = -1;
  private totalScore = 0;
  private throwLog: unknown[] = [];

  constructor(o: KineticOpts) {
    super(o, { bloom: 0.55, bloomThreshold: 0.9, exposure: 0.95 });
    this.duration = Infinity;
    this.players = o.players ?? 1;
    this.frames = Array.from({ length: this.players }, () => Array.from({ length: 10 }, () => [] as number[]));
    this.lane = bowlLane(this.stage, this.show);
    this.stage.setFov(50);
    if (this.stage.key) {
      this.stage.key.position.set(-2, 7, 5);
      this.stage.key.target.position.set(0, 0, -4);
    }
    this.buildPhysics();
    // galaxy ball
    const ballMat = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; uniform float uTime;
        void main(){ vec3 p = normalize(vP); float sw = sin(p.x * 7.0 + sin(p.y * 5.0) * 2.0) * sin(p.z * 6.0);
          vec3 c = mix(vec3(0.16, 0.04, 0.42), vec3(1.0, 0.25, 0.7), smoothstep(-0.2, 0.8, sw));
          c = mix(c, vec3(0.25, 0.85, 1.0), smoothstep(0.6, 1.0, sin(p.y * 9.0 + p.x * 4.0)));
          float fr = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.0);
          c += vec3(0.6, 0.8, 1.0) * fr * 1.1;
          // finger holes
          float holes = smoothstep(0.985, 0.99, dot(p, normalize(vec3(0.0, 0.25, 1.0)))) + smoothstep(0.988, 0.992, dot(p, normalize(vec3(0.15, 0.45, 0.9)))) + smoothstep(0.988, 0.992, dot(p, normalize(vec3(-0.15, 0.45, 0.9))));
          c *= 1.0 - holes * 0.9;
          gl_FragColor = vec4(c * 1.2, 1.0); }`,
    });
    this.ballMesh = new T.Mesh(new T.SphereGeometry(LANE.ballR, 40, 28), ballMat);
    this.ballMesh.castShadow = true;
    this.stage.scene.add(this.ballMesh);
    this.ball = new C.Body({ mass: BALL_KG, shape: new C.Sphere(LANE.ballR), material: this.mats.ball, linearDamping: 0.02, angularDamping: 0.02 });
    this.ball.allowSleep = false;
    // a ball driven into the pocket carries the rack a little harder
    this.ball.addEventListener("collide", (e: { body: C.Body }) => {
      if (this.pocketDone || this.phase !== "roll") return;
      const head = this.pins[0];
      if (!head || e.body !== head.body) return;
      this.pocketDone = true;
      const off = Math.abs(this.ball.position.x - head.spot.x);
      const speed = this.ball.velocity.length();
      if (off > 0.04 && off < 0.17 && speed > 7.5) {
        this.pocketBoost = 0.18;
        this.pocketHit = true;
      }
    });
    // your character on the approach, seen from behind
    this.you.group.rotation.y = Math.PI;
    this.stage.scene.add(this.you.group);
    this.preparation = this.you.load("nova").then(async () => {
      await this.you.loadMoves();
      this.moves = true;
    });
    // a faint line down the lane from where you stand
    this.guide = new T.Mesh(
      new T.PlaneGeometry(0.05, 9).rotateX(-Math.PI / 2).translate(0, 0.006, -4.5),
      new T.MeshBasicMaterial({ color: new T.Color(PT.cyan).multiplyScalar(0.9), transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false }),
    );
    this.stage.scene.add(this.guide);
    this.card = document.createElement("div");
    this.card.className = "bw-card";
    this.pop = document.createElement("div");
    this.pop.className = "tn-pop";
    this.host.append(this.card, this.pop);
    this.rack();
    this.renderCard();
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { gsGame: unknown }).gsGame = this;
  }

  private mats = { lane: new C.Material("lane"), pin: new C.Material("pin"), ball: new C.Material("ball") };

  private buildPhysics() {
    const w = this.world;
    w.allowSleep = true;
    w.broadphase = new C.SAPBroadphase(w);
    (w.solver as C.GSSolver).iterations = 14;
    const m = this.mats;
    // tuned on a pin bench: pocket hits strike, head-on hits split, and a
    // spinning ball doesn't grind pins into the deck (low ball-pin friction)
    w.addContactMaterial(new C.ContactMaterial(m.ball, m.lane, { friction: 0.02, restitution: 0.05 }));
    w.addContactMaterial(new C.ContactMaterial(m.pin, m.lane, { friction: 0.18, restitution: 0.2 }));
    w.addContactMaterial(new C.ContactMaterial(m.pin, m.pin, { friction: 0.25, restitution: 0.65 }));
    w.addContactMaterial(new C.ContactMaterial(m.ball, m.pin, { friction: 0.02, restitution: 0.55 }));
    const L = Math.abs(LANE.end);
    const stat = (shape: C.Shape, x: number, y: number, z: number) => {
      const b = new C.Body({ mass: 0, material: m.lane });
      b.addShape(shape);
      b.position.set(x, y, z);
      w.addBody(b);
      return b;
    };
    // lane and deck
    stat(new C.Box(new C.Vec3(LANE.halfWidth, 0.1, L / 2 + 3)), 0, -0.1, -L / 2 + 3);
    // gutters: a lower floor on each side with a wall outside
    for (const s of [-1, 1]) {
      stat(new C.Box(new C.Vec3(LANE.gutter / 2, 0.1, L / 2 + 3)), s * (LANE.halfWidth + LANE.gutter / 2), -LANE.gutterDepth - 0.1, -L / 2 + 3);
      stat(new C.Box(new C.Vec3(0.07, 0.6, L / 2 + 4)), s * (LANE.halfWidth + LANE.gutter + 0.07), 0.3, -L / 2 + 2);
    }
    // pit floor and back cushion
    stat(new C.Box(new C.Vec3(2, 0.1, 1.5)), 0, -0.7, LANE.end - 1.5);
    stat(new C.Box(new C.Vec3(2, 1.2, 0.1)), 0, 0.4, LANE.end - 2.4);
  }

  private makePin(spot: T.Vector3): Pin {
    const body = new C.Body({ mass: 1.6, material: this.mats.pin, linearDamping: 0.05, angularDamping: 0.12 });
    // narrow base, a straight belly where the ball strikes, then neck and head
    body.addShape(new C.Cylinder(0.115, 0.06, 0.1, 12), new C.Vec3(0, 0.05 - PIN_COM, 0));
    body.addShape(new C.Cylinder(0.115, 0.115, 0.2, 12), new C.Vec3(0, 0.2 - PIN_COM, 0));
    body.addShape(new C.Cylinder(0.05, 0.115, 0.12, 12), new C.Vec3(0, 0.36 - PIN_COM, 0));
    body.addShape(new C.Cylinder(0.065, 0.055, 0.2, 10), new C.Vec3(0, 0.52 - PIN_COM, 0));
    body.sleepSpeedLimit = 0.12;
    body.sleepTimeLimit = 0.4;
    this.world.addBody(body);
    const mesh = ptPin();
    mesh.scale.setScalar(LANE.pinH / 0.97);
    this.stage.scene.add(mesh);
    return { body, mesh, spot: spot.clone(), down: false, gone: false };
  }

  /** Stand all ten pins on their spots. */
  private rack() {
    if (!this.pins.length) this.pins = pinSpots().map((s) => this.makePin(s));
    for (const p of this.pins) {
      p.down = false;
      p.gone = false;
      if (!this.world.bodies.includes(p.body)) this.world.addBody(p.body);
      p.mesh.visible = true;
      this.placePin(p);
    }
    this.standingBefore = 10;
  }

  private placePin(p: Pin) {
    p.body.position.set(p.spot.x, PIN_COM + 0.002, p.spot.z);
    p.body.quaternion.set(0, 0, 0, 1);
    p.body.velocity.set(0, 0, 0);
    p.body.angularVelocity.set(0, 0, 0);
    p.body.wakeUp();
    p.body.sleep();
  }

  /** Clear the fallen pins after a first ball; the rest stay where they stand. */
  private sweep() {
    for (const p of this.pins) {
      if (p.down) {
        p.gone = true;
        p.mesh.visible = false;
        this.world.removeBody(p.body);
      } else {
        // stood up straight where it is
        p.body.quaternion.set(0, 0, 0, 1);
        p.body.position.y = PIN_COM + 0.002;
        p.body.velocity.set(0, 0, 0);
        p.body.angularVelocity.set(0, 0, 0);
        p.body.sleep();
      }
    }
  }

  private isDown(p: Pin) {
    if (p.gone) return true;
    const up = p.body.quaternion.vmult(new C.Vec3(0, 1, 0));
    return up.y < 0.82 || p.body.position.y < 0.1 || Math.abs(p.body.position.x) > LANE.halfWidth + 0.05 || p.body.position.z < LANE.end - 0.1;
  }

  // ---- scoring ------------------------------------------------------------

  private totals(rolls: number[][]) {
    return bowlingTotals(rolls);
  }

  private marks(fr: number[], last: boolean) {
    const m: string[] = [];
    for (let r = 0; r < fr.length; r++) {
      const v = fr[r];
      if (!last) {
        if (r === 0 && v === 10) {
          m.push("", "X");
          break;
        }
        if (r === 1 && fr[0] + v === 10) m.push("/");
        else m.push(v === 0 ? "–" : String(v));
      } else {
        const prev = r > 0 ? fr[r - 1] : 0;
        const fresh = r === 0 || prev === 10 || (r === 2 && fr[0] + fr[1] === 10) || (r === 2 && fr[0] === 10 && fr[1] === 10);
        if (v === 10 && fresh) m.push("X");
        else if (!fresh && prev + v === 10) m.push("/");
        else m.push(v === 0 ? "–" : String(v));
      }
    }
    return m;
  }

  private renderCard() {
    const rows = this.frames.map((rolls, pi) => {
      const tot = this.totals(rolls);
      const cells = rolls
        .map((fr, f) => {
          const mk = this.marks(fr, f === 9);
          const live = pi === this.player && f === this.frameNo;
          return `<div class="bw-f${live ? " live" : ""}"><div class="bw-m">${(f === 9 ? [0, 1, 2] : [0, 1]).map((i) => `<i>${mk[i] ?? ""}</i>`).join("")}</div><b>${tot[f] ?? ""}</b></div>`;
        })
        .join("");
      return `<div class="bw-row">${this.players > 1 ? `<span class="bw-p">P${pi + 1}</span>` : ""}${cells}</div>`;
    });
    this.card.innerHTML = rows.join("");
    const mine = this.totals(this.frames[0]).filter((x) => x !== null).at(-1) ?? 0;
    this.totalScore = mine as number;
    this.score = this.totalScore;
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

  // ---- frame --------------------------------------------------------------

  protected step(dt: number, t: number, input: MotionState) {
    this.lane.update(t);
    (this.ballMesh.material as T.ShaderMaterial).uniforms.uTime.value = t;
    this.body3d.update(this.options.cameraOk ? this.options.tracker.latestWorld : null, performance.now());
    if (this.phase === "aim") this.aim(dt, t, input);
    this.pose(dt, t);
    this.physics(dt, t);
    this.updateCamera(dt, t);
  }

  private aim(dt: number, t: number, input: MotionState) {
    // step left or right to move along the foul line
    const goal = this.options.cameraOk ? Math.max(-0.45, Math.min(0.45, input.lane * 0.45)) : Math.sin(t * 0.4) * 0.2;
    this.stand += (goal - this.stand) * (1 - Math.exp(-dt * 5));
    this.guide.position.x = this.stand;
    this.guide.visible = true;
    const rel = this.options.cameraOk ? this.readThrow(t) : this.demoThrow(t);
    if (rel) this.release(rel, t);
  }

  private readThrow(t: number) {
    if (!this.body3d.fresh) return null;
    for (const h of ["R", "L"] as const) {
      const r = this.watches[h].feed(this.body3d, t);
      if (r) return r;
      if (t - this.watches[h].backAt < 0.2) this.ballHand = h;
    }
    return null;
  }

  private demoThrow(t: number) {
    if (this.demoAt < 0) this.demoAt = t + 1.6;
    if (t < this.demoAt) return null;
    this.demoAt = -1;
    const k = Math.sin(t * 1.7);
    return { speed: 4 + Math.abs(k) * 1.5, vx: k * 0.25, vz: 4, curve: -k * 0.4, hand: "R" as const };
  }

  private release(r: { speed: number; vx: number; vz: number; curve: number; hand: "L" | "R" }, t: number) {
    this.ballHand = r.hand;
    this.phase = "roll";
    this.phaseAt = t;
    this.released = t;
    this.hitPins = false;
    this.pocketDone = false;
    this.pocketHit = false;
    this.pocketBoost = 0;
    this.guide.visible = false;
    const speed = Math.max(6, Math.min(15, 3.6 + r.speed * 1.9));
    const angle = Math.max(-0.05, Math.min(0.05, Math.atan2(r.vx, Math.max(0.5, r.vz)) * 0.14));
    this.hook = Math.max(-1, Math.min(1, r.curve * 0.35));
    // the ball leaves from beside your hip, where you stand on the approach
    const x = Math.max(-LANE.halfWidth + 0.22, Math.min(LANE.halfWidth - 0.22, this.stand + (r.hand === "R" ? 0.12 : -0.12)));
    this.ball.position.set(x, LANE.ballR + 0.02, -0.25);
    this.ball.velocity.set(Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    // rolling forward, with side spin for hook
    this.ball.angularVelocity.set(-speed / LANE.ballR, 0, 0);
    this.ball.quaternion.set(0, 0, 0, 1);
    if (!this.world.bodies.includes(this.ball)) this.world.addBody(this.ball);
    this.ball.wakeUp();
    this.lunge = 1;
    this.throwLog.push({ t: +t.toFixed(2), speed: +speed.toFixed(2), angle: +angle.toFixed(3), hook: +this.hook.toFixed(2), handSpeed: +r.speed.toFixed(2) });
    if (this.throwLog.length > 12) this.throwLog.shift();
    sfx.whoosh();
  }

  /** Your character: ball in hand, arm following yours, lunge at release. */
  private pose(dt: number, t: number) {
    this.you.group.position.set(this.stand, 0, 0.9 - this.lunge * 0.45);
    this.lunge = Math.max(0, this.lunge - dt * (this.phase === "roll" ? 0.35 : 2));
    if (this.moves) {
      const hold = this.phase === "aim";
      const follow = this.phase !== "aim" ? Math.min(1, (t - this.released) / 0.15) : 0;
      this.you.timeline([
        ["BoxBounce", t * 0.6, hold ? 1 : 1 - follow],
        ["Throw", 0.55 + Math.min(0.9, (t - this.released) * 0.9), follow],
      ]);
      if (hold && this.options.cameraOk && this.body3d.live(performance.now())) this.you.drive(this.body3d, "back", { overlay: true, arms: [this.ballHand], legs: false, torso: false, blend: 1 });
    }
    if (this.phase === "aim") {
      const h = this.you.boneWorld(this.ballHand === "L" ? "LeftHand" : "RightHand");
      if (h) {
        this.ballMesh.position.copy(h).add(new T.Vector3(0, -0.06, -0.05));
        this.ballMesh.visible = true;
      }
    }
  }

  private physics(dt: number, t: number) {
    // hook: the ball bites once it reaches the dry back end of the lane
    if (this.phase === "roll") {
      const z = this.ball.position.z;
      if (z < -7 && z > LANE.headPin + 0.4 && Math.abs(this.ball.position.x) < LANE.halfWidth) {
        const vz = Math.abs(this.ball.velocity.z);
        this.ball.velocity.x += this.hook * 3.6 * dt * Math.min(1, vz / 8);
      }
      if (!this.hitPins && z < LANE.headPin + 0.7) {
        this.hitPins = true;
        this.slowmo = this.config.reducedMotion ? 1 : 0.45;
      }
    }
    this.slowmo += (1 - this.slowmo) * (1 - Math.exp(-dt * 1.4));
    if (this.pocketBoost > 0) {
      // for a moment after a pocket hit, moving pins keep a little more energy
      this.pocketBoost -= dt;
      for (const p of this.pins) if (!p.gone && p.body.velocity.length() > 0.8) p.body.velocity.scale(1 + dt * 1.6, p.body.velocity);
    }
    const step = dt * this.slowmo;
    const sub = 4;
    for (let i = 0; i < sub; i++) this.world.step(step / sub);
    // listen for pin noise
    let moving = 0;
    for (const p of this.pins) {
      if (p.gone) continue;
      p.mesh.position.copy(p.body.position as unknown as T.Vector3).add(new T.Vector3(0, -PIN_COM, 0).applyQuaternion(p.body.quaternion as unknown as T.Quaternion));
      p.mesh.quaternion.copy(p.body.quaternion as unknown as T.Quaternion);
      if (p.body.velocity.length() > 0.4) moving++;
      if (p.body.position.y < -2) {
        p.gone = true;
        p.mesh.visible = false;
        this.world.removeBody(p.body);
      }
    }
    if (this.phase === "roll" || this.phase === "settle") {
      this.ballMesh.position.copy(this.ball.position as unknown as T.Vector3);
      this.ballMesh.quaternion.copy(this.ball.quaternion as unknown as T.Quaternion);
      if (this.hitPins && moving > 2 && !this.pinSound) {
        this.pinSound = true;
        const n = this.pins.filter((p) => !p.gone && p.body.velocity.length() > 0.4).length;
        sfx.pins(n);
        if (n >= 5) sfx.crowd("ooh", 0.5);
      }
    }
    if (this.phase === "roll") {
      const gone = this.ball.position.z < LANE.end - 0.2 || this.ball.position.y < -0.3;
      const stuck = t - this.released > 8 || (t - this.released > 1.5 && this.ball.velocity.length() < 0.2);
      if (gone || stuck) {
        this.phase = "settle";
        this.phaseAt = t;
      }
    } else if (this.phase === "settle" && t - this.phaseAt > (moving ? 2.6 : 1.3)) this.score_(t);
    else if (this.phase === "result" && t - this.phaseAt > 2.1) this.next(t);
  }
  private pinSound = false;
  private pocketDone = false;
  private pocketBoost = 0;
  private pocketHit = false;

  private score_(t: number) {
    this.phase = "result";
    this.phaseAt = t;
    this.pinSound = false;
    for (const p of this.pins) p.down = this.isDown(p);
    const standing = this.pins.filter((p) => !p.down).length;
    const knocked = this.standingBefore - standing;
    const fr = this.frames[this.player][this.frameNo];
    const last = this.frameNo === 9;
    fr.push(knocked);
    const first = fr.length === 1 || (last && (fr[fr.length - 2] === 10 || (fr.length === 3 && fr[0] + fr[1] === 10)));
    const strike = standing === 0 && first;
    const spare = standing === 0 && !first;
    this.hits += knocked > 0 ? 1 : 0;
    this.misses += knocked === 0 ? 1 : 0;
    if (strike) {
      this.combo++;
      this.say("STRIKE!", "perfect");
      this.show.hit(1);
      this.lane.confetti.burst(220);
      this.lane.sparks.emit(new T.Vector3(0, 0.8, LANE.headPin - 0.5), PT.gold, 90, 7, 0.9);
      sfx.crowd("cheer", 1);
      announce("Strike!");
    } else if (spare) {
      this.combo++;
      this.say("SPARE!", "win");
      this.show.hit(0.9);
      this.lane.confetti.burst(140);
      sfx.crowd("applause", 0.9);
    } else {
      if (knocked === 0) {
        this.combo = 0;
        this.say(this.ball.position.y < -0.02 || Math.abs(this.ball.position.x) > LANE.halfWidth ? "GUTTER" : "MISS", "lose");
        this.show.miss();
      } else {
        this.say(String(knocked), "info");
        this.show.hit(knocked / 10);
        if (knocked >= 7) sfx.crowd("applause", 0.5);
      }
    }
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.renderCard();
  }

  /** Next ball: a second try at what's standing, or the next frame. */
  private next(t: number) {
    const fr = this.frames[this.player][this.frameNo];
    const last = this.frameNo === 9;
    const standing = this.pins.filter((p) => !p.down).length;
    let frameDone: boolean;
    if (!last) frameDone = fr[0] === 10 || fr.length === 2;
    else frameDone = fr.length === 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
    this.world.removeBody(this.ball);
    this.ballMesh.visible = false;
    if (frameDone) {
      if (this.players === 2 && this.player === 0) this.player = 1;
      else {
        this.player = 0;
        this.frameNo++;
      }
      if (this.frameNo >= 10) {
        this.finish();
        return;
      }
      this.rack();
      if (this.players === 2) announce(`Player ${this.player + 1}.`);
    } else if (standing === 0) this.rack();
    else {
      this.sweep();
      this.standingBefore = standing;
    }
    this.renderCard();
    this.phase = "aim";
    this.phaseAt = t;
    this.watches.L.reset();
    this.watches.R.reset();
  }

  private updateCamera(dt: number, t: number) {
    const cam = this.stage.camera;
    const b = this.ball.position;
    let pos: T.Vector3, look: T.Vector3;
    if (this.phase === "aim" || (this.phase === "roll" && t - this.released < 0.35)) {
      pos = new T.Vector3(this.stand * 0.5 + 0.35, 2.35, 4.6);
      look = new T.Vector3(this.stand * 0.2, 0.05, -10);
    } else if (this.phase === "roll" && b.z > LANE.headPin + 4) {
      pos = new T.Vector3(b.x * 0.6, 1.25, Math.max(LANE.headPin + 4.2, b.z + 3.6));
      look = new T.Vector3(b.x * 0.4, 0.2, b.z - 5);
    } else {
      // pin cam: low and close for the crash
      pos = new T.Vector3(0.55, 0.95, LANE.headPin + 3.1);
      look = new T.Vector3(0, 0.35, LANE.headPin - 0.7);
    }
    const k = 1 - Math.exp(-dt * (this.phase === "roll" ? 4 : 2.2));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  protected hint() {
    return "";
  }

  protected resultDetails() {
    return this.frames.map((rolls, i) => ({ label: this.players > 1 ? `PLAYER ${i + 1}` : "FINAL SCORE", value: String(this.totals(rolls).filter((x) => x !== null).at(-1) ?? 0) }));
  }

  protected diagnostics() {
    return {
      phase: this.phase,
      frame: this.frameNo,
      roll: this.frames[this.player][this.frameNo]?.length ?? 0,
      player: this.player,
      total: this.totalScore,
      rolls: this.frames[0],
      throws: this.throwLog,
      back: { L: this.watches.L.backAt, R: this.watches.R.backAt },
    };
  }

  /** Dev and QA: what a bot bowler needs. */
  botView() {
    return { game: "bowl", live: this.elapsed > 0.3, phase: this.phase, frame: this.frameNo, standing: this.pins.filter((p) => !this.isDown(p)).length, stand: this.stand };
  }

  stop() {
    this.you.dispose();
    clearTimeout(this.popTimer);
    super.stop();
  }
}
