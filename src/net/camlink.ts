// Phone-as-camera / TV mode. The big screen runs the game; a phone joins with
// a 4-digit code, runs pose tracking LOCALLY (so only tiny pose packets + one
// video stream cross the network), and becomes the camera. Same PeerJS broker
// as multiplayer, separate code namespace.

import Peer, { DataConnection } from 'peerjs';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { computeFrame, type FrameState, type PlayerFrame, type PoseTracker } from '../pose/tracker';
import { encodePose, decodePose } from './room';
import { getRtcConfig } from './ice';

const CAM_PREFIX = 'groovestar-cam-';

/** TV side: looks exactly like a PoseTracker to the game loop */
export class TvCamHost {
  code = '';
  video = document.createElement('video');
  latest: PlayerFrame = { t: 0, features: null, energy: 0, points: null };
  latestLandmarks: NormalizedLandmark[] | null = null;
  connected = false;
  onChange: (() => void) | null = null;
  private peer!: Peer;
  private st: FrameState = { lastWrists: null, energy: 0 };

  static async create(): Promise<TvCamHost> {
    const { config } = await getRtcConfig();
    const host = new TvCamHost();
    host.video.playsInline = true;
    host.video.muted = true;
    host.code = String(1000 + Math.floor(Math.random() * 9000));
    return new Promise((resolve, reject) => {
      host.peer = new Peer(CAM_PREFIX + host.code, { config });
      const timeout = setTimeout(() => reject(new Error('Could not reach the connection service — a firewall or VPN may be blocking it.')), 12000);
      host.peer.on('open', () => {
        clearTimeout(timeout);
        host.peer.on('disconnected', () => {
          if (!host.destroyed) setTimeout(() => { if (!host.destroyed) host.peer.reconnect(); }, 1000);
        });
        host.peer.on('connection', (conn: DataConnection) => {
          conn.on('data', (raw: any) => {
            if (raw?.t === 'pose' && Array.isArray(raw.d)) {
              const lms = decodePose(raw.d);
              if (lms) {
                host.latestLandmarks = lms as unknown as NormalizedLandmark[];
                const now = performance.now();
                host.latest = computeFrame(host.latestLandmarks, now, host.st, host.latest.t);
              }
            }
          });
          conn.on('close', () => { host.connected = false; host.latestLandmarks = null; host.onChange?.(); });
          host.connected = true;
          host.onChange?.();
        });
        host.peer.on('call', (call) => {
          call.answer();
          call.on('stream', (stream) => {
            host.video.srcObject = stream;
            host.video.play().catch(() => { /* autoplay */ });
          });
        });
        resolve(host);
      });
      host.peer.on('error', (e: any) => { clearTimeout(timeout); reject(new Error(String(e?.message ?? e))); });
    });
  }

  update() { /* frames arrive over the wire — nothing to poll */ }

  destroyed = false;

  destroy() {
    this.destroyed = true;
    try { this.peer?.destroy(); } catch { /* gone */ }
    this.connected = false;
  }
}

/** Phone side: track locally, stream poses + video to the TV */
export async function connectPhoneCam(
  code: string,
  tracker: PoseTracker,
  onStatus: (s: string) => void,
): Promise<{ stop: () => void }> {
  const { config, turn } = await getRtcConfig();
  return new Promise((resolve, reject) => {
    const peer = new Peer({ config });
    const fail = (m: string) => reject(new Error(m));
    // long enough for a TURN-relayed connection to negotiate
    const timeout = setTimeout(() => fail(turn
      ? 'Found the screen, but the connection could not be established — try again.'
      : 'Found the screen, but this network blocks a direct connection — try the phone on wifi or hotspot.'), 20000);
    peer.on('open', () => {
      const conn = peer.connect(CAM_PREFIX + code, { reliable: false });
      conn.on('open', () => {
        clearTimeout(timeout);
        onStatus('Connected — streaming your camera to the big screen.');
        const stream = tracker.video.srcObject as MediaStream | null;
        if (stream) peer.call(CAM_PREFIX + code, stream);
        const timer = window.setInterval(() => {
          tracker.update();
          if (tracker.latestLandmarks) {
            conn.send({ t: 'pose', d: encodePose(tracker.latestLandmarks) });
          }
        }, 66);
        conn.on('close', () => { clearInterval(timer); onStatus('Disconnected from the big screen.'); });
        resolve({ stop: () => { clearInterval(timer); try { peer.destroy(); } catch { /* gone */ } } });
      });
      conn.on('error', () => { clearTimeout(timeout); fail('Could not reach that screen.'); });
    });
    peer.on('error', (e: any) => {
      clearTimeout(timeout);
      if (String(e?.type) === 'peer-unavailable') fail('No screen is waiting on that code.');
      else fail('Connection service unreachable — a firewall or VPN may be blocking it.');
    });
  });
}
