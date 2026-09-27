import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { cutContact } from "../core/input";
import { bladeArena, BLADE_BLUE, BLADE_RED } from "../render/pt/blade-arena";
import { chart, type BladeNote } from "./charts";
import { sfx } from "../../games/sfx";
import { equippedSaber } from "../core/equipment";
import { RibbonTrail } from "../render/trail";
import { softDot } from "../render/pt/palette";
interface Note extends BladeNote {
  object: T.Group;
  whole: T.Mesh;
  arrow: T.Mesh;
  state: number;
  hitAt: number;
  split: T.Mesh[];
  splitH: T.Mesh[];
  spin: number;
  hitZ: number;
}
const HAND_COLOR = { L: BLADE_BLUE, R: BLADE_RED };

/** Note material: dark glossy body in the hand color with blazing edges. */
function crystal(color: number) {
  const m = new T.MeshStandardMaterial({
    color: new T.Color(color).multiplyScalar(0.55),
    emissive: new T.Color(color),
    emissiveIntensity: 0.6,
    roughness: 0.22,
    metalness: 0.35,
  });
  m.defines = { USE_UV: "" };
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        vec2 e = min(vUv, 1.0 - vUv);
        float d = min(e.x, e.y);
        float edge = 1.0 - smoothstep(0.0, 0.07, d);
        float inner = smoothstep(0.5, 0.0, length(vUv - 0.5));
        totalEmissiveRadiance *= 0.34 + edge * 5.0 + inner * 0.25;
      }`,
    );
  };
  m.customProgramCacheKey = () => "pt-note2";
  return m;
}

/** Soft glow around a saber blade, brightest down its middle. */
function bladeGlow(color: T.Color) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    uniforms: { uColor: { value: color }, uK: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float c = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(uColor * c * uK, 1.0);
      }`,
  });
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
    super(o, { fog: 0x03020c, fogDensity: 0.012, bloom: 0.95, bloomRadius: 0.55, bloomThreshold: 0.72, vignette: 0.6, exposure: 1.0 });
    this.duration = (this.music.track.beats * 60) / this.music.track.bpm;
    this.world = bladeArena(this.stage, this.show);
    this.show.onLevel((_, up) => up && this.world.moment());
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
      // Blade: a white-hot core inside a soft colored glow.
      const core = new T.Mesh(new T.CapsuleGeometry(0.014, 0.98, 4, 10), new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).lerp(col, 0.25).multiplyScalar(3.2) }));
      core.position.y = 0.68;
      g.add(core);
      const glow = new T.Mesh(new T.CapsuleGeometry(0.075, 0.98, 4, 16), bladeGlow(col.clone().multiplyScalar(2.6)));
      glow.position.y = 0.68;
      g.add(glow);
      const tip = new T.Sprite(new T.SpriteMaterial({ map: softDot(), color: col.clone().multiplyScalar(2), blending: T.AdditiveBlending, depthWrite: false }));
      tip.scale.setScalar(0.34);
      tip.position.y = 0.19;
      g.add(tip);
      const flare = new T.PointLight(col, 2.2, 3);
      flare.position.y = 0.5;
      g.add(flare);
      const trail = new RibbonTrail(col.clone().multiplyScalar(1.1), 12);
      this.stage.scene.add(trail.mesh);
      return { g, previous: null, trail, glow, tip };
    };
    this.hands = { L: createHand("L"), R: createHand("R") };
    const materials = { L: crystal(BLADE_BLUE), R: crystal(BLADE_RED) };
    const arrows = [0, Math.PI, -Math.PI / 2, Math.PI / 2].map(
      (rot) =>
        new T.MeshBasicMaterial({
          map: arrowTexture(rot),
          color: new T.Color(1, 1, 1).multiplyScalar(2.2),
          transparent: true,
          depthWrite: false,
        }),
    );
    const wholeGeo = new RoundedBoxGeometry(0.6, 0.6, 0.6, 3, 0.08);
    const halfGeo = new RoundedBoxGeometry(0.298, 0.6, 0.6, 2, 0.06);
    const halfGeoH = new RoundedBoxGeometry(0.6, 0.298, 0.6, 2, 0.06);
    const arrowGeo = new T.PlaneGeometry(0.46, 0.46);
    this.notes = chart(this.music.track.beats, this.seed, this.config.difficulty, o.track ?? 0).map((n) => {
      const object = new T.Group();
      this.stage.scene.add(object);
      const whole = new T.Mesh(wholeGeo, materials[n.side]);
      object.add(whole);
      const split = [-0.155, 0.155].map((x) => {
        const h = new T.Mesh(halfGeo, materials[n.side]);
        h.position.x = x;
        h.visible = false;
        object.add(h);
        return h;
      });
      const splitH = [-0.155, 0.155].map((y) => {
        const h = new T.Mesh(halfGeoH, materials[n.side]);
        h.position.y = y;
        h.visible = false;
        object.add(h);
        return h;
      });
      const arrow = new T.Mesh(arrowGeo, arrows[n.dir]);
      arrow.position.z = 0.306;
      object.add(arrow);
      object.visible = false;
      return { ...n, object, whole, arrow, state: 0, hitAt: 0, split, splitH, spin: 0, hitZ: 0 };
    });
  }
  private cutFx(n: Note, t: number, quality: number) {
    const at = n.object.position.clone();
    const col = HAND_COLOR[n.side];
    const vertical = n.dir < 2;
    const swing = new T.Vector3(vertical ? 0 : n.dir === 2 ? 1 : -1, vertical ? (n.dir === 0 ? -1 : 1) : 0, 0);
    this.world.sparks.emit(at, col, 60, 7, 0.75, swing.clone().multiplyScalar(0.8));
    this.world.sparks.emit(at, 0xffffff, 22, 4, 0.4);
    // slash: a white-hot streak along the cut
    const slash = new T.Mesh(
      new T.PlaneGeometry(1.7, 0.07),
      new T.MeshBasicMaterial({ color: new T.Color(1, 1, 1).lerp(new T.Color(col), 0.35).multiplyScalar(3.2), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    );
    slash.position.copy(at);
    slash.position.z += 0.32;
    slash.rotation.z = vertical ? Math.PI / 2 : 0;
    this.stage.scene.add(slash);
    this.rings.push({ mesh: slash, t });
    this.world.cut(n.side, quality);
    this.shake = Math.min(1, this.shake + 0.3);
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.beat = this.music.beat(t);
    let sec: "intro" | "verse" | "chorus" | "bridge" | "outro" = "intro";
    for (const x of this.music.track.sections) if (this.beat >= x.beat) sec = x.kind;
    this.world.section = sec;
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
      const tipWorld = h.g.localToWorld(new T.Vector3(0, 1.16, 0)),
        baseWorld = h.g.localToWorld(new T.Vector3(0, 0.26, 0));
      if (h.g.visible) h.trail.push(baseWorld, tipWorld);
      (h.glow.material as T.ShaderMaterial).uniforms.uK.value = 0.85 + this.show.pulse * 0.35;
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
          n.hitZ = n.object.position.z;
          this.hit(Math.abs(d) < 0.13 ? 100 : 70, Math.abs(d) < 0.13 ? "PERFECT" : "GREAT");
          sfx.slice(this.combo);
          this.cutFx(n, t, Math.abs(d) < 0.13 ? 1 : 0.6);
        }
      }
      if (input.fresh || !this.options.cameraOk) h.previous = tip;
    }
    for (const n of this.notes) {
      const d = n.beat - this.beat;
      n.object.visible = d < 7 && (n.state === 1 ? t - n.hitAt < 0.9 : d > -0.7);
      if (!n.object.visible) continue;
      // cut halves drift on slowly instead of flying into the camera
      const z = n.state === 1 ? n.hitZ + (t - n.hitAt) * 1.2 : 0.8 - d * 4.4;
      n.object.position.set(n.side === "L" ? -0.82 : 0.82, n.height ? 2.0 : 1.08, z);
      if (n.state === 0) {
        // Notes spin into place as they approach, then face the player squarely.
        const approach = Math.max(0, Math.min(1, d / 6));
        n.object.rotation.set(approach * 0.6, approach * 1.4, 0);
        n.object.scale.setScalar(1 + Math.max(0, 1 - Math.abs(d)) * this.show.pulse * 0.06);
      }
      if (n.state === 0 && d < -0.38) {
        n.state = 2;
        this.world.miss();
        this.miss("MISS");
      }
      if (n.state === 1) {
        const k = (t - n.hitAt) * 3.2;
        n.whole.visible = false;
        n.arrow.visible = false;
        const vertical = n.dir < 2;
        (vertical ? n.split : n.splitH).forEach((p, i) => {
          const s = i ? 1 : -1;
          p.visible = true;
          if (vertical) {
            p.position.set(s * (0.155 + k * 0.75), -k * k * 0.35, k * 0.2);
            p.rotation.set(k * 1.4, 0, -s * k * 1.8);
          } else {
            p.position.set(k * 0.1 * s, s * (0.155 + k * 0.6) - k * k * 0.45, k * 0.2);
            p.rotation.set(s * k * 1.6, k * 0.6, 0);
          }
        });
        n.object.scale.setScalar(Math.max(0, 1 - k * 0.22));

      } else if (n.state === 2) n.object.visible = false;
    }
    this.rings = this.rings.filter((r) => {
      const age = t - r.t;
      if (age > 0.22) {
        r.mesh.removeFromParent();
        r.mesh.geometry.dispose();
        (r.mesh.material as T.Material).dispose();
        return false;
      }
      r.mesh.scale.set(1 + age * 4, 1 - age * 3, 1);
      (r.mesh.material as T.MeshBasicMaterial).opacity = 1 - age / 0.22;
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
  protected diagnostics() {
    return {
      beat: this.beat,
      notes: this.notes.length,
      liveNotes: this.notes.filter((n) => n.object.visible).length,
      track: this.music.track.id,
    };
  }
}
