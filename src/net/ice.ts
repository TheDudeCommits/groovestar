// Fetches the ICE server list from /api/ice before any peer connection.
// When a TURN relay is configured server-side, players behind carrier-grade
// NAT (most mobile networks) can still connect; without one we fall back to
// STUN-only and report turn:false so error messages can be honest about it.

const STUN_ONLY: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
};

export interface RtcSetup { config: RTCConfiguration; turn: boolean }

let cached: (RtcSetup & { at: number }) | null = null;

export async function getRtcConfig(): Promise<RtcSetup> {
  // TURN creds are short-lived — re-fetch every 10 minutes
  if (cached && performance.now() - cached.at < 10 * 60_000) {
    return { config: cached.config, turn: cached.turn };
  }
  let setup: RtcSetup = { config: STUN_ONLY, turn: false };
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('/api/ice', { signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j?.iceServers) && j.iceServers.length) {
        setup = { config: { iceServers: j.iceServers, iceCandidatePoolSize: 2 }, turn: !!j.turn };
      }
    }
  } catch { /* dev server / offline — STUN-only */ }
  // debug hook: force every connection through the relay to prove TURN works
  if (localStorage.getItem('gs-forcerelay') === '1') {
    setup.config.iceTransportPolicy = 'relay';
  }
  cached = { ...setup, at: performance.now() };
  return setup;
}
