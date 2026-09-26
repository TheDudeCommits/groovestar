# GrooveStar · Kinetic Broadcast

A browser movement arcade with Dance, Beat Blade, Boxing, Rush, Fruit Slice, Tennis and Bowling. Kinetic Broadcast adds an original 3D cast, authored game venues, camera movement practice, shared results/progress and original audio while retaining Classic Canvas and established Dance/YouTube/friend modes.

See [HANDOVER.md](HANDOVER.md) for current deployment and continuation details, [implementation and acceptance](docs/KINETIC_IMPLEMENTATION.md) for tested scope and open device gates, [art bible](docs/KINETIC_ART_BIBLE.md), and [gameplay evidence](docs/qa/README.md).

```sh
npm ci
npm run dev
npm test
npm run build
```

Camera processing runs in the browser. Explicit demos preview all games without earning progress. Physical webcam/phone tuning and real-network acceptance are still required for the Kinetic preview. The older documentation below explains retained baseline systems; the handover takes precedence where behavior changed.

---

# ⭐ GrooveStar

A camera-controlled dance game in the browser, built as a faithful recreation of the
**Just Dance** gameplay language — studied frame-by-frame from JD2014/JD2016 footage
(see [REFERENCE.md](REFERENCE.md) for the full breakdown).

**Play it:** allow the webcam, pick a song, stand back so your upper body is visible,
and mirror the on-screen coach. No webcam? Demo Mode runs the full show with
simulated scoring.

## The Just Dance DNA

| Reference system | GrooveStar implementation |
|---|---|
| Full-body coach, centered, locked camera | Canvas-rendered stylized dancer, blank glowing face, neon rim light, gloved tracked hand |
| Pictogram queue sliding to a "now" slot | Same move library renders coach pose, pictogram card, and scoring target |
| X / OK / GOOD / SUPER / PERFECT pops | Judgment pops under the player chip, per-move windows on the beat |
| Gold Moves ("YEAH", sunburst, freeze) | Gold pictograms → held pose, full-screen radial burst, sting, screen shake |
| Left star meter → 5 stars + superstar | 13,333-point scale with reference-style thresholds |
| Karaoke lyrics with sweep highlight | Original lyrics per song, word-sweep via CSS gradient |
| Beat-reactive stages that never occlude | 3 scenes: night-city geysers/aurora, gold bokeh, disco floor + neon letters |
| White-flash outro → count-up results | Congratulations banner, tabular count-up, stars popping at thresholds |

## You are the dancer

The center-stage character is a live mirror of the player, generated on the spot:

- During the "Get Ready" screen a ~1.5s **style scan** samples the webcam at
  landmark-guided regions (hair, cheeks, chest, forearms, thighs), takes
  per-channel medians across frames, and stylizes the palette into the game's
  neon language — a redhead gets a redheaded avatar, your hoodie color becomes
  the avatar's hoodie.
- **Sleeve detection**: forearm color closer to your shirt than to your skin →
  long sleeves → the avatar gets the hoodie treatment (hood, drawstrings,
  kangaroo pocket); otherwise bare arms.
- In play, MediaPipe landmarks are mirrored, smoothed, re-anchored to the stage
  and rendered as the stylized dancer (neon rim, blank glowing face, glove,
  wrist motion trails, beat-pulsing aura). Legs are synthesized with a groove
  stance when the camera only sees your upper body.
- Choreography guidance comes from the sliding pictogram queue plus a **mini
  coach** dancing the routine beside it; scoring compares your live pose to the
  choreography target.

## Motion tracking & scoring

1. MediaPipe PoseLandmarker (lite, GPU) tracks 33 landmarks from the webcam at ~30 fps.
2. Landmarks are mirrored (you mirror the coach) and reduced to a limb-angle vector:
   upper arms, forearms, torso lean — the same feature the move library exports.
3. Each choreography move opens a ±0.85-beat window; the best blended similarity
   (70% pose accuracy, 30% motion energy) inside the window becomes the judgment.
4. Deliberately forgiving: enthusiasm scores; standing still doesn't.

## Dance to any YouTube song

Paste a music-video or choreography link in the menu: the official YouTube
embed becomes the audio source and a dimmed neon-framed backdrop panel (the
game never downloads or re-hosts the video), and a routine is **generated on
the spot** — deterministic per video, so a song always gets "its" choreography.

