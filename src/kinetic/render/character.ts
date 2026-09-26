import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { HandRig } from "../../pose/rig";
import type { Pose } from "../../moves";
import { forward } from "../../moves";
import { outfit } from "../core/equipment";
import type { StyleProfile } from "../../appearance";
const cache = new Map<string, Promise<GLTF>>();
export class Character {
  readonly group = new T.Group();
  private model?: T.Object3D;
  private mixer?: T.AnimationMixer;
  private actions = new Map<string, T.AnimationAction>();
  private current = "";
  private bones = new Map<string, T.Bone>();
  private rest = new Map<string, T.Quaternion>();
  private alive = true;
  groundY = 0;
  private standingY: number | null = null;
  private footRest = new Map<string, T.Quaternion>();
  ready = false;
  async load(id = "nova") {
    this.ready = false;
    const key = `/models/${id}.glb`;
    let promise = cache.get(key);
    if (!promise) {
      promise = new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(key);
      cache.set(key, promise);
    }
    const gltf = await promise;
    if (!this.alive) return;
    this.model = clone(gltf.scene);
    this.model.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone();
      }
      if (o instanceof T.Bone) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, o.quaternion.clone());
      }
    });
    this.group.add(this.model);
    this.mixer = new T.AnimationMixer(this.model);
    for (const c of gltf.animations) {
      const name = ["Idle", "Run", "Dance", "Guard", "Celebrate"].find((n) =>
        c.name.startsWith(n),
      );
      if (name && !this.actions.has(name))
        this.actions.set(name, this.mixer.clipAction(c));
    }
    this.group.updateWorldMatrix(true, true);
    for (const n of ["FootL", "FootR"]) {
      const b = this.bones.get(n);
      if (b) this.footRest.set(n, b.getWorldQuaternion(new T.Quaternion()));
    }
    const kit = outfit();
    if (kit.id !== "studio")
      this.model.traverse((o) => {
        if (o instanceof T.Mesh) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if (
              m instanceof T.MeshStandardMaterial &&
              m.name.replace(/\.\d+$/, "") === "cream"
            )
              m.color.set(kit.color);
        }
      });
    this.ready = true;
    this.play("Idle");
  }
  play(name: string) {
    if (name === this.current) return;
    this.actions.get(this.current)?.fadeOut(0.18);
    this.actions.get(name)?.reset().fadeIn(0.18).play();
    this.current = name;
  }
  update(dt: number) {
    this.mixer?.update(dt);
  }
  tint(colors: {
    skin?: string;
    top?: string;
    bottom?: string;
    hair?: string;
  }) {
    this.model?.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!(m instanceof T.MeshStandardMaterial)) continue;
        const map: Record<string, string | undefined> = {
          skin: colors.skin,
          accent: colors.top,
          pants: colors.bottom,
          hair: colors.hair,
        };
        const c = map[m.name.replace(/\.\d+$/, "")];
        if (c) m.color.set(c);
      }
    });
  }
  applyLook(style: StyleProfile) {
    this.tint({
      skin: style.skin,
      top: style.top,
      bottom: style.bottom,
      hair: style.hair,
    });
    const clamp = (x: number, min: number, max: number) =>
      Math.max(min, Math.min(max, x));
    const head = this.bones.get("Head");
    if (head) head.scale.setScalar(clamp(style.body.headScale, 0.85, 1.2));
    const build = clamp(style.body.buildScale, 0.85, 1.15);
    this.group.scale.x = build;
  }
  private pointBone(
    name: string,
    from: T.Vector3,
    to: T.Vector3,
    blend = 0.45,
  ) {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent) return;
    const dir = to.clone().sub(from);
    if (dir.length() < 0.025) return;
    const parentQ = bone.parent.getWorldQuaternion(new T.Quaternion());
    const q = new T.Quaternion().setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      dir.normalize(),
    );
    q.premultiply(parentQ.invert());
    bone.quaternion.slerp(q, blend);
    bone.updateWorldMatrix(false, true);
  }
  tracked(rig: HandRig) {
    if (!this.ready || !rig.hasPose) return;
    this.mixer?.stopAllAction();
    this.current = "";
    this.group.updateWorldMatrix(true, true);
    const h = rig.hips();
    if (!h) return;
    const torso = Math.max(0.1, rig.torso);
    const p = (name: Parameters<HandRig["joint"]>[0]) => {
      const j = rig.joint(name);
      return j && j.vis > 0.45
        ? new T.Vector3(
            (((j.x - h.x) * rig.aspect) / torso) * 0.46,
            1.01 - ((j.y - h.y) / torso) * 0.46,
            name.startsWith("wr")
              ? 0.12 +
                ((name.endsWith("L") && j.x > h.x) ||
                (name.endsWith("R") && j.x < h.x)
                  ? 0.22
                  : 0)
              : name.startsWith("el")
                ? 0.07
                : 0,
          )
        : null;
    };
    const segments: [
      string,
      Parameters<HandRig["joint"]>[0],
      Parameters<HandRig["joint"]>[0],
    ][] = [
      ["UpperArmR", "shL", "elL"],
      ["LowerArmR", "elL", "wrL"],
      ["UpperArmL", "shR", "elR"],
      ["LowerArmL", "elR", "wrR"],
      ["ThighR", "hipL", "kneeL"],
      ["ShinR", "kneeL", "ankleL"],
      ["ThighL", "hipR", "kneeR"],
      ["ShinL", "kneeR", "ankleR"],
    ];
    for (const [bn, a, b] of segments) {
      const pa = p(a),
        pb = p(b);
      if (pa && pb) this.pointBone(bn, pa, pb, 0.65);
      else {
        const bone = this.bones.get(bn),
          rest = this.rest.get(bn);
        if (bone && rest) bone.quaternion.slerp(rest, 0.08);
      }
    }
    this.plantFeet();
    this.standingY ??= h.y;
    this.group.position.y += Math.max(
      0,
      Math.min(0.3, ((this.standingY - h.y) / torso) * 0.46 - 0.04),
    );
    const a = p("shL"),
      b = p("shR");
    if (a && b) {
      const chest = this.bones.get("Chest");
      if (chest)
        chest.quaternion.slerp(
          new T.Quaternion().setFromEuler(
            new T.Euler(
              0,
              0,
              Math.max(
                -0.35,
                Math.min(0.35, Math.atan2(b.y - a.y, Math.abs(b.x - a.x))),
              ),
            ),
          ),
          0.1,
        );
    }
  }
  private plantFeet() {
    this.group.updateWorldMatrix(true, true);
    let low = Infinity;
    for (const [name, rest] of this.footRest) {
      const b = this.bones.get(name);
      if (!b?.parent) continue;
      const q = b.parent
        .getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(rest);
      b.quaternion.copy(q);
      b.updateWorldMatrix(false, true);
      low = Math.min(low, b.getWorldPosition(new T.Vector3()).y);
    }
    if (Number.isFinite(low))
      this.group.position.y = Math.max(
        this.groundY - 0.4,
        Math.min(
          this.groundY + 0.3,
          this.group.position.y +
            (this.groundY + 0.15 * this.group.scale.y - low),
        ),
      );
  }
  choreo(pose: Pose) {
    if (!this.ready) return;
    this.mixer?.stopAllAction();
    this.current = "";
    const sk = forward(pose) as unknown as Record<string, [number, number]>;
    const pt = (n: string) => {
      const p = sk[n];
      return p ? new T.Vector3(p[0] * 0.67, 1.1 - p[1] * 0.67, 0) : null;
    };
    const sets = [
      ["UpperArmR", "shL", "elL"],
      ["LowerArmR", "elL", "wrL"],
      ["UpperArmL", "shR", "elR"],
      ["LowerArmL", "elR", "wrR"],
      ["ThighR", "hipL", "kneeL"],
      ["ShinR", "kneeL", "ankL"],
      ["ThighL", "hipR", "kneeR"],
      ["ShinL", "kneeR", "ankR"],
    ];
    for (const [bn, a, b] of sets) {
      const pa = pt(a),
        pb = pt(b);
      if (pa && pb) this.pointBone(bn, pa, pb, 0.7);
    }
    this.plantFeet();
  }
  reach(side: "L" | "R", target: T.Vector3) {
    if (!this.ready) return;
    const s = side === "L" ? 1 : -1;
    const shoulder = new T.Vector3(s * 0.235, 1.46, 0);
    const delta = target.clone().sub(shoulder);
    if (delta.length() > 0.57)
      target = shoulder.clone().add(delta.normalize().multiplyScalar(0.57));
    const elbow = shoulder
      .clone()
      .lerp(target, 0.52)
      .add(new T.Vector3(s * 0.07, -0.06, 0.1));
    this.pointBone("UpperArm" + side, shoulder, elbow, 0.35);
    this.pointBone("LowerArm" + side, elbow, target, 0.45);
  }
  dispose() {
    this.alive = false;
    this.mixer?.stopAllAction();
    this.group.removeFromParent();
    this.model?.traverse((o) => {
      if (o instanceof T.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
