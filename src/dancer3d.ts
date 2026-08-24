// 3D dancer: Quaternius CC0 characters (Ultimate Modular pack) rendered with
// three.js into an offscreen WebGL canvas and blitted into the 2D pipeline.
// The humanoid rig is retargeted every frame by pure direction-matching: for
// each bone we know the desired world-space direction (from the same smoothed
// screen-space joints the 2D avatar uses, plus MediaPipe depth for the arms),
// and rotate the bone so its child points that way. No animation clips.

import {
  WebGLRenderer, Scene, OrthographicCamera, AmbientLight, DirectionalLight,
  Quaternion, Vector3, Color, Bone, Object3D, Mesh, MeshStandardMaterial, SRGBColorSpace,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { StyleProfile } from './appearance';

type P2 = [number, number];

export interface Joints3D {
  pelvis: P2; midSh: P2; head: P2;
  shA: P2; elA: P2; wrA: P2; shB: P2; elB: P2; wrB: P2;
  hipA: P2; kneeA: P2; ankA: P2; hipB: P2; kneeB: P2; ankB: P2;
  /** depth hints, MediaPipe z relative to hips (negative = toward camera) */
  zElA: number; zWrA: number; zElB: number; zWrB: number;
  /** false when the camera can't see the legs — keep the rest-pose stance */
  legsTracked: boolean;
}

/** viewer-left ('A') limbs belong to the character's anatomical RIGHT (.R) */
const BONE_MAP: [keyof Joints3D, keyof Joints3D, string][] = [
  ['shA', 'elA', 'UpperArm.R'], ['elA', 'wrA', 'LowerArm.R'],
  ['shB', 'elB', 'UpperArm.L'], ['elB', 'wrB', 'LowerArm.L'],
  ['hipA', 'kneeA', 'UpperLeg.R'], ['kneeA', 'ankA', 'LowerLeg.R'],
  ['hipB', 'kneeB', 'UpperLeg.L'], ['kneeB', 'ankB', 'LowerLeg.L'],
  ['pelvis', 'midSh', 'Chest'], ['midSh', 'head', 'Neck'],
];

const RES_W = 480, RES_H = 620;
const WORLD_H = 3.4;                 // ortho frustum height in world units

interface RigBone {
  bone: Bone;
  parent: Object3D;
  restLocal: Quaternion;
  childDirLocal: Vector3;            // rest direction to child, in bone space
}

export class Dancer3D {
  canvas = document.createElement('canvas');
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: OrthographicCamera;
  private key: DirectionalLight;
  private root: Object3D | null = null;
  private rig = new Map<string, RigBone>();
  private hips: Bone | null = null;
  /** hips height above the ground in rest pose (world units) */
  hipsRestY = 1;
  private feet: { bone: Bone; parent: Object3D; restLocal: Quaternion; restWorld: Quaternion }[] = [];
  /** world-units torso length (hips→chest child) for screen scaling */
  torsoWorld = 0.6;
  /** px per world unit in the render */
  pxPerUnit = RES_H / WORLD_H;
  /** hips position in render pixels (x from left, y from top) */
  hipsPx: P2 = [RES_W / 2, RES_H * 0.62];
  ready = false;
  loading: string | null = null;

  constructor() {
    this.canvas.width = RES_W;
    this.canvas.height = RES_H;
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    const aspect = RES_W / RES_H;
    // straight-on symmetric frustum showing world y ∈ [0, WORLD_H]
    this.camera = new OrthographicCamera(
      -WORLD_H * aspect / 2, WORLD_H * aspect / 2, WORLD_H / 2, -WORLD_H / 2, 0.1, 20);
    this.camera.position.set(0, WORLD_H / 2, 8);
    this.camera.updateMatrixWorld();
    this.scene.add(new AmbientLight(0xffffff, 1.35));
    this.key = new DirectionalLight(0xffffff, 1.6);
    this.key.position.set(-2, 4, 6);
    this.scene.add(this.key);
  }

  async load(model: string): Promise<boolean> {
    if (this.loading === model) return this.ready;
    this.loading = model;
    this.ready = false;
    try {
      const gltf = await new GLTFLoader().loadAsync(`/models/${model}.glb`);
      if (this.loading !== model) return false; // superseded by a later load
      if (this.root) this.scene.remove(this.root);
      this.root = gltf.scene;
      this.scene.add(this.root);
      this.root.updateWorldMatrix(true, true);

      this.rig.clear();
      this.hips = null;
      // GLTFLoader sanitizes node names ('UpperArm.L' -> 'UpperArmL') — match normalized
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      const byName = new Map<string, Bone>();
      this.root.traverse((n) => {
        if ((n as Bone).isBone) byName.set(norm(n.name), n as Bone);
      });
      this.hips = byName.get('hips') ?? null;
      for (const [, , boneName] of BONE_MAP) {
        const bone = byName.get(norm(boneName)) ?? null;
        if (!bone) continue;
        const b = bone as Bone;
        // child joint = first bone child (Neck's child is Head, etc.)
        const child = b.children.find((c) => (c as Bone).isBone) as Bone | undefined;
        const childDirLocal = child
          ? child.position.clone().normalize()
          : new Vector3(0, 1, 0);
        this.rig.set(boneName, {
          bone: b, parent: b.parent!, restLocal: b.quaternion.clone(), childDirLocal,
        });
      }
      // feet: pinned flat — they must not inherit the shin's rotation delta
      this.feet = [];
      for (const fn of ['footl', 'footr']) {
        const fb = byName.get(fn);
        if (fb) {
          const restWorld = new Quaternion();
          fb.getWorldQuaternion(restWorld);
          this.feet.push({ bone: fb, parent: fb.parent!, restLocal: fb.quaternion.clone(), restWorld });
        }
      }
      if (this.hips) {
        const hb = this.hips as Bone;
        const hw = new Vector3();
        hb.getWorldPosition(hw);
        this.hipsRestY = hw.y;
        const chest = this.rig.get('Chest');
        if (chest) {
          const cw = new Vector3();
          chest.bone.getWorldPosition(cw);
          this.torsoWorld = Math.max(0.3, hw.distanceTo(cw) + 0.28); // hips→chest + chest span
        }
        this.hipsPx = this.project(hw);
      }
      this.ready = true;
      return true;
    } catch {
      if (this.loading === model) this.loading = null;
      return false;
    }
  }

  private project(w: Vector3): P2 {
    const v = w.clone().project(this.camera);
    return [(v.x * 0.5 + 0.5) * RES_W, (1 - (v.y * 0.5 + 0.5)) * RES_H];
  }

  /** tint materials from the player's scanned colors (AUTO mode only) */
  tint(style: StyleProfile) {
    if (!this.root) return;
    const setC = (m: MeshStandardMaterial, hex: string) => { m.color = new Color(hex); };
    let bodyMats = 0;
    this.root.traverse((n) => {
      const mesh = n as Mesh;
      if (!mesh.isMesh) return;
      const owner = this.ownerOf(n);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mm of mats) {
        const m = mm as MeshStandardMaterial;
        const name = (m.name || '').toLowerCase();
        if (name.includes('skin')) setC(m, style.skin);
        else if (name.includes('hair')) setC(m, style.hair);
        else if (owner === 'legs') setC(m, style.bottom);
        else if (owner === 'feet') setC(m, style.boots);
        else if (owner === 'head') setC(m, style.hair);
        else setC(m, bodyMats++ === 0 ? style.top : style.topDeep); // shirt, then jacket/accents
      }
    });
  }

  private ownerOf(n: Object3D): 'body' | 'legs' | 'feet' | 'head' {
    let cur: Object3D | null = n;
    while (cur) {
      const nm = cur.name.toLowerCase();
      if (nm.includes('legs')) return 'legs';
      if (nm.includes('feet')) return 'feet';
      if (nm.includes('head')) return 'head';
      if (nm.includes('body')) return 'body';
      cur = cur.parent;
    }
    return 'body';
  }

  /**
   * Retarget: rotate each mapped bone so its child points along the desired
   * world direction derived from the 2D joints (+depth for arms), then render.
   */
  pose(j: Joints3D) {
    if (!this.ready || !this.root) return;
    const dir = (a: P2, b: P2, z: number): Vector3 => {
      const v = new Vector3(b[0] - a[0], -(b[1] - a[1]), z);
      return v.lengthSq() < 1e-6 ? new Vector3(0, -1, 0) : v.normalize();
    };
    // torso scale: screen px per unit-ish — depth hints are normalized against it
    const torsoPx = Math.max(20, Math.hypot(j.midSh[0] - j.pelvis[0], j.midSh[1] - j.pelvis[1]));
    const zf = (z: number) => Math.max(-0.9, Math.min(0.9, -z * 2.2)) * torsoPx * 0.7;

    // arms: keep relaxed hands from crossing into the body — limit how far
    // the upper arm may point past the midline (outward for 'R' is -x)
    const clampIn = (v: Vector3, out: -1 | 1): Vector3 => {
      if (v.x * out < -0.12) { v.x = -0.12 * out; v.normalize(); }
      return v;
    };

    const targets = new Map<string, Vector3>();
    targets.set('Chest', dir(j.pelvis, j.midSh, 0));
    targets.set('Neck', dir(j.midSh, j.head, 0));
    targets.set('UpperArm.R', clampIn(dir(j.shA, j.elA, zf(j.zElA)), -1));
    targets.set('LowerArm.R', dir(j.elA, j.wrA, zf(j.zWrA)));
    targets.set('UpperArm.L', clampIn(dir(j.shB, j.elB, zf(j.zElB)), 1));
    targets.set('LowerArm.L', dir(j.elB, j.wrB, zf(j.zWrB)));
    if (j.legsTracked) {
      targets.set('UpperLeg.R', dir(j.hipA, j.kneeA, 0));
      targets.set('LowerLeg.R', dir(j.kneeA, j.ankA, 0));
      targets.set('UpperLeg.L', dir(j.hipB, j.kneeB, 0));
      targets.set('LowerLeg.L', dir(j.kneeB, j.ankB, 0));
    }
    // legs off-camera → natural rest stance (bones reset below)

    // reset every mapped bone first, then process parents before children
    for (const rb of this.rig.values()) rb.bone.quaternion.copy(rb.restLocal);
    for (const f of this.feet) f.bone.quaternion.copy(f.restLocal);
    const order = ['Chest', 'Neck', 'UpperArm.R', 'LowerArm.R', 'UpperArm.L', 'LowerArm.L',
      'UpperLeg.R', 'LowerLeg.R', 'UpperLeg.L', 'LowerLeg.L'];
    const pw = new Quaternion(), cw = new Quaternion(), delta = new Quaternion();
    const cur = new Vector3();
    for (const name of order) {
      const rb = this.rig.get(name);
      const target = targets.get(name);
      if (!rb || !target) continue;
      rb.parent.updateWorldMatrix(true, false);
      rb.parent.getWorldQuaternion(pw);
      cw.copy(pw).multiply(rb.restLocal);
      cur.copy(rb.childDirLocal).applyQuaternion(cw);
      delta.setFromUnitVectors(cur, target);
      // local = parent⁻¹ · delta · parentWorld · restLocal
      rb.bone.quaternion.copy(pw.clone().invert().multiply(delta).multiply(cw));
    }
    // pin the feet flat: restore their rest WORLD orientation under the
    // now-rotated shins so they stay planted instead of rolling with the leg
    if (j.legsTracked) {
      for (const f of this.feet) {
        f.parent.updateWorldMatrix(true, false);
        f.parent.getWorldQuaternion(pw);
        f.bone.quaternion.copy(pw.clone().invert().multiply(f.restWorld));
      }
    }
    this.root.updateWorldMatrix(true, true);
    this.renderer.render(this.scene, this.camera);
  }

  /** stage key light follows the beam color/side */
  setLight(x01: number, color: string) {
    this.key.position.set((x01 - 0.5) * 6, 4, 6);
    this.key.color = new Color(color);
  }
}
