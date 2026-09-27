# GrooveStar · Round 4 handover (gameplay and mechanics)

Updated 28 September 2026. The owner played the round 3 preview with a real webcam: only Fruit Slice was good. Dance didn't respond to their moves (Nova danced alone), Beat Blade blocks couldn't be hit and had no excitement, Boxing was a pad drill instead of a real match against the AI or another player, Tennis showed two rackets and ignored swing speed, intensity and angle (and Luna returned nothing), and Bowling threw by itself. This round rebuilds the mechanics on `primetime/overhaul`.

## Why the games failed a real player

- Beat Blade read raw camera coordinates: blocks sat at fixed screen spots, the saber always pointed up, and a cut had to cross a spot about 5% of the screen wide. The recorded-human QA scored 0 of 19; the old real-motion suite only warned on zero hits, so it "passed".
- Tennis and Boxing judged swings and punches at the moment the camera reported them, 150 to 250 ms after they happened, so the ball had already gone by. Bowling armed on any lowered hand and threw on any quick rise.
- The Dance coach replaced the player's avatar, and the old 2D features couldn't tell dancing from standing still.

## What changed

| Area | Change | Files |
| --- | --- | --- |
| Test player | A dev-only simulated body (`?sim=<bot>`) produces MediaPipe-shaped landmarks through a virtual webcam with 30 fps sampling, 85 ms latency, jitter and motion blur. Bots for every game play through the real input chain; `tools/qa/play.mjs` runs them, films them and reports hits. Real recorded clips of bowling, tennis and boxing motion were added. | `src/dev/`, `tools/qa/play.mjs`, `tools/qa/online-box.mjs`, `tests/fixtures/motion/*-real.mp4` |
| Body-relative input | Hands in reach space (measured from your shoulders in your own arm lengths), a filtered 3D body from MediaPipe world landmarks, and a character driver that mirrors (Dance) or copies (Tennis, Bowling, online Boxing) the player onto a rig. | `src/kinetic/core/reach.ts`, `src/pose/body3d.ts`, `src/kinetic/render/character.ts` |
| Beat Blade | Blades grow out of the forearm; a cut is the whole blade sweeping through a block between frames, lag-compensated, direction-checked only once the block arrives (wind-ups don't count). Beat Saber charts with swing parity, doubles and bombs; halves split along the swing; score popups, multiplier ring, energy bar and fail state; edge flashes, combo bursts and a chorus drop. | `src/kinetic/games/blade.ts`, `src/kinetic/games/blade-chart.ts` |
| Dance | You dance beside Nova as a live avatar driven by your 3D pose, with a sync ring and rim light that follow how well you match. Scoring compares arm shapes (weighted by how much Nova uses each limb), leg lifts and hand motion at your learned reaction lag. A copy scores PERFECT and SUPER, random dancing OK and GOOD, standing still OK and MISS. The stage lights pump with your energy. | `src/dance/sync.ts`, `src/kinetic/render/dance.ts`, `src/pose/scorer.ts` |
| Tennis | One racket in your playing hand (learned from your swings). Your character runs to the ball; timing sets direction, swing speed power, up or down topspin or slice, plus smash and lob. Luna chases and returns with pressure errors. Real scoring, serves and faults, lag-compensated swings, ball shadow, trail and bounce marks. | `src/kinetic/games/tennis.ts`, `src/kinetic/games/tennis-ball.ts` |
| Bowling | The ball sits in your character's hand and her arm follows yours; a pendulum swing (back while low, then through and up) releases it, with speed from your hand and line and hook from your swing. cannon-es pins tuned on a bench, a new lane at real proportions, a pin camera and ten-frame scoring. | `src/kinetic/games/bowling.ts`, `src/kinetic/games/bowl-score.ts`, `src/kinetic/render/pt/bowl-venue.ts` |
| Boxing | A three-round fight with Blaze, first person: jabs, crosses, hooks and uppercuts from the fist's speed relative to its shoulder; telegraphed attacks you block, slip or duck; counters, stamina, knockdowns with a ten count (punch to get up) and a decision. FIGHT ONLINE matches two players over the existing rooms, each the authority on their own defense. | `src/kinetic/games/boxing*.ts`, `src/net/room.ts`, `src/main.ts` |
| Cast | Blaze, the second crew member: Meshy image-to-3D from a concept made in Nova's style, auto-rigged; 26 more library clips for boxing, tennis and bowling. | `public/models/blaze-pt.glb`, `tools/primetime/build-cast.mjs`, `tools/primetime/build-moves.mjs` |

## Verification

Run on 28 September 2026 on the M1 Pro MacBook.

- `npm test`: 41 of 41 pass (5 new: chart parity, bowling totals, tennis shot solving, the online pose codec, dance sync).
- `npm run build`: passes; the simulator is not in the production bundle; cannon-es loads only with Bowling.
- `npm run qa:kinetic`: passes; all five 3D demos at 16.7 to 16.8 ms frame p95.
- `npm run qa:realmotion`: 7 of 7, and each game must now respond to the recorded body (Blade 6 cuts, Boxing punches read from real shadowboxing, Tennis swings from real strokes, Bowling throws from a real bowling swing, Dance scored moves).
- Bots: Beat Blade 98% cuts on Flow and Expert; Dance copy mostly PERFECT/SUPER, standing still OK/MISS; Tennis rallies with points both ways; Bowling around 100 through nine frames with strikes and spares; Boxing competitive to round 3 with knockdowns both ways; an online round between two browsers kept health and the clock in sync.

## Still open after round 4

- A real webcam on real hardware (the owner's play test), Safari, Firefox and phones.
- Online boxing across real networks: tested between two local browsers on the public PeerJS broker; strict NATs depend on the TURN relay behind `/api/ice`.
- Licensed or commissioned music, the other six crew members, Fruit Slice in Three.js.

---

# GrooveStar · Round 3 handover (art, text and game quality)

Updated 27 September 2026. The owner reviewed the Primetime overhaul preview: the UI was better, but the generated menu art looked low quality and AI-made, there was too much text, and the games were far from Kinect or Wii quality (Dance and Beat Blade not vibey, Fruit Slice's background awful). This round answers that on the same branch, `primetime/overhaul`.

## What changed

| Area | Change | Files |
| --- | --- | --- |
| Dance | Nova is the coach: full size, center stage, performing twenty Meshy motion-capture dances time-warped onto the song's beat grid. Each clip's tempo, beat phase and pose data are measured by the dance lab, so the scorer and move cards read the motion she performs. Routines use 8-beat phrases, and choruses repeat so they can be learned. The stage has an LED wall of beat-synced graphics per section, moving heads and floor uplights that change look every bar, a follow spot and colored rims, a mirror floor, and gold-move pyro and confetti. Move cards are colored silhouettes with arrows showing how the hands travel. | `src/dance/nova-routine.ts`, `src/kinetic/render/dance.ts`, `src/kinetic/render/pt/dance-stage.ts`, `src/ui/hud.ts`, `tools/primetime/{build-moves.mjs,bake-dances.mjs,dance-data.py,lab/}` |
| Dance scoring fix | The dance tracker had the player's left and right swapped (fixed earlier in `rig.ts`, never in `computeFrame`), and the old AIST++ clip angles were mirrored. Features now follow the move library's convention, so copying the coach scores. | `src/pose/tracker.ts`, `tests/dance.test.ts` |
| Beat Blade | A black void where the music draws the light: a tunnel of neon rings that spins on every bar, laser fans, side pylons, a halo at the vanishing point, a mirror floor and streaming motes. Glossy red and blue cubes split along the swing with a slash flash; sabers are longer with a white-hot core. | `src/kinetic/render/pt/blade-arena.ts`, `src/kinetic/games/blade.ts` |
| Fruit Slice | A rendered wooden dojo wall lit by paper lanterns replaces the generated night market. Fruit is 42% larger, and juice stains take the fruit's color, drip and linger on the wall. | `public/kinetic/pt/plate-fruit.webp`, `src/kinetic/render/fruit-arena.ts`, `src/games/fruit.ts` |
| Other venues | Boxing, Tennis, Bowling and Rush no longer use generated plates: 3D tiered stands and crowds, a ring light rig, floodlight towers, a procedural nebula wall, a synthwave sun and skyline. Slogan banners became graphics. | `src/kinetic/render/pt/{box,court,rush}-venue.ts` |
| Menu art | Every card and game-page hero is a Cycles render of the game's own Nova, posed from her clips with each game's props (sabers and a sliced cube, gloves, coins, fruit, a racket, a galaxy ball and pins) under stage lighting. | `tools/primetime/keyart/`, `tools/primetime/import-keyart.mjs`, `public/kinetic/pt/{card,hero}-*.webp` |
| Less text | Taglines, descriptions, spec sheets, hints, eyebrow labels, the demo banner and long in-game hints are gone. Home is the logo, carousel and a circuit button with icon chips; game pages are the hero, title, pace, PLAY and short mode pills; setup is one instruction, a short tip and the camera. | `src/kinetic/ui.ts`, `src/kinetic/setup.ts`, `src/kinetic/core/session.ts`, `src/kinetic/primetime.css` |
| Soundtrack | Four original tracks rendered from pure DSP: punchy drums, sidechain-pumped supersaws, plucks, a lead hook, risers and impacts into each drop, reverb, delay and a limited master near -9.4 LUFS. Dance plays the produced Neon Nights (the live synth stays as a fallback). | `tools/primetime/music/`, `public/kinetic/audio/`, `src/audio/engine.ts`, `src/kinetic/core/music.ts` |

## Still open after round 3

- A real webcam on real hardware, Safari, Firefox and phones.
- Owner listening: the new tracks are prototypes rendered without a human listening pass; commissioned or licensed songs are still planned (decision 3).
- The other seven characters (the crew screen shows locks), Fruit Slice in Three.js, the replay layer and content phases.

---

# GrooveStar · Primetime overhaul handover

Updated 27 September 2026. The owner reviewed the Phase 0 preview, found the look unchanged and too plain, and asked for the full visual overhaul. It is on branch `primetime/overhaul`, which builds on Phase 0 (the Phase 0 handover follows below). The plan, decisions and status are in [docs/PRIMETIME.md](docs/PRIMETIME.md).

## What the overhaul changed

| Area | Change | Files |
| --- | --- | --- |
| Art | Seven game key-art cards, the GrooveStar logo, five venue backdrops and a crowd strip, generated from the approved concept frames. Rebuild with `node tools/primetime/import-art.mjs` (sources outside the repository). | `public/kinetic/pt/`, `tools/primetime/import-art.mjs` |
| Nova 2.0 | The Meshy Nova with Idle, three dances, Guard, Celebrate and Run in one 1.8 MB GLB. Toon shading, ink outline hull, cyan and magenta rim. Every role uses Nova until the rest of the cast is rebuilt. | `public/models/nova-pt.glb`, `tools/primetime/build-nova.mjs`, `src/kinetic/render/character.ts`, `src/kinetic/render/pt/toon.ts` |
| Render kit | `Stage` gains a Primetime mode (night fog, toon key light and fills, bloom, grade pass with beat kick). Shared effects: moving heads, lasers, LED walls, instanced crowds, confetti, sparks, pyro, painted backdrops, blurred mirror floors. | `src/kinetic/render/stage.ts`, `src/kinetic/render/pt/` |
| Show Director | Every round tracks the beat and a hype meter. Hits climb five levels (Soundcheck, Warm-up, Headliner, Encore, Supernova) that recolor the lights and fire confetti, lasers, pyro and a level banner. | `src/kinetic/render/pt/show.ts`, `src/kinetic/core/session.ts` |
| Venues | Beat Blade cathedral with crystal notes and lightsabers; Boxing sunset arena with Nova holding focus mitts and first-person gloves; Rush through Groove City at dusk with a hologram ghost; Dance main stage with a hologram coach on a pedestal; Tennis night stadium; Bowling cosmic lanes; Fruit Slice night market (still the 2D simulation). | `src/kinetic/render/pt/*-venue.ts`, `src/kinetic/games/`, `src/kinetic/render/dance.ts`, `src/kinetic/render/fruit-arena.ts`, `src/games/fruit.ts` |
| YouTube songs | The video plays on the Dance LED wall behind the dancer: the stage canvas is transparent there with an LED-dot mask, and every additive effect keeps the frame alpha. | `src/kinetic/render/pt/fx.ts`, `src/kinetic/render/pt/palette.ts`, `src/main.ts` |
| Interface | Home is a lobby: Nova dances on the stage behind a game-card carousel, with level, medals and streak. Key-art game pages, setup, results, settings, crew, progress, pause, song ready flow, lobbies and phone camera all use the night-show design. The in-game HUD has chrome judgment callouts, a combo counter and a hype meter. | `src/kinetic/ui.ts`, `src/kinetic/setup.ts`, `src/kinetic/primetime.css`, `src/ui/hud.ts` |
| Seated play | Arm-only games (Beat Blade, Boxing, Fruit Slice, Tennis) track with shoulders and hands in frame, so they no longer pause when the hips leave the camera. Dance, Rush and Bowling still need the hips. | `src/kinetic/core/input.ts`, `src/kinetic/core/catalog.ts` |
| Performance | In-game overlays avoid backdrop blur and per-frame filter changes; with them, Bowling stalled for 50 to 130 ms every couple of seconds. | `src/kinetic/primetime.css` |
| QA | Tour and screenshot helpers for visual review. QA scripts follow the new class names. Four new unit tests cover hype levels, the beat pulse, alpha-safe blending and seated tracking. | `tools/primetime/tour.mjs`, `tools/primetime/shot.mjs`, `tools/kinetic/`, `tests/primetime.test.ts` |

## Overhaul verification

Run on 27 September 2026 on the same M1 Pro MacBook.

- `npm test`: 32 of 32 pass.
- `npm run build`: passes.
- `npm run qa:kinetic`: passes; all five 3D demos at 16.7 to 16.8 ms frame p95 (draw calls: Blade 150, Boxing 83, Rush 167 to 197, Tennis 76, Bowling 36).
- `npm run qa:recovery`: passes, including portrait layouts without overflow.
- `npm run qa:realmotion`: 7 of 7 games pass with worker inference and 16.7 to 16.8 ms frame p95 with the camera on.
- YouTube song flow checked with an embeddable video: the video fills the LED wall and the dancer stays in front of it.

## Still open after the overhaul

- A real webcam on real hardware, Safari and Firefox, and phones, as after Phase 0.
- Original music (decision 3). The three synthesized tracks remain.
- The other seven characters; the crew screen marks them as arriving soon.
- Fruit Slice in Three.js, the replay layer (Phase 3) and the content engine (Phase 4).

---

# GrooveStar · Primetime Phase 0 handover

Updated 27 September 2026. The owner approved the Primetime direction and all six plan decisions, then asked for Phase 0. The work is on branch `primetime/phase-0` (from `main` at `1a88042`). The plan, decisions and phase gates are in [docs/PRIMETIME.md](docs/PRIMETIME.md). The Kinetic Broadcast handover below still describes the Production release.

## What Phase 0 changed

| Area | Change | Files |
| --- | --- | --- |
| IP cleanup | The 44 routines extracted from Just Dance gameplay videos (plus 2 unindexed files) were removed from the repository and archived outside it as local test data. `public/routines/` is gitignored, and the loader reads it only in development builds. The Dance Classics rows hide themselves when no index is found. | `src/routines.ts`, `.gitignore`, `tools/extract_jd/README.md`, `docs/ASSET_PROVENANCE.md` |
| Pose inference | MediaPipe runs in a module Web Worker; the page transfers one `ImageBitmap` per new camera frame. The old main-thread path remains as an automatic fallback, including mid-session. `localStorage['gs-pose-main']='1'` forces the old path for A/B checks. The WASM is now pinned to the installed tasks-vision 0.10.35; before, it loaded 0.10.14 WASM under 0.10.35 JS. | `src/pose/pose-worker.ts`, `src/pose/engine.ts`, `src/pose/pose-protocol.ts`, `src/pose/tracker.ts`, `vite.config.ts` |
| Model preload | The pose model downloads and compiles in the background about a second after the home screen loads (skipped on demo and capture routes). Setup shows real download progress. | `src/main.ts`, `src/kinetic/setup.ts` |
| Setup | The 4 to 7 step practice checklist is replaced by one calibration pose: step into the frame, raise both hands. A hand raised past the top edge counts when its elbow is up. "Start anyway" appears after 5 seconds. `MotionInput` already recalibrates on each round's first tracked frame, so nothing functional was lost. Game tips replace the practice steps. | `src/kinetic/setup.ts`, `src/kinetic/core/setup-pose.ts`, `src/kinetic/kinetic.css` |
| Dance | No legacy disco tiles under the 3D dancer. The painted slogan and "01" that collided with lyrics and the star meter are gone. The coach is larger. Pictograms in the 3D renderer are 30% larger, on cards, with the strip moved clear of the dancer. Untracked limbs hold for 350 ms, then ease into a relaxed stance instead of the bind pose, and the avatar stays on stage through short tracking gaps. | `src/main.ts`, `src/kinetic/render/dance.ts`, `src/kinetic/render/character.ts`, `src/ui/hud.ts` |
| Beat Blade | 1-pixel line trails replaced by tapered ribbon trails that restart after a tracking jump. The decorative light strips that crossed the note corridor now sit outside the arches. | `src/kinetic/render/trail.ts`, `src/kinetic/games/blade.ts`, `src/kinetic/render/worlds.ts` |
| Draw calls | Pins are one vertex-colored mesh each; alley, court and racket set dressing is batched with shared materials. Demo draw calls: Bowling 228 to 42, Tennis 202 to 38. | `src/kinetic/render/sports.ts` |
| Audio | Pausing after the soundtrack stopped no longer throws "Cannot suspend a closed AudioContext". The real-motion suite surfaced this in Rush. | `src/kinetic/core/music.ts` |
| Any Song search | One retry, an 8-second timeout, a consent cookie for EU regions, logging of the network error cause, and a friendlier 502 message. Production search already returned 200 when checked on 26 September at 18:42 UTC, so the handover's 502s were transient. | `api/search.ts` |
| Real-motion QA | `npm run qa:realmotion` plays every game with a recorded body: five fixture clips are served to Chrome as the webcam. It checks setup pose recognition, tracking share, worker inference, frame pacing and page errors, and writes `docs/qa/realmotion-report.json`. Needs local Chrome, ffmpeg and the dev server on port 5179. | `tools/kinetic/realmotion.mjs`, `tests/fixtures/motion/`, `package.json` |
| Tests and diagnostics | Six new unit tests (setup pose, ribbon reset, routine gate, pin draw call). `window.gsKinetic.inference` reports the inference mode and cost. | `tests/phase0.test.ts`, `src/kinetic/core/session.ts` |

## Phase 0 verification

Run on 27 September 2026 on an M1 Pro MacBook shared with other simulator sessions (load average 9 to 25 during the runs; far higher earlier in the day).

- `npm test`: 28 of 28 pass (22 existing, 6 new).
- `npm run build`: TypeScript and Vite pass. The worker ships as its own ES module chunk (`pose-worker-*.js`); the existing chunk-size warnings remain.
- `npm run qa:kinetic`: the seven-game smoke passes. Demo draw calls: Blade 81, Boxing 40, Rush 80, Tennis 44, Bowling 44. All at 16.7 to 16.8 ms frame p95.
- `npm run qa:recovery`: passes. Camera denial still waits for an explicit demo choice.
- `npm run qa:realmotion` on the dev server: 7 of 7 games pass. The camera went live 1.6 to 4.7 s after pressing Play, with the model preloaded on the home screen. Inference ran in the worker at 16 to 21 ms per frame, and frame p95 was 16.7 to 16.8 ms in every 3D game. The setup pose was recognized 1.2 to 8 s after the camera went live; the longer waits happen when a clip's pose had already passed and the 12-second clip had to loop. Warnings: the Blade and Tennis fixtures scored no hits, since their movement is not choreographed to the charts. Report: `docs/qa/realmotion-report.json`.
- Production build (`vite preview`): Dance and Boxing real-motion runs pass, with Boxing in worker mode.
- Worker versus main thread, Beat Blade with the same fixture, frames over 20 ms: at full CPU speed, 0.9% (worker) and 0.3% (main), both 60 fps. With Chrome CPU throttling at 3×, standing in for a slower laptop, 0.3% (worker, p99 16.8 ms) and 21.7% (main, p99 50 ms).

## Still open after Phase 0

- Physical webcam and phone acceptance. The fixtures are generated video; a real player on real hardware has not played this branch.
- The worker path was exercised in Chrome only. Safari and Firefox fall back to the main thread automatically if module workers or OffscreenCanvas fail, but neither was tested.
- `qa:realmotion` is not in CI (the repository has no CI). It needs Chrome, ffmpeg and a dev server.
- Git history before 27 September 2026 still contains the extracted routines. Removing them from history needs a force-push, which the owner has not requested.
- Phase 1 (Dance Main Stage) is next; see [docs/PRIMETIME.md](docs/PRIMETIME.md).

## Continuing

Read this section and [docs/PRIMETIME.md](docs/PRIMETIME.md). Continue from `primetime/phase-0`, or from `main` once it is merged. Phase 1 builds the Dance Main Stage slice: the Primetime render kit, Show Director, Hype levels, Nova 2.0 from the Meshy model, better retargeting, venue kit and feedback effects. Keep `npm test`, `npm run qa:kinetic` and `npm run qa:realmotion` green, and never reintroduce extracted third-party routines into `public/`. Pushes to `main` deploy Production; use branch previews for review.

---

# GrooveStar · Kinetic Broadcast handover

Updated 27 September 2026 (Asia/Bangkok). The owner selected **Kinetic Broadcast**, authorized the overhaul, and explicitly requested pushing and deploying all latest changes. The overhaul is now merged into `main` and deployed to Production. Physical camera, real-network and owner visual/music acceptance remain open; deployment does not establish those checks.

## Source and release

- Repository: https://github.com/TheDudeCommits/groovestar
- Release branch: `main`; implementation branch `codex/kinetic-broadcast` was merged through [PR #1](https://github.com/TheDudeCommits/groovestar/pull/1).
- Release worktree: `/Users/amir/Claude/groovestar-kinetic`, local branch `codex/production-handover` tracking `origin/main`.
- Original source checkout: `/Users/amir/Claude/groovestar`; baseline main `b3437593582044b335d52fc116dfeb5c1f7efeda`.
- The task started in `/Users/amir/Codex-ThreeJS`, an unrelated project. It was not changed or reused.
- Production: https://groovestar.vercel.app
- Verified rollback deployment: `dpl_H3p18giKRphkamZCKTsiq5TmGJ1x`, READY, `groovestar-54esks1w6-amirs-projects-d9680079.vercel.app`.
- Vercel project `prj_9LPZCjCKgtcapicr4yJrof7g5OaT`, team `team_9UHUI9xdsOl7LAy5xl8hUIV6`, framework Vite, Node 24.x.
- Git pushes to `main` deploy to Production. Use a separate branch or explicit CLI `--target=preview` for previews on this existing project. Preview deployments retain the project's existing Vercel authentication protection.
- Application commit: `5f1dc0fb985a8217359e12d2968eb375fe3be97d`.
- Production application release commit: `8d17957ff2d18d3b6bff37a2adcd99ed1cf51286` (PR #1 merge).
- Verified Production application deployment: `dpl_FCRXJqDSf8SXgveY4gbNsfWY2Ngx`, **READY**, target Production, source Git; https://groovestar-mxoie6yxz-amirs-projects-d9680079.vercel.app. The canonical alias `groovestar.vercel.app` was verified on this deployment, serving the expected `index-BKqgQ5Zq.js` application bundle with HTTP 200.
- This handover/evidence follow-up changes documentation only. Its push to `main` triggers another Production build of the same application; the deployment above identifies the application release tested below. Resolve the canonical alias in Vercel when continuing to find the newest documentation build.
- Verified preview: https://groovestar-kxffincn8-amirs-projects-d9680079.vercel.app
- Preview deployment: `dpl_4F36BGr4eP2qVbahKVeDT7jDntyT`, **READY**, target Preview (`target: null` in the Vercel API), source CLI, exact application commit above.
- The first preview `dpl_8zMx5qMEc42c2b9XcSqHTFpBvPQn` was superseded after enabling the existing server services for Preview. `ANTHROPIC_API_KEY`, `METERED_DOMAIN` and `METERED_API_KEY` now target Production + Preview, with existing secret values preserved and no secret values read or written to the repository. Vercel authentication remains enabled.
- Deployed desktop/mobile and all-seven-game smoke passed with zero browser errors. Evidence: `docs/qa/preview-smoke-report.json` and `preview-*.png`.
- The original baseline deployment above is retained as a rollback. No application code or asset changes were needed for this release.

The original handover is preserved verbatim in `docs/HANDOVER_BASELINE.md`. Its comments about missing Three.js, 15Hz image-only phone packets, borrowed sound effects and every push being Production describe the baseline, not this branch. Original planning document: `VISUAL_OVERHAUL_PLAN.md`.

## What changed

Kinetic UI uses cream/ink, cobalt/vermilion signals, condensed athletic type and actual engine imagery. Home, game homes, crew, setup/practice, shared HUD/pause/results, progress, equipment unlocks, circuit and phone surfaces are integrated with the existing app. Vanilla TypeScript/Vite remain; no React/Next migration.

Eight original sportswear cast models use a shared 17-bone GLB rig and five clips. The 3D Dance presentation adapter follows real joints and original routine timing. My Look colors/proportions and stored selections are preserved. New cast serves menus, covers, coach/opponent, runner and celebrations.

Beat Blade now has a 3D architectural light arena, observed swept blade contact and three original 90-second soundtrack/chart packages. Boxing uses spatial matching-hand mitt contact, high/low targets, return-to-guard and slips. Rush has a modular city, seeded reachable course patterns, rise/duck/lane actions, shield/coins, endless recycling and a local personal ghost marker. Tennis and Bowling have complete scenes and new contact/release logic. Fruit retains its mature simulation and race wiring with new presentation, fresh-frame gating and shared progress. Classic Any Song and Canvas rendering remain available.

## Where to work

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Existing navigation, Dance, YouTube/friends/phone; Kinetic launch/result adapters |
| `src/kinetic/ui.ts`, `kinetic.css` | Catalog, homes, crew, settings, progress and results |
| `src/kinetic/setup.ts` | Camera framing, left/right and game-specific practice; failed camera never silently starts a scored Kinetic run |
| `src/kinetic/core/` | Typed catalog, rendering-independent session services, settings, observed input, original music, records/ghost scope and equipment |
| `src/kinetic/games/` | New Blade, Boxing, Rush, Tennis and Bowling; deterministic chart/course/combo content |
| `src/kinetic/render/` | Three.js stage, batching, shared GLB loader/retargeter, venues, props and Dance/preview adapters |
| `src/pose/{tracker,rig,scorer}.ts` | MediaPipe and correct subject-left conventions, freshness/lower body, established Dance scoring with added best-combo metric |
| `src/net/{camlink,camera-packet}.ts` | v2 phone packets and explicit legacy image-only decoding |
| `src/games/fruit.ts` | Retained fruit physics, waves, boss logic and race; shared pause and run-record integration |
| `tools/kinetic/` | Original Blender/audio sources, optimized export wrapper, engine capture and browser QA scripts |
| `docs/KINETIC_ART_BIBLE.md` | Selected palette, type, rig, lighting, motion and scene direction |
| `docs/ASSET_PROVENANCE.md`, `asset-manifest.json` | Source/license register and 64 hashed production assets |
| `docs/KINETIC_IMPLEMENTATION.md`, `docs/qa/` | Exact scope, limitations, reports, screenshots and gameplay clips |

## Commands and test routes

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5179
npm test
npm run build
npm run qa:kinetic
npm run qa:recovery
npm run qa:rounds
npm run qa:motion
npm run assets:cast
npm run assets:audio
npm run assets:art
node tools/kinetic/asset-manifest.mjs
git diff --check
```

Asset export requires Blender/ffmpeg. Browser scripts require local Chrome. `GROOVESTAR_QA_URL` selects a deployed URL for smoke/recovery/round checks. Motion fixtures import Vite source modules and stay local.

`?demo=blade|box|rush|fruit|tennis|bowl` explicitly previews gameplay without earning records. `?dancetest` previews the original Dance routine. `?bladetest` remains the established Classic Canvas comparison harness. `?asset=...&cast=...` captures actual engine artwork. Shared challenge URLs carry `game`, `challenge`, `v=2`, `level`, `impact`, `track` and optional `endless`.

Backquote opens the inherited input debug view. `window.gsKinetic` adds current game, actual RAF p95, elapsed/score, input freshness, draw calls and phone transport diagnostics. Existing `gsTune` does not automatically change new Kinetic thresholds: tune `core/input.ts` and game detectors explicitly, and extend the tuning UI if live adjustment is needed.

## Verification at handover

- Production release check, 27 September: all 22 targeted tests, TypeScript/Vite build and whitespace check passed again. The canonical live site passed the seven-game desktop/mobile smoke with zero page errors and no demo progress writes. Screenshots were reviewed and browser processes closed. Evidence: `docs/qa/production-smoke-report.json` and `production-home-*.png`.
- Production service checks confirmed TURN configuration (`/api/ice` 200), music-analysis input validation (`/api/songmeta` 400 for missing title, no paid generation), and 44 Dance Classics. **YouTube search is currently failing**: `/api/search` returned 502 with `fetch failed` across repeated requests and two queries. Vercel request logs confirm the 502s; `api/search.ts` is unchanged from the baseline. The exact upstream connection failure remains undiagnosed. Track this separately from the successful game smoke; do not reuse the older passing Preview search result as current evidence. See `docs/qa/production-services-report.json`.
- 22 targeted tests passed, production build passed and diff whitespace clean.
- Desktop/mobile catalog and crew, all seven launch flows, 3D pause/resume/restart/exit, Dance/Fruit pause and Classic fallback checked with no page errors.
- All six arcade games completed actual-clock demo rounds with records/rewards disabled. Additional full Dance and two-player Bowling rounds passed.
- Native graphics context loss/recovery, camera-denial choice and soundtrack/difficulty/impact challenge restoration passed.
- Synthetic actual-GLB mirrored reaches, cross-body and occlusion fixtures passed.
- Brief local camera-free smoke runs recorded approximately 16.8ms p95 RAF intervals. This is not sustained performance with MediaPipe active.
- Runtime dependency audit: zero reported vulnerabilities with `npm audit --omit=dev` at handover. Vite emits legacy/main and Three.js chunk-size warnings.
- All automation browsers were closed after use. Clips are explicit demo recordings with no private camera content.

## Preserve these constraints

- Rig L uses subject-left landmarks 11/13/15/23. Never reverse it based on the old contradictory introductory comment. Display mirroring and model-bone naming are separate transforms.
- A repeated or stale input packet is not new motion. New Blade/Box scoring uses observed contact evidence; visual interpolation must not manufacture hits.
- Demo mode earns no stars, medals, minutes, best scores or ghosts. Keep saved legacy data; migration imports old movement time once and preserves original keys.
- Friend video is opt-in; pose processing stays local. Phone-to-TV video is part of explicitly choosing the phone camera role.
- Shared challenge/ghost compatibility includes rules version, seed, difficulty, impact, track where applicable and endless scope. A matching seed alone is insufficient.
- Every scene and browser must be closed/disposed after use. Preserve Classic fallback and original Dance/YouTube/multiplayer behavior while iterating.
- Preserve original art, audio and animation source/provenance. All 34 inherited borrowed one-shots were replaced. This does not relicense inherited third-party YouTube content.

## Outstanding acceptance and follow-up

Real-camera threshold/latency tuning, sustained inference performance, low-impact body tests, different body/camera/lighting conditions, two-device different-network/relay tests and owner visual/music acceptance are **not passed**. The owner explicitly authorized Production deployment on 27 September despite these previously documented open checks. Complete them before claiming physical/network acceptance or expanding precision demands. The full list and conditional later features are in `docs/KINETIC_IMPLEMENTATION.md`.

Immediate service follow-up: diagnose the Production YouTube search proxy's upstream `fetch failed` response. The release does not change that handler. Record a successful same-origin search with nonempty results before marking it resolved.

Notable limits: new solo 3D Dance suppresses the legacy backup crew; remote Dance avatars and some friends/Any Song presentation remain on the established Canvas path. Legacy aura/tattoo cosmetics remain stored for Classic. Rush ghosts are translucent markers and only retain the first ~90 seconds. Bowling is five-frame arcade scoring with simplified pin response. Three-round Boxing, sparring, extra biomes, denser crossover/dodge patterns and richer facial/secondary animation follow the accepted physical-play gates.

## Copy-paste continuation

Read this HANDOVER.md, docs/KINETIC_IMPLEMENTATION.md and docs/KINETIC_ART_BIBLE.md in TheDudeCommits/groovestar. Continue from the latest origin/main; /Users/amir/Claude/groovestar-kinetic is the release worktree. Verify GitHub head and the canonical Production deployment before edits. The owner selected Kinetic Broadcast and authorized its Production release on 27 September 2026. Conduct real-camera motion/latency and target-device tests, verify phone pairing and two-device relayed friend sessions, and apply owner visual/music feedback. Preserve Dance scoring/routines, existing saved progress, subject-left mapping, explicit demo isolation and opt-in friend video. Do not claim physical/network acceptance from synthetic/demo tests. Keep the recorded Production rollback available and close all browsers immediately after use.
