// Pose extraction: runs the game's own MediaPipe PoseLandmarker over a local
// video file in headless Chrome, stepping frame-by-frame at SAMPLE_FPS.
// Usage: node pose_extract.mjs <videoFile> <outJson>
// Emits: { fps, dur, frames: [[tSec, present, x0,y0,v0, x1,y1,v1, ...13 pts] ...] }
// Points: nose, Lsho, Rsho, Lelb, Relb, Lwri, Rwri, Lhip, Rhip, Lkne, Rkne, Lank, Rank
// (MediaPipe "L/R" = subject anatomical side; viewer-left is subject-RIGHT.)

import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { basename } from 'path';

const [file, out] = process.argv.slice(2);
const SAMPLE_FPS = 24;
const IDX = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// serve the video over localhost (file:// + headless chrome don't mix)
const srv = createServer((req, res) => {
  if (!req.url.endsWith('.mp4')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>extract</title>');
    return;
  }
  const size = statSync(file).size;
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = Number(m[1]), end = m[2] ? Number(m[2]) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1, 'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
    });
    const buf = readFileSync(file);
    res.end(buf.subarray(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(readFileSync(file));
  }
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await (await b.newContext()).newPage();
// (page is served from the same localhost origin as the video — no CORS/PNA)
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text().slice(0, 160)); });
await page.goto(`http://localhost:${port}/`);

const result = await page.evaluate(async ({ url, fps, idx }) => {
  const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
  const files = await vision.FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  const lm = await vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  const video = document.createElement('video');
  video.muted = true; video.crossOrigin = 'anonymous';
  video.src = url;
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('video load failed'));
  });
  const dur = video.duration;
  const frames = [];
  const step = 1 / fps;
  let ts = 0;
  for (let t = 0; t < dur; t += step) {
    video.currentTime = t;
    await new Promise((res) => { video.onseeked = res; });
    ts += 33; // monotToneous fake ms timeline for the VIDEO-mode tracker
    let res2;
    try { res2 = lm.detectForVideo(video, ts); } catch { continue; }
    const l = res2.landmarks?.[0];
    if (!l || l.length < 33) { frames.push([Math.round(t * 1000) / 1000, 0]); continue; }
    const row = [Math.round(t * 1000) / 1000, 1];
    for (const i of idx) {
      row.push(Math.round(l[i].x * 1000) / 1000, Math.round(l[i].y * 1000) / 1000,
        Math.round((l[i].visibility ?? 1) * 100) / 100);
    }
    frames.push(row);
  }
  return { fps, dur, frames };
}, { url: `http://localhost:${port}/${basename(file)}`, fps: SAMPLE_FPS, idx: IDX });

writeFileSync(out, JSON.stringify(result));
const ok = result.frames.filter((f) => f[1] === 1).length;
console.log(`${basename(file)}: ${result.frames.length} samples, ${Math.round((ok / result.frames.length) * 100)}% with pose, dur ${Math.round(result.dur)}s`);
await b.close();
srv.close();
