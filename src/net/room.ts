// Multiplayer rooms over WebRTC (PeerJS + its free public broker — no server
// of our own). Topology: game data flows through the host (star — host relays
// every message to the other guests, so guests only need one data connection),
// while webcam video is a full mesh of direct MediaConnections.
//
// Room codes are 4 digits; the host's peer id is derived from the code.

import Peer, { DataConnection, MediaConnection } from 'peerjs';
import type { StyleProfile } from '../appearance';
import { getRtcConfig } from './ice';

const PREFIX = 'groovestar-v1-';
export const MAX_PLAYERS = 4;

export type NetMsg =
  | { t: 'hello'; name: string }
  | { t: 'roster'; players: { id: string; name: string }[] }
  | { t: 'full' }
  | { t: 'style'; style: StyleProfile }
  | { t: 'start'; videoId: string; bpm: number; intro: number }
  | { t: 'pose'; d: number[] }          // quantized landmarks (see poseCodec)
  | { t: 'score'; s: number; stars: number }
  | { t: 'end'; s: number };

export interface Envelope { from: string; msg: NetMsg }

export class Room {
  peer!: Peer;
  code = '';
  isHost = false;
  myName = '';
  /** ordered roster incl. self — index = corner slot */
  players: { id: string; name: string }[] = [];
  private conns = new Map<string, DataConnection>();      // host: all guests; guest: just host
  private mediaConns = new Map<string, MediaConnection>();
  private myStream: MediaStream | null = null;
  private dead = false;

