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
