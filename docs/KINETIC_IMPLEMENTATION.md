# Kinetic Broadcast implementation and acceptance

Owner selection: 5 September 2026. Isolated worktree `/Users/amir/Claude/groovestar-kinetic`, branch `codex/kinetic-broadcast`, baseline `b3437593582044b335d52fc116dfeb5c1f7efeda`. Source main and the unrelated `/Users/amir/Codex-ThreeJS` checkout were not edited.

## Implemented

- Kinetic Broadcast catalog, all seven game homes, crew picker, equipment unlocks, movement settings, camera framing and game-specific practice, HUD, pause/recovery, results, progress and a four-minute Blade → Boxing → Rush circuit.
- Original eight-character GLB cast with shared skinning, five animation clips, confidence-aware live Dance retargeting, foot leveling, bounded My Look proportions and color mapping. Shared cast appears in covers, menus, Dance, coaches, runner and result celebration.
- Shared observed-input service, lower-body joints, stale-frame expiry, repeated-frame rejection, calibration, context/visibility recovery, audio cleanup, low-impact options, reduced effects and graphics tiers.
- Phone protocol v2: sequence, capture time, confidence, full normalized body, optional world landmarks and aspect ratio. RTT/jitter/estimated pose age diagnostics. Explicit v1 image-only decoder retained. Friend video sharing now opt-in; phone-to-TV camera streaming is the explicitly selected controller mode.
- Beat Blade: Three.js arena, continuous blades, swept contact, hand/direction/timing checks, split notes, three original 90-second soundtracks and deterministic authored phrase charts. Existing Any Song/Canvas harness retained as its established separate mode.
- Boxing: complete coach, reachable high/low pads, correct-hand spatial contact, world/image motion evidence, guard rearming, combinations, slips and three intensity densities in a 60-second round.
- Rush: original city kit, runner clips, calibrated lane/rise/duck, low-impact knee/reach alternative, three hazards, coins, shield, 90-second routes, recycled endless course chunks, local personal-ghost marker and comparable challenge links.
- Tennis: court and opponent, continuous/swept racket contact, ball placement and first-to-five game. Bowling: aim/swing/release, simplified rolling/pin-chain response, five-frame arcade scoring and one/two-player pass-and-play.
- Fruit: existing waves, bosses, continuous saber gameplay and race integration retained; new court/HUD styling, local pause/recovery, fresh-frame gating and unified run records. Its established predictive saber/collision implementation remains a compatibility path, rather than being represented as the new observed-only Blade detector.
- Versioned run ledger; demo isolation; old best/stars/style/fruit data preserved; old active seconds and movement dates imported once. Records retain seed, difficulty, impact, track and endless mode. Outfits and Blade grips use earned cosmetics.
- All 34 borrowed one-shot audio files replaced by original DSP effects. Audio, geometry, animation and capture sources retained, with font/renderer notices and a SHA-256 manifest.

## Evidence saved in `docs/qa/`

- `npm test`: 22 targeted tests passed. Coverage includes mirrored hands, repeated/stale packets, invalid joints, spatial punch/cut rejection, image-only fallback, 300 seeded difficulty/course cases, chart determinism, demo isolation, legacy migration and equipment gating.
- `npm run build`: TypeScript and Vite production build passed. Existing-size warnings remain for the legacy application bundle and the lazy Three.js renderer chunk; these are not failed checks.
- Smoke: all seven games launch; five 3D games pause/resume/restart/exit; Dance/Fruit controls; seven catalog entries; all crew thumbnails load; desktop and 390px mobile menus. No page errors or demo ledger writes.
- Full actual-clock demo rounds: Blade, Boxing, Rush, Fruit, Tennis and Bowling reached results without page errors and without earning records. Individual reports include scores and measured elapsed state.
- Recovery: explicit camera-denial demo choice, native WebGL context loss/restoration, challenge track/intensity/impact, portrait Blade/Rush/Box and Classic Fruit exit.
- Additional full demo rounds: solo Dance reached the new result screen without saving stars, and two-player Bowling completed all five frames with both players' scores.
- Actual GLB motion fixtures: neutral, left reach, right reach, cross-body reach and partial occlusion. Mirrored reach assertions passed; this is synthetic pose evidence, not a camera-motion acceptance pass.
- Gameplay recordings: actual demo sessions in `blade-demo.webm`, `rush-demo.webm`, `dance-demo.webm`. Browser recordings do not include audio.
- Local smoke p95 RAF interval was about 16.8ms in brief camera-free runs. Blade static scenery batching reduced measured draw calls from 272 to 81. Do not extrapolate this to sustained camera inference or phone input performance.
- All automation browsers close in `finally`. Output snapshots and recordings are evidence, not private camera captures.

## Explicitly outstanding acceptance and later expansion

The implementation is a broad playable preview. The accepted plan's physical/device gates remain open:

1. Real webcam and phone left/right, reach, cross-body, squat/rise, low-impact, occlusion and reacquisition. Measure target reachability and input-to-feedback latency before treating the current thresholds as accepted.
2. Sustained camera-inference performance at normal/low quality on the target laptop and phone. Compare Classic/3D with the same recorded physical input; current demo benchmarks are not that comparison. Profile worker-based inference only if measured blocking warrants it.
3. Two physical devices, different networks and a relayed PeerJS session: pairing, reconnect, Fruit race, Dance multiplayer, video opt-in and rematch. Protocol fixtures and preserved wiring do not establish a network pass.
4. Owner visual/motion and soundtrack/chart acceptance. There is no claim of hand-played chart approval, full mocap quality or controller-grade physical punch speed.
5. Conditional plan expansions after those gates: three-round Boxing programs, hooks/uppercuts/sparring, denser Blade crossover/dodge patterns, additional Rush biomes and live races, richer cast expressions/secondary motion, a full runner avatar for the ghost and optional dwell navigation.

Classic Any Song and friend flows retain more legacy presentation than the seven new solo game homes. Legacy Dance cosmetics such as 2D aura/tattoos remain stored for Classic Canvas; only supported color/proportion and new outfit mappings apply to the 3D rig. The backup-crew toggle and remote Dance avatars still use the legacy rendering path, and backup crew is currently suppressed with the new solo 3D presentation. Expand that adapter after physical Dance acceptance rather than claiming full visual parity.

Bowling uses explicit arcade scores (strike 15, spare 12, otherwise pinfall), not regulation ten-pin scoring or a rigid-body engine. The personal Rush ghost is a translucent progress marker; it replays the recorded lane/jump/duck values. Endless ghost recordings retain the first 900 samples, about 90 seconds. New challenges are asynchronous URLs, not live multiplayer.

No Production promotion should be described as accepted until the relevant owner/device gates are recorded. See root `HANDOVER.md` for exact commit and deployment evidence.
