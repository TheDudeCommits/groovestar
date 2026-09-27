# Kinetic asset provenance

Prepared 5 September 2026. This register covers assets introduced or replaced by the Kinetic implementation. It does not relicense inherited YouTube content, routines or unrelated third-party dependencies.

| Assets | Source and method | Attribution / scope |
| --- | --- | --- |
| `public/models/{nova,blaze,luna,kiko,rex,velvet,midnight,sol}.glb` | Original procedural Blender clothing, anatomy, hair, materials, rig and authored keyframes in `tools/kinetic/build_cast.py`; editable Nova `.blend` retained | Created for GrooveStar in this implementation; no downloaded meshes, sampled motion or real-person likenesses |
| World and equipment geometry | Original TypeScript scene construction in `src/kinetic/render/` and game modules | Created for GrooveStar; no game-franchise models, textures, logos or maps |
| Catalog / crew WebPs | Engine captures made by `tools/kinetic/capture-artwork.mjs` | Derived from the above assets |
| 34 `public/sfx/*.mp3` | Original synthesized impulses, tones, sweeps and noise rendered by the same audio script | Every inherited borrowed one-shot has been replaced; filenames retained for compatibility |
| Barlow Condensed, Manrope, IBM Plex Mono | Versioned `@fontsource` npm packages; local font delivery | SIL Open Font License 1.1, complete notices shipped in `public/licenses/` |
| Three.js and bundled meshopt decoder | Versioned npm dependency; GLTFLoader / SkeletonUtils / rendering | Three.js MIT notice shipped in `public/licenses/Three-MIT.txt`; decoder's embedded notice retained in its module |
| `public/kinetic/pt/logo.webp` (added 27 September 2026) | Generated with Higgsfield (GPT Image 2.5, 2K) from the owner-approved Primetime concept frames, trimmed and converted by `tools/primetime/import-art.mjs` | AI-generated original logotype; source PNG kept outside the repository |
| `public/kinetic/pt/{card-*,hero-*,nova-avatar,plate-home}.webp` (replaced 27 September 2026) | Cycles renders of the game's own Nova model, posed from her Meshy clips, with procedural props, lighting and sets in Blender (`tools/primetime/keyart/keyart.py`, `render_all.sh`), converted by `tools/primetime/import-keyart.mjs`. The avatar is a crop of the Dance card; the home still is the Dance hero | Original renders; replaced the generated key art after owner feedback that it looked AI-generated |
| `public/kinetic/pt/plate-fruit.webp` (replaced 27 September 2026) | Cycles render of a procedural wooden dojo wall with paper lanterns (`tools/primetime/keyart/dojo.py`) | Original render |
| Retired 27 September 2026 | The generated plates for Boxing, Rush, Tennis and Bowling and the crowd strip were removed; those venues now build their stands, skies and crowds in Three.js | — |
| `public/models/nova-moves.glb`, `src/data/nova-dances.json` (added 27 September 2026) | 41 clips from Meshy's animation library applied to Nova's rig (20 dances plus game actions), merged without mesh by `tools/primetime/build-moves.mjs`; dance tempo, beat phase and pose data derived by `tools/primetime/bake-dances.mjs` and `dance-data.py` | Generated under the owner's Meshy plan |
| Signal, Afterimage, Velocity, Neon Nights (replaced 27 September 2026) | Original compositions rendered from pure DSP by `tools/primetime/music/render.mjs` (`tracks.mjs` holds the chords, hooks and arrangements): synthesized drums, supersaws, plucks, lead, risers, reverb, delay and limiting | No samples or third-party recordings. Prototype music under owner decision 3; commissioned or licensed songs still planned |
| `public/models/nova-pt.glb` (added 27 September 2026) | Meshy multi-image-to-3D from the Nova concept views, remeshed and auto-rigged by Meshy; Idle, All Night Dance, Boom Dance, You Groove, Combat Stance, Cheer and Run clips from Meshy's animation library, merged and meshopt-compressed by `tools/primetime/build-nova.mjs` | Generated under the owner's Meshy plan; the character is original to GrooveStar |
| `tests/fixtures/motion/*.mp4` (added 27 September 2026) | Five 12-second clips generated with Higgsfield (Kling 3.0), center-cropped to 4:3 and encoded at 640×480 | AI-generated people, not real individuals. QA input for `npm run qa:realmotion` only; not shipped with the game |

Removed 27 September 2026: `public/routines/*.json` (44 indexed Dance Classics plus 2 unindexed files). They were pose-extracted from third-party Just Dance gameplay videos, so they are not distributable. They are archived outside the repository as local test data, and `src/routines.ts` reads `public/routines/` only in development builds. Git history before that date still contains them.

`asset-manifest.json` records current file sizes and SHA-256 hashes for the cast, new music/art, effects and license notices. To regenerate: `node tools/kinetic/asset-manifest.mjs`.

Rebuild audio with `npm run assets:audio` (requires ffmpeg with MP3 encoding). Rebuild optimized cast with `npm run assets:cast` (requires Blender; glTF-Transform comes from the lockfile). Rebuild artwork against a running Vite server with `npm run assets:art` (uses local Chrome, Playwright Core and Sharp; closes its browser in `finally`). Do not substitute concept images for runtime geometry or remove source files after export.

The synthesized tracks and hand-authored chart phrases still need human listening and physical play acceptance. Reproducible generation and provenance are not a claim of human musical approval.
