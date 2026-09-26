// Owns the pose worker: preloads the model before anyone opens the camera,
// reports load progress for the setup screen, and routes results back to the
// tracker. Falls back (resolves false) when workers, ImageBitmap or
// OffscreenCanvas are unavailable, so the tracker can use the main thread.

import { POSE_MODEL_URL, POSE_WASM_URL, type PoseStage, type PoseWorkerResponse } from './pose-protocol';

export interface PoseEngineStatus {
  stage: PoseStage;
  progress: number;
  delegate: 'GPU' | 'CPU' | null;
  error: string | null;
}

export type PoseResult = Extract<PoseWorkerResponse, { type: 'result' }>;

class PoseEngine {
  status: PoseEngineStatus = { stage: 'idle', progress: 0, delegate: null, error: null };
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private listeners = new Set<(s: PoseEngineStatus) => void>();
  private resultListener: ((r: PoseResult) => void) | null = null;

  get supported() {
    return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
  }

  get usable() { return this.status.stage === 'ready' && !!this.worker; }

  preload(): Promise<boolean> {
    if (this.ready) return this.ready;
    if (!this.supported) {
      this.set({ stage: 'error', error: 'Workers or OffscreenCanvas unavailable' });
      this.ready = Promise.resolve(false);
      return this.ready;
    }
    this.ready = new Promise<boolean>((resolve) => {
      try {
        this.worker = new Worker(new URL('./pose-worker.ts', import.meta.url), { type: 'module', name: 'groovestar-pose' });
      } catch (e) {
        this.set({ stage: 'error', error: String(e) });
        resolve(false);
        return;
      }
      this.worker.onmessage = (e: MessageEvent<PoseWorkerResponse>) => {
        const m = e.data;
        if (m.type === 'result') this.resultListener?.(m);
        else if (m.type === 'progress') this.set({ stage: m.stage, progress: m.progress });
        else if (m.type === 'ready') { this.set({ stage: 'ready', progress: 1, delegate: m.delegate }); resolve(true); }
        else if (m.type === 'error') { this.fail(m.message); resolve(false); }
      };
      this.worker.onerror = (e) => { this.fail(e.message || 'pose worker failed'); resolve(false); };
      this.worker.postMessage({ type: 'init', wasm: POSE_WASM_URL, model: POSE_MODEL_URL });
    });
    return this.ready;
  }

  /** Transfers the bitmap; the worker closes it. */
  detect(bitmap: ImageBitmap, ts: number) {
    if (!this.worker) { bitmap.close(); return false; }
    this.worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]);
    return true;
  }

  onResult(fn: ((r: PoseResult) => void) | null) { this.resultListener = fn; }

  subscribe(fn: (s: PoseEngineStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => { this.listeners.delete(fn); };
  }

  private fail(message: string) {
    this.worker?.terminate();
    this.worker = null;
    this.set({ stage: 'error', error: message });
  }

  private set(patch: Partial<PoseEngineStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }
}

export const poseEngine = new PoseEngine();
