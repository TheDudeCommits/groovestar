**GrooveStar · Visual overhaul and game expansion plan**

Prepared 5 September 2026. Planning only. Baseline: GitHub `main` and the clean local checkout both at `b3437593582044b335d52fc116dfeb5c1f7efeda`.

**Recommendation**

Build GrooveStar into a cohesive movement arcade with an original cast, authored environments, and a console-quality flow from choosing a game to celebrating a result. Establish the art direction with concrete screen previews, prove it in a polished Beat Blade slice, then rebuild Boxing and Rush. Refresh Dance's presentation while protecting its existing choreography, scoring, player motion, and multiplayer behavior.

The visual target is stylized, expressive, and readable from across a room. More bloom alone will not supply the missing character design, animation, environment composition, or gameplay clarity.

**What I verified**

- Read the full [handover](https://github.com/TheDudeCommits/groovestar/blob/b3437593582044b335d52fc116dfeb5c1f7efeda/HANDOVER.md), package configuration, and relevant source in `/Users/amir/Claude/groovestar`.
- The task's initial working directory, `/Users/amir/Codex-ThreeJS`, belongs to a different project. It is not the GrooveStar source and was not modified.
- Reviewed the Production catalog, Dance menu, Fruit Slice home, and Beat Blade's `?bladetest` arena visually. Closed the browser immediately after review. This was a presentation review, not real-camera gameplay, mobile acceptance, or a multiplayer test.
- The project uses Vite, vanilla TypeScript, Canvas 2D, MediaPipe, and PeerJS. There is no Three.js dependency in this checkout.
- Seven games already exist. Beat Blade, Rush, and Boxing should be evolved or rebuilt under their existing identities rather than introduced as duplicate catalog entries.

| Area | Current evidence | Implication |
| --- | --- | --- |
| Catalog and game homes | Small symbolic covers, horizontal overflow, sparse generic game detail pages | Replace placeholder-like covers and improve hierarchy, selection, and room-distance readability |
| Dance | Eight named cast presets; procedural `BodyArt` and `PlayerAvatar`; appearance scanning; existing choreography and scoring | Preserve identity and behavior, introduce a better character presentation behind a controlled adapter |
| Fruit Slice | Extensive waves, bosses, saber collision, effects, progression, race integration | Keep its established game loop; bring assets and presentation into the selected art direction |
| Beat Blade | Continuous blade collision, directional notes, seeded charts, arena lighting, synthetic visual harness | Best candidate for the first finished visual and interaction slice |
| Boxing | A punch finds the first live pad with a matching hand; resolution does not check the pad's position or high/low target | Rebuild target contact and punch classification alongside the coach and environment |
| Rush | Basic projected lanes, procedural obstacles, random waves, gesture-driven movement | Rebuild course design, runner animation, movement calibration, and world art together |
| Phone camera | `camlink.ts` sends normalized poses every 66 ms, approximately 15 Hz; no world landmarks | Measure latency and jitter; add a versioned richer input protocol before demanding precision boxing |
| Input rig | Filtering, prediction, body normalization; current joint set stops at hips | Reuse its conventions, extend it for knees/ankles/feet and per-frame confidence where needed |
| Results | Fruit and Blade guard best-score writes in demo mode; Rush and Boxing currently do not | Centralize verified-run persistence so demo play never earns records or rewards |

The handover records a previous rollback of 3D, specific UI preferences, unmeasured movement thresholds, and unresolved real-network race testing. Treat these as baseline constraints and open validation work, rather than evidence that the current build has passed those checks.

**1. Choose a visual identity using actual screens**

Prepare three materially different directions before production UI edits. Each direction should include the home screen, one dancer sheet, and one gameplay frame in the same composition and resolution as the current product. This produces nine comparable images, followed by a short motion study for the selected direction.

| Direction | Visual language | Characters and worlds | Tradeoff |
| --- | --- | --- | --- |
| Motion Festival · recommended | Warm violet and magenta, gold accents, cream type, oversized editorial game artwork, concert lighting | Graphic cel-shaded athletes, strong silhouettes, expressive clothing; distinct venues within one entertainment world | Evolves the existing identity and can support both playful games and dramatic arenas |
| Electric Playground | Sculpted shapes, tactile painted surfaces, sunlit dioramas, generous spatial UI | Rounded stylized characters, chunky readable props, inviting miniature worlds | Strong Wii-like accessibility and friendliness; less naturally suited to a severe rhythm arena |
| Kinetic Broadcast | Cream and charcoal, sharp color signals, oversized athletic typography, restrained animation | Fashion-oriented sports characters, bold architectural stages, graphic motion accents | More mature sports positioning; deliberately departs from the current palette and typography |

The second and third directions are explicit alternatives to the handover's existing visual rules. Until a direction is selected, retain the current violet/magenta/gold identity, Lilita One and Baloo 2, minimal copy, type-led controls, and unboxed composition. Product copy should continue to avoid emojis and em dashes.

The selected direction becomes a small art bible: palette roles, type scale, silhouette rules, character proportions, materials, lighting, icon shapes, feedback hierarchy, and motion timing. Use original or appropriately licensed production assets. Concept images establish appearance; they are not substitutes for rigged game characters or playable environments.

**2. Rebuild the entire player journey**

| Surface | Proposed change | Acceptance evidence |
| --- | --- | --- |
| Home | A large featured game scene and visible selection of the rest of the catalog; editorial artwork with integrated titles; clearly discoverable navigation | All seven games are discoverable; keyboard and touch selection work; no dependence on an unexplained horizontal scrollbar |
| Game selection | Distinct key art, a short actual gameplay preview on selection, and concise duration, movement, impact, and player-count information | A new player can identify what they will do before pressing Play |
| Game home | Full-bleed venue art, hero character or equipment, one dominant Play action, secondary practice/friends choices, contextual unlocks | Each game has its own identity while navigation and controls stay consistent |
| Setup | Camera source choice, live framing guide, responsive body outline, tracking state, and a brief practice of the game's movements | Setup tests the required body regions and movements; a failed body check cannot silently become a scored round |
| Character selection | Visible cast lineup with animated previews, outfits, names, and a clear My Look option | Choosing a character no longer requires cycling through a text button without seeing the result |
| Gameplay HUD | One compact score/round cluster, one secondary cluster when needed, small contextual motion cues | Notes, hands, feet, hazards, and the dance coach remain unobstructed; critical text is readable from the play position |
| Pause and tracking recovery | Large Resume, Recalibrate, Restart, and Exit actions; gentle reacquisition feedback | The game suspends scoring when input is stale or lost, and resumes predictably |
| Results | Character celebration, one prominent achievement, brief performance breakdown, visible next reward, immediate replay | Measured movement and successful play drive rewards; demo results are clearly separate |
| Friends | Shared ready state, short room code, readable rival progress, rematch flow, clear optional video sharing | Tested on two physical devices and different networks, including a relayed connection |
| Fitness | Short mixed-game sessions, active minutes, streaks, movement milestones, intensity selection | Fitness data stays understandable; calorie values are labeled as estimates, not used as the primary achievement |
| Phone | Pairing, camera framing, tracking/connection state, and simple session controls | The phone's camera role is designed separately from the large-screen gameplay layout |

Explore dwell-based hand selection only after the basic flow works. Use obvious focus and progress feedback, and prevent accidental selection from normal movement. Keep conventional controls available. Default the design effort to a landscape laptop/monitor/TV experience plus a phone camera companion; validate standalone mobile gameplay separately before promising equivalent precision.

**3. Give the dancers and cast an authored production pipeline**

Keep Nova, Blaze, Luna, Kiko, Rex, Velvet, Midnight, and Sol as recognizable identities. Develop one hero character fully before producing the complete cast.

- Create front, side, and back views; expression and outfit sheets; material references; and a small signature-pose sheet. Distinguish characters through silhouette and attitude as well as palette.
- Replace or augment procedural anatomy with authored, rigged art. On the Canvas path, prototype layered illustrated meshes, masks, and a limited set of facing variants. On an approved 3D path, use a skinned GLB with cel-shaded materials and a shared humanoid skeleton.
- Retarget the player's calibrated joints through anatomical constraints, stable limb lengths, torso orientation, and confidence-aware blending. Add foot planting where tracking supports it; avoid sliding feet, collapsing elbows, and uncontrolled twist.
- Animate coaches and opponents using authored or licensed motion clips with explicit move timing and transitions. Preserve the timing of existing Dance routines and gold moves.
- Keep the player's body motion responsive to actual tracking. Use canned clips for a runner's gait, coach demonstration, idle, and celebration; do not use them to fabricate the player's successful movement or score.
- Add restrained secondary motion to hair and clothing, anticipation to coach actions, and distinct celebration states. Readability and timing come before extra accessories.
- Preserve My Look color/proportion mapping and current cast preferences through migration. Offer a small live mirror preview for feedback; a full segmented-video player treatment is a separate optional direction, not a prerequisite.
- Share the cast between covers, game homes, practice demonstrations, Dance, Boxing coaches, Rush runners, and results. This is how the suite gains a recognizable identity without producing unrelated art for every screen.

First character acceptance clip: idle, left/right reach, cross-body reach, turn, shallow squat, lower-body motion, brief occlusion, reacquisition, and a celebration. Compare source movement and avatar side by side. Approval depends on motion, not just an attractive still.

**4. Make the renderer decision with a bounded comparison**

Canvas 2D can support a polished illustrated style. Real depth, changing camera perspective, skinned characters, and spatial lighting are easier to author consistently in a 3D renderer. My preferred long-term option for Beat Blade and Rush is an incremental Three.js presentation layer, subject to the owner's decision after the visual boards. The handover explicitly records that 3D was rolled back and asks for approval before reintroducing it; this plan does not change the stack.

If that option is selected, compare the existing Beat Blade render and a small Three.js prototype using the same note chart, camera framing, colors, and recorded input. Compare image quality, sustained frame time, tracking age, load size, and recovery behavior. Only retain it if the visual gain survives real-camera use.

Implementation shape if selected:

- Keep Vite and vanilla TypeScript. A React or Next.js migration is not required for this work.
- Add a renderer-independent game session contract. Current `GameOpts` requires `CanvasRenderingContext2D`; first separate input, simulation, sound, results, and rendering.
- Use a separate WebGL canvas and one active shared renderer for migrated games. The existing canvas already owns a 2D context; it cannot simply switch context types. Keep Dance and Fruit functional while migration proceeds game by game.
- Keep gameplay and scoring outside scene objects. Use a fixed simulation step where appropriate; rhythm judgments remain tied to the authoritative music clock and input timestamps.
- Keep menus and text-heavy HUD in DOM; keep action, character animation, and effects in the scene renderer.
- Ship optimized GLB assets, shared materials, compressed textures, lazy-loaded game bundles, and quality tiers. Budget effects with MediaPipe running, rather than measuring an empty scene.
- Use simple swept intersections and authored collision proxies for the initial runner, blades, and pads. Add a physics engine when a game needs meaningful physical response, such as a later Bowling rebuild.
- Implement resize, context loss/recovery, scene disposal, and audio cleanup as part of the first slice.

Three.js's [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) supports the intended asset route. The current [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) requires WebGL 2, so actual target-device support belongs in the prototype gate.

If Canvas remains the choice, use the same game architecture and art direction with authored 2D rigs, layered environments, baked lighting and depth cues, and carefully composed effects. Commit to a controlled camera and illustrated aesthetic, then demonstrate the result honestly in motion.

**5. Establish motion input as a shared product capability**

The camera is estimating pose, so design interactions around signals it can observe reliably. A depth-capable motion-camera experience and tracked handheld VR controllers are quality references, not interchangeable input hardware.

1. Preserve the tested joint mapping. The `JOINTS` implementation and handover use subject-left landmarks for rig L; the introductory comment in `rig.ts` still contradicts that mapping. Correct documentation and verify with a real raised-left-hand check before any retargeting work.
2. Feed all arcade games through a calibrated shared pose service. Produce continuous joint samples and discrete actions derived from those samples. Latching remains useful for lane switches and jumps; continuous contact remains necessary for blades and pads.
3. Extend the rig with lower-body joints, source timestamps, confidence, and explicit capability flags. Use actual video aspect ratio rather than assuming all camera sources are 4:3.
4. Upgrade phone packets with protocol version, sequence, capture time, confidence, and optional world landmarks. Measure sustainable sampling rate and network delay before raising the send rate. Handle missing fields and old clients deliberately.
5. Avoid treating repeated network frames as new motion measurements. Interpolate for display, limit extrapolation, and use frame freshness to decide whether a scoreable action exists.
6. Separate short visual smoothing from evidence used by hit detection. Prediction must not create extra hits or turn missing input into successful movement.
7. Measure tracking, transport, render, and audio delay independently. Google documents that web PoseLandmarker inference is synchronous; profile a worker-based pipeline if it is blocking the renderer. [MediaPipe documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
8. Run a real-camera tuning session with the existing debug overlay. Tune body-normalized thresholds, mirrored directions, reachable target areas, and timing windows using measured movement. Include different distances and both webcam and phone inputs.
9. Centralize session lifecycle, pause/recovery, records, and demo isolation. Preserve existing stats with a versioned migration rather than clearing localStorage.

Add low-impact movement alternatives as part of the input design: a deliberate knee raise or reach instead of mandatory jumping, smaller calibrated lateral range, and optional shallow ducks. Use symbols and position as well as color for hand and target cues. Provide reduced camera motion, shake, bloom, and flashes without removing essential gameplay information.

**6. Beat Blade · first flagship slice**

Fantasy: stand on a suspended platform inside a vast musical structure and physically conduct its light with two energy blades.

- Environment: a recognizable architectural arena, layered ribs and light volumes, strong near/far scale, reflective material accents, and a dramatic horizon. Preserve a quiet target corridor while the surrounding structure transforms on musical phrases.
- Equipment: designed hilts, clear blade cores, speed-reactive trails, cut debris, contact sparks, and a distinctive ignition. Give impact effects a hierarchy so arrows and targets stay readable.
- Music direction: synchronize environment events to bars, phrase changes, builds, and drops. Use frequent beat pulses sparingly. A large flash should communicate a musical or player milestone.
- Interaction: matching hand, target crossing, cut direction, and timing. Start with broad reachable targets and four directions; introduce doubles, crossovers, dodge walls, and higher density only after camera validation.
- Camera: stable play view with restrained scene motion. Do not require VR-style depth placement or precise controller wrist orientation from a webcam estimate.
- Content: three authored, licensed or original tracks with hand-checked charts before expanding automatic generation. Preserve Any Song as a flexible mode, but do not claim a generic BPM grid has the same chart quality. Treat the embedded music video's audio and analysis limitations separately from a locally controlled audio source.
- Progression: accuracy, combo, blade cosmetics, medals, a seeded daily chart, then personal ghosts and asynchronous challenges. Live race comes after solo timing and network behavior are measured.

First slice: one 60–90 second musical passage with an intro, a build, a drop, a recovery phrase, and results. It must be replayable with the real camera, not only `?bladetest`. Retain the existing harness for deterministic visual comparison.

**7. Boxing · rebuild as a character-led pad session**

Fantasy: train with an expressive coach in a stylized rooftop gym, with a later progression to a lit arena.

- A complete coach occupies the space, moves mitts into reachable targets, anticipates combinations, absorbs hits, and responds with short encouraging cues.
- Design mitt materials, glove deformation, body weight shifts, footwork, impact animation, and dry, layered contact sounds. The coach's reaction should make a hit feel physical even on modest hardware.
- First mechanics: left/right straight punches, high/low targets, return to guard, and readable slips. Validate these before adding hooks, uppercuts, and reactive sparring.
- Hit validation: the correct hand must enter the pad's target region during the active time window with appropriate extension/motion evidence. A punch elsewhere must miss. Require recovery before counting another strike.
- Use available world-pose estimates as one signal, and a separately tuned image-space fallback for phone input. Do not label a webcam-derived strength score as measured punch force.
- Build authored combinations with anticipation, attack, recovery, and rest. Offer Technique and Cardio modes with clear intensity choices.
- Progression: three short training rounds, combo mastery, coach reactions, outfit/glove unlocks, and score challenges. Defer live contact-versus-player combat until solo recognition and latency are proven.

First slice: one finished coach, one gym, jab-cross, high/low targeting, one slip cue, guard reset, and a scored 60-second round. Include explicit tests that wrong-hand, wrong-height, stale-frame, and repeated-without-recovery punches do not score.

**8. Rush · rebuild as the original runner game**

Fantasy: your GrooveStar character runs through a colorful city at golden hour, moving between rooftops, a market, and a dramatic transit concourse. Use the lane-runner genre as inspiration while authoring GrooveStar's own places, characters, props, and audio.

- Visuals: a real sense of forward travel; layered architecture, foreground passes, soft distance haze, landmark reveals, and authored obstacle silhouettes. Prioritize one excellent route before producing additional biomes.
- Character: grounded run cycles, leaning lane transitions, jump/step-over animation, crouch, stumble recovery, and visible near-miss reactions. Live torso lean and arm motion can add responsiveness over authored locomotion.
- Controls: calibrated lateral displacement changes lanes, a deliberate upward action clears hurdles, and a squat/duck clears overhead obstacles. Keep locomotion centered in a comfortable play area; physical running toward the screen is not required.
- Low-impact mode: use an intentional knee raise or reach to trigger the same in-game clearance action. Confirm recognition during setup.
- Course director: seeded, handcrafted chunks connected by rules. Guarantee a reachable route and sufficient movement-transition time, not just one visually empty lane. Exclude unavoidable overlapping jump/duck requirements.
- Structure: offer a short checkpoint session first, then Endless. Add coins, near misses, one readable power-up, recovery sections, and a finale set piece.
- Progression: route medals, new outfits, daily seeds, and a ghost of the player's own best. Add equal-seed friend races after replay and networking are stable.

First slice: a 90-second route, one runner, three obstacle types, one power-up, one landmark reveal, and a finish. Prove a clear route remains physically achievable at each intended difficulty.

**9. Make subsequent games cheaper to build**

Introduce a typed game manifest for title, cover/preview, controls, required tracked joints, camera capabilities, session lengths, renderer, asset bundle, music, progression rules, and multiplayer support. The shared app owns setup, countdown, pause, results, accessibility settings, and navigation. Each game owns its rules, authored content, and scene.

Version seeds with game rules, chart/course content, input mode, and difficulty. A seed alone is insufficient for comparable ghosts when the generator changes. Record action/replay data locally by default; video recording and sharing remain separate choices.

Following the three priority games, rebuild Tennis around continuous racket contact and Bowling around a measured swing/release. Give them complete environment, music, asset, progression, and testing packages. Avoid adding more catalog tiles until the existing offerings meet the new bar.

**10. Delivery order and acceptance gates**

| Milestone | Concrete deliverable | Gate before expanding |
| --- | --- | --- |
| A · Visual direction | Three sets of home/character/game images and one selected motion study | Owner selects a coherent direction; art bible records it |
| B · Baseline and motion | Real-camera measurements, input contracts, lower-body plan, reliable demo isolation, known Dance regression baseline | Left/right mapping, loss/recovery, calibration, and phone limitations are understood |
| C · Presentation proof | A renderer comparison if approved, one hero character motion test, and a 60–90 second Beat Blade slice | Material visual gain, readable targets, reliable real-camera play, acceptable sustained performance |
| D · Shared UI and cast | New home, game detail, setup, HUD, results, cast picker, first completed character; Dance presentation adapted carefully | Full journey works on desktop and phone companion; Dance behavior remains intact |
| E · Boxing | One complete coach-led round, then three rounds after validation | Spatially correct punch scoring and coach contact read convincingly |
| F · Rush | One finished route, then route and difficulty expansion | Lane/jump/duck recognition is stable and course transitions are achievable |
| G · Suite release | Fruit visual consistency, shared progression/challenges, remaining cast, network and device validation | Every released game meets the common quality bar |

Plan this as multiple production milestones rather than one giant rewrite. Set calendar estimates after the first character and Beat Blade slice expose the real art-production and tracking costs. The initial asset workload is one hero character, one blade arena, one gym, one runner route kit, three music/chart packages, and a small original or licensed effects library. Producing all eight characters and several biomes before those proofs would multiply rework.

**Release evidence required**

- Capture comparable menu, character, gameplay, and results frames and short clips. Include small-screen layouts and room-distance readability.
- Aim initially for 60 fps on the primary laptop with camera inference active and a measured 30 fps fallback tier. Record sustained frame-time percentiles, pose age, and input-to-feedback latency; these are proposed targets, not claims about today's build. Phone mode needs its own measured budget.
- Test lower-quality lighting, temporary occlusion, entering/leaving frame, different body proportions and camera distances, and the selected low-impact mappings.
- Test seeded scoring/replay determinism, reachable courses, real target contact, and no records from demo play. Synthetic inputs verify code paths, while physical camera sessions determine movement acceptance.
- Exercise repeated launches, pause, restart, exit, audio disposal, resizing, and graphics recovery. Repair stale smoke scripts before relying on them; the current arcade smoke script's first-tile assumption predates Dance becoming the first catalog tile.
- Run the existing build and appropriate smoke checks, plus new targeted interaction tests when behavior changes. Save screenshots and outcome evidence with each game milestone.
- Exercise phone-camera pairing and a two-device friend race on real networks, including reconnect and rematch. Do not inherit a multiplayer pass from the handover.
- Replace the borrowed SFX pack with cleared production audio and record provenance for new characters, environments, motion, music, and catalog media before a broader release.
- Work in an isolated branch/worktree. Establish and verify a preview deployment route before publishing experiments. The handover reports that main pushes deploy Production and that no staging environment is established; do not treat a push as harmless backup.
- Release only the accepted milestone, preserve the previous build as rollback, and record the exact commit, deployment status, and canonical Production alias. Close browser sessions immediately after each review.

**Next concrete task**

Produce the nine visual direction previews against the current GrooveStar layouts, with Motion Festival as the recommended direction. Include an enlarged dancer comparison and a Beat Blade frame that makes the intended improvement visible. Selection of that direction and the renderer route then determines the first playable slice. No game-code rewrite or deployment is part of this planning task.
