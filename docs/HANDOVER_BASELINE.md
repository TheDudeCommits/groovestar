# GrooveStar — Session Handover

Live: https://groovestar.vercel.app · Repo: TheDudeCommits/groovestar (main auto-deploys production on push — there is NO staging; every `git push` ships).

## What this is

A browser camera-motion game suite. Home screen is now a CATALOG of seven games (Dance is one tile among them, no longer the main game). Two games are rebuilt to the owner's bar and actively iterated: **Fruit Slice** (energy-saber fruit cutting, owner-approved trajectory) and **Beat Blade** (Beat Saber-benchmark, just rebuilt frame-matched to reference footage, awaiting owner verdict). Four games remain UNREBUILT trash from an old session (Rush, Bowling, Tennis, Boxing) — they compile and run on the new gesture engine but need ground-up rebuilds like the first two. The dance game is untouched and owner-loved: protect it.

## Stack

- Vite + vanilla TypeScript + Canvas 2D. No frameworks, no three.js (owner rolled 3D back once; the Beat Blade rebuild pushed Canvas 2D to its limit — owner MAY be open to relaxing this for the "last 10%", ask before doing it).
- MediaPipe Tasks Vision PoseLandmarker (lite, GPU) from CDN. `src/pose/tracker.ts`.
- PeerJS multiplayer (host-relay star + webcam mesh) + TURN via Metered. `/api/ice`.
- Serverless `/api`: choreo + songmeta (Claude), search, lyrics, vibe (thumbnail palettes), ice.
- `npm run dev` / `npm run build` (tsc + vite). macOS: no `timeout`, `sed -i ''`. Playwright-core with `channel: 'chrome'` for testing; smoke scripts in `tools/smoke_*.mjs` (run from project dir; `PORT=5173 node tools/smoke_fruit.mjs`).

## THE FOUNDATION (Sprint 0, all games build on this)

- `src/pose/rig.ts` — **HandRig**: One-Euro filter + 70ms prediction per joint, velocities in height-units/s, speeds in SHOULDER-WIDTHS/s (distance-independent). **CRITICAL, hard-won**: in mirror view viewer-L = subject LEFT landmarks (15/13/11/23). This was crossed for a whole session and made hands feel swapped; do not "fix" it back.
- `src/pose/gestures.ts` — rebuilt detectors (peak-detected swings, world-landmarks-only punches in m/s with 2D-foreshortening fallback for the phone cam which sends NO worldLandmarks, body-relative lane/jump/duck with latching). Rush/Bowl/Tennis/Box still consume these; their rebuilds should go continuous like fruit/blade.
- `src/games/tuning.ts` — every threshold in one live table. Console: `gsTune()`, `gsTune('fruit.sliceRel', 2.5)`, `gsTuneReset()`. Persists in localStorage.
- `src/games/debug.ts` — backquote toggles the gesture debug overlay in any arcade game (signal bars vs thresholds, event flashes, raw-vs-predicted wrists). THE tuning instrument — a real-camera tuning session with the owner has STILL never happened and every threshold is an educated guess.
- `src/games/juice.ts` — hit-stop, slow-mo, shake, pooled particles (spark/dust/shard/ring), pops, squash, glow sprites (never use shadowBlur in games), adaptive quality `q` (sheds particle counts when frame dt EMA > 18.5ms).
- `src/games/sfx.ts` — SAMPLE-FIRST sound engine: 34 recorded one-shots in `public/sfx/*.mp3` (ripped Fruit Ninja pack the owner uploaded — fine for personal use, NOT license-clean commercially), variant rotation + pitch jitter, synth fallback until decoded, master 0.35. Also the persistent saber hum (saberHum/saberHumStop).
- `src/games/saber.ts` — **Sabers module** (both blade games use it): lightsaber render (white-hot core, color sheath, additive bloom, metallic hilt, emitter flare), swept light-plane trails, tip streaks, embers, throttled whooshes, speed-driven hum. Style colors from progression.
- `src/games/flow.ts` — pre-game body calibration (framing guidance, stores shoulder/torso scale) + 3-2-1-GO countdown + results count-up. Wired centrally in `arcadeCamera`/`endArcade` in main.ts.
- `src/games/progress.ts` — lifetime fruit stats + medal counts + SABER_STYLES (Classic/Ember/Starlight/Bloom unlocked at 0/2/5/9 medals). Demo (no-camera) runs never write stats/best/medals.
- `src/games/arena.ts` — fruit's beat-reactive dusk backdrop (cached gradients). `src/games/music.ts` — BLADE_RUNNING, the composed 132 BPM fruit track.
- `src/audio/engine.ts` gained: `energy` (0..1 live layer override — null = dance behavior untouched), `setBrightness()` (movement-driven master lowpass), `pluck(tone)` (pentatonic hit notes quantized to next 16th — slices literally play melodies), `setVolume()`.

## Menu / navigation

`showMenu()` = home catalog. `showDanceHome()` = old dance menu (classics/any-song/dance-off + calibrate/character footer). `showGameHome(def)` generic per-game home; `showFruitHome()` full version (solo/race buttons, saber style picker, stats, medal targets). endArcade "Menu" returns to the game's home. Home footer: name, fitness toggle, phone camera.

