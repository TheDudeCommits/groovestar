import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { HandRig } from "../../pose/rig";
import type { Body3D, Body3DJoint } from "../../pose/body3d";
import type { Pose } from "../../moves";
import { forward } from "../../moves";
import { outfit } from "../core/equipment";
import type { StyleProfile } from "../../appearance";
import { toonify, hologram, type ToonOptions } from "./pt/toon";
const cache = new Map<string, Promise<GLTF>>();
type RigJointName = Parameters<HandRig["joint"]>[0];
/** Bones driven by tracking, with the viewer-space joints that aim them. */
const TRACK_SEGMENTS: [string, RigJointName, RigJointName][] = [
  ["UpperArmR", "shL", "elL"],
  ["LowerArmR", "elL", "wrL"],
  ["UpperArmL", "shR", "elR"],
  ["LowerArmL", "elR", "wrR"],
  ["ThighR", "hipL", "kneeL"],
  ["ShinR", "kneeL", "ankleL"],
  ["ThighL", "hipR", "kneeR"],
  ["ShinL", "kneeR", "ankleR"],
];
/** Relaxed standing pose used when tracking drops, instead of the bind pose. */
const IDLE: Partial<Record<RigJointName, [number, number, number]>> = {
  shL: [-0.2, 1.47, 0], elL: [-0.25, 1.21, 0.03], wrL: [-0.27, 0.96, 0.08],
  shR: [0.2, 1.47, 0], elR: [0.25, 1.21, 0.03], wrR: [0.27, 0.96, 0.08],
  hipL: [-0.1, 1.01, 0], kneeL: [-0.11, 0.58, 0.02], ankleL: [-0.12, 0.16, 0],
  hipR: [0.1, 1.01, 0], kneeR: [0.11, 0.58, 0.02], ankleR: [0.12, 0.16, 0],
};
const idle = (name: RigJointName) => {
  const v = IDLE[name] ?? [0, 1, 0];
  return new T.Vector3(v[0], v[1], v[2]);
};
/** How long an untracked limb holds its last pose before relaxing (ms). */
const HOLD_MS = 350;

/**
 * Primetime cast built from Meshy exports (see tools/primetime/build-nova.mjs).
 * The game's logical bone names map onto the Meshy skeleton; limbs are aimed
 * from their rest pose, so no bone-axis convention is assumed.
 */
const PT_MODELS: Record<string, { url: string; height: number }> = {
  nova: { url: "/models/nova-pt.glb", height: 1.72 },
};
const MESHY_BONES: Record<string, string> = {
  UpperArmR: "RightArm",
  LowerArmR: "RightForeArm",
  UpperArmL: "LeftArm",
  LowerArmL: "LeftForeArm",
  ThighR: "RightUpLeg",
  ShinR: "RightLeg",
  ThighL: "LeftUpLeg",
  ShinL: "LeftLeg",
  Chest: "Spine02",
  Head: "Head",
  FootL: "LeftFoot",
  FootR: "RightFoot",
  HandL: "LeftHand",
  HandR: "RightHand",
};
const MESHY_CHILD: Record<string, string> = {
  RightArm: "RightForeArm",
  RightForeArm: "RightHand",
  LeftArm: "LeftForeArm",
  LeftForeArm: "LeftHand",
  RightUpLeg: "RightLeg",
  RightLeg: "RightFoot",
  LeftUpLeg: "LeftLeg",
  LeftLeg: "LeftFoot",
};
const CLIP_NAMES = ["Idle", "Run", "Dance", "Dance2", "Dance3", "Guard", "Celebrate"];

/** Which character a role uses. Every role is played by Nova until the rest of the cast is rebuilt. */
export function castFor(id: string) {
  return PT_MODELS[id] ? id : "nova";
}

