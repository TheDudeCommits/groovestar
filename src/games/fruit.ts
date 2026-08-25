// Fruit Slice — energy sabers edition. Both hands hold vector-drawn energy
// katanas that orient along your swing, leave comet trails, and cut fruit by
// sweeping the whole blade through it. A composed synth track drives a
// beat-reactive dusk arena. Wave director with authored patterns, golden and
// ice fruit, a pomegranate boss you mash, a gold-rush finale, fever mode,
// and an online score race over the multiplayer rooms (same seed, same
// waves, live rival score).

import { TUNING } from './tuning';
import { Juice, drawGlow } from './juice';
import { sfx } from './sfx';
import { Arena } from './arena';
import { BLADE_RUNNING } from './music';
import { AudioEngine } from '../audio/engine';
import { flashText, type Game, type GameOpts, type Ctx } from './shared';
import { addFruitRun } from './progress';
import { Sabers } from './saber';

type Special = 'none' | 'bomb' | 'gold' | 'ice' | 'boss';

interface FruitKind {
  name: string;
  r: number;
  body: string;
  rind: string;
  seeds?: string;
  points: number;
  weight: number;
  hits?: number;           // multi-hit shells (coconut cracks before it splits)
}

const KINDS: FruitKind[] = [
  { name: 'melon', r: 0.062, body: '#ff5d73', rind: '#39b356', seeds: '#28203a', points: 3, weight: 3 },
  { name: 'orange', r: 0.046, body: '#ffa63e', rind: '#e8842a', points: 2, weight: 3 },
  { name: 'apple', r: 0.044, body: '#f8f4d8', rind: '#e8342e', seeds: '#3a2c20', points: 2, weight: 3 },
  { name: 'lime', r: 0.04, body: '#d6f78e', rind: '#57d95a', points: 2, weight: 3 },
  { name: 'berry', r: 0.034, body: '#b39dff', rind: '#7a3df0', points: 4, weight: 2 },
  { name: 'pineapple', r: 0.056, body: '#ffe9a3', rind: '#e8a52a', seeds: '#8a6a1a', points: 3, weight: 2 },
  { name: 'dragon', r: 0.05, body: '#f8f4ff', rind: '#ff6ac1', seeds: '#28203a', points: 5, weight: 1.2 },
  { name: 'star', r: 0.044, body: '#ffe9a3', rind: '#ffd23e', points: 6, weight: 0.7 },
  { name: 'coconut', r: 0.048, body: '#f8f4d8', rind: '#6b4e35', points: 6, weight: 1.4, hits: 2 },
];
const KIND_WEIGHT = KINDS.reduce((a, k) => a + k.weight, 0);
const GOLD: FruitKind = { name: 'gold', r: 0.048, body: '#ffe9a3', rind: '#ffd23e', points: 15, weight: 0 };
const ICE: FruitKind = { name: 'ice', r: 0.046, body: '#dff4ff', rind: '#6ee7ff', points: 5, weight: 0 };
const BOMB: FruitKind = { name: 'bomb', r: 0.048, body: '#2c2837', rind: '#43404d', points: 0, weight: 0 };
const BOSS: FruitKind = { name: 'boss', r: 0.088, body: '#ff5d73', rind: '#8a2444', seeds: '#ffd23e', points: 25, weight: 0 };
const BOSS_HP = 8;

interface Fruit {
  kind: FruitKind;
  special: Special;
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number;
  sliced: boolean;
  sliceAngle: number;
  sliceAge: number;
  halfSep: number;
  dead: boolean;
  hp: number;
  lastHit: number;
}

interface SliceFlash { x1: number; y1: number; x2: number; y2: number; life: number }

/** live link to the online score race (wired by main.ts over the room) */
export interface RaceLink {
  send(score: number): void;
  rival(): { name: string; score: number } | null;
}

export type FruitOpts = GameOpts & {
  seed?: string;
  race?: RaceLink;
  /** bronze, silver, gold thresholds — drives the next-medal HUD target */
  medals?: [number, number, number];
};

const ROUND_SECS = 60;
const FEVER_SECS = 8;
const TRAIL_MS = 200;
const INTRO_SECS = 1.1;
const OUTRO_SECS = 1.7;
type Finale = 'goldrush' | 'frenzy' | 'twinboss';

export class FruitGame implements Game {
  private fruits: Fruit[] = [];
  private flashes: SliceFlash[] = [];
  private juice = new Juice();
  private saberRig = new Sabers(this.juice);
  private arena = new Arena();
  private music: AudioEngine | null = null;
  private rnd: () => number;
  private score = 0;
  private best = Number(localStorage.getItem('gs-fruit-best') ?? 0);
  private fruitCount = 0;
  private combo = 0;
  private bestCombo = 0;
  private lastSliceAt = 0;
  private comboFlashT = 0;
  private fever = 0;
  private feverLeft = 0;
  private goldSpawned = 0;
  private iceSpawned = 0;
  private bossDone1 = false;
  private bossDone2 = false;
  private frenzyDone = false;
  private goldRush = false;              // finale active (any kind)
  private finale: Finale = 'goldrush';
  private bossKills = 0;
  private kcal = 0;
  private introT = INTRO_SECS;
  private outroT = 0;
  private bodyGrads = new Map<string, CanvasGradient>();
  private iceT = 0;
  private bombFlash = 0;
  private centerMsg = { text: '', color: '#fff', t: 0 };
  private t0 = performance.now();
  private lastT = performance.now();
  private gameTime = 0;
  private pending: { at: number; fn: () => void }[] = [];
  private nextPatternAt = 0.8;
  private lastPattern = '';
  private lastTickSec = -1;
  private lastRaceSend = 0;
  private raf = 0;
  private over = false;
  private demo = { L: 0, R: Math.PI };
  private splat: HTMLCanvasElement = document.createElement('canvas');
  private splatCtx = this.splat.getContext('2d')!;

