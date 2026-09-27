// Pose inference off the main thread. MediaPipe's detectForVideo is
// synchronous: on the main thread it stalls every animation frame for the
// length of one inference, which halved frame pacing with the camera on.
// Here it runs in a dedicated module worker; the page transfers one
// ImageBitmap per new camera frame and gets landmarks back.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseWorkerRequest, PoseWorkerResponse } from './pose-protocol';

const scope = self as unknown as {
  postMessage(message: PoseWorkerResponse): void;
  onmessage: ((e: MessageEvent<PoseWorkerRequest>) => void) | null;
};
const post = (m: PoseWorkerResponse) => scope.postMessage(m);

let landmarker: PoseLandmarker | null = null;

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) post({ type: 'progress', stage: 'download', progress: Math.min(1, received / total) });
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function init(wasm: string, model: string) {
  post({ type: 'progress', stage: 'download', progress: 0 });
  const [files, buffer] = await Promise.all([FilesetResolver.forVisionTasks(wasm, true), download(model)]);
  post({ type: 'progress', stage: 'compile', progress: 1 });
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetBuffer: buffer, delegate },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
  });
  let delegate: 'GPU' | 'CPU' = 'GPU';
  try {
    landmarker = await PoseLandmarker.createFromOptions(files, options('GPU'));
  } catch {
    delegate = 'CPU';
    landmarker = await PoseLandmarker.createFromOptions(files, options('CPU'));
  }
  post({ type: 'ready', delegate });
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    init(m.wasm, m.model).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  if (m.type === 'frame') {
    const started = performance.now();
    let landmarks = null, world = null;
    try {
      if (landmarker) {
        const res = landmarker.detectForVideo(m.bitmap, m.ts);
        landmarks = res.landmarks?.[0] ?? null;
        world = res.worldLandmarks?.[0] ?? null;
      }
    } catch { /* a failed frame reports no pose; the next frame retries */ }
    m.bitmap.close();
    post({ type: 'result', ts: m.ts, landmarks, world, cost: performance.now() - started });
    return;
  }
  if (m.type === 'close') {
    landmarker?.close();
    landmarker = null;
  }
};
