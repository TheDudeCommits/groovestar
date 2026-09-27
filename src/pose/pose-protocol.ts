// Messages between the page and the pose worker.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const POSE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export type PoseWorkerRequest =
  | { type: 'init'; wasm: string; model: string }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number }
  | { type: 'close' };

export type PoseStage = 'idle' | 'download' | 'compile' | 'ready' | 'error';

export type PoseWorkerResponse =
  | { type: 'progress'; stage: 'download' | 'compile'; progress: number }
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  | { type: 'result'; ts: number; landmarks: NormalizedLandmark[] | null; world: NormalizedLandmark[] | null; cost: number };
