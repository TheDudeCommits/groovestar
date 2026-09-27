import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { boxVenue } from "../render/pt/box-venue";
import { Character } from "../render/character";
import { PT, softDot } from "../render/pt/palette";
import { Body3D } from "../../pose/body3d";
import { FighterInput, type Punch, type Defense } from "./boxing-input";
import { sfx } from "../../games/sfx";
import { announce } from "../core/settings";
import { random } from "../core/records";

/*
 * Boxing: a real fight with Blaze, three rounds, first person.
 *
 * You throw jabs, crosses, hooks and uppercuts; each lands on her head or
 * body depending on where your fist goes, unless she covers up or slips it.
 * She fights back with telegraphed punches (a glowing glove, a flash on
 * the side it comes from, then the wind-up): raise your gloves to block,
 * lean to slip a straight, duck a hook. Dodge one and she's open for a
 * counter. Punches cost stamina, so flailing tires you out. Knock her down
 * three times, or out-point her over three rounds. If you go down, punch
 * to beat the count.
 */

type Side = "you" | "blaze";
type AttackId = "jab" | "cross" | "straight" | "hookL" | "hookR" | "upper" | "upperL";

interface AttackDef {
  clip: string;
  /** her hand; she faces you, so her left comes from your right (screen side +1) */
  hand: "L" | "R";
  dmg: number;
  kind: "straight" | "hook" | "upper";
  high: boolean;
}

const ATTACKS: Record<AttackId, AttackDef> = {
  jab: { clip: "JabL", hand: "L", dmg: 7, kind: "straight", high: true },
  cross: { clip: "JabR", hand: "R", dmg: 10, kind: "straight", high: true },
  straight: { clip: "StraightR", hand: "R", dmg: 11, kind: "straight", high: true },
  hookL: { clip: "HookL", hand: "L", dmg: 12, kind: "hook", high: true },
  hookR: { clip: "HookR", hand: "R", dmg: 12, kind: "hook", high: true },
  upper: { clip: "Uppercut", hand: "R", dmg: 13, kind: "upper", high: true },
  upperL: { clip: "UppercutL", hand: "L", dmg: 13, kind: "upper", high: true },
};

const HIT_CLIPS = ["HitFace", "HitFace1", "HitFace2"];
const PLAYER_DMG = { jab: 3.2, cross: 4.6, hook: 5.4, uppercut: 6.2 };

type AIState = "stance" | "tell" | "strike" | "hit" | "block" | "dodge" | "down" | "getup" | "ko" | "win" | "rest";

interface AI {
  state: AIState;
  at: number;
  attack: AttackId | null;
  /** her punch already landed (or missed) this strike */
  resolved: boolean;
  /** seconds into the attack clip when the fist lands */
  impact: number;
  clip: string;
  clipAt: number;
  nextAttack: number;
  combo: AttackId[];
  open: number;
  hits: number[];
  x: number;
  vx: number;
}

/** First-person boxing glove. */
function glove(side: "L" | "R") {
  const g = new T.Group();
  // your corner is blue: both gloves, so they never read as hers
  const col = new T.Color(side === "L" ? 0x2f6bff : 0x3a78ff);
  const leather = new T.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, emissive: col, emissiveIntensity: 0.06 });
  const fist = new T.Mesh(new T.SphereGeometry(0.11, 28, 20), leather);
  fist.scale.set(1, 1.12, 1.25);
  g.add(fist);
  const thumb = new T.Mesh(new T.CapsuleGeometry(0.04, 0.07, 4, 10), leather);
  thumb.position.set(side === "L" ? 0.085 : -0.085, -0.02, 0.04);
  thumb.rotation.z = side === "L" ? -0.6 : 0.6;
  g.add(thumb);
  // the cuff and wrist run down and back toward you, out of the bottom of the view
  const wrist = new T.Group();
  wrist.position.set(0, -0.09, 0.09);
  wrist.rotation.x = -0.75;
  g.add(wrist);
  const cuff = new T.Mesh(new T.CylinderGeometry(0.075, 0.07, 0.16, 24), new T.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.5 }));
  cuff.position.y = -0.06;
  wrist.add(cuff);
  const band = new T.Mesh(new T.TorusGeometry(0.075, 0.01, 8, 28), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.4) }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.01;
  wrist.add(band);
  return g;
}

/** Blaze's gloves: glossy orange, worn on her hand bones. */
function blazeGlove() {
  const g = new T.Group();
  const leather = new T.MeshPhysicalMaterial({ color: new T.Color(0xff5a1a).multiplyScalar(0.8), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, emissive: 0xff3a10, emissiveIntensity: 0.08 });
  const fist = new T.Mesh(new T.SphereGeometry(0.095, 24, 18), leather);
  fist.scale.set(1, 1.05, 1.25);
  fist.position.z = 0.03;
  g.add(fist);
  const cuff = new T.Mesh(new T.CylinderGeometry(0.062, 0.058, 0.1, 18), new T.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.5 }));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = -0.08;
  g.add(cuff);
  return g;
}