  constructor(private o: FruitOpts) {
    this.rnd = o.seed ? mulberry32(strHash(o.seed)) : Math.random;
    const roll = this.rnd();
    this.finale = roll < 0.45 ? 'goldrush' : roll < 0.75 ? 'frenzy' : 'twinboss';
  }

  start() {
    this.t0 = this.lastT = performance.now();
    try {
      this.music = new AudioEngine();
      this.music.setVolume(0.62);
      this.music.energy = 0.3;
      void this.music.play(BLADE_RUNNING, 0);
    } catch { this.music = null; }
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.saberRig.dispose();
    if (this.music) {
      this.music.stop();
      try { void this.music.ctx.close(); } catch { /* already closed */ }
      this.music = null;
    }
  }

  private get W() { return window.innerWidth; }
  private get H() { return window.innerHeight; }

  // ---- main loop ------------------------------------------------------------

  private frame() {
    const { ctx } = this.o;
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const left = Math.max(0, ROUND_SECS - (now - this.t0) / 1000);
    const dt = this.juice.step(rawDt);
    this.gameTime += dt;

    const prevIntro = this.introT;
    this.introT = Math.max(0, this.introT - rawDt);
    if (prevIntro > 0.7 && this.introT <= 0.7) sfx.whoosh();       // sabers igniting
    if (prevIntro > 0 && this.introT === 0) { this.say('SLICE', '#ffd23e'); sfx.slice(4); }
    this.readHands(now, dt);
    if (this.introT <= 0 && this.outroT <= 0) {
      this.director(left);
      this.slicing(now);
    }
    this.physics(dt);
    this.timers(dt, rawDt, left);

    // fitness: integrate movement effort into calories (same rate as dance)
    const energy = this.o.tracker.latest.energy;
    if (this.o.cameraOk) this.kcal += ((3.2 + 9 * energy) / 60) * rawDt;

    // dynamic music: combo, fever and the finale push layers in; the whole
    // mix brightens with how hard you are actually moving
    if (this.music) {
      const e = 0.3 + Math.min(0.35, this.combo * 0.035)
        + (this.feverLeft > 0 ? 0.4 : 0)
        + (this.goldRush ? 0.45 : 0);
      this.music.energy = this.iceT > 0 ? 0.15 : Math.min(1, e);
      const rel = Math.max(this.saberRig.data.L.rel, this.saberRig.data.R.rel);
      this.moveEma += (Math.min(1, rel / 9) - this.moveEma) * Math.min(1, rawDt * 3);
      this.music.setBrightness(this.iceT > 0 ? 0.1 : 0.45 + this.moveEma * 0.55);
    }

    if (this.o.race && now - this.lastRaceSend > 400) {
      this.lastRaceSend = now;
      this.o.race.send(this.score);
    }

    this.draw(ctx, now, rawDt, left);

    if (left <= 0 && !this.over) {
      if (this.outroT === 0) {
        // signature outro: time freezes to a crawl, sabers power down
        this.outroT = OUTRO_SECS;
        this.say('TIME', '#fff7ee');
        this.juice.slowmo(0.3, 1200);
        sfx.bell();
        if (this.music) this.music.energy = 0.2;
      }
      this.outroT = Math.max(0.0001, this.outroT - rawDt);
      if (this.outroT <= 0.001) {
        this.over = true;
        this.stop();
        // demo autopilot runs (no camera) must not earn records or medals
        if (this.o.cameraOk) {
          if (this.score > this.best) localStorage.setItem('gs-fruit-best', String(this.score));
          const m = this.o.medals;
          const medal = !m ? 0 : this.score >= m[2] ? 3 : this.score >= m[1] ? 2 : this.score >= m[0] ? 1 : 0;
          addFruitRun({ sliced: this.fruitCount, bossKills: this.bossKills, combo: this.bestCombo, kcal: this.kcal, medal: medal as 0 | 1 | 2 | 3 });
        }
        const kcalNote = this.kcal >= 1 ? `, ${Math.round(this.kcal)} kcal` : '';
        this.o.onExit(this.score, `${this.fruitCount} fruit sliced, best combo ${this.bestCombo}${kcalNote}`);
      }
    }
  }

  // ---- input ----------------------------------------------------------------

  private readHands(now: number, dt: number) {
    const { tracker, rig, cameraOk } = this.o;
    tracker.update();
    const scale = this.bladeLen();
    if (cameraOk && rig) {
      rig.update(tracker.latestLandmarks, tracker.latestWorld ?? null, now, 4 / 3);
      for (const h of ['L', 'R'] as const) {
        const s = rig.hand(h);
        if (s && s.vis > 0.35) {
          const boost = TUNING.fruit.predictBoostMs / 1000;
          const px = (s.px + (s.vx / (4 / 3)) * boost) * this.W;
          const py = (s.py + s.vy * boost) * this.H;
          this.saberRig.move(h, px, py, s.vx, s.vy, s.rel, now, dt, this.H, scale);
        } else {
          this.saberRig.hide(h);
        }
      }
    } else {
      for (const h of ['L', 'R'] as const) {
        this.demo[h] += dt * 5.2;
        const targets = this.fruits.filter((f) => !f.sliced && !f.dead && f.special !== 'bomb' && f.y < this.H * 0.95);
        const mine = targets.filter((f) => (h === 'L' ? f.x < this.W * 0.55 : f.x >= this.W * 0.45));
        const tgt = mine.sort((a, c) => a.y - c.y)[0];
        const bx = tgt ? tgt.x + Math.cos(this.demo[h]) * this.H * 0.06 : this.W * (h === 'L' ? 0.3 : 0.7) + Math.cos(this.demo[h]) * this.W * 0.12;
        const by = tgt ? tgt.y + Math.sin(this.demo[h]) * this.H * 0.09 : this.H * 0.5 + Math.sin(this.demo[h] * 1.6) * this.H * 0.2;
        const prev = this.saberRig.data[h].hand ?? { x: bx, y: by };
        this.saberRig.move(h, bx, by, (bx - prev.x) / Math.max(dt, 1e-3) / this.H, (by - prev.y) / Math.max(dt, 1e-3) / this.H, TUNING.fruit.sliceRel + 2, now, dt, this.H, scale);
      }
    }
  }

