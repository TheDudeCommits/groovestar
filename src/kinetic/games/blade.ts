import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { cutContact } from "../core/input";
import { bladeVenue } from "../render/pt/blade-venue";
import { chart, type BladeNote } from "./charts";
import { sfx } from "../../games/sfx";
import { equippedSaber } from "../core/equipment";
import { RibbonTrail } from "../render/trail";
import { PT, softDot } from "../render/pt/palette";
interface Note extends BladeNote {
  object: T.Group;
  whole: T.Mesh;
  arrow: T.Mesh;
  state: number;
  hitAt: number;
  split: T.Mesh[];
}
const HAND_COLOR = { L: PT.left, R: PT.right };

/** Crystal note material: glassy body, glowing bevel edges, bright core. */
function crystal(color: number) {
  const m = new T.MeshStandardMaterial({
    color: new T.Color(color).multiplyScalar(0.1),
    emissive: new T.Color(color),
    emissiveIntensity: 0.42,
    roughness: 0.38,
    metalness: 0.15,
  });
  m.defines = { USE_UV: "" };
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.0, 0.09, min(e.x, e.y));
        float inner = 1.0 - smoothstep(0.1, 0.5, length(vUv - 0.5));
        totalEmissiveRadiance *= 0.5 + edge * 3.4 + inner * 0.5;
      }`,
    );
  };
  m.customProgramCacheKey = () => "pt-crystal";
  return m;
}

/** A bold chevron arrow with a soft glow, drawn once per direction. */
function arrowTexture(rot: number) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d")!;
  c.translate(128, 128);
  c.rotate(rot);
  const path = () => {
    c.beginPath();
    c.moveTo(-70, -34);
    c.lineTo(0, 40);
    c.lineTo(70, -34);
  };
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = "rgba(255,255,255,0.35)";
  c.lineWidth = 64;
  c.filter = "blur(10px)";
  path();
  c.stroke();
  c.filter = "none";
  c.strokeStyle = "#fff";
  c.lineWidth = 34;
  path();
  c.stroke();
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

export class KineticBlade extends KineticSession {
  private world;
  private notes: Note[] = [];
  private hands: Record<
    "L" | "R",
    { g: T.Group; previous: { x: number; y: number } | null; trail: RibbonTrail; glow: T.Mesh; tip: T.Sprite }
  >;
  private rings: { mesh: T.Mesh; t: number }[] = [];
  private beat = 0;
  private shake = 0;
  constructor(o: KineticOpts) {
    super(o, { fog: 0x0c0620, fogDensity: 0.014, bloom: 0.6, bloomRadius: 0.42, bloomThreshold: 0.85, vignette: 0.55, exposure: 0.95 });
    this.duration = (this.music.track.beats * 60) / this.music.track.bpm;
    this.world = bladeVenue(this.stage, this.show);
    this.stage.camera.position.set(0, 1.8, 5.6);
    this.stage.camera.lookAt(0, 1.6, -20);
    const style = equippedSaber();
    const metal = new T.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.3, metalness: 0.9 });
    const createHand = (side: "L" | "R") => {
      const g = new T.Group();
      this.stage.scene.add(g);
      const col = new T.Color(HAND_COLOR[side]);
      // Hilt: grip, colored guard ring and pommel.
      const grip = new T.Mesh(new T.CylinderGeometry(0.036, 0.04, 0.26, 16), metal);
      g.add(grip);
      const deep = style.id === "classic" ? col.clone() : new T.Color(side === "L" ? style.deepL : style.deepR);
      const accent = new T.MeshStandardMaterial({ color: deep, emissive: deep, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.6 });
      for (const y of [-0.08, 0.02]) {
        const band = new T.Mesh(new T.TorusGeometry(0.041, 0.008, 8, 20), accent);
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        g.add(band);
      }
      const guard = new T.Mesh(new T.CylinderGeometry(0.052, 0.044, 0.05, 16), metal);
      guard.position.y = 0.15;
      g.add(guard);
      const emitter = new T.Mesh(new T.TorusGeometry(0.046, 0.01, 8, 24), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(4) }));
      emitter.rotation.x = Math.PI / 2;
      emitter.position.y = 0.176;
      g.add(emitter);
      // Blade: hot white core inside a colored glow shell.
      const core = new T.Mesh(new T.CapsuleGeometry(0.011, 0.74, 4, 10), new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).lerp(col, 0.5).multiplyScalar(1.7) }));
      core.position.y = 0.56;
      g.add(core);
      const glow = new T.Mesh(
        new T.CapsuleGeometry(0.038, 0.74, 4, 12),
        new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }),
      );
      glow.position.y = 0.56;
      g.add(glow);
      const tip = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: col.clone().multiplyScalar(2), blending: T.AdditiveBlending, depthWrite: false }));
      tip.scale.setScalar(0.34);
      tip.position.y = 0.19;
      g.add(tip);
      const flare = new T.PointLight(col, 2.2, 3);
      flare.position.y = 0.5;
      g.add(flare);
      const trail = new RibbonTrail(col.clone().multiplyScalar(1.5), 18);
      this.stage.scene.add(trail.mesh);
      return { g, previous: null, trail, glow, tip };
    };
    this.hands = { L: createHand("L"), R: createHand("R") };
    const materials = { L: crystal(PT.left), R: crystal(PT.right) };
    const arrows = [0, Math.PI, -Math.PI / 2, Math.PI / 2].map(
      (rot) =>
        new T.MeshBasicMaterial({
          map: arrowTexture(rot),
          color: new T.Color(1, 1, 1).multiplyScalar(2.2),
          transparent: true,
          depthWrite: false,
        }),
    );
    const wholeGeo = new RoundedBoxGeometry(0.56, 0.54, 0.5, 3, 0.07);
    const halfGeo = new RoundedBoxGeometry(0.278, 0.54, 0.5, 2, 0.05);
    const arrowGeo = new T.PlaneGeometry(0.44, 0.44);
    this.notes = chart(this.music.track.beats, this.seed, this.config.difficulty, o.track ?? 0).map((n) => {
      const object = new T.Group();
      this.stage.scene.add(object);
      const whole = new T.Mesh(wholeGeo, materials[n.side]);
      object.add(whole);
      const split = [-0.145, 0.145].map((x) => {
        const h = new T.Mesh(halfGeo, materials[n.side]);
        h.position.x = x;
        h.visible = false;
        object.add(h);
        return h;
      });
      const arrow = new T.Mesh(arrowGeo, arrows[n.dir]);
      arrow.position.z = 0.256;
      object.add(arrow);
      object.visible = false;
      return { ...n, object, whole, arrow, state: 0, hitAt: 0, split };
    });
  }
  private cutFx(n: Note, t: number) {
    const at = n.object.position.clone();
    const col = HAND_COLOR[n.side];
    this.world.sparks.emit(at, col, 46, 6.5, 0.7);
    this.world.sparks.emit(at, 0xffffff, 14, 3.5, 0.35);
    const ring = new T.Mesh(
      new T.RingGeometry(0.2, 0.26, 48),
      new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(3), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    );
    ring.position.copy(at);
    this.stage.scene.add(ring);
    this.rings.push({ mesh: ring, t });
    this.shake = Math.min(1, this.shake + 0.35);
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.beat = this.music.beat(t);
    this.world.update(t, this.config.reducedMotion);
    for (const side of ["L", "R"] as const) {
      const h = this.hands[side];
      const sample = this.input.rig.hand(side);
      const next = this.notes.find((n) => n.side === side && n.state === 0 && n.beat >= this.beat - 0.35);
      let x = side === "L" ? 0.34 : 0.66,
        y = 0.6;
      if (this.options.cameraOk) {
        h.g.visible = !!sample && sample.vis > 0.5;
        h.trail.mesh.visible = h.g.visible;
        if (!h.g.visible) h.trail.clear();
        if (sample) {
          x = sample.x;
          y = sample.y;
        }
      } else if (next) {
        const k = Math.max(-1, Math.min(1, (this.beat - next.beat) * 5));
        const target = this.stage.project(new T.Vector3(side === "L" ? -0.82 : 0.82, next.height ? 2 : 1.08, 0.85));
        x = target.x;
        y = target.y + 0.16;
        if (next.dir === 0) y += k * 0.13;
        else if (next.dir === 1) y -= k * 0.13;
        else x += k * 0.13 * (next.dir === 2 ? 1 : -1);
      }
      const v = this.stage.unproject(x, y, 0.85);
      h.g.position.copy(v);
      const angle = this.options.cameraOk && sample ? Math.atan2(sample.vy, sample.vx) : Math.sin(t * 5) * 0.5;
      h.g.rotation.z = -angle * 0.3 + (side === "L" ? 0.17 : -0.17);
      h.g.updateWorldMatrix(true, true);
      const tipWorld = h.g.localToWorld(new T.Vector3(0, 0.92, 0)),
        baseWorld = h.g.localToWorld(new T.Vector3(0, 0.22, 0));
      if (h.g.visible) h.trail.push(baseWorld, tipWorld);
      (h.glow.material as T.MeshBasicMaterial).opacity = 0.45 + this.show.pulse * 0.25;
      const tip = this.stage.project(tipWorld);
      const base = this.stage.project(h.g.localToWorld(new T.Vector3(0, 0.12, 0)));
      for (const n of this.notes) {
        if (n.side !== side || n.state) continue;
        const d = this.beat - n.beat;
        if (d < -0.32 || d > 0.38) continue;
        const p = this.stage.project(new T.Vector3(n.side === "L" ? -0.82 : 0.82, n.height ? 2 : 1.08, 0.8 + d * 4.4));
        let contact = !this.options.cameraOk && d >= 0;
        if (this.options.cameraOk && sample && h.previous && input.fresh && sample.vis > 0.55 && sample.rel > 1.2) {
          contact = cutContact({
            base,
            tip,
            previous: h.previous,
            target: p,
            aspect: this.stage.camera.aspect,
            dir: n.dir,
            vx: sample.vx,
            vy: sample.vy,
            speed: sample.rel,
            visibility: sample.vis,
            fresh: input.fresh,
            delta: d,
          });
        }
        if (contact) {
          n.state = 1;
          n.hitAt = t;
          this.hit(Math.abs(d) < 0.13 ? 100 : 70, Math.abs(d) < 0.13 ? "PERFECT" : "GREAT");
          sfx.slice(this.combo);
          this.cutFx(n, t);
        }
      }
      if (input.fresh || !this.options.cameraOk) h.previous = tip;
    }
    for (const n of this.notes) {
      const d = n.beat - this.beat;
      n.object.visible = d < 7 && d > -0.7;
      if (!n.object.visible) continue;
      n.object.position.set(n.side === "L" ? -0.82 : 0.82, n.height ? 2.0 : 1.08, 0.8 - d * 4.4);
      if (n.state === 0) {
        // Notes spin into place as they approach, then face the player squarely.
        const approach = Math.max(0, Math.min(1, d / 6));
        n.object.rotation.set(approach * 0.6, approach * 1.4, 0);
        n.object.scale.setScalar(1 + Math.max(0, 1 - Math.abs(d)) * this.show.pulse * 0.06);
      }
      if (n.state === 0 && d < -0.38) {
        n.state = 2;
        this.miss("MISS");
      }
      if (n.state === 1) {
        const k = (t - n.hitAt) * 4;
        n.whole.visible = false;
        n.arrow.visible = false;
        n.split.forEach((p, i) => {
          p.visible = true;
          p.position.x = (i ? 1 : -1) * (0.145 + k * 0.5);
          p.position.y = -k * k * 0.25;
          p.rotation.z = (i ? -1 : 1) * k * 1.2;
          p.rotation.x = k * 0.8;
        });
        n.object.scale.setScalar(Math.max(0, 1 - k * 0.3));
      } else if (n.state === 2) n.object.visible = false;
    }
    this.rings = this.rings.filter((r) => {
      const age = t - r.t;
      if (age > 0.45) {
        r.mesh.removeFromParent();
        r.mesh.geometry.dispose();
        (r.mesh.material as T.Material).dispose();
        return false;
      }
      r.mesh.scale.setScalar(1 + age * 9);
      (r.mesh.material as T.MeshBasicMaterial).opacity = 1 - age / 0.45;
      return true;
    });
    // Camera: a gentle drift, plus a small kick on every cut.
    this.shake = Math.max(0, this.shake - dt * 4);
    const cam = this.stage.camera;
    const reduced = this.config.reducedMotion;
    cam.position.set(
      (reduced ? 0 : Math.sin(t * 0.35) * 0.06) + (reduced ? 0 : (Math.random() - 0.5) * this.shake * 0.04),
      1.8 + (reduced ? 0 : (Math.random() - 0.5) * this.shake * 0.03),
      5.6,
    );
    cam.lookAt(0, 1.6, -20);
  }
  protected hint() {
    return this.options.cameraOk ? "LEFT HAND · BLUE      RIGHT HAND · CORAL" : super.hint();
  }
  protected diagnostics() {
    return {
      beat: this.beat,
      notes: this.notes.length,
      liveNotes: this.notes.filter((n) => n.object.visible).length,
      track: this.music.track.id,
    };
  }
}