export class KineticBox extends KineticSession {
  private venue;
  private blaze = new Character({ toon: { rimLeft: PT.magenta, rimRight: PT.gold, rim: 1 } });
  private body = new Body3D();
  private fighter: FighterInput;
  private gloves: Record<"L" | "R", T.Group>;
  private gloveKick = { L: 0, R: 0 };
  private rnd: () => number;
  private hp: Record<Side, number> = { you: 100, blaze: 100 };
  private stamina = 100;
  private downs: Record<Side, number> = { you: 0, blaze: 0 };
  private round = 1;
  private rounds = 3;
  private roundLen: number;
  private roundLeft: number;
  private phase: "intro" | "fight" | "break" | "down" | "over" = "intro";
  private phaseAt = 0;
  private count = 0;
  private getUpPunches = 0;
  private roundScore: { you: number; blaze: number }[] = [];
  private landed: Record<Side, number> = { you: 0, blaze: 0 };
  private thrown = 0;
  private dmgDone: Record<Side, number> = { you: 0, blaze: 0 };
  private ai: AI = { state: "stance", at: 0, attack: null, resolved: false, impact: 0.35, clip: "", clipAt: 0, nextAttack: 3, combo: [], open: 0, hits: [], x: 0, vx: 0 };
  private impacts = new Map<string, number>();
  private moves = false;
  private camShake = new T.Vector3();
  private hurt = 0;
  private ui: {
    root: HTMLElement;
    you: HTMLElement;
    youTrail: HTMLElement;
    blaze: HTMLElement;
    blazeTrail: HTMLElement;
    stamina: HTMLElement;
    clock: HTMLElement;
    call: HTMLElement;
    warn: HTMLElement;
    hurt: HTMLElement;
    count: HTMLElement;
  };
  private callTimer = 0;
  private headPos = new T.Vector3();
  private telegraphGlow: T.Sprite;
  private blazeGloves = { L: blazeGlove(), R: blazeGlove() };
  private demoNext = 1;
  private log: unknown[] = [];
  /** when you last threw: your guard is down for a beat after a punch */
  private lastPunchAt = -9;
  private punchLog: unknown[] = [];
  private defenseSeen = { guard: 0, slip: 0, duck: 0, frames: 0 };

