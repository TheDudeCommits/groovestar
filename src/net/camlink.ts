// Phone-as-camera / TV mode. The big screen runs the game; a phone joins with
// a 4-digit code, runs pose tracking LOCALLY (so only tiny pose packets + one
// video stream cross the network), and becomes the camera. Same PeerJS broker
// as multiplayer, separate code namespace.

import Peer, { DataConnection } from 'peerjs';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { computeFrame, type FrameState, type PlayerFrame, type PoseTracker } from '../pose/tracker';
import { encodePose, decodePose } from './room';
import { getRtcConfig } from './ice';
import {decodeCameraPacket} from './camera-packet';

const CAM_PREFIX = 'groovestar-cam-';

/** TV side: looks exactly like a PoseTracker to the game loop */
export class TvCamHost {
  code = '';
  video = document.createElement('video');
  latest: PlayerFrame = { t: 0, features: null, energy: 0, points: null };
  latestLandmarks: NormalizedLandmark[] | null = null;
  connected = false;
  latestWorld: NormalizedLandmark[] | null = null;
  aspect = 4 / 3;
  private sequence = -1;
  private connection:DataConnection|null=null;
  stats={protocol:1,rtt:0,interval:0,jitter:0,estimatedPoseAge:null as number|null};
  private clockOffset:number|null=null;
  private receivedAt = 0;
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
      const timeout = setTimeout(() => reject(new Error('Could not reach the connection service. A firewall or VPN may be blocking it.')), 12000);
      host.peer.on('open', () => {
        clearTimeout(timeout);
        host.peer.on('disconnected', () => {
          if (!host.destroyed) setTimeout(() => { if (!host.destroyed) host.peer.reconnect(); }, 1000);
        });
        host.peer.on('connection', (conn: DataConnection) => {
          host.connection?.close();host.connection=conn;host.sequence=-1;host.clockOffset=null;
          host.latestLandmarks=null;host.latestWorld=null;host.st={lastWrists:null,energy:0};
          const ping=()=>{if(conn.open)conn.send({t:'ping',hostTime:performance.now()});};
          const timer=window.setInterval(ping,2500);conn.on('open',ping);
          conn.on('data',(raw:any)=>{
            if(host.connection!==conn)return;
            if(raw?.t==='pong'&&Number.isFinite(raw.hostTime)&&Number.isFinite(raw.phoneTime)){
              const now=performance.now(),rtt=now-raw.hostTime;if(rtt<0||rtt>5000)return;
              host.stats.rtt=rtt;host.clockOffset=raw.phoneTime-(raw.hostTime+now)/2;return;
            }
            const packet=decodeCameraPacket(raw,host.sequence);if(!packet)return;
            const now=performance.now(),interval=now-host.receivedAt;
            if(host.receivedAt){host.stats.jitter=host.stats.jitter*.9+Math.abs(interval-host.stats.interval)*.1;host.stats.interval=host.stats.interval*.9+interval*.1;}else host.stats.interval=33;
            host.sequence=packet.sequence;host.stats.protocol=packet.version;host.receivedAt=now;
            host.stats.estimatedPoseAge=packet.capturedAt!==null&&host.clockOffset!==null?Math.max(0,now-(packet.capturedAt-host.clockOffset)):null;
            host.latestLandmarks=packet.landmarks;host.latestWorld=packet.world;host.aspect=packet.aspect;
            host.latest=computeFrame(host.latestLandmarks,now,host.st,host.latest.t);
          });
          conn.on('close',()=>{clearInterval(timer);if(host.connection!==conn)return;host.connected=false;host.latestLandmarks=null;host.latestWorld=null;host.sequence=-1;host.connection=null;host.onChange?.();});
          host.connected=true;host.onChange?.();
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

  update() { if (performance.now() - this.receivedAt > 240) { this.latestLandmarks = null; this.latestWorld = null; this.latest = { ...this.latest, points: null, features:null, energy: 0 }; } }

  destroyed = false;

  destroy() {
    this.destroyed = true;
    try { this.peer?.destroy(); } catch { /* gone */ }
    this.connected = false;this.video.pause();this.video.srcObject=null;this.latestLandmarks=null;this.latestWorld=null;
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
    const fail = (m: string) => {peer.destroy();reject(new Error(m));};
    // long enough for a TURN-relayed connection to negotiate
    const timeout = setTimeout(() => fail(turn
      ? 'Found the screen, but the connection could not be established. Try again.'
      : 'Found the screen, but this network blocks a direct connection. Try the phone on wifi or a hotspot.'), 20000);
    peer.on('open', () => {
      const conn = peer.connect(CAM_PREFIX + code, { reliable: false });
      conn.on('data',(raw:any)=>{if(raw?.t==='ping'&&Number.isFinite(raw.hostTime))conn.send({t:'pong',hostTime:raw.hostTime,phoneTime:performance.now()});});
      conn.on('open', () => {
        clearTimeout(timeout);
        onStatus('Connected. Streaming your camera to the big screen.');
        const stream = tracker.video.srcObject as MediaStream | null;
        if (stream) peer.call(CAM_PREFIX + code, stream);
        let seq = 0;
        let lastSent = -1;
        const timer = window.setInterval(() => {
          tracker.update();
          if (tracker.latestLandmarks && tracker.latest.t !== lastSent) {
            lastSent = tracker.latest.t;
            conn.send({ t: 'pose', v: 2, seq: seq++, capturedAt: tracker.latest.t, aspect: tracker.aspect, d: encodePose(tracker.latestLandmarks), points:tracker.latestLandmarks.map(p=>[p.x,p.y,p.z,p.visibility??1]), world: tracker.latestWorld?.map(p => [p.x, p.y, p.z, p.visibility ?? 1]) ?? null });
          }
        }, 33);
        conn.on('close', () => { clearInterval(timer); onStatus('Disconnected from the big screen.'); });
        resolve({ stop: () => { clearInterval(timer); try { peer.destroy(); } catch { /* gone */ } } });
      });
      conn.on('error', () => { clearTimeout(timeout); fail('Could not reach that screen.'); });
    });
    peer.on('error', (e: any) => {
      clearTimeout(timeout);
      if (String(e?.type) === 'peer-unavailable') fail('No screen is waiting on that code.');
      else fail('Connection service unreachable. A firewall or VPN may be blocking it.');
    });
  });
}
