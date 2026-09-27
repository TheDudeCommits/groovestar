import { defineConfig } from 'vite';

// The pose worker is an ES module worker in dev and in production builds, so
// MediaPipe loads its module WASM loader the same way in both.
export default defineConfig({
  worker: { format: 'es' },
});
