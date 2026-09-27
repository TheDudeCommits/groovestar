# Kinetic asset provenance

Prepared 5 September 2026. This register covers assets introduced or replaced by the Kinetic implementation. It does not relicense inherited YouTube content, routines or unrelated third-party dependencies.

| Assets | Source and method | Attribution / scope |
| --- | --- | --- |
| `public/models/{nova,blaze,luna,kiko,rex,velvet,midnight,sol}.glb` | Original procedural Blender clothing, anatomy, hair, materials, rig and authored keyframes in `tools/kinetic/build_cast.py`; editable Nova `.blend` retained | Created for GrooveStar in this implementation; no downloaded meshes, sampled motion or real-person likenesses |
| World and equipment geometry | Original TypeScript scene construction in `src/kinetic/render/` and game modules | Created for GrooveStar; no game-franchise models, textures, logos or maps |
| Catalog / crew WebPs | Engine captures made by `tools/kinetic/capture-artwork.mjs` | Derived from the above assets |
| Signal, Afterimage, Velocity | Original deterministic DSP compositions, instruments and drum synthesis in `tools/kinetic/build_audio.mjs`; each 90 seconds, stereo 44.1 kHz MP3 | No sampled commercial recordings; arrangement BPMs 112 / 128 / 136 |
| 34 `public/sfx/*.mp3` | Original synthesized impulses, tones, sweeps and noise rendered by the same audio script | Every inherited borrowed one-shot has been replaced; filenames retained for compatibility |
| Barlow Condensed, Manrope, IBM Plex Mono | Versioned `@fontsource` npm packages; local font delivery | SIL Open Font License 1.1, complete notices shipped in `public/licenses/` |
| Three.js and bundled meshopt decoder | Versioned npm dependency; GLTFLoader / SkeletonUtils / rendering | Three.js MIT notice shipped in `public/licenses/Three-MIT.txt`; decoder's embedded notice retained in its module |
| `public/kinetic/pt/{card-*,plate-*,crowd,logo,nova-avatar}.webp` (added 27 September 2026) | Generated with Higgsfield (GPT Image 2.5, 2K) from the owner-approved Primetime concept frames, then resized and converted to WebP by `tools/primetime/import-art.mjs`; the Nova avatar is a crop of the Dance card | AI-generated original art: no third-party characters, logos or real people. Source PNGs are kept outside the repository |
| `public/models/nova-pt.glb` (added 27 September 2026) | Meshy multi-image-to-3D from the Nova concept views, remeshed and auto-rigged by Meshy; Idle, All Night Dance, Boom Dance, You Groove, Combat Stance, Cheer and Run clips from Meshy's animation library, merged and meshopt-compressed by `tools/primetime/build-nova.mjs` | Generated under the owner's Meshy plan; the character is original to GrooveStar |
| `tests/fixtures/motion/*.mp4` (added 27 September 2026) | Five 12-second clips generated with Higgsfield (Kling 3.0), center-cropped to 4:3 and encoded at 640×480 | AI-generated people, not real individuals. QA input for `npm run qa:realmotion` only; not shipped with the game |

Removed 27 September 2026: `public/routines/*.json` (44 indexed Dance Classics plus 2 unindexed files). They were pose-extracted from third-party Just Dance gameplay videos, so they are not distributable. They are archived outside the repository as local test data, and `src/routines.ts` reads `public/routines/` only in development builds. Git history before that date still contains them.

`asset-manifest.json` records current file sizes and SHA-256 hashes for the cast, new music/art, effects and license notices. To regenerate: `node tools/kinetic/asset-manifest.mjs`.

Rebuild audio with `npm run assets:audio` (requires ffmpeg with MP3 encoding). Rebuild optimized cast with `npm run assets:cast` (requires Blender; glTF-Transform comes from the lockfile). Rebuild artwork against a running Vite server with `npm run assets:art` (uses local Chrome, Playwright Core and Sharp; closes its browser in `finally`). Do not substitute concept images for runtime geometry or remove source files after export.

The synthesized tracks and hand-authored chart phrases still need human listening and physical play acceptance. Reproducible generation and provenance are not a claim of human musical approval.
