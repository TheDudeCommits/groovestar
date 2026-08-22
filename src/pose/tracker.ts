// Webcam + MediaPipe PoseLandmarker wrapper. Produces, per frame:
//  - a mirrored landmark set (player mirror-matches the coach, like the reference)
//  - the same limb-angle feature vector the move library exposes
//  - a motion-energy estimate (how much the player is actually moving)

import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// MediaPipe landmark indices
const L = { shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24 };
const D = 180 / Math.PI;

export interface PlayerFrame {
  t: number;                    // performance.now() ms
  features: number[] | null;    // [shL, shL+elL, shR, shR+elR, lean*2.5] matching poseFeatures()
  energy: number;               // 0..1 recent movement
  points: { x: number; y: number }[] | null; // mirrored, for the mini preview
}

export class PoseTracker {
  video: HTMLVideoElement;
  private lm: PoseLandmarker | null = null;
  private lastWrists: { x: number; y: number }[] | null = null;
  private lastT = 0;
  private energySmooth = 0;
  latest: PlayerFrame = { t: 0, features: null, energy: 0, points: null };
  /** raw (unmirrored) landmarks from the last successful detection */
  latestLandmarks: NormalizedLandmark[] | null = null;
  ready = false;
  error: string | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async init(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
      const files = await FilesetResolver.forVisionTasks(WASM_URL);
      this.lm = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      this.ready = true;
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** call once per rAF */
  update() {
    if (!this.ready || !this.lm || this.video.readyState < 2) return;
    const now = performance.now();
    if (now - this.lastT < 33) return; // ~30 fps detection is plenty
    let res;
    try {
      res = this.lm.detectForVideo(this.video, now);
    } catch { return; }
    this.lastT = now;
    const lms = res.landmarks?.[0];
    if (!lms || lms.length < 33) {
      this.latest = { t: now, features: null, energy: this.decayEnergy(), points: null };
      this.latestLandmarks = null;
      return;
    }
    this.latestLandmarks = lms;
    // mirror x so the player's viewer-left is the coach's viewer-left
    const p = (i: number) => ({ x: 1 - lms[i].x, y: lms[i].y });
    const shL = p(L.shR), shR = p(L.shL);   // note: mirroring swaps L/R
    const elL = p(L.elR), elR = p(L.elL);
    const wrL = p(L.wrR), wrR = p(L.wrL);
    const hipL = p(L.hipR), hipR = p(L.hipL);

    const midSh = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
    const midHip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const lean = Math.atan2(midSh.x - midHip.x, midHip.y - midSh.y) * D;

    // limb angle with the library convention: 0 = down, 90 = outward, 180 = up
    const limb = (a: { x: number; y: number }, b: { x: number; y: number }, side: number) => {
      const dx = (b.x - a.x) * side, dy = b.y - a.y;
      return Math.atan2(dx, dy) * D; // 0 down, +90 outward
    };
    const uL = limb(shL, elL, -1), fL = limb(elL, wrL, -1);
    const uR = limb(shR, elR, 1), fR = limb(elR, wrR, 1);
    const features = [uL, fL, uR, fR, lean * 2.5];

    // motion energy from wrist velocity (normalized by torso size)
    const torso = Math.hypot(midSh.x - midHip.x, midSh.y - midHip.y) || 0.25;
    const wrists = [wrL, wrR];
    if (this.lastWrists) {
      const dt = Math.max(16, now - (this.latest.t || now)) / 1000;
      let v = 0;
      for (let i = 0; i < 2; i++) {
        v += Math.hypot(wrists[i].x - this.lastWrists[i].x, wrists[i].y - this.lastWrists[i].y);
      }
      const inst = Math.min(1, (v / torso / dt) * 0.55);
      this.energySmooth = this.energySmooth * 0.82 + inst * 0.18;
    }
    this.lastWrists = wrists;

    const pts = [shL, shR, elL, elR, wrL, wrR, hipL, hipR, midSh, midHip,
      p(0), p(25), p(26), p(27), p(28)]; // + head, knees, ankles (mirrored)
    this.latest = { t: now, features, energy: this.energySmooth, points: pts };
  }

  private decayEnergy() {
    this.energySmooth *= 0.9;
    return this.energySmooth;
  }

  stop() {
    const s = this.video.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}
