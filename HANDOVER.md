# GrooveStar — Session Handover

Live: https://groovestar.vercel.app · Repo: TheDudeCommits/groovestar (main auto-deploys production on push — there is NO staging; every `git push` ships).

## What this is

A browser camera-motion game suite. Core: a Just Dance-style dance game (solid, well-liked), plus a six-game "movement suite" (Fruit Slice, Beat Blade, Rush, Bowling, Tennis, Boxing) added in the last session which the owner has judged **not good on a real camera — needs fundamental rework, see "Why the games failed" below. Start there.**

## Stack

- Vite + vanilla TypeScript + Canvas 2D. No frameworks, no three.js (3D characters were tried and ROLLED BACK by owner request — do not reintroduce).
- MediaPipe Tasks Vision PoseLandmarker (lite, GPU, VIDEO mode) from CDN. `src/pose/tracker.ts` exposes `latestLandmarks` (normalized) and `latestWorld` (meters).
- PeerJS multiplayer (host-relay star for data, mesh for webcam video) + TURN relay via Metered (env: `METERED_DOMAIN`, `METERED_API_KEY` on Vercel; `/api/ice` hands out creds).
- Serverless API in `/api` (origin-guarded + rate-limited, CDN-cached GETs): `choreo` + `songmeta` (Claude claude-opus-5, key in Vercel env only), `search`, `lyrics` (LRCLIB), `vibe` (thumbnail palettes), `ice`.

## Commands

- `cd /Users/amir/Claude/groovestar && npm run dev` (localhost:5173), `npm run build` (tsc + vite).
- Testing: playwright-core with `channel: 'chrome'`, fake camera flag `--use-file-for-fake-video-capture=/tmp/fakecam.y4m` (a JD gameplay clip; recreate with yt-dlp + `ffmpeg -i clip.mp4 -pix_fmt yuv420p -s 640x480 /tmp/fakecam.y4m`). Run test scripts FROM the project dir (node_modules resolution). macOS: no `timeout` cmd; `sed -i ''`.
- CAUTION: editing files while a dev-server playwright run is active hot-reloads the page and corrupts the test.

## The dance game (owner is happy with this — protect it)

- `src/main.ts` (~2000 lines): menu, all flows, play loop, results. States: menu/ready/play/results.
- Modes: Classics catalog (44 extracted real JD routines in `public/routines/*.json`, index.json curated titles), any-YouTube-song (AI choreo via /api/choreo, 45s client wait, CDN-cached globally), multiplayer dance-off (rooms, 4-digit codes, host broadcasts routine), phone-as-camera, fitness mode (25-kcal milestone flashes, total on results only).
- Body renderer `src/body.ts` (BodyArt): constructed anatomy — curved tapered limbs, torso from measured shoulder/hip scan (`shoulderScale`/`hipScale` in BodyShape), clothing as geometry (hoodie/jacket/tee/skirt via `Look`), joint cover caps (shoulders/hips — fixed visible seams), face with tracking pupils/blinks, spring hair. Soft gradients — owner REJECTED hard cel shading + interior line art (rolled back). `drawCharacter` in coach.ts renders choreography-driven characters (crew, mini guide, menu, victory) via pooled BodyArt with `lite: true`.
- Judgment rim = the white sticker outline tinted by judgment color (single element; gold/green/blue/red). Pictograms are the ORIGINAL thin stick figures — owner rejected my chunky-silhouette redesign as more confusing. Open question for pictograms: ask owner whether the confusion is which-limb, which-direction, or when-to-hit before redesigning again.
- Characters: `src/characters.ts` CAST (8 presets) + auto look from calibration scan. 3D skin removed.
- Tracking feel: One-Euro filter + 70ms velocity extrapolation + full-frame-rate detection when <9ms/detect (in avatar.update + tracker). Owner noticed and wants this snappiness. LESSON: commit feel changes separately from visual changes (a visual rollback once took the tracking with it).
- Scoring: raw points normalized against a simulated flawless run (combo multiplier ×2/×3/×4 at 4/8/12; OK holds combo; X breaks). Flawless = exactly 13333. Strictness was raised twice at owner request (similarity zero at 70°, PERFECT ≥0.85, timing weight 30%).

## UI rules (owner-enforced, do not violate)

- NO emojis anywhere. NO em dashes in copy. No boxed panels — letterspaced uppercase section labels, underline inputs, type-only buttons with gold sweep-underline hover. Chip toggles (rounded, gold fill when active).
- Fonts: Lilita One (display) + Baloo 2 (UI). Warm violet-magenta-sunset gradient sky, single gold accent `--acc: #ffd23e`. Owner rejected: cold techno fonts, near-black gloom, lime accent, opacity-dim hovers.
- Owner detests "vibe-coded / AI-generated" looks. Minimal text. Balanced alignment (one column grid).