## Fruit Slice (flagship, owner likes the direction)

`src/games/fruit.ts` (~1000 lines). 60s round: rig-driven sabers cut via blade-line + swept-tip-path collision gated by `fruit.sliceRel` shoulder-widths/s; seeded wave director (patterns: single/cross/fan/ladder/bombTrap/frenzy + scheduled bosses at 28s/50s); 9 fruit kinds incl. 2-hit coconut, golden (+fever), ice (slow-mo), pomegranate BOSS (8 hits, cracks, hp pips); fever meter → 8s double points; seeded finale variants (goldrush/frenzy/twinboss); saber-ignite intro, slow-mo outro; directional cut-face splash + persistent fading splatter layer; medal targets in HUD (`medals: [180,400,750]` — NOT yet tuned from real play, ask the owner for their real scores); music energy/brightness/pluck all wired; kcal integration.
**Online race**: fruitRaceLobby → Room (4-digit codes, ≤4 players), same seed = same waves, live rival score in HUD, spectator webcam corners (room.shareStream + onStream in `launchFruitRace`), verdict + host rematch on results. NEVER tested on real two-device networks.

## Beat Blade (just rebuilt, awaiting owner verdict)

`src/games/beatblade.ts`. Rebuilt frame-matched against reference Beat Saber footage (yt-dlp frames → iterate screenshots — the "gauntlet"; frames were at /tmp/bsframes, regenerate from https://www.youtube.com/watch?v=r6OYcMpm7cA if needed). Near-black arena tinted by the song's vibe palette (`accent` from fetchVibe), laser-rod fan from the vanishing point, edge light towers, converging highway + rolling beat grid, music video as floating framed jumbotron (`VIDEO_WIN` fractions — main.ts setBounds must match), glossy extruded 3D note cubes w/ glowing arrows that materialize at the horizon and split along the actual cut angle, multiplier ring (x1-x4 at combo 10/20/30), energy bar, combo strobes, count-in ignite, grades S/A/B/C + FULL COMBO. Continuous detection: matching hand's blade sweep through note + motion-direction dot ≥ 0.2 (perfect ≥ 0.7 within 0.18 beats). Seeded pattern-grammar charts (density ramp, direction runs, bar-start doubles, crossovers w/ dashed rim, rest every 16th beat).
**`?bladetest` query param** = synthetic 128bpm clock + demo autopilot, no YouTube — use for all visual iteration.

## Owner's standing quality bar (from this session's feedback)

AAA or rebuild again. Specifically: stunning visuals, fluid on-beat feel, epic atmosphere, effects that "go crazy with the song", badass lightsabers, non-repetitive/replayable, online play vs friends. They compare directly against commercial benchmarks (Fruit Ninja, Beat Saber) and will send reference footage — match it. They upload assets when they want them used (the SFX pack). They notice and dislike "AI-generated" sounding/looking output.

## UI rules (owner-enforced)

NO emojis. NO em dashes in copy. No boxed panels; letterspaced uppercase labels, type-only buttons, chip toggles. Lilita One + Baloo 2. Warm violet-magenta sky + gold `#ffd23e` accent for the suite (Beat Blade's dark arena is the sanctioned exception). Middle dot `·` as separator is house style. Minimal text, milestones over persistent HUD.

## Next up (owner's plan)

1. Owner plays the new Beat Blade with a real song — expect a feedback round (direction strictness: loosen with dot threshold; note readability; environment).
2. THE tuning session: owner on camera with backquote overlay, fix all TUNING numbers from measurement (biggest outstanding lever; never done).
3. Medal thresholds from the owner's real scores.
4. Then rebuild game 3 onward one at a time on the same stack (Boxing was next in the original plan: coach character via BodyArt + world-space punch classification; then Rush with BodyArt runner mirroring the player, Tennis continuous racket, Bowling pendulum release). Each gets: arena-class environment, its own music track (Song in music.ts + engine.energy), sample SFX, seeded content, race mode where it fits, medals + stats + home screen.
5. Owed from earlier lists: daily challenge (seed infra exists), ghost race vs own best, async challenge links, announcer voice, per-game rebuilds of covers.

## Lessons this session (do not relearn)

- Games must feed on the RIG, not raw landmarks; anything tuned on fake-camera footage is a guess until the owner plays it.
- Commit feel changes separately from visuals.
- The arcade preview canvas must be self-painting (`buildArcadePreview`) — a plain buildPreview is a blank rectangle outside dance mode.
- AudioContexts leak per game restart unless closed (`music.ctx.close()` in stop()).
- Vite dev has no /api — YouTube search UI needs a pasted URL; songmeta falls back to 120bpm; use ?bladetest for blade.
- `vercel --prod` from local FAILS; deploy by git push only. Owner's smoke evidence: screenshots > words.

## Env / accounts

Vercel project `groovestar` (env: ANTHROPIC_API_KEY, METERED_DOMAIN, METERED_API_KEY). Classics extraction pipeline documented in git history + `tools/extract_jd/` (unchanged this session). Fitness mode + phone-as-camera + dance multiplayer all working, untouched.