- Set the tempo with **TAP THE BEAT** or a preset; pick a difficulty (levels
  add double-time mirror echoes).
- The generator works from a ~95-move library with an anti-repetition budget:
  16-beat section patterns, left/right call-and-response echoes, choruses keep
  a recognizable 4-move hook while refreshing their back half, fresh fills on
  odd repetitions, and one-time gold moves at section climaxes. A typical song
  uses 60+ unique moves and no move more than a handful of times.

### Real rhythm & lyric sync

- **Mic beat-sync**: while a YouTube track plays, the game listens to the room
  (optional mic permission), builds an onset envelope (spectral flux), and
  estimates the track's true tempo (autocorrelation) and beat phase (comb
  alignment). The beat grid is gently pulled onto the actual music — pictograms
  land on real downbeats. A chip shows "♪ LIVE SYNC" when locked.
- **Synced lyrics (LRCLIB)**: the video title is matched against LRCLIB's free
  synced-lyrics database; found lyrics power the in-game karaoke bar and the
  context-aware choreographers:
  - *Keyword tier* (always on): lyric words trigger matching moves — "jump" →
    star jump, "hands up" → raise the roof, "left/right", "down low", "spin"…
  - *AI tier* (optional): a serverless endpoint (`api/choreo.ts`) asks Claude
    to beat-map a full routine that understands the lyrics' meaning, song
    structure, and energy. Enable it by setting `ANTHROPIC_API_KEY` in the
    Vercel project env; results are cached per video. Without a key the
    endpoint returns 503 and the keyword tier takes over seamlessly.

## Real dance motion (AIST++)

YouTube routines are built from **200 real motion-capture dance clips** derived
from the [AIST++ Dance Motion Dataset](https://google.github.io/aistplusplus_dataset/)
(Li et al., annotations CC BY 4.0) — 20 clips × 10 genres (break, pop, lock,
middle/LA hip-hop, house, waacking, krump, street jazz, ballet jazz).
`tools/process_aist.py` converts the 60fps 3D keypoints into beat-aligned
2-beat clips in the game's pose parameterization (de-rotated to face front,
floorwork filtered, 16 keyframes each, diversity-selected per genre); at
runtime the coach Catmull-Roms through the keyframes so the movement — weight
shifts, bounce, follow-through — is the dancer's, not an interpolator's.
Scoring compares the player continuously against the clip's pose at each
instant. The generator keeps routines in 1–2 seeded genres; the AI tier picks
genres to match the song's mood. Static poses remain for gold-move freezes and
the built-in synth songs.

## Songs

Three original tracks are synthesized live with WebAudio (kick/clap/hats, filtered
saw bass, supersaw pads, arp leads — zero audio assets):

- **Neon Nights** — 120 BPM, night-city scene
- **Gold Rush** — 128 BPM, gold bokeh scene
- **Letter Party** — 116 BPM, disco floor with G-R-V letter poses

## Dev

```bash
npm install
npm run dev     # local dev
npm run build   # typecheck + production build to dist/
```

Vanilla TypeScript + Vite + Canvas 2D. Only runtime dependency: `@mediapipe/tasks-vision`.

## Multiplayer across different networks (TURN relay)

Multiplayer and phone-camera links are peer-to-peer (WebRTC). Two players on
far-apart networks — especially mobile carriers, which use carrier-grade NAT —
often can't connect directly with STUN alone; that needs a **TURN relay**.
The game asks `/api/ice` for its ICE servers, so enabling TURN is config-only:

1. Create a free account at [metered.ca](https://www.metered.ca/stun-turn)
   (free tier: 50 GB/month relay traffic) and create a TURN app.
2. On Vercel, set two environment variables and redeploy:
   - `METERED_DOMAIN` — your app domain, e.g. `yourapp.metered.live`
   - `METERED_API_KEY` — the API key from the Metered dashboard

Any other TURN server works too via `TURN_URLS` (comma-separated),
`TURN_USERNAME`, `TURN_CREDENTIAL`. Without TURN configured the game still
works on friendly networks and says so honestly when a connection can't be
made. Debug: set `localStorage['gs-forcerelay']='1'` to force all traffic
through the relay and prove the TURN path end-to-end.