## THE MOVEMENT SUITE — why the games failed & the fix plan

`src/games/`: fruit.ts, beatblade.ts, rush.ts, bowl.ts, tennis.ts, box.ts, shared.ts, covers.ts. Gesture engine: `src/pose/gestures.ts` (SwingDetector, PunchDetector, BodyDetector). Registry + launchers in main.ts (`ARCADE` array).

Owner verdict after real-camera play: ALL SIX are bad. Root causes (honest assessment):

1. **Everything was tuned in demo mode / fake-camera footage, never on a real body.** All thresholds are guesses.
2. **Unit bug in PunchDetector**: it mixes `worldLandmarks` z (METERS) with normalized-landmark z depending on availability, then applies one fused threshold (1.35). The scales differ wildly — punch detection is effectively random. Fix: use worldLandmarks exclusively, thresholds in m/s (punch z-velocity is typically 2–4 m/s).
3. **Gesture latency**: SwingDetector spans a 6-frame history (~200ms) then has a 350ms refractory — swings feel swallowed. Tennis's hit window (z ≤ 0.14, ~0.3s) is far too tight against that latency.
4. **No visible hand/body cursors in most games** — players can't see what the game thinks they're doing, so it feels broken even when tracking works.
5. **Discrete gesture events are the wrong model for half of these.** Tennis/bowling would feel dramatically better as CONTINUOUS mechanics: racket/ball glued to the tracked hand every frame, contact by overlap+velocity, rather than "did a SwingEvent fire inside a window."

Recommended plan for next session, in order:
1. Build a **gesture debug overlay** (toggle via localStorage `gs-debug`): draw live wrist speeds, punch fusion components, lane value, jump/duck flags, thresholds as bars on screen. Have the owner stand in front of the camera for 2 minutes per gesture; tune the numbers live. This converts guesswork into measurement and is the highest-leverage hour available.
6. Centralize all thresholds into one tunable config object (with localStorage overrides) instead of magic numbers per file.
2. Fix PunchDetector units (worldLandmarks only).
3. Convert Tennis + Fruit + Beat Blade to continuous hand-cursor mechanics (racket follows hand; blades already do this — their problem is threshold + fruit spawn pacing). Add always-visible hand cursors to every game.
4. Rebuild game-by-game WITH the owner playing after each change ("we'll go through them one by one together" was the plan — do that, don't batch).
5. Not yet built from the blueprint (`docs/EXPANSION.md`): couch 2P (`numPoses: 2`), online parallel-race MP for arcade games, Beat Blade mic-sync charts.

## Classics extraction pipeline (works, documented for reuse)

`tools/extract_jd/`: `run_one.sh` (yt-dlp h264 download → pose_extract.mjs headless-Chrome MediaPipe over the video via localhost range server → build_routine.py: octave-family autocorrelation BPM + least-squares beat snap + Claude tempo prior via /api/songmeta → 16-kf 2-beat windows). `batch.sh` (3 workers; note the `< /dev/null` stdin fix). `build_index.py` (curated titles, quality culls). Culled: Pac-Man, Hips Don't Lie Sumo (costumes defeat tracking), That POWER, Lean On (fragmented footage). Blue (AFIqSaZM2D0) has lead=178 beats (video's routine starts ~84s in) — classics seek past long leads at start; classics show NO karaoke overlay (song-vs-video timeline mismatch).

## Env / accounts

- Vercel project `groovestar` (linked via `.vercel/`): env has ANTHROPIC_API_KEY, METERED_DOMAIN=groovestar.metered.live, METERED_API_KEY. `npx vercel` CLI is authenticated; `vercel --prod` from local FAILS (build env) — deploy by git push only.
- Quaternius CC0 packs were downloaded then removed with the 3D rollback; itch download flow + gdown venv (/tmp/jdvenv) documented in git history if ever needed.

## Testing recipes

- Menu/gameplay screenshots: playwright headless + fake cam; wait for `.hud` via querySelector-polling (the element is zero-size — `waitForSelector` visibility never fires).
- Demo mode (no camera flags) exercises every game via autopilots.
- FPS probe and CDP CPU profile snippets are in git history (session of 2026-08-24). Headless is software-rendered — only use RELATIVE numbers.
- Scorer simulations: `npx tsx` scripts importing src modules directly (see git history for examples).

## Owner working style (important)

- Ships fast, judges by playing on a real camera + screenshots; wants rollbacks honored immediately and completely.
- Prefers being shown 2-3 concrete options ranked, then says "implement N".
- Wants milestones/celebrations over persistent HUD labels; happy uplifting tone; hates clutter.
- When something's broken, they send a screenshot — read it carefully, it usually contains the diagnosis.