  constructor(o: KineticOpts) {
    super(o, { fog: 0x06030e, fogDensity: 0.03, bloom: 0.6, bloomThreshold: 0.85, exposure: 1.0, vignette: 0.55 });
    this.duration = Infinity;
    this.rnd = random(this.seed);
    const diff = this.config.difficulty;
    this.roundLen = diff === "flow" ? 50 : 60;
    this.roundLeft = this.roundLen;
    this.venue = boxVenue(this.stage, this.show);
    this.fighter = new FighterInput(this.input.rig);
    this.stage.setFov(62);
    this.stage.camera.position.set(0, 1.56, 1.45);
    this.stage.camera.lookAt(0, 1.38, -0.3);
    this.stage.scene.add(this.blaze.group);
    this.blaze.group.position.set(0, 0, -0.3);
    if (this.stage.key) {
      this.stage.key.intensity = 1.25;
      this.stage.key.position.set(-1.2, 5, 4);
      this.stage.key.target.position.set(0, 1.2, -0.3);
    }
    this.preparation = this.blaze.load("blaze").then(async () => {
      await this.blaze.loadMoves();
      this.moves = true;
      this.measureImpacts();
    });
    this.gloves = { L: glove("L"), R: glove("R") };
    this.stage.scene.add(this.gloves.L, this.gloves.R);
    this.telegraphGlow = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: new T.Color(0xff3a4a).multiplyScalar(2), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.telegraphGlow.scale.setScalar(0.5);
    this.stage.scene.add(this.telegraphGlow, this.blazeGloves.L, this.blazeGloves.R);
    this.ui = this.makeUi();
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { gsGame: unknown }).gsGame = this;
  }

  private makeUi() {
    const root = document.createElement("div");
    root.className = "bx-ui";
    root.innerHTML = `
      <div class="bx-bars">
        <div class="bx-bar bx-you"><b>YOU</b><div class="bx-hp"><i data-trail></i><i data-hp></i></div><div class="bx-st"><i data-st></i></div></div>
        <div class="bx-clock" data-clock>R1 · 1:00</div>
        <div class="bx-bar bx-blaze"><b>BLAZE</b><div class="bx-hp"><i data-trail></i><i data-hp></i></div></div>
      </div>
      <div class="bx-call" data-call></div>
      <div class="bx-warn" data-warn></div>
      <div class="bx-count" data-count></div>
      <div class="bx-hurt" data-hurt></div>`;
    this.host.appendChild(root);
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    return {
      root,
      you: q(".bx-you [data-hp]"),
      youTrail: q(".bx-you [data-trail]"),
      blaze: q(".bx-blaze [data-hp]"),
      blazeTrail: q(".bx-blaze [data-trail]"),
      stamina: q("[data-st]"),
      clock: q("[data-clock]"),
      call: q("[data-call]"),
      warn: q("[data-warn]"),
      hurt: q("[data-hurt]"),
      count: q("[data-count]"),
    };
  }

  /** Find when each attack clip's fist is furthest out: that's the impact. */
  private measureImpacts() {
    for (const [, a] of Object.entries(ATTACKS)) {
      const dur = this.blaze.clipDuration(a.clip);
      if (!dur) continue;
      let best = 0.35,
        bestZ = -Infinity;
      for (let t = 0.05; t < Math.min(dur, 1.2); t += 1 / 30) {
        this.blaze.timeline([[a.clip, t, 1]]);
        this.blaze.group.updateMatrixWorld(true);
        const hand = this.blaze.boneWorld(a.hand === "L" ? "LeftHand" : "RightHand");
        const hips = this.blaze.boneWorld("Hips");
        if (!hand || !hips) continue;
        const z = hand.z - hips.z;
        if (z > bestZ) {
          bestZ = z;
          best = t;
        }
      }
      this.impacts.set(a.clip, best);
    }
  }

  // ---- UI ----------------------------------------------------------------

  private call(text: string, kind: "good" | "bad" | "big" | "info" = "info", ms = 900) {
    const el = this.ui.call;
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.callTimer);
    this.callTimer = window.setTimeout(() => el.classList.remove("show"), ms);
  }

  private updateUi() {
    const set = (el: HTMLElement, v: number) => (el.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100)).toFixed(3)})`);
    set(this.ui.you, this.hp.you);
    set(this.ui.blaze, this.hp.blaze);
    // the white trail catches up after a hit, like fighting games
    for (const [el, v] of [
      [this.ui.youTrail, this.hp.you],
      [this.ui.blazeTrail, this.hp.blaze],
    ] as const) {
      const cur = Number(el.dataset.v ?? 100);
      const next = cur > v ? Math.max(v, cur - 0.6) : v;
      el.dataset.v = String(next);
      el.style.transform = `scaleX(${(next / 100).toFixed(3)})`;
    }
    set(this.ui.stamina, this.stamina);
    const m = Math.floor(this.roundLeft / 60),
      s = Math.floor(this.roundLeft % 60);
    this.ui.clock.textContent = this.phase === "break" ? `R${this.round + 1} NEXT` : `R${this.round} · ${m}:${String(s).padStart(2, "0")}`;
    this.hurt = Math.max(0, this.hurt - 0.03);
    this.ui.hurt.style.opacity = this.hurt.toFixed(2);
  }

  // ---- frame -------------------------------------------------------------

  protected step(dt: number, t: number, input: MotionState) {
    this.venue.update(t);
    this.body.update(this.options.cameraOk ? this.options.tracker.latestWorld : null, performance.now());
    // down on the canvas, any fast fist counts toward getting up
    const minSpeed = this.phase === "down" ? 1.1 : this.config.difficulty === "flow" ? 1.8 : 2.0;
    const punches = this.options.cameraOk ? this.fighter.update(this.body, t, minSpeed) : this.demoPunches(t);
    if (this.options.cameraOk) {
      const d = this.fighter.defense;
      this.defenseSeen.frames++;
      if (d.guard) this.defenseSeen.guard++;
      if (d.slip) this.defenseSeen.slip++;
      if (d.duck) this.defenseSeen.duck++;
    }
    if (!this.options.cameraOk) this.demoDefense(t);
    void input;
    this.stamina = Math.min(100, this.stamina + dt * 9);
    switch (this.phase) {
      case "intro":
        if (t - this.phaseAt > 0.2 && !this.introDone) {
          this.introDone = true;
          this.call(`ROUND ${this.round}`, "big", 1300);
          window.setTimeout(() => {
            if (this.stopped) return;
            this.call("FIGHT!", "big", 800);
            sfx.ring(1);
            sfx.crowd("cheer", 0.8);
          }, 1300);
        }
        if (t - this.phaseAt > 2.1) this.setPhase("fight", t);
        break;
      case "fight":
        this.roundLeft = Math.max(0, this.roundLeft - dt);
        for (const p of punches) this.playerPunch(p, t);
        this.runAI(dt, t);
        if (this.roundLeft <= 0) this.endRound(t);
        break;
      case "down":
        this.runDown(t, punches);
        break;
      case "break":
        if (t - this.phaseAt > 6) {
          this.round++;
          this.roundLeft = this.roundLen;
          this.introDone = false;
          this.fighter.recenter();
          this.setPhase("intro", t);
        }
        break;
      case "over":
        break;
    }
    this.poseBlaze(dt, t);
    this.poseGloves(dt, t);
    this.updateCamera(dt, t);
    this.updateUi();
  }
  private introDone = false;

  private setPhase(p: KineticBox["phase"], t: number) {
    this.phase = p;
    this.phaseAt = t;
  }

  // ---- your punches --------------------------------------------------------

  private playerPunch(p: Punch, t: number) {
    const ai = this.ai;
    this.thrown++;
    this.lastPunchAt = t;
    this.punchLog.push({ t: +t.toFixed(2), hand: p.hand, kind: p.kind, power: +p.power.toFixed(2), high: p.high });
    if (this.punchLog.length > 16) this.punchLog.shift();
    this.gloveKick[p.hand] = 1;
    const tired = this.stamina < 25;
    this.stamina = Math.max(0, this.stamina - (p.kind === "jab" ? 9 : 14));
    if (ai.state === "down" || ai.state === "getup" || ai.state === "ko") return;
    const diff = this.config.difficulty;
    // she covers up more when you spam
    ai.hits = ai.hits.filter((x) => t - x < 1.4);
    const pressure = ai.hits.length * 0.14;
    const open = t < ai.open || ai.state === "tell" || ai.state === "strike";
    const counter = open;
    const baseBlock = (diff === "expert" ? 0.62 : diff === "athlete" ? 0.5 : 0.32) * (p.high ? 1 : 0.6);
    const blocked = !open && ai.state !== "hit" && this.rnd() < Math.min(0.8, baseBlock + pressure);
    const dodged = !open && !blocked && p.kind !== "hook" && this.rnd() < (diff === "expert" ? 0.16 : diff === "athlete" ? 0.1 : 0.05);
    const at = this.targetPoint(p);
    if (dodged) {
      this.aiDo("dodge", t, this.rnd() < 0.5 ? "Dodge" : "Dodge1");
      this.call("SLIPPED", "info", 500);
      sfx.whoosh();
      return;
    }
    if (blocked) {
      this.aiDo("block", t, ["Block1", "Block2", "Block3"][Math.floor(this.rnd() * 3)]);
      this.venue.sparks.emit(at, 0xffffff, 10, 2.5, 0.3);
      sfx.punch(p.power * 0.5, true);
      const chip = PLAYER_DMG[p.kind] * 0.12;
      this.damage("blaze", chip, t);
      return;
    }
    // landed
    let dmg = PLAYER_DMG[p.kind] * (0.55 + p.power * 0.6) * (tired ? 0.55 : 1) * (counter ? 1.6 : 1) * (p.high ? 1 : 0.8);
    if (!p.high && p.kind === "hook") dmg *= 1.15;
    ai.hits.push(t);
    this.landed.you++;
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += Math.round(dmg * 10) + (counter ? 50 : 0);
    this.show.hit(Math.min(1, 0.4 + p.power * 0.6));
    const big = p.power > 0.85 || counter;
    // beat her to it: a counter stops a jab or a cross, but her hooks and
    // uppercuts power through and you trade
    const armored = (ai.state === "tell" || ai.state === "strike") && ai.attack && ATTACKS[ai.attack].kind !== "straight";
    if (armored) {
      this.venue.sparks.emit(at, 0xfff0c0, 20, 3.5, 0.4);
      sfx.punch(p.power, false);
      this.damage("blaze", dmg * 0.8, t);
      return;
    }
    if (ai.state === "tell" || ai.state === "strike") ai.attack = null;
    this.aiDo("hit", t, p.high ? (big ? "HitReact" : HIT_CLIPS[Math.floor(this.rnd() * HIT_CLIPS.length)]) : "HitBody");
    this.venue.sparks.emit(at, big ? PT.gold : 0xfff0c0, big ? 48 : 26, big ? 6 : 4, 0.5);
    this.venue.sparks.emit(at, 0xffffff, 12, 3, 0.35);
    sfx.punch(p.power, false);
    if (counter) this.call("COUNTER!", "good", 700);
    else if (big) this.call(p.kind === "uppercut" ? "UPPERCUT!" : p.kind === "hook" ? "HOOK!" : "BOOM!", "good", 600);
    if (big) sfx.crowd("cheer", 0.6);
    this.camShake.set((this.rnd() - 0.5) * 0.02, 0.01, 0);
    this.damage("blaze", dmg, t);
  }

  /** Where your punch meets her: head or body, from her own bones. */
  private targetPoint(p: Punch) {
    const head = this.blaze.boneWorld("Head") ?? new T.Vector3(0, 1.55, -0.3);
    const chest = this.blaze.boneWorld("Spine01") ?? new T.Vector3(0, 1.2, -0.3);
    const at = (p.high ? head : chest).clone().add(new T.Vector3(p.hand === "L" ? -0.07 : 0.07, 0, 0.14));
    return at;
  }

  private damage(to: Side, amount: number, t: number) {
    this.hp[to] = Math.max(0, this.hp[to] - amount);
    this.dmgDone[to === "you" ? "blaze" : "you"] += amount;
    if (this.hp[to] <= 0 && this.phase === "fight") this.knockdown(to, t);
  }

  // ---- Blaze ---------------------------------------------------------------

  private aiDo(state: AIState, t: number, clip: string) {
    const ai = this.ai;
    ai.state = state;
    ai.at = t;
    ai.clip = clip;
    ai.clipAt = t;
  }

  private runAI(dt: number, t: number) {
    const ai = this.ai;
    const diff = this.config.difficulty;
    const age = t - ai.at;
    // footwork: she drifts side to side in front of you
    const drift = Math.sin(t * 0.7) * 0.18 + Math.sin(t * 1.9) * 0.05;
    ai.vx += (drift - ai.x) * dt * 3 - ai.vx * dt * 2;
    ai.x += ai.vx * dt;
    switch (ai.state) {
      case "stance":
        if (t >= ai.nextAttack && this.stamina >= 0) this.startAttack(t);
        break;
      case "tell": {
        // the tell: her glove glows before she throws
        const tell = diff === "expert" ? 0.28 : diff === "athlete" ? 0.4 : 0.56;
        if (!ai.attack) {
          this.backToStance(t, 0.4);
          break;
        }
        if (age >= tell) {
          ai.state = "strike";
          ai.resolved = false;
          ai.at = t;
          ai.clip = ATTACKS[ai.attack!].clip;
          ai.clipAt = t;
        }
        break;
      }
      case "strike": {
        if (!ai.attack) {
          this.backToStance(t, 0.4);
          break;
        }
        const impact = this.impacts.get(ATTACKS[ai.attack].clip) ?? 0.35;
        if (age >= impact && !ai.resolved) {
          ai.resolved = true;
          this.resolveAttack(ai.attack, t);
        }
        if (age >= impact + 0.35) this.nextAfterAttack(t);
        break;
      }
      case "hit":
        if (age > 0.55) this.backToStance(t, 0.35);
        break;
      case "block":
      case "dodge":
        if (age > 0.45) {
          this.backToStance(t, 0.2);
          // she likes to fire back straight off a block
          if (this.rnd() < (diff === "flow" ? 0.3 : 0.5)) ai.nextAttack = t + 0.2;
        }
        break;
      default:
        break;
    }
  }

  private backToStance(t: number, minGap: number) {
    const ai = this.ai;
    ai.state = "stance";
    ai.at = t;
    ai.clip = "";
    ai.attack = null;
    // her rhythm is set when she attacks; a hit or a block only delays it
    ai.nextAttack = Math.max(ai.nextAttack, t + minGap);
  }

  private startAttack(t: number) {
    const ai = this.ai;
    const diff = this.config.difficulty;
    const pool: AttackId[] = diff === "flow" ? ["jab", "jab", "cross", "hookL", "hookR"] : ["jab", "cross", "straight", "hookL", "hookR", "upper", "upperL"];
    if (!ai.combo.length) {
      const first = pool[Math.floor(this.rnd() * pool.length)];
      ai.combo = [first];
      const comboChance = diff === "expert" ? 0.45 : diff === "athlete" ? 0.28 : 0.1;
      if (this.rnd() < comboChance) ai.combo.push(first === "jab" ? "cross" : pool[Math.floor(this.rnd() * pool.length)]);
    }
    ai.attack = ai.combo.shift()!;
    const gap = diff === "expert" ? 1.0 + this.rnd() * 0.9 : diff === "athlete" ? 1.4 + this.rnd() * 1.0 : 1.9 + this.rnd() * 1.1;
    ai.nextAttack = t + gap;
    ai.state = "tell";
    ai.at = t;
    ai.clip = "";
    const a = ATTACKS[ai.attack];
    // warn from the side it comes from: her left fist is on your right
    const side = a.hand === "L" ? "right" : "left";
    this.ui.warn.dataset.side = a.kind === "upper" ? "low" : side;
    this.ui.warn.dataset.kind = a.kind;
    this.ui.warn.classList.remove("show");
    void this.ui.warn.offsetWidth;
    this.ui.warn.classList.add("show");
  }

  private nextAfterAttack(t: number) {
    const ai = this.ai;
    if (ai.combo.length) {
      ai.state = "stance";
      ai.nextAttack = t + 0.05;
      return;
    }
    this.backToStance(t, 0.6);
  }

  /** Her punch arrives: did you block, slip, duck, or eat it? */
  private resolveAttack(id: AttackId, t: number) {
    const ai = this.ai;
    const a = ATTACKS[id];
    const d: Defense = this.options.cameraOk ? this.fighter.defenseAround(t) : this.demoDef;
    const from = a.hand === "L" ? 1 : -1; // screen side the fist comes from
    const slipOk = a.kind === "straight" ? d.slip !== 0 : a.kind === "hook" ? d.slip === -from : d.slip !== 0;
    const duckOk = a.kind === "straight" || a.kind === "hook" ? d.duck : false;
    const diff = this.config.difficulty;
    const mult = diff === "expert" ? 1.25 : diff === "athlete" ? 1 : 0.7;
    if (slipOk || duckOk) {
      this.call(duckOk ? "DUCKED!" : "SLIPPED!", "good", 600);
      sfx.whoosh();
      ai.open = t + 0.95;
      this.score += 60;
      this.show.hit(0.7);
      this.log.push({ t: +t.toFixed(2), id, out: duckOk ? "duck" : "slip" });
      return;
    }
    // a high guard covers straights and hooks, but an uppercut comes up
    // between the gloves, and a fist you just threw isn't guarding anything
    const guarding = d.guard && t - this.lastPunchAt > 0.28 && a.kind !== "upper";
    if (guarding) {
      this.call("BLOCKED", "info", 450);
      sfx.punch(0.5, true);
      this.damage("you", a.dmg * (a.kind === "hook" ? 0.28 : 0.15) * mult, t);
      this.camShake.set(from * 0.012, 0.004, 0);
      this.log.push({ t: +t.toFixed(2), id, out: "block" });
      return;
    }
    // you take it
    this.landed.blaze++;
    this.combo = 0;
    this.show.miss();
    sfx.punch(0.9, false);
    this.hurt = 0.85;
    this.camShake.set(-from * 0.07, a.kind === "upper" ? 0.05 : 0.02, 0.03);
    this.call(a.kind === "upper" && d.guard ? "THROUGH THE GUARD" : a.kind === "hook" ? "HOOK" : a.kind === "upper" ? "UPPERCUT" : "HIT", "bad", 550);
    this.damage("you", a.dmg * mult, t);
    this.log.push({ t: +t.toFixed(2), id, out: "hit" });
  }

  // ---- knockdowns, rounds, the result -------------------------------------

  private knockdown(who: Side, t: number) {
    this.downs[who]++;
    this.setPhase("down", t);
    this.count = 0;
    this.getUpPunches = 0;
    this.downWho = who;
    this.ai.combo = [];
    this.ai.attack = null;
    sfx.crowd("cheer", 1);
    if (who === "blaze") {
      this.aiDo("down", t, this.rnd() < 0.5 ? "KnockDown" : "KnockDown1");
      this.call("KNOCKDOWN!", "good", 1200);
      this.venue.confetti.burst(120);
      this.show.hit(1);
      this.score += 1000;
    } else {
      this.call("YOU'RE DOWN", "bad", 1200);
      this.hurt = 1;
      this.aiDo("rest", t, "Taunt");
    }
  }
  private downWho: Side = "blaze";

  private runDown(t: number, punches: Punch[]) {
    const who = this.downWho;
    const age = t - this.phaseAt;
    const n = Math.min(10, Math.floor((age - 1) / 1.0) + 1);
    if (age > 1 && n !== this.count) {
      this.count = n;
      this.ui.count.textContent = String(n);
      this.ui.count.classList.remove("show");
      void this.ui.count.offsetWidth;
      this.ui.count.classList.add("show");
      sfx.count();
    }
    if (who === "you") {
      // punch to get back up
      this.getUpPunches += punches.length;
      this.ui.count.dataset.hint = this.getUpPunches < 4 ? "PUNCH TO GET UP" : "";
      if (this.getUpPunches >= 4 && this.downs.you < 3 && this.count < 10) {
        this.hp.you = this.downs.you === 1 ? 45 : 30;
        this.ui.count.textContent = "";
        this.ui.count.dataset.hint = "";
        this.call("BACK UP!", "good", 900);
        this.fighter.recenter();
        this.setPhase("fight", t);
        this.backToStance(t, 1.5);
        return;
      }
      if (this.count >= 10 || (this.downs.you >= 3 && this.count >= 3)) this.endFight("blaze", t, "KO");
      return;
    }
    // Blaze beats the count unless it's her third time down
    const upAt = this.downs.blaze >= 3 ? Infinity : this.config.difficulty === "expert" ? 5 : 7;
    if (this.count >= upAt && this.ai.state === "down") {
      this.aiDo("getup", t, "GetUp");
    }
    if (this.ai.state === "getup" && t - this.ai.at > 1.8) {
      this.hp.blaze = this.downs.blaze === 1 ? 50 : 35;
      this.ui.count.textContent = "";
      this.call("SHE'S UP", "info", 900);
      this.backToStance(t, 1.2);
      this.setPhase("fight", t);
      return;
    }
    if (this.count >= 10) this.endFight("you", t, "KO");
  }

  private endRound(t: number) {
    // ten-point must: the round goes to whoever did more damage
    const you = this.dmgDone.you,
      her = this.dmgDone.blaze;
    const r = you >= her ? { you: 10, blaze: 9 } : { you: 9, blaze: 10 };
    this.roundScore.push(r);
    this.dmgDone = { you: 0, blaze: 0 };
    sfx.ring(2);
    if (this.round >= this.rounds) {
      const a = this.roundScore.reduce((s, x) => s + x.you, 0) - this.downs.you,
        b = this.roundScore.reduce((s, x) => s + x.blaze, 0) - this.downs.blaze;
      this.endFight(a >= b ? "you" : "blaze", t, "DECISION");
      return;
    }
    this.call(`END OF ROUND ${this.round}`, "info", 1600);
    this.setPhase("break", t);
    this.aiDo("rest", t, "Tired");
    this.hp.you = Math.min(100, this.hp.you + 20);
    this.hp.blaze = Math.min(100, this.hp.blaze + 15);
  }

  private endFight(winner: Side, t: number, how: "KO" | "DECISION") {
    if (this.phase === "over") return;
    this.setPhase("over", t);
    this.winner = winner;
    this.ui.count.textContent = "";
    if (winner === "you") {
      this.call(how === "KO" ? "K.O.!" : "YOU WIN", "big", 2600);
      this.score += how === "KO" ? 3000 : 1500;
      this.venue.confetti.burst(260);
      sfx.crowd("cheer", 1.2);
      announce(how === "KO" ? "Knockout!" : "Winner, by decision!");
    } else {
      this.call(how === "KO" ? "K.O." : "BLAZE WINS", "bad", 2600);
      this.aiDo("win", t, "Taunt");
    }
    this.howWon = how;
    window.setTimeout(() => this.finish(), 3200);
  }
  private winner: Side | null = null;
  private howWon = "";

  // ---- presentation --------------------------------------------------------

  private poseBlaze(dt: number, t: number) {
    const ai = this.ai;
    this.blaze.group.position.set(ai.x, 0, -0.3);
    if (!this.moves) {
      this.blaze.update(dt);
      return;
    }
    const idle = "BoxBounce";
    const age = t - ai.clipAt;
    let layers: [string, number, number][];
    if (ai.state === "stance" || ai.state === "tell" || ai.state === "rest") {
      layers = [[ai.state === "rest" ? ai.clip || "Tired" : idle, ai.state === "rest" ? t - ai.clipAt : t, 1]];
      if (ai.state === "tell" && ai.attack) {
        // the first frames of the punch: she loads up
        const a = ATTACKS[ai.attack];
        const k = Math.min(1, age / 0.4);
        layers = [
          [idle, t, 1 - k * 0.6],
          [a.clip, 0.02 + k * 0.08, k * 0.6],
        ];
      }
    } else if (ai.clip) {
      const d = this.blaze.clipDuration(ai.clip) || 1;
      const hold = ai.state === "down" || ai.state === "ko" || ai.state === "win";
      const ct = hold ? Math.min(d - 0.05, age) : Math.min(d - 0.02, age * (ai.state === "hit" ? 1.3 : 1));
      const w = hold ? 1 : Math.min(1, age / 0.06) * Math.min(1, (d * 1.2 - age) / 0.25 + 0.2);
      layers = [
        [idle, t, Math.max(0, 1 - w)],
        [ai.clip, ct, Math.max(0.001, w)],
      ];
    } else layers = [[idle, t, 1]];
    this.blaze.timeline(layers);
    // telegraph glow on the fist that's coming
    const g = this.telegraphGlow.material as T.SpriteMaterial;
    if ((ai.state === "tell" || ai.state === "strike") && ai.attack && !ai.resolved) {
      const a = ATTACKS[ai.attack];
      const hand = this.blaze.boneWorld(a.hand === "L" ? "LeftHand" : "RightHand");
      if (hand) this.telegraphGlow.position.copy(hand);
      g.opacity = ai.state === "tell" ? 0.5 + 0.4 * Math.sin(t * 30) : 0.9;
    } else g.opacity = Math.max(0, g.opacity - dt * 4);
    const head = this.blaze.boneWorld("Head");
    if (head) this.headPos.copy(head);
    for (const s of ["L", "R"] as const) {
      const hand = this.blaze.boneWorld(s === "L" ? "LeftHand" : "RightHand"),
        fore = this.blaze.boneWorld(s === "L" ? "LeftForeArm" : "RightForeArm");
      if (!hand || !fore) continue;
      const dir = hand.clone().sub(fore).normalize();
      const gl = this.blazeGloves[s];
      gl.position.copy(hand).addScaledVector(dir, 0.07);
      gl.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
    }
  }

  private poseGloves(dt: number, t: number) {
    const cam = this.stage.camera;
    for (const s of ["L", "R"] as const) {
      const g = this.gloves[s];
      this.gloveKick[s] = Math.max(0, this.gloveKick[s] - dt * 5);
      let u = s === "L" ? -0.32 : 0.32,
        v = -0.28,
        ext = 0;
      if (this.options.cameraOk) {
        const w = this.body.get(s === "L" ? "wrL" : "wrR", 0.25),
          sh = this.body.get(s === "L" ? "shL" : "shR", 0.25),
          nose = this.body.get("nose", 0.25);
        g.visible = !!w;
        if (w && sh) {
          // fist relative to the face, in meters; reaching forward extends it
          const ref = nose ?? sh;
          u = (w.x - ref.x) * 1.0;
          v = (w.y - ref.y) * 1.0 - 0.05;
          ext = Math.max(0, Math.min(1, (w.z - sh.z - 0.08) / 0.4));
        }
      } else {
        g.visible = true;
        u += Math.sin(t * 2 + (s === "L" ? 0 : 1)) * 0.02;
      }
      ext = Math.max(ext, Math.sin(Math.min(1, this.gloveKick[s]) * Math.PI) * 0.9);
      // in front of the eyes: guard low in the view, punches reach out to her
      const local = new T.Vector3(u * 1.1 + (s === "L" ? -0.04 : 0.04), v * 0.9 - 0.16 + ext * 0.12, -0.5 - ext * 1.0);
      const world = local.applyQuaternion(cam.quaternion).add(cam.position);
      g.position.lerp(world, 1 - Math.exp(-dt * 30));
      g.quaternion.copy(cam.quaternion);
      g.rotateZ(s === "L" ? -0.25 : 0.25);
      g.scale.setScalar(0.88);
    }
  }

  private updateCamera(dt: number, t: number) {
    const cam = this.stage.camera;
    const d = this.options.cameraOk ? this.fighter.defense : this.demoDef;
    // your head moves the view: slip and duck for real
    const x = Math.max(-0.35, Math.min(0.35, d.headX * 0.28)),
      y = Math.max(-0.4, Math.min(0.1, d.headY * 0.3));
    this.camShake.multiplyScalar(Math.exp(-dt * 8));
    const reduced = this.config.reducedMotion;
    const bob = reduced ? 0 : Math.sin(t * 3.1) * 0.008;
    const down = this.phase === "down" && this.downWho === "you" ? 0.45 : 0;
    cam.position.set(x + this.camShake.x, 1.56 + y + bob + this.camShake.y - down, 1.45 + this.camShake.z);
    cam.lookAt(this.ai.x * 0.5 + x * 0.3, 1.38 + y * 0.4 - down * 0.6, -0.3);
    if (!reduced) cam.rotateZ(this.camShake.x * 1.6);
  }

  // ---- demo autopilot -------------------------------------------------------

  private demoDef: Defense = { guard: false, headX: 0, headY: 0, slip: 0, duck: false, t: 0 };

  private demoPunches(t: number): Punch[] {
    if (this.phase !== "fight" || t < this.demoNext) return [];
    this.demoNext = t + 0.7 + this.rnd() * 1.1;
    const kinds = ["jab", "cross", "hook", "uppercut"] as const;
    const k = kinds[Math.floor(this.rnd() * 4)];
    return [{ hand: k === "jab" ? "L" : "R", kind: k, dir: [0, 0, 1], power: 0.5 + this.rnd() * 0.5, high: this.rnd() < 0.75, t }];
  }

  private demoDefense(t: number) {
    const ai = this.ai;
    const coming = (ai.state === "tell" || ai.state === "strike") && ai.attack;
    const a = coming ? ATTACKS[ai.attack!] : null;
    const pick = Math.floor(t * 7) % 3;
    this.demoDef = {
      guard: !!a && pick === 0,
      slip: a && pick === 1 ? (a.hand === "L" ? -1 : 1) : 0,
      duck: !!a && pick === 2 && a.kind !== "upper",
      headX: a && pick === 1 ? (a.hand === "L" ? -0.8 : 0.8) : 0,
      headY: a && pick === 2 ? -0.8 : 0,
      t,
    };
  }

  // ---- session hooks ---------------------------------------------------------

  protected hint() {
    return "";
  }

  protected resultDetails() {
    const acc = this.thrown ? Math.round((this.landed.you / this.thrown) * 100) : 0;
    return [
      { label: "RESULT", value: this.winner === "you" ? `WIN · ${this.howWon}` : `LOSS · ${this.howWon}` },
      { label: "PUNCHES LANDED", value: `${this.landed.you} / ${this.thrown} (${acc}%)` },
      { label: "KNOCKDOWNS", value: `${this.downs.blaze} – ${this.downs.you}` },
    ];
  }

  protected diagnostics() {
    return {
      phase: this.phase,
      round: this.round,
      hp: this.hp,
      stamina: Math.round(this.stamina),
      ai: this.ai.state,
      attack: this.ai.attack,
      landed: this.landed,
      thrown: this.thrown,
      downs: this.downs,
      defense: this.options.cameraOk ? this.fighter.defense : this.demoDef,
      log: this.log.slice(-10),
      punches: this.punchLog,
      defenseSeen: this.defenseSeen,
      getUp: this.getUpPunches,
      count: this.count,
    };
  }

  /** Dev and QA: what a bot fighter needs to see. */
  botView() {
    const ai = this.ai;
    const a = ai.attack ? ATTACKS[ai.attack] : null;
    const now = performance.now();
    let impactAt: number | null = null;
    if (a && (ai.state === "tell" || ai.state === "strike")) {
      const tell = this.config.difficulty === "expert" ? 0.28 : this.config.difficulty === "athlete" ? 0.4 : 0.56;
      const impact = this.impacts.get(a.clip) ?? 0.35;
      const at = ai.state === "tell" ? ai.at + tell + impact : ai.at + impact;
      impactAt = now + (at - this.elapsed) * 1000;
    }
    return {
      game: "box",
      live: this.phase === "fight" || this.phase === "down",
      phase: this.phase,
      down: this.phase === "down" ? this.downWho : null,
      open: this.elapsed < ai.open,
      attack: a ? { kind: a.kind, from: a.hand === "L" ? 1 : -1, impactAt } : null,
    };
  }

  stop() {
    this.blaze.dispose();
    clearTimeout(this.callTimer);
    super.stop();
  }
}