  /** blade extension 0..1: ignites over the intro, retracts over the outro */
  private bladeLen(): number {
    const ease = (k: number) => k * k * (3 - 2 * k);
    const inK = this.introT > 0 ? 1 - this.introT / INTRO_SECS : 1;
    const outK = this.outroT > 0 ? Math.max(0, this.outroT / OUTRO_SECS) : 1;
    return Math.max(0.02, ease(inK) * ease(outK));
  }

  private moveEma = 0;

  // ---- wave director --------------------------------------------------------

  private director(left: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.gameTime >= this.pending[i].at) {
        this.pending[i].fn();
        this.pending.splice(i, 1);
      }
    }
    if (left < 1.4 || this.gameTime < this.nextPatternAt) return;
    const elapsed = ROUND_SECS - left;
    const feverOn = this.feverLeft > 0;

    if (!this.goldRush && left <= 8.5) {
      // every round ends differently: the finale kind is seeded per game
      this.goldRush = true;
      if (this.finale === 'goldrush') { this.say('GOLD RUSH', '#ffd23e'); sfx.fanfare(true); }
      else if (this.finale === 'frenzy') { this.say('FRENZY FINALE', '#ff6ac1'); sfx.fanfare(true); }
      else {
        this.say('FINAL BOSSES', '#ff6ac1');
        sfx.bell();
        this.launchBoss();
        this.pend(0.5, () => this.launchBoss());
      }
    }

    if (this.goldRush) {
      if (this.finale === 'goldrush') {
        if (this.rnd() < 0.3) this.patternFan(3);
        else this.launch(0.15 + this.rnd() * 0.7);
        this.nextPatternAt = this.gameTime + 0.42;
      } else if (this.finale === 'frenzy') {
        if (this.rnd() < 0.45) this.patternFan(4);
        else { this.launch(0.15 + this.rnd() * 0.7); this.launch(0.15 + this.rnd() * 0.7); }
        this.nextPatternAt = this.gameTime + 0.3;
      } else {
        this.launch(0.2 + this.rnd() * 0.6);
        this.nextPatternAt = this.gameTime + 0.85;
      }
      return;
    }

    if (!this.bossDone1 && elapsed > 28) { this.bossDone1 = true; this.launchBoss(); }
    else if (!this.bossDone2 && elapsed > 50) { this.bossDone2 = true; this.launchBoss(); }
    else if (!this.frenzyDone && elapsed > 22) { this.frenzyDone = true; this.patternFrenzy(); }
    else this.pickPattern(elapsed, feverOn);

    const base = Math.max(0.9, 1.6 - elapsed * 0.012);
    this.nextPatternAt = this.gameTime + base * (feverOn ? 0.55 : 1);
  }

  private pickPattern(elapsed: number, feverOn: boolean) {
    const table: [string, number, () => void][] = [
      ['single', 3, () => this.launch(0.2 + this.rnd() * 0.6)],
      ['double', elapsed > 6 ? 3 : 0, () => this.patternCross()],
      ['fan', elapsed > 10 ? 2.5 : 0, () => this.patternFan(3 + Math.floor(this.rnd() * 2))],
      ['ladder', elapsed > 14 ? 2 : 0, () => this.patternLadder()],
      ['bomb', elapsed > 10 && !feverOn ? 1.6 : 0, () => this.patternBombTrap()],
      ['gold', this.goldSpawned < 2 && elapsed > 12 ? 0.5 : 0, () => { this.goldSpawned++; this.launch(0.3 + this.rnd() * 0.4, 'gold'); }],
      ['ice', this.iceSpawned < 2 && elapsed > 16 ? 0.5 : 0, () => { this.iceSpawned++; this.launch(0.3 + this.rnd() * 0.4, 'ice'); }],
    ];
    const live = table.filter(([name, w]) => w > 0 && name !== this.lastPattern);
    const total = live.reduce((a, [, w]) => a + w, 0);
    let roll = this.rnd() * total;
    for (const [name, w, fn] of live) {
      roll -= w;
      if (roll <= 0) { this.lastPattern = name; fn(); return; }
    }
  }

  private patternCross() {
    this.launch(0.16, 'none', 0.55);
    this.pend(0.12, () => this.launch(0.84, 'none', -0.55));
  }

  private patternFan(n: number) {
    for (let i = 0; i < n; i++) {
      const fr = 0.5 + (i - (n - 1) / 2) * 0.16;
      this.pend(i * 0.07, () => this.launch(0.5, 'none', (fr - 0.5) * 1.3));
    }
  }

  private patternLadder() {
    for (let i = 0; i < 4; i++) this.pend(i * 0.14, () => this.launch(0.2 + i * 0.18));
  }

  private patternBombTrap() {
    const at = 0.25 + this.rnd() * 0.5;
    const side = this.rnd() < 0.5 ? -0.11 : 0.11;
    this.launch(at);
    this.pend(0.06, () => this.launch(at + side, 'bomb'));
  }

  private patternFrenzy() {
    this.say('FRENZY', '#ffd23e');
    sfx.frenzy();
    for (let i = 0; i < 12; i++) {
      const fr = 0.15 + this.rnd() * 0.7;
      this.pend(i * 0.15, () => this.launch(fr));
    }
    this.lastPattern = 'frenzy';
  }

  private pend(delay: number, fn: () => void) {
    this.pending.push({ at: this.gameTime + delay, fn });
  }

  private launch(xFrac: number, special: Special = 'none', vxBias = 0) {
    const h = this.H, w = this.W;
    const kind = special === 'bomb' ? BOMB : special === 'gold' ? GOLD : special === 'ice' ? ICE : this.pickKind();
    const g = h * 1.1;
    const peak = h * (0.55 + this.rnd() * 0.25);
    const x = w * Math.max(0.08, Math.min(0.92, xFrac));
    this.fruits.push({
      kind, special,
      x, y: h + kind.r * h,
      vx: (w * 0.5 - x) * 0.35 + vxBias * w * 0.35 + (this.rnd() - 0.5) * w * 0.08,
      vy: -Math.sqrt(2 * g * peak),
      rot: this.rnd() * Math.PI * 2,
      vr: (this.rnd() - 0.5) * 4.5,
      sliced: false, sliceAngle: 0, sliceAge: 0, halfSep: 0, dead: false,
      hp: kind.hits ?? 1, lastHit: 0,
    });
  }

  private pickKind(): FruitKind {
    let roll = this.rnd() * KIND_WEIGHT;
    for (const k of KINDS) {
      roll -= k.weight;
      if (roll <= 0) return k;
    }
    return KINDS[0];
  }

  private launchBoss() {
    const h = this.H, w = this.W;
    this.say('BOSS', '#ff6ac1');
    sfx.bell();
    sfx.throwUp();
    this.fruits.push({
      kind: BOSS, special: 'boss',
      x: w * (0.35 + this.rnd() * 0.3), y: h + BOSS.r * h,
      vx: (this.rnd() - 0.5) * w * 0.04,
      vy: -h * 0.62,                     // low gravity below makes it hang
      rot: 0, vr: 0.4,
      sliced: false, sliceAngle: 0, sliceAge: 0, halfSep: 0, dead: false,
      hp: BOSS_HP, lastHit: 0,
    });
  }

  // ---- physics --------------------------------------------------------------

  private physics(dt: number) {
    const g = this.H * 1.1;
    for (const f of this.fruits) {
      f.vy += g * dt * (f.special === 'boss' && !f.sliced ? 0.16 : 1);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.sliced) {
        f.sliceAge += dt;
        f.halfSep += this.H * 0.35 * dt;
        if (f.sliceAge > 0.9) f.dead = true;
      }
      if (f.y > this.H + this.H * 0.2) f.dead = true;
    }
    this.fruits = this.fruits.filter((f) => !f.dead);
  }

  // ---- slicing --------------------------------------------------------------

  private slicing(now: number) {
    let slicedThisFrame = 0;
    let cx = 0, cy = 0;
    for (const key of ['L', 'R'] as const) {
      const saber = this.saberRig.data[key];
      if (!saber.visible || !saber.hand || saber.rel < TUNING.fruit.sliceRel) continue;
      for (const f of this.fruits) {
        if (f.sliced || f.dead) continue;
        const r = f.kind.r * this.H;
        let hit = false;
        let angle = saber.angle;
        // the blade itself, hilt to tip
        if (segCircle(saber.hand.x, saber.hand.y, saber.tip.x, saber.tip.y, f.x, f.y, r)) hit = true;
        // plus the tip's swept path since the last frames
        if (!hit) {
          for (let i = saber.tipPts.length - 1; i >= 1; i--) {
            const p1 = saber.tipPts[i - 1], p2 = saber.tipPts[i];
            if (now - p2.t > 90) break;
            if (segCircle(p1.x, p1.y, p2.x, p2.y, f.x, f.y, r)) {
              hit = true;
              angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
              break;
            }
          }
        }
        if (!hit) continue;
        if (f.special === 'boss') { this.hitBoss(f, now, angle); continue; }
        if (f.hp > 1) { this.crackShell(f, now); continue; }
        this.slice(f, angle);
        if (f.special === 'none' || f.special === 'gold') {
          slicedThisFrame++;
          cx += f.x; cy += f.y;
        }
      }
    }
    if (slicedThisFrame >= 3) {
      const label = slicedThisFrame === 3 ? 'TRIPLE' : slicedThisFrame === 4 ? 'QUAD' : 'WILD';
      const bonus = 5 * this.mult();
      this.score += bonus;
      this.say(label, '#ffd23e');
      this.juice.hitStop(60);
      this.juice.ring(cx / slicedThisFrame, cy / slicedThisFrame, '#ffd23e', this.H * 0.16);
      this.juice.pop(cx / slicedThisFrame, cy / slicedThisFrame - this.H * 0.07, `+${bonus}`, '#ffd23e', 1.2);
      sfx.critical();
    }
  }

  private mult(): number {
    const m = this.combo >= 12 ? 4 : this.combo >= 8 ? 3 : this.combo >= 4 ? 2 : 1;
    const finaleBonus = this.goldRush && this.finale !== 'frenzy' ? 2 : 1;
    return m * (this.feverLeft > 0 ? 2 : 1) * finaleBonus;
  }

  /** hard-shelled fruit (coconut) takes a crack before it splits */
  private crackShell(f: Fruit, now: number) {
    if (now - f.lastHit < 140) return;
    f.lastHit = now;
    f.hp--;
    f.vr += (this.rnd() - 0.5) * 6;
    f.vy -= this.H * 0.08;
    this.juice.burst({ x: f.x, y: f.y, count: 7, kind: 'shard', color: [f.kind.rind, '#8a6a4a'], speed: this.H * 0.3, gravity: this.H * 0.6, size: this.H * 0.008, life: 0.5 });
    this.juice.pop(f.x, f.y - f.kind.r * this.H * 1.3, 'CRACK', '#fff7ee', 0.8);
    sfx.crack();
  }

  private hitBoss(f: Fruit, now: number, angle: number) {
    if (now - f.lastHit < 140) return;
    f.lastHit = now;
    f.hp--;
    f.vr = -f.vr + (this.rnd() - 0.5);
    this.juice.burst({ x: f.x, y: f.y, count: 8, color: ['#ffd23e', '#ff5d73'], speed: this.H * 0.3, gravity: this.H * 0.5, size: this.H * 0.006, life: 0.45 });
    this.lastSliceAt = this.gameTime;      // boss mashing keeps the chain alive
    if (f.hp > 0) {
      this.juice.pop(f.x, f.y - f.kind.r * this.H * 1.2, String(f.hp), '#fff7ee');
      sfx.bossHit(BOSS_HP - f.hp);
      return;
    }
    // smashed
    const pts = BOSS.points * this.mult();
    this.score += pts;
    this.fruitCount++;
    this.bossKills++;
    this.fever = Math.min(1, this.fever + 0.35);
    this.slicedVisuals(f, angle);
    this.juice.hitStop(85);
    this.juice.shake(9, 260);
    this.juice.ring(f.x, f.y, '#ff6ac1', this.H * 0.3, 0.5);
    this.juice.burst({ x: f.x, y: f.y, count: 34, color: ['#ffd23e', '#ff5d73', '#ff6ac1'], speed: this.H * 0.55, gravity: this.H * 0.6, size: this.H * 0.007, life: 0.7 });
    this.juice.pop(f.x, f.y - this.H * 0.08, `+${pts}`, '#ffd23e', 1.3);
    this.say('SMASHED', '#ff6ac1');
    sfx.bossDown();
    this.music?.goldSting();
    this.checkFever();
  }

  private slice(f: Fruit, angle: number) {
    if (f.special === 'bomb') return this.hitBomb(f);
    this.combo = this.gameTime - this.lastSliceAt < TUNING.fruit.chainMs / 1000 ? this.combo + 1 : 1;
    this.lastSliceAt = this.gameTime;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.combo === 4 || this.combo === 8 || this.combo === 12) {
      this.say(`COMBO X${this.combo >= 12 ? 4 : this.combo >= 8 ? 3 : 2}`, '#ffd23e');
      sfx.pop(this.combo / 4 + 4);
      this.comboFlashT = 0.5;
    }
    const mult = this.mult();
    const pts = f.kind.points * mult;
    this.score += pts;
    this.fruitCount++;
    this.slicedVisuals(f, angle);
    this.juice.pop(f.x, f.y - f.kind.r * this.H * 1.3, `+${pts}`, mult > 1 ? '#ffd23e' : '#ffffff', mult > 2 ? 1.15 : 1);
    sfx.slice(this.combo, f.kind.name);
    this.music?.pluck(Math.min(14, this.combo), 0.1 + Math.min(0.06, this.combo * 0.005));

    if (f.special === 'gold') {
      this.juice.ring(f.x, f.y, '#ffd23e', this.H * 0.2);
      this.juice.burst({ x: f.x, y: f.y, count: 22, color: ['#ffd23e', '#fff7ee'], speed: this.H * 0.5, size: this.H * 0.006, life: 0.7 });
      this.say('GOLDEN', '#ffd23e');
      sfx.fanfare(false);
      this.fever = Math.min(1, this.fever + 0.3);
    } else if (f.special === 'ice') {
      this.iceT = 2.0;
      this.juice.slowmo(0.45, 2000);
      this.juice.ring(f.x, f.y, '#6ee7ff', this.H * 0.24);
      this.juice.burst({ x: f.x, y: f.y, count: 16, kind: 'shard', color: ['#dff4ff', '#6ee7ff'], speed: this.H * 0.4, gravity: this.H * 0.5, size: this.H * 0.012, life: 0.8 });
      this.say('FREEZE', '#6ee7ff');
      sfx.freeze();
    } else {
      this.fever = Math.min(1, this.fever + 0.055);
    }
    this.checkFever();
  }

  private checkFever() {
    if (this.fever >= 1 && this.feverLeft <= 0) {
      this.feverLeft = FEVER_SECS;
      this.say('FEVER', '#ff6ac1');
      sfx.fanfare(true);
      this.music?.goldSting();
    }
  }

  private slicedVisuals(f: Fruit, angle: number) {
    f.sliced = true;
    f.sliceAngle = angle;
    f.vy -= this.H * 0.12;
    const r = f.kind.r * this.H;
    this.flashes.push({
      x1: f.x - Math.cos(angle) * r * 1.6, y1: f.y - Math.sin(angle) * r * 1.6,
      x2: f.x + Math.cos(angle) * r * 1.6, y2: f.y + Math.sin(angle) * r * 1.6,
      life: 0.15,
    });
    this.stampSplat(f, angle);
    // juice sprays out of the cut faces, along the slice normal both ways;
    // bigger fruit throw bigger splashes
    const scale = f.kind.r / 0.046;
    for (const side of [1, -1]) {
      this.juice.burst({
        x: f.x, y: f.y, count: Math.round(7 * scale),
        color: [f.kind.body, f.kind.body, f.kind.rind],
        angle: angle + (Math.PI / 2) * side, spread: 0.9,
        speed: this.H * 0.4 * scale, gravity: this.H * 0.7,
        size: this.H * 0.007 * scale, life: 0.6,
      });
    }
    // fine mist that hangs a moment
    this.juice.burst({
      x: f.x, y: f.y, count: Math.round(6 * scale), kind: 'dust',
      color: [f.kind.body], speed: this.H * 0.12, gravity: this.H * 0.15,
      size: this.H * 0.005 * scale, life: 0.7,
    });
  }

  private hitBomb(f: Fruit) {
    f.dead = true;
    this.score = Math.max(0, this.score - 10);
    this.combo = 0;
    this.fever *= 0.5;
    this.bombFlash = 0.5;
    this.juice.hitStop(90);
    this.juice.shake(16, 340);
    this.juice.ring(f.x, f.y, '#ff8a2e', this.H * 0.3, 0.5);
    this.juice.burst({ x: f.x, y: f.y, count: 26, color: ['#ffd23e', '#ff8a2e', '#43404d'], speed: this.H * 0.6, gravity: this.H * 0.4, size: this.H * 0.008, life: 0.6 });
    this.juice.pop(f.x, f.y, '-10', '#ff5d5d', 1.2);
    sfx.bomb();
  }

  private stampSplat(f: Fruit, angle: number) {
    const c = this.splatCtx;
    const r = f.kind.r * this.H;
    c.save();
    c.translate(f.x, f.y);
    c.rotate(angle);
    c.fillStyle = f.kind.body;
    c.globalAlpha = 0.26;
    c.beginPath();
    c.ellipse(0, 0, r * 1.3, r * 0.42, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.2;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.7 + Math.random() * 0.9);
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d * 0.5, r * (0.1 + Math.random() * 0.16), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  // ---- timers ---------------------------------------------------------------

  private timers(dt: number, rawDt: number, left: number) {
    if (this.combo > 0 && this.gameTime - this.lastSliceAt > TUNING.fruit.chainMs / 1000) this.combo = 0;
    if (this.feverLeft > 0) this.feverLeft = Math.max(0, this.feverLeft - rawDt);
    if (this.feverLeft === 0 && this.fever >= 1) this.fever = 0;
    this.iceT = Math.max(0, this.iceT - rawDt);
    this.bombFlash = Math.max(0, this.bombFlash - rawDt * 1.6);
    this.comboFlashT = Math.max(0, this.comboFlashT - rawDt);
    this.centerMsg.t = Math.max(0, this.centerMsg.t - rawDt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= rawDt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }
    this.juice.update(dt);
    const sec = Math.ceil(left);
    if (left < 10 && sec !== this.lastTickSec) { this.lastTickSec = sec; sfx.tick(); }
    if (this.splat.width) {
      this.splatCtx.save();
      this.splatCtx.globalCompositeOperation = 'destination-out';
      this.splatCtx.globalAlpha = 0.035;
      this.splatCtx.fillRect(0, 0, this.splat.width, this.splat.height);
      this.splatCtx.restore();
    }
  }

  private say(text: string, color: string) {
    this.centerMsg = { text, color, t: 0.9 };
  }

  // ---- rendering ------------------------------------------------------------

  private draw(ctx: Ctx, now: number, rawDt: number, left: number) {
    const w = this.W, h = this.H;
    if (this.splat.width !== w || this.splat.height !== h) {
      this.splat.width = w; this.splat.height = h;
    }

    const beat = this.music && this.music.beat() > 0 ? this.music.beat() : this.gameTime * 2.2;
    const feverAmt = this.feverLeft > 0 ? Math.min(1, this.feverLeft) : this.fever * 0.25;

    ctx.save();
    this.juice.applyShake(ctx);
    this.arena.update(rawDt, w, h);
    this.arena.draw(ctx, w, h, beat, feverAmt);
    ctx.drawImage(this.splat, 0, 0);

    for (const f of this.fruits) this.drawFruit(ctx, f, now);
    for (const fl of this.flashes) {
      ctx.strokeStyle = '#fff7ee';
      ctx.globalAlpha = fl.life / 0.15;
      ctx.lineWidth = h * 0.006;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fl.x1, fl.y1); ctx.lineTo(fl.x2, fl.y2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.juice.draw(ctx, h);
    this.saberRig.draw(ctx, h, now, this.bladeLen());
    ctx.restore();

    if (this.iceT > 0) {
      ctx.fillStyle = `rgba(110,231,255,${Math.min(0.35, this.iceT) * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.bombFlash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${this.bombFlash * 0.3})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.centerMsg.t > 0) {
      flashText(ctx, w, h, this.centerMsg.text, this.centerMsg.color, Math.min(1, this.centerMsg.t * 2.2), 0.9 + (0.9 - this.centerMsg.t) * 0.2);
    }
    if (this.o.cameraOk && this.o.rig && !this.o.rig.hasPose) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,247,238,0.7)';
      ctx.font = `700 ${h * 0.022}px 'Baloo 2', sans-serif`;
      ctx.fillText('Step back so the camera can see you', w / 2, h * 0.5);
      ctx.restore();
    }
    this.drawHud(ctx, left);
  }

  private drawFruit(ctx: Ctx, f: Fruit, now: number) {
    const r = f.kind.r * this.H;
    if (f.special === 'gold' || (this.goldRush && !f.sliced && f.special === 'none')) {
      drawGlow(ctx, f.x, f.y, r * 2.2, '#ffd23e', 0.45 + Math.sin(now / 130) * 0.15);
    }
    if (f.special === 'ice' && !f.sliced) drawGlow(ctx, f.x, f.y, r * 2, '#6ee7ff', 0.4);
    if (f.special === 'boss' && !f.sliced) drawGlow(ctx, f.x, f.y, r * 1.9, '#ff6ac1', 0.35 + Math.sin(now / 100) * 0.1);

    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.special === 'bomb') {
      ctx.rotate(f.rot * 0.4);
      ctx.fillStyle = '#2c2837';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#43404d';
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a8694';
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.4, -r * 1.4, r * 0.7, -r * 1.2); ctx.stroke();
      const tw = 0.7 + Math.sin(now / 55) * 0.3;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(r * 0.7, -r * 1.2, r * 0.2 * tw, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const th = f.rot * 0.4;
      const gx = f.x + r * 0.7 * Math.cos(th) + r * 1.2 * Math.sin(th);
      const gy = f.y + r * 0.7 * Math.sin(th) - r * 1.2 * Math.cos(th);
      drawGlow(ctx, gx, gy, r * 0.5 * tw, '#ffd23e', 0.9);
      return;
    }
    if (!f.sliced) {
      ctx.rotate(f.rot);
      this.drawWhole(ctx, f, r, now);
    } else {
      for (const half of [-1, 1] as const) {
        ctx.save();
        const off = f.halfSep * half;
        const nx = Math.cos(f.sliceAngle + Math.PI / 2), ny = Math.sin(f.sliceAngle + Math.PI / 2);
        ctx.translate(nx * off, ny * off);
        ctx.rotate(f.sliceAngle + half * (0.14 + f.sliceAge * 0.8));
        ctx.globalAlpha = Math.max(0, 1 - f.sliceAge * 1.15);
        ctx.beginPath();
        ctx.arc(0, 0, r, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
        ctx.closePath();
        ctx.fillStyle = f.kind.body;
        ctx.fill();
        ctx.lineWidth = r * 0.16;
        ctx.strokeStyle = f.kind.rind;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, half === -1 ? Math.PI : 0, half === -1 ? 0 : Math.PI);
        ctx.stroke();
        if (f.kind.seeds) {
          ctx.fillStyle = f.kind.seeds;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(i * r * 0.3, half * r * 0.22, r * 0.05, r * 0.09, i * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawWhole(ctx: Ctx, f: Fruit, r: number, now: number) {
    // per-kind radial gradient, cached per radius bucket (allocation-free frames)
    const key = `${f.kind.name}:${Math.round(r / 4)}`;
    let g = this.bodyGrads.get(key);
    if (!g) {
      g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.2, 0, 0, r * 1.05);
      g.addColorStop(0, lighten(f.kind.rind, 1.3));
      g.addColorStop(1, f.kind.rind);
      this.bodyGrads.set(key, g);
    }
    ctx.fillStyle = g;
    if (f.kind.name === 'star') {
      // starfruit: a fat five-point star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r * 1.05 : r * 0.55;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,247,238,0.5)';
      ctx.lineWidth = r * 0.08;
      ctx.stroke();
      return;
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,247,238,0.5)';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, -2.4, -1.2); ctx.stroke();
    if (f.special === 'boss') {
      // pomegranate: crown + cracks that spread as it takes hits
      ctx.fillStyle = '#8a2444';
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.86);
      ctx.lineTo(-r * 0.18, -r * 1.16);
      ctx.lineTo(0, -r * 0.95);
      ctx.lineTo(r * 0.18, -r * 1.16);
      ctx.lineTo(r * 0.28, -r * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = r * 0.05;
      const cracks = BOSS_HP - f.hp;
      for (let i = 0; i < cracks; i++) {
        const a = (i / BOSS_HP) * Math.PI * 2 + 0.7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
        ctx.lineTo(Math.cos(a + 0.3) * r * 0.6, Math.sin(a + 0.3) * r * 0.6);
        ctx.lineTo(Math.cos(a + 0.15) * r * 0.9, Math.sin(a + 0.15) * r * 0.9);
        ctx.stroke();
      }
      // hp pips
      ctx.fillStyle = 'rgba(255,247,238,0.9)';
      for (let i = 0; i < f.hp; i++) {
        const a = -Math.PI / 2 + (i - (f.hp - 1) / 2) * 0.32;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 1.32, Math.sin(a) * r * 1.32, r * 0.05 * (1 + Math.sin(now / 150) * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (f.special === 'ice') {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = r * 0.06;
      for (const a of [0.4, 1.6, 2.9]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a + 2.3) * r * 0.5, Math.sin(a + 2.3) * r * 0.5);
        ctx.stroke();
      }
      return;
    }
    if (f.special === 'gold') {
      ctx.fillStyle = 'rgba(255,247,238,0.9)';
      for (const [sx, sy, sr] of [[-0.3, -0.42, 0.1], [0.35, 0.15, 0.07], [0.05, 0.4, 0.05]] as const) {
        ctx.beginPath(); ctx.arc(sx * r, sy * r, sr * r, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    ctx.fillStyle = '#2f9e39';
    ctx.beginPath();
    ctx.ellipse(r * 0.25, -r * 0.95, r * 0.3, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#28203a';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, -r * 1.15); ctx.stroke();
    if (f.kind.name === 'melon') {
      ctx.strokeStyle = 'rgba(20,80,40,0.5)';
      ctx.lineWidth = r * 0.1;
      for (const sx of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(sx * r, -r * 0.85);
        ctx.quadraticCurveTo(sx * r * 1.8, 0, sx * r, r * 0.85);
        ctx.stroke();
      }
    }
    if (f.kind.name === 'orange') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (f.kind.name === 'lime') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (f.kind.name === 'pineapple') {
      // crosshatch skin + crown
      ctx.strokeStyle = 'rgba(138,106,26,0.5)';
      ctx.lineWidth = r * 0.06;
      for (const s of [-0.5, 0, 0.5]) {
        for (const dir of [1, -1]) {
          ctx.beginPath();
          ctx.moveTo(-r * 0.8, s * r + dir * -r * 0.5);
          ctx.lineTo(r * 0.8, s * r + dir * r * 0.5);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#39b356';
      for (const [lx, la] of [[-0.22, -0.5], [0, 0], [0.22, 0.5]] as const) {
        ctx.save();
        ctx.translate(lx * r, -r * 0.95);
        ctx.rotate(la);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.25, r * 0.12, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (f.kind.name === 'dragon') {
      // dragonfruit: magenta skin with curling green-tipped scales
      ctx.fillStyle = '#57d95a';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        ctx.save();
        ctx.translate(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.09, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (f.kind.name === 'coconut') {
      // fuzzy husk + the three pores; crack appears after the first hit
      ctx.strokeStyle = 'rgba(74,52,32,0.7)';
      ctx.lineWidth = r * 0.05;
      for (const a of [0.3, 1.5, 2.8, 4.2, 5.4]) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.92, a, a + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#4a3420';
      for (const [px2, py2] of [[-0.2, -0.25], [0.2, -0.25], [0, 0.1]] as const) {
        ctx.beginPath();
        ctx.arc(px2 * r, py2 * r, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((f.kind.hits ?? 1) > f.hp) {
        ctx.strokeStyle = '#f8f4d8';
        ctx.lineWidth = r * 0.07;
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 0.2);
        ctx.lineTo(-r * 0.2, 0);
        ctx.lineTo(r * 0.15, -r * 0.25);
        ctx.lineTo(r * 0.7, 0.05 * r);
        ctx.stroke();
      }
    }
  }

  private drawHud(ctx: Ctx, left: number) {
    const w = this.W, h = this.H;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff7ee';
    ctx.font = `400 ${h * 0.052}px 'Lilita One', sans-serif`;
    ctx.fillText(String(this.score), w * 0.045, h * 0.1);
    ctx.font = `700 ${h * 0.017}px 'Baloo 2', sans-serif`;
    ctx.fillStyle = 'rgba(255,247,238,0.55)';
    ctx.fillText(`BEST ${Math.max(this.best, this.score)}`, w * 0.046, h * 0.135);
    // next medal target keeps a goal on screen the whole round
    if (this.o.medals) {
      const [b, s, g] = this.o.medals;
      const next = this.score < b ? ['BRONZE', b] as const : this.score < s ? ['SILVER', s] as const : this.score < g ? ['GOLD', g] as const : null;
      ctx.font = `700 ${h * 0.015}px 'Baloo 2', sans-serif`;
      if (next) {
        ctx.fillStyle = next[0] === 'GOLD' ? '#ffd23e' : next[0] === 'SILVER' ? '#cfd6e4' : '#d9915b';
        ctx.fillText(`${next[0]} AT ${next[1]}`, w * 0.046, h * 0.162);
      } else {
        ctx.fillStyle = '#ffd23e';
        ctx.fillText('GOLD MEDAL SECURED', w * 0.046, h * 0.162);
      }
    }
    // live rival score in a race
    const rival = this.o.race?.rival();
    if (rival) {
      const ahead = this.score >= rival.score;
      ctx.fillStyle = ahead ? '#7cf95c' : '#ff5d5d';
      ctx.font = `700 ${h * 0.019}px 'Baloo 2', sans-serif`;
      ctx.fillText(`${rival.name} ${rival.score}`, w * 0.046, h * 0.192);
    }
    const cx = w / 2, cy = h * 0.085, r = h * 0.038;
    const urgent = left < 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = h * 0.008;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = urgent ? '#ff5d5d' : '#ffd23e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / ROUND_SECS));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff7ee';
    const pulse = urgent ? 1 + Math.max(0, Math.sin((left % 1) * Math.PI)) * 0.15 : 1;
    ctx.font = `400 ${h * 0.026 * pulse}px 'Lilita One', sans-serif`;
    ctx.fillText(String(Math.ceil(left)), cx, cy + h * 0.01);
    const bw = w * 0.11;
    const lvl = this.feverLeft > 0 ? this.feverLeft / FEVER_SECS : this.fever;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(cx - bw / 2, cy + r + h * 0.02, bw, h * 0.006);
    ctx.fillStyle = this.feverLeft > 0 ? '#ff6ac1' : '#ffd23e';
    ctx.fillRect(cx - bw / 2, cy + r + h * 0.02, bw * Math.min(1, lvl), h * 0.006);
    if (this.feverLeft > 0) {
      ctx.fillStyle = '#ff6ac1';
      ctx.font = `700 ${h * 0.015}px 'Baloo 2', sans-serif`;
      ctx.fillText('FEVER, DOUBLE POINTS', cx, cy + r + h * 0.045);
    } else if (this.goldRush) {
      ctx.fillStyle = this.finale === 'frenzy' ? '#ff6ac1' : '#ffd23e';
      ctx.font = `700 ${h * 0.015}px 'Baloo 2', sans-serif`;
      const label = this.finale === 'goldrush' ? 'GOLD RUSH, DOUBLE POINTS' : this.finale === 'frenzy' ? 'FRENZY FINALE' : 'FINAL BOSSES, DOUBLE POINTS';
      ctx.fillText(label, cx, cy + r + h * 0.045);
    }
    if (this.combo >= 2) {
      ctx.textAlign = 'right';
      const grow = 1 + this.comboFlashT * 0.5;
      ctx.fillStyle = this.combo >= 4 ? '#ffd23e' : '#fff7ee';
      ctx.font = `400 ${h * 0.042 * grow}px 'Lilita One', sans-serif`;
      ctx.fillText(`x${this.combo}`, w * 0.96, h * 0.11);
      ctx.font = `700 ${h * 0.014}px 'Baloo 2', sans-serif`;
      ctx.fillStyle = 'rgba(255,247,238,0.55)';
      ctx.fillText('COMBO', w * 0.958, h * 0.135);
    }
    ctx.restore();
  }
}

// ---- helpers ----------------------------------------------------------------

function segCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(cx - x1, cy - y1) <= r;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) <= r;
}

function lighten(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, ((v >> s) & 255) * f));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function strHash(s: string): number {
  let a = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 16777619);
  }
  return a >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