export interface CharacterLook {
  /** "toon" is the Primetime look; "hologram" suits coaches and ghosts. */
  style?: "toon" | "hologram";
  color?: T.ColorRepresentation;
  toon?: ToonOptions;
}

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
  private segSeen = new Map<string, number>();
  private kind: "classic" | "meshy" = "classic";
  private footLift = 0.15;
  private holo: ReturnType<typeof hologram> | null = null;
  private q1 = new T.Quaternion();
  private q2 = new T.Quaternion();
  private q3 = new T.Quaternion();
  private v1 = new T.Vector3();
  private hipsRest = new T.Vector3();
  /** rest orientation of each bone relative to the character group */
  private restChar = new Map<string, T.Quaternion>();
  ready = false;
  constructor(private look: CharacterLook = {}) {}
  async load(id = "nova") {
    this.ready = false;
    const pt = PT_MODELS[castFor(id)];
    const key = pt ? pt.url : `/models/${id}.glb`;
    let promise = cache.get(key);
    if (!promise) {
      promise = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(key);
      cache.set(key, promise);
    }
    const gltf = await promise;
    if (!this.alive) return;
    this.kind = pt ? "meshy" : "classic";
    this.model = clone(gltf.scene);
    this.model.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
      if (o instanceof T.Bone) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, o.quaternion.clone());
        if (o.name === "Hips") this.hipsRest.copy(o.position);
      }
    });
    if (pt) {
      // Meshy exports are authored in centimetres under a scaled armature.
      this.model.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(this.model, true);
      const s = pt.height / Math.max(0.01, box.max.y - box.min.y);
      this.model.scale.multiplyScalar(s);
      this.model.position.y = -box.min.y * s;
      this.model.updateMatrixWorld(true);
      const foot = this.bones.get("LeftFoot");
      if (foot) this.footLift = foot.getWorldPosition(new T.Vector3()).y;
      if (this.look.style === "hologram") this.holo = hologram(this.model, this.look.color ?? 0x3fe0ff);
      else toonify(this.model, this.look.toon);
    }
    this.group.add(this.model);
    this.mixer = new T.AnimationMixer(this.model);
    for (const c of gltf.animations) {
      const exact = CLIP_NAMES.find((n) => c.name === n);
      const name = exact ?? ["Idle", "Run", "Dance", "Guard", "Celebrate"].find((n) => c.name.startsWith(n));
      if (name && !this.actions.has(name)) this.actions.set(name, this.mixer.clipAction(c));
    }
    this.group.updateWorldMatrix(true, true);
    {
      const gq = this.group.getWorldQuaternion(new T.Quaternion()).invert();
      for (const [name, b] of this.bones) this.restChar.set(name, gq.clone().multiply(b.getWorldQuaternion(new T.Quaternion())));
    }
    for (const n of ["FootL", "FootR"]) {
      const b = this.bone(n);
      if (b) this.footRest.set(n, b.getWorldQuaternion(new T.Quaternion()));
    }
    const kit = outfit();
    if (!pt && kit.id !== "studio")
      this.model.traverse((o) => {
        if (o instanceof T.Mesh) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if (m instanceof T.MeshStandardMaterial && m.name.replace(/\.\d+$/, "") === "cream") m.color.set(kit.color);
        }
      });
    this.ready = true;
    this.play("Idle");
  }
  private bone(logical: string) {
    return this.bones.get(this.kind === "meshy" ? (MESHY_BONES[logical] ?? logical) : logical);
  }
  /** A skeleton bone by its Meshy name (Hips, LeftHand, Head...). */
  rigBone(name: string) {
    return this.bones.get(name);
  }
  get clips() {
    return [...this.actions.keys()];
  }
  /**
   * Load Nova's extra clips (dance routines, game actions) from
   * nova-moves.glb; they bind to this skeleton by bone name.
   */
  async loadMoves() {
    if (this.kind !== "meshy" || !this.mixer) return;
    const key = "/models/nova-moves.glb";
    let promise = cache.get(key);
    if (!promise) {
      promise = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(key);
      cache.set(key, promise);
    }
    const gltf = await promise;
    if (!this.alive || !this.mixer) return;
    for (const c of gltf.animations) if (!this.actions.has(c.name)) this.actions.set(c.name, this.mixer.clipAction(c));
  }
  clipDuration(name: string) {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }
  /**
   * Pose the skeleton straight from clips on an external timeline (the song
   * beat), blending up to two: [name, seconds, weight].
   */
  timeline(layers: [string, number, number][]) {
    if (!this.ready || !this.mixer) return;
    if (this.current) {
      this.actions.get(this.current)?.stop();
      this.current = "";
    }
    const used = new Set<string>();
    for (const [name, time, weight] of layers) {
      const a = this.actions.get(name);
      if (!a || weight <= 0.001) continue;
      const d = a.getClip().duration;
      if (!this.timelineNames.has(name)) {
        a.reset();
        a.play();
      }
      a.paused = true;
      a.enabled = true;
      a.setEffectiveWeight(weight);
      a.time = ((time % d) + d) % d;
      used.add(name);
    }
    for (const name of this.timelineNames) if (!used.has(name)) this.actions.get(name)?.stop();
    this.timelineNames = used;
    this.mixer.update(0);
    if (this.holo) this.holo.uTime.value = performance.now() / 1000;
  }
  private timelineNames = new Set<string>();
  private stopTimeline() {
    for (const name of this.timelineNames) this.actions.get(name)?.stop();
    this.timelineNames.clear();
  }
  play(name: string, fade = 0.18) {
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;
    this.stopTimeline();
    this.actions.get(this.current)?.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    this.current = name;
  }
  /** Live rim light (toon look): the Dance avatar glows with how in sync you are. */
  setRim(left: T.ColorRepresentation, right: T.ColorRepresentation, strength?: number) {
    this.model?.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const u = (o.material as T.Material).userData?.pt as { uRimL: { value: T.Color }; uRimR: { value: T.Color }; uRim: { value: number } } | undefined;
      if (!u) return;
      u.uRimL.value.set(left);
      u.uRimR.value.set(right);
      if (strength !== undefined) u.uRim.value = strength;
    });
  }
  /** Seconds into the current clip, for syncing a dance to the beat. */
  setTimeScale(k: number) {
    if (this.mixer) this.mixer.timeScale = k;
  }
  update(dt: number) {
    this.mixer?.update(dt);
    if (this.holo) this.holo.uTime.value += dt;
  }
  /** World position of a hand bone (for attaching mitts, rackets, trails). */
  handWorld(side: "L" | "R", target = new T.Vector3()) {
    const b = this.bone(side === "L" ? "HandL" : "HandR");
    return b ? b.getWorldPosition(target) : null;
  }
  tint(colors: { skin?: string; top?: string; bottom?: string; hair?: string }) {
    if (this.kind === "meshy") return;
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
    if (this.kind === "meshy") return;
    this.tint({ skin: style.skin, top: style.top, bottom: style.bottom, hair: style.hair });
    const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
    const head = this.bones.get("Head");
    if (head) head.scale.setScalar(clamp(style.body.headScale, 0.85, 1.2));
    const build = clamp(style.body.buildScale, 0.85, 1.15);
    this.group.scale.x = build;
  }
  /**
   * Aim a limb so it points from `from` to `to` (character space). Meshy
   * limbs rotate from their rest orientation toward the target, which keeps
   * forearm twist stable over long tracking sessions.
   */
  private pointBone(name: string, from: T.Vector3, to: T.Vector3, blend = 0.45) {
    const bone = this.bone(name);
    if (!bone || !bone.parent) return;
    const dir = to.clone().sub(from);
    if (dir.length() < 0.025) return;
    if (this.kind === "meshy") {
      const child = this.bones.get(MESHY_CHILD[bone.name]);
      const restLocal = this.rest.get(bone.name);
      if (!child || !restLocal) return;
      dir.transformDirection(this.group.matrixWorld);
      const parentQ = bone.parent.getWorldQuaternion(this.q1);
      const restWorld = this.q2.copy(parentQ).multiply(restLocal);
      const restDir = this.v1.copy(child.position).normalize().applyQuaternion(restWorld);
      const delta = this.q3.setFromUnitVectors(restDir, dir);
      const targetLocal = parentQ.invert().multiply(delta.multiply(restWorld));
      bone.quaternion.slerp(targetLocal, blend);
      bone.updateWorldMatrix(false, true);
      return;
    }
    const parentQ = bone.parent.getWorldQuaternion(new T.Quaternion());
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    q.premultiply(parentQ.invert());
    bone.quaternion.slerp(q, blend);
    bone.updateWorldMatrix(false, true);
  }
  /** Reset tracked bones to rest so an animation clip hands over cleanly. */
  private takeControl() {
    if (this.timelineNames.size) {
      this.stopTimeline();
      if (this.kind === "meshy") for (const [n, q] of this.rest) this.bones.get(n)?.quaternion.copy(q);
      const hips = this.bones.get("Hips");
      if (hips && this.kind === "meshy") hips.position.copy(this.hipsRest);
    }
    if (this.current) {
      this.mixer?.stopAllAction();
      this.current = "";
      if (this.kind === "meshy") for (const [n, q] of this.rest) this.bones.get(n)?.quaternion.copy(q);
      const hips = this.bones.get("Hips");
      if (hips && this.kind === "meshy") hips.position.copy(this.hipsRest);
    }
  }
  tracked(rig: HandRig) {
    if (!this.ready || !rig.hasPose) return;
    this.takeControl();
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
              ? 0.12 + ((name.endsWith("L") && j.x > h.x) || (name.endsWith("R") && j.x < h.x) ? 0.22 : 0)
              : name.startsWith("el")
                ? 0.07
                : 0,
          )
        : null;
    };
    const now = performance.now();
    for (const [bn, a, b] of TRACK_SEGMENTS) {
      const pa = p(a),
        pb = p(b);
      if (pa && pb) {
        this.pointBone(bn, pa, pb, 0.65);
        this.segSeen.set(bn, now);
      } else if (now - (this.segSeen.get(bn) ?? -1e9) > HOLD_MS) {
        this.pointBone(bn, idle(a), idle(b), 0.08);
      }
      // otherwise the limb holds its last tracked orientation
    }
    this.plantFeet();
    this.standingY ??= h.y;
    this.group.position.y += Math.max(0, Math.min(0.3, ((this.standingY - h.y) / torso) * 0.46 - 0.04));
    const a = p("shL"),
      b = p("shR");
    if (a && b) this.tiltChest(Math.max(-0.35, Math.min(0.35, Math.atan2(b.y - a.y, Math.abs(b.x - a.x)))), 0.1);
  }
  /**
   * Pose the skeleton from the player's tracked 3D body, every frame.
   * "front": the character faces the camera and mirrors the player (their
   * left arm moves its right, like a reflection). "back": seen from behind,
   * it copies them (third-person games). Limbs are aimed from rest, the
   * torso takes the player's lean and twist, and the feet stay planted.
   */
  drive(body: Body3D, facing: "front" | "back", opts: { blend?: number; legs?: boolean; torso?: boolean; now?: number } = {}) {
    if (!this.ready || this.kind !== "meshy") return;
    this.takeControl();
    this.group.updateWorldMatrix(true, true);
    const blend = opts.blend ?? 0.6;
    const sx = facing === "front" ? 1 : -1;
    const pos = (name: Body3DJoint, minVis = 0.45) => {
      const j = body.get(name, minVis);
      return j ? new T.Vector3(sx * j.x, j.y, j.z) : null;
    };
    const player = (c: "L" | "R") => (facing === "front" ? (c === "L" ? "R" : "L") : c);
    const now = opts.now ?? performance.now();
    if (opts.torso !== false) {
      const aL = pos(`sh${player("L")}` as Body3DJoint, 0.5),
        aR = pos(`sh${player("R")}` as Body3DJoint, 0.5),
        hL = pos(`hip${player("L")}` as Body3DJoint, 0.3),
        hR = pos(`hip${player("R")}` as Body3DJoint, 0.3);
      if (aL && aR) {
        const shoulderMid = aL.clone().add(aR).multiplyScalar(0.5);
        const hipMid = hL && hR ? hL.clone().add(hR).multiplyScalar(0.5) : new T.Vector3(0, 0, 0);
        this.orientSpine(shoulderMid.sub(hipMid), aL.clone().sub(aR), blend * 0.7);
      }
    }
    const segs: [string, Body3DJoint, Body3DJoint][] = [];
    for (const c of ["L", "R"] as const) {
      const p = player(c);
      segs.push([`UpperArm${c}`, `sh${p}` as Body3DJoint, `el${p}` as Body3DJoint], [`LowerArm${c}`, `el${p}` as Body3DJoint, `wr${p}` as Body3DJoint]);
      if (opts.legs !== false) segs.push([`Thigh${c}`, `hip${p}` as Body3DJoint, `knee${p}` as Body3DJoint], [`Shin${c}`, `knee${p}` as Body3DJoint, `ank${p}` as Body3DJoint]);
    }
    for (const [bn, a, b] of segs) {
      const leg = bn.startsWith("Thigh") || bn.startsWith("Shin");
      const pa = pos(a, leg ? 0.55 : 0.45),
        pb = pos(b, leg ? 0.55 : 0.45);
      if (pa && pb) {
        this.pointBone(bn, pa, pb, blend);
        this.segSeen.set(bn, now);
      } else if (now - (this.segSeen.get(bn) ?? -1e9) > HOLD_MS) {
        const ia = TRACK_SEGMENTS.find((x) => x[0] === bn);
        if (ia) this.pointBone(bn, idle(ia[1]), idle(ia[2]), 0.08);
      }
    }
    this.plantFeet();
  }

  /** Turn the spine so the chest matches a target up vector and shoulder line (character space). */
  private orientSpine(up: T.Vector3, across: T.Vector3, blend: number) {
    const u = up.clone().normalize();
    if (!Number.isFinite(u.x) || u.lengthSq() < 0.5) return;
    const a = across.clone().sub(u.clone().multiplyScalar(across.dot(u)));
    if (a.lengthSq() < 1e-6) return;
    a.normalize();
    const f = new T.Vector3().crossVectors(a, u);
    const target = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(a, u, f));
    // keep it human: limit the lean and twist
    const angle = 2 * Math.acos(Math.min(1, Math.abs(target.w)));
    if (angle > 0.9) target.slerp(new T.Quaternion(), 1 - 0.9 / angle);
    const gq = this.group.getWorldQuaternion(new T.Quaternion());
    const parts: [string, number][] = [["Spine02", 0.45], ["Spine", 1]];
    for (const [name, k] of parts) {
      const bone = this.bones.get(name),
        rest = this.restChar.get(name);
      if (!bone?.parent || !rest) continue;
      const qPart = new T.Quaternion().slerp(target, k);
      const world = gq.clone().multiply(qPart).multiply(rest);
      const parentQ = bone.parent.getWorldQuaternion(new T.Quaternion());
      bone.quaternion.slerp(parentQ.invert().multiply(world), blend);
      bone.updateWorldMatrix(false, true);
    }
  }
  private tiltChest(angle: number, blend: number) {
    const chest = this.bone("Chest");
    if (!chest?.parent) return;
    if (this.kind === "classic") {
      chest.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(0, 0, angle)), blend);
      return;
    }
    const restLocal = this.rest.get(chest.name)!;
    const parentQ = chest.parent.getWorldQuaternion(this.q1);
    const fwd = this.v1.set(0, 0, 1).transformDirection(this.group.matrixWorld);
    const restWorld = this.q2.copy(parentQ).multiply(restLocal);
    const tilt = this.q3.setFromAxisAngle(fwd, angle);
    chest.quaternion.slerp(parentQ.invert().multiply(tilt.multiply(restWorld)), blend);
  }
  /** Tracking lost entirely: hold briefly, then ease into a relaxed stance. */
  relax(sinceMs: number) {
    if (!this.ready || sinceMs < HOLD_MS) return;
    this.takeControl();
    this.group.updateWorldMatrix(true, true);
    for (const [bn, a, b] of TRACK_SEGMENTS) this.pointBone(bn, idle(a), idle(b), 0.06);
    this.plantFeet();
  }
  private plantFeet() {
    this.group.updateWorldMatrix(true, true);
    let low = Infinity;
    for (const [name, rest] of this.footRest) {
      const b = this.bone(name);
      if (!b?.parent) continue;
      const q = b.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rest);
      b.quaternion.copy(q);
      b.updateWorldMatrix(false, true);
      low = Math.min(low, b.getWorldPosition(new T.Vector3()).y);
    }
    const lift = this.kind === "meshy" ? this.footLift * this.group.scale.y : 0.15 * this.group.scale.y;
    if (Number.isFinite(low))
      this.group.position.y = Math.max(
        this.groundY - 0.4,
        Math.min(this.groundY + 0.3, this.group.position.y + (this.groundY + lift - low)),
      );
  }
  choreo(pose: Pose) {
    if (!this.ready) return;
    this.takeControl();
    this.group.updateWorldMatrix(true, true);
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
  /** Reach a hand toward a character-space target (coach mitts, rackets). */
  reach(side: "L" | "R", target: T.Vector3, strength = 1) {
    if (!this.ready) return;
    this.group.updateWorldMatrix(true, true);
    const s = side === "L" ? 1 : -1;
    const upper = this.bone("UpperArm" + side),
      lower = this.bone("LowerArm" + side),
      hand = this.bone("Hand" + side);
    if (this.kind === "meshy" && upper && lower && hand) {
      // Two-bone IK: place the elbow on the circle that fits both bone
      // lengths, bent down and back like a real arm.
      const toLocal = (b: T.Object3D) => this.group.worldToLocal(b.getWorldPosition(new T.Vector3()));
      const S = toLocal(upper),
        E0 = toLocal(lower),
        H0 = toLocal(hand);
      const l1 = S.distanceTo(E0),
        l2 = E0.distanceTo(H0);
      const P = target.clone();
      const d = Math.min(Math.max(P.distanceTo(S), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.005);
      const dir = P.clone().sub(S).normalize();
      P.copy(S).addScaledVector(dir, d);
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const pole = new T.Vector3(s * 0.35, -1, -0.45);
      const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
      const E = S.clone().addScaledVector(dir, a).addScaledVector(perp, h);
      const k = 0.9 * strength;
      this.pointBone("UpperArm" + side, S, E, k);
      this.pointBone("LowerArm" + side, E, P, Math.min(1, k + 0.05));
      return;
    }
    const shoulder = new T.Vector3(s * 0.235, 1.46, 0);
    const local = target.clone();
    const delta = local.clone().sub(shoulder);
    if (delta.length() > 0.57) local.copy(shoulder).add(delta.normalize().multiplyScalar(0.57));
    const elbow = shoulder.clone().lerp(local, 0.52).add(new T.Vector3(s * 0.07, -0.06, 0.1));
    this.pointBone("UpperArm" + side, shoulder, elbow, 0.35);
    this.pointBone("LowerArm" + side, elbow, local, 0.45);
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
