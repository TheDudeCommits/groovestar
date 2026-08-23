// ICE server config for all WebRTC connections (multiplayer + phone camera).
// STUN alone can't connect players behind carrier-grade NAT (common on mobile
// networks) — that needs a TURN relay. Configure ONE of these on Vercel:
//   METERED_DOMAIN + METERED_API_KEY   — metered.ca free tier (recommended);
//                                        fresh short-lived creds fetched here
//   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL — any static TURN server
// With neither set, returns STUN-only and turn:false so the client can show
// honest error messages.
// GET /api/ice  (no-store: TURN credentials must never sit in the CDN cache)

import { checkOrigin, rateLimit } from './_utils.js';

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export default async function handler(req: any, res: any) {
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, 'ice', 20)) return;
  res.setHeader('Cache-Control', 'no-store');

  const { METERED_DOMAIN, METERED_API_KEY, TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = process.env;

  if (METERED_DOMAIN && METERED_API_KEY) {
    try {
      const r = await fetch(
        `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}`,
      );
      if (r.ok) {
        const servers = await r.json();
        if (Array.isArray(servers) && servers.length) {
          res.status(200).json({ iceServers: servers, turn: true });
          return;
        }
      }
    } catch { /* fall through to static / stun-only */ }
  }

  if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) {
    res.status(200).json({
      iceServers: [
        ...STUN,
        { urls: TURN_URLS.split(',').map((s) => s.trim()), username: TURN_USERNAME, credential: TURN_CREDENTIAL },
      ],
      turn: true,
    });
    return;
  }

  res.status(200).json({ iceServers: STUN, turn: false });
}