  onUpdate: (() => void) | null = null;                    // roster changed
  onMessage: ((from: string, msg: NetMsg) => void) | null = null;
  onStream: ((peerId: string, stream: MediaStream) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;

  get myId() { return this.peer?.id ?? ''; }

  // ---- lifecycle -----------------------------------------------------------

  static async create(name: string): Promise<Room> {
    const { config } = await getRtcConfig();
    const room = new Room();
    room.isHost = true;
    room.myName = name;
    room.code = String(1000 + Math.floor(Math.random() * 9000));
    return new Promise((resolve, reject) => {
      room.peer = new Peer(PREFIX + room.code, { config });
      const timeout = setTimeout(() =>
        reject(new Error('Multiplayer service unreachable \u2014 a firewall or VPN may be blocking it.')), 12000);
      room.peer.on('open', () => {
        clearTimeout(timeout);
        room.players = [{ id: room.peer.id, name }];
        room.keepRegistered();
        room.wireHost();
        resolve(room);
      });
      room.peer.on('error', (e: any) => {
        if (String(e?.type) === 'unavailable-id') {
          // code collision — extremely unlikely; caller can retry
          reject(new Error('Room code collision, try again.'));
        } else reject(e);
      });
    });
  }

  static async join(code: string, name: string): Promise<Room> {
    const { config, turn } = await getRtcConfig();
    const room = new Room();
    room.isHost = false;
    room.myName = name;
    room.code = code;
    return new Promise((resolve, reject) => {
      room.peer = new Peer({ config });
      const fail = (m: string) => reject(new Error(m));
      const brokerTimeout = setTimeout(() =>
        fail('Multiplayer service unreachable — a firewall or VPN may be blocking it.'), 12000);
      room.peer.on('open', () => {
        clearTimeout(brokerTimeout);
        const conn = room.peer.connect(PREFIX + code, { reliable: true });
        // reaching here with no peer-unavailable error means the room EXISTS —
        // a timeout is the P2P connection itself failing, which across strict
        // networks (mobile carriers, hotels) needs a TURN relay. Say so
        // instead of blaming the code.
        const timeout = setTimeout(() => fail(turn
          ? 'Found the room, but the connection could not be established. Try again — or switch one player to a phone hotspot.'
          : 'Found the room, but your networks block a direct connection. Try a phone hotspot on one side.'), 20000);
        conn.on('open', () => {
          clearTimeout(timeout);
          room.keepRegistered();
          room.conns.set('host', conn);
          conn.send({ from: room.peer.id, msg: { t: 'hello', name } } satisfies Envelope);
          conn.on('data', (raw) => room.handleGuestData(raw as Envelope));
          conn.on('close', () => room.onClosed?.('The host left the room.'));
          room.wireMedia();
          resolve(room);
        });
        conn.on('error', () => { clearTimeout(timeout); fail('Could not reach that room.'); });
      });
      room.peer.on('error', (e: any) => {
        clearTimeout(brokerTimeout);
        if (String(e?.type) === 'peer-unavailable') {
          fail('Room not found — double-check the code and make sure the host is still on the lobby screen.');
        } else fail(String(e?.message ?? e));
      });
    });
  }

  /** the free broker drops idle sockets — reconnect so the room stays reachable */
  private keepRegistered() {
    this.peer.on('disconnected', () => {
      if (!this.dead) setTimeout(() => { if (!this.dead) this.peer.reconnect(); }, 1000);
    });
  }

  destroy() {
    this.dead = true;
    try { this.peer?.destroy(); } catch { /* gone */ }
    this.conns.clear();
    this.mediaConns.clear();
  }

  // ---- host ----------------------------------------------------------------

  private wireHost() {
    this.peer.on('connection', (conn) => {
      conn.on('data', (raw) => this.handleHostData(conn, raw as Envelope));
      conn.on('close', () => {
        const id = [...this.conns.entries()].find(([, c]) => c === conn)?.[0];
        if (id) {
          this.conns.delete(id);
          this.players = this.players.filter((p) => p.id !== id);
          this.broadcastRoster();
          this.onUpdate?.();
        }
      });
    });
    this.wireMedia();
  }

  private handleHostData(conn: DataConnection, env: Envelope) {
    if (env.msg.t === 'hello') {
      if (this.players.length >= MAX_PLAYERS) {
        conn.send({ from: this.peer.id, msg: { t: 'full' } } satisfies Envelope);
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(env.from, conn);
      this.players.push({ id: env.from, name: env.msg.name.slice(0, 14) || 'PLAYER' });
      this.broadcastRoster();
      this.onUpdate?.();
      return;
    }
    // relay everything else to the other guests + deliver locally
    for (const [id, c] of this.conns) {
      if (id !== env.from) c.send(env);
    }
    this.onMessage?.(env.from, env.msg);
  }

  private broadcastRoster() {
    const msg: NetMsg = { t: 'roster', players: this.players };
    for (const c of this.conns.values()) {
      c.send({ from: this.peer.id, msg } satisfies Envelope);
    }
  }

  // ---- guest ---------------------------------------------------------------

  private handleGuestData(env: Envelope) {
    if (env.msg.t === 'roster') {
      this.players = env.msg.players;
      this.onUpdate?.();
      // establish media mesh with everyone we don't have a call with yet
      if (this.myStream) this.callMissing();
      return;
    }
    if (env.msg.t === 'full') {
      this.onClosed?.('That room is full (4 players max).');
      return;
    }
    this.onMessage?.(env.from, env.msg);
  }

  // ---- messaging -----------------------------------------------------------

  send(msg: NetMsg) {
    const env: Envelope = { from: this.myId, msg };
    if (this.isHost) {
      for (const c of this.conns.values()) c.send(env);
    } else {
      this.conns.get('host')?.send(env);
    }
  }

  // ---- webcam mesh ---------------------------------------------------------

  private wireMedia() {
    this.peer.on('call', (call) => {
      call.answer(this.myStream ?? undefined);
      this.acceptCall(call);
    });
  }

  /** share our camera stream with the room (call once the camera is live) */
  shareStream(stream: MediaStream) {
    this.myStream = stream;
    this.callMissing();
  }

  private callMissing() {
    if (!this.myStream) return;
    for (const p of this.players) {
      if (p.id === this.myId || this.mediaConns.has(p.id)) continue;
      // deterministic caller: lower id calls higher id, avoids double calls
      if (this.myId < p.id) {
        const call = this.peer.call(p.id, this.myStream);
        if (call) { this.mediaConns.set(p.id, call); this.acceptCall(call); }
      }
    }
  }

  private acceptCall(call: MediaConnection) {
    this.mediaConns.set(call.peer, call);
    call.on('stream', (remote) => this.onStream?.(call.peer, remote));
    call.on('close', () => this.mediaConns.delete(call.peer));
  }
}

// ---------------------------------------------------------------------------
// Pose codec: the landmark indices the avatar renderer consumes, quantized to
// integers (x,y ×1000, visibility ×100). ~21 landmarks → 63 ints per packet.

const POSE_IDX = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];

export function encodePose(lms: { x: number; y: number; z?: number; visibility?: number }[]): number[] {
  const out: number[] = [];
  for (const i of POSE_IDX) {
    const l = lms[i];
    out.push(
      Math.round(l.x * 1000), Math.round(l.y * 1000),
      Math.round((l.z ?? 0) * 1000), Math.round((l.visibility ?? 1) * 100),
    );
  }
  return out;
}

export interface WirePoint { x: number; y: number; z: number; visibility: number }

export function decodePose(d: number[]): WirePoint[] | null {
  if (d.length !== POSE_IDX.length * 4) return null;
  const lms: WirePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  POSE_IDX.forEach((idx, k) => {
    lms[idx] = { x: d[k * 4] / 1000, y: d[k * 4 + 1] / 1000, z: d[k * 4 + 2] / 1000, visibility: d[k * 4 + 3] / 100 };
  });
  return lms;
}
