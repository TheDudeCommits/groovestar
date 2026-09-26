import * as T from "three";
import { KineticSession, type KineticOpts } from "../core/session";
import type { MotionState } from "../core/input";
import { cutContact } from "../core/input";
import { bladeWorld } from "../render/worlds";
import { block, material, COLORS } from "../render/stage";
import { chart, type BladeNote } from "./charts";
import { sfx } from "../../games/sfx";
import { equippedSaber } from "../core/equipment";
interface Note extends BladeNote {
  object: T.Group;
  state: number;
  hitAt: number;
  split: T.Mesh[];
}
export class KineticBlade extends KineticSession {
  private world;
  private notes: Note[] = [];
  private hands: Record<
    "L" | "R",
    {
      g: T.Group;
      previous: { x: number; y: number } | null;
      trail: T.Line;
      points: T.Vector3[];
    }
  >;
  private beat = 0;
  constructor(o: KineticOpts) {
    super(o, true);
    this.duration = (this.music.track.beats * 60) / this.music.track.bpm;
    this.world = bladeWorld(this.stage);
    this.stage.camera.position.set(0, 1.8, 5.6);
    this.stage.camera.lookAt(0, 1.6, -20);
    const style = equippedSaber();
    const cols = { L: new T.Color(COLORS.blue), R: new T.Color(COLORS.coral) };
    const core = new T.MeshBasicMaterial({ color: 0xffffff });
    const createHand = (side: "L" | "R") => {
      const g = new T.Group();
      this.stage.scene.add(g);
      const m = new T.MeshStandardMaterial({
        color: cols[side],
        emissive: cols[side],
        emissiveIntensity: 3.6,
        metalness: 0.3,
        roughness: 0.25,
      });
      block(g, 0.058, 0.74, 0.058, 0, 0.48, 0, m);
      block(g, 0.022, 0.74, 0.022, 0, 0.48, 0.038, core);
      block(
        g,
        0.085,
        0.25,
        0.085,
        0,
        0,
        0,
        material(
          style.id === "classic"
            ? 0x747f8c
            : new T.Color(side === "L" ? style.deepL : style.deepR).getHex(),
          0.2,
          0.8,
        ),
      );
      for (let i = 0; i < 4; i++)
        block(
          g,
          0.089,
          0.013,
          0.089,
          0,
          -0.08 + i * 0.042,
          0,
          material(0x161b23),
        );
      if (style.id !== "classic") {
        block(
          g,
          0.28,
          0.025,
          0.08,
          0,
          0.12,
          0,
          material(new T.Color(style.ember[0]).getHex(), 0.25, 0.6),
        );
      }
      const flare = new T.PointLight(cols[side], 1.3, 2);
      flare.position.y = 0.14;
      g.add(flare);
      const geometry = new T.BufferGeometry().setFromPoints(
        Array.from({ length: 12 }, () => new T.Vector3()),
      );
      const trail = new T.Line(
        geometry,
        new T.LineBasicMaterial({
          color: cols[side],
          transparent: true,
          opacity: 0.6,
        }),
      );
      this.stage.scene.add(trail);
      return { g, previous: null, trail, points: [] };
    };
    this.hands = { L: createHand("L"), R: createHand("R") };
    const materials = {
      L: new T.MeshStandardMaterial({
        color: COLORS.blue,
        emissive: COLORS.blue,
        emissiveIntensity: 0.3,
        roughness: 0.2,
        metalness: 0.45,
      }),
      R: new T.MeshStandardMaterial({
        color: COLORS.coral,
        emissive: COLORS.coral,
        emissiveIntensity: 0.3,
        roughness: 0.2,
        metalness: 0.45,
      }),
    };
    const glyphs = ["↓", "↑", "→", "←"];
    const arrows = glyphs.map((glyph) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const c = cv.getContext("2d")!;
      c.font = "bold 105px Arial";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#fff";
      c.fillText(glyph, 64, 66);
      const texture = new T.CanvasTexture(cv);
      return new T.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
    });
    this.notes = chart(
      this.music.track.beats,
      this.seed,
      this.config.difficulty,
      o.track ?? 0,
    ).map((n) => {
      const object = new T.Group();
      this.stage.scene.add(object);
      const split = [-0.145, 0.145].map((x) =>
        block(object, 0.282, 0.54, 0.5, x, 0, 0, materials[n.side]),
      );
      const arrow = new T.Mesh(new T.PlaneGeometry(0.42, 0.42), arrows[n.dir]);
      arrow.position.z = 0.258;
      object.add(arrow);
      object.visible = false;
      return { ...n, object, state: 0, hitAt: 0, split };
    });
  }
  protected step(dt: number, t: number, input: MotionState) {
    this.beat = this.music.beat(t);
    this.world.update(this.beat, this.config.reducedMotion);
    for (const side of ["L", "R"] as const) {
      const h = this.hands[side];
      const sample = this.input.rig.hand(side);
      const next = this.notes.find(
        (n) => n.side === side && n.state === 0 && n.beat >= this.beat - 0.35,
      );
      let x = side === "L" ? 0.34 : 0.66,
        y = 0.6;
      if (this.options.cameraOk) {
        h.g.visible = !!sample && sample.vis > 0.5;
        h.trail.visible = h.g.visible;
        if (sample) {
          x = sample.x;
          y = sample.y;
        }
      } else if (next) {
        const k = Math.max(-1, Math.min(1, (this.beat - next.beat) * 5));
        const target = this.stage.project(
          new T.Vector3(
            side === "L" ? -0.82 : 0.82,
            next.height ? 2 : 1.08,
            0.85,
          ),
        );
        x = target.x;
        y = target.y + 0.16;
        if (next.dir === 0) y += k * 0.13;
        else if (next.dir === 1) y -= k * 0.13;
        else x += k * 0.13 * (next.dir === 2 ? 1 : -1);
      }
      const v = this.stage.unproject(x, y, 0.85);
      h.g.position.copy(v);
      const angle =
        this.options.cameraOk && sample
          ? Math.atan2(sample.vy, sample.vx)
          : Math.sin(t * 5) * 0.5;
      h.g.rotation.z = -angle * 0.3 + (side === "L" ? 0.17 : -0.17);
      h.points.unshift(v.clone().add(new T.Vector3(0, 0.82, 0)));
      h.points = h.points.slice(0, 12);
      h.trail.geometry.setFromPoints(h.points.length > 1 ? h.points : [v, v]);
      h.g.updateWorldMatrix(true, true);
      const tip = this.stage.project(
        h.g.localToWorld(new T.Vector3(0, 0.85, 0)),
      );
      const base = this.stage.project(
        h.g.localToWorld(new T.Vector3(0, 0.12, 0)),
      );
      for (const n of this.notes) {
        if (n.side !== side || n.state) continue;
        const d = this.beat - n.beat;
        if (d < -0.32 || d > 0.38) continue;
        const p = this.stage.project(
          new T.Vector3(
            n.side === "L" ? -0.82 : 0.82,
            n.height ? 2 : 1.08,
            0.8 + d * 4.4,
          ),
        );
        let contact = !this.options.cameraOk && d >= 0;
        if (
          this.options.cameraOk &&
          sample &&
          h.previous &&
          input.fresh &&
          sample.vis > 0.55 &&
          sample.rel > 1.2
        ) {
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
          this.hit(
            Math.abs(d) < 0.13 ? 100 : 70,
            Math.abs(d) < 0.13 ? "PERFECT CUT" : "GOOD CUT",
          );
          sfx.slice(this.combo);
        }
      }
      if (input.fresh || !this.options.cameraOk) h.previous = tip;
    }
    for (const n of this.notes) {
      const d = n.beat - this.beat;
      n.object.visible = d < 7 && d > -0.7;
      if (!n.object.visible) continue;
      n.object.position.set(
        n.side === "L" ? -0.82 : 0.82,
        n.height ? 2.0 : 1.08,
        0.8 - d * 4.4,
      );
      if (n.state === 0 && d < -0.38) {
        n.state = 2;
        this.miss();
      }
      if (n.state === 1) {
        const k = (t - n.hitAt) * 4;
        n.object.children[2].visible = false;
        n.split.forEach((p, i) => {
          p.position.x = (i ? 1 : -1) * (0.145 + k * 0.45);
          p.position.y = -k * k * 0.2;
          p.rotation.z = (i ? 1 : -1) * k;
        });
        n.object.scale.setScalar(Math.max(0, 1 - k * 0.35));
      } else if (n.state === 2) n.object.visible = false;
    }
  }
  protected hint() {
    return this.options.cameraOk
      ? "LEFT · BLUE     /     RIGHT · CORAL"
      : super.hint();
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
