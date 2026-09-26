# Kinetic Broadcast art bible

Selected by the owner on 5 September 2026. This selection supersedes the baseline violet/gold typography and presentation guidance for the new Kinetic surfaces. Retained Classic Canvas modes remain available.

## Identity

| Role | Color / type | Use |
| --- | --- | --- |
| Paper | `#eeeae1` | Main surface, clothing, score plates |
| Ink | `#171917` | Functional type, equipment, architecture |
| Vermilion | `#f35d42` | Action, right-hand equipment, gym |
| Cobalt | `#365ff5` | Left-hand equipment, rhythm arena |
| Chartreuse | `#d7ef70` | Progress, timing feedback, secondary accents |
| Display | Barlow Condensed 600–800 | Oversized athletic headlines and numbers |
| Body | Manrope 400–700 | Descriptions and instructions |
| Information | IBM Plex Mono 400–500 | Timers, movement cues, indices |

Use large type, asymmetric compositions, numbered games, strong silhouettes, graphic court markings and actual game-scene artwork. Keep movement targets visually quiet. Compact score plates provide contrast against moving scenery. Hand cues combine left/right placement, arrow direction and color. Avoid ornamental dashboard cards, excessive floating labels, emojis and decorative camera shake.

## Cast and rig

Eight original sportswear characters share one 17-bone rig: Nova, Blaze, Luna, Kiko, Rex, Velvet, Midnight and Sol. Hair silhouettes and team colors distinguish them. Technical jackets use cream panels, colored sleeves, pockets, zip details and fitted trousers. Outfits unlock at 5 and 10 accumulated medals. My Look maps saved colors and bounded body/head proportions to the new rig.

`tools/kinetic/build_cast.py` is the source of geometry, material assignments, skin weights and animation. `cast-source.blend` is an editable Nova source scene. Blender exports Y-up GLB, front facing +Z. The build wrapper batches meshes by material and runs meshopt compression. Use `npm run assets:cast` with Blender on PATH, or set `GROOVESTAR_BLENDER`.

Clips: Idle, Run, Dance, Guard, Celebrate. Coaches and preview actors use clips; Dance's player uses observed joints. Rig L remains the user's anatomical left (MediaPipe 11/13/15/23). A front-facing model uses the opposite named anatomical bone to reproduce the mirrored display. Confidence loss blends unsupported limbs toward rest. Feet stay level with floor correction. Cross-body display depth is an artistic offset, not inferred physical depth and never scoring evidence.

## Worlds and motion

- Dance: graphic broadcast court with cobalt backdrop and cream floor. Existing routine timing and scorer feed a presentation adapter.
- Beat Blade: deep architectural corridor, repeating ribs, coral/cobalt light, distant torus portal, a quiet note corridor, continuous blade trails and split notes. Phrase changes use the original soundtrack's clock.
- Boxing: coral training hall, complete coach, suspended ring ropes and reachable colored mitts.
- Rush: terracotta and cream city, modular buildings, trees, lamps, awnings, road markings and a repeated city gateway. Recycle three scenery chunks.
- Fruit: dark green broadcast court behind the established fruit simulation and effects.
- Tennis: complete court, net, rackets, ball arc and Luna opponent.
- Bowling: three wood lanes, sculpted pins and a measured swing/release ball. Arcade pin response is a custom simplified simulation.

Stable gameplay cameras are primary. Portrait framing expands field of view to retain the play area; standalone phone precision is not yet physically accepted. Reduced-motion mode removes decorative camera/scenery motion where applicable, disables Fruit shake/flashes and lowers Blade bloom. Low graphics disables postprocessing/shadows and caps DPR at 1. Auto starts at DPR <=1.5 and can shed resolution/shadows.

## Media and QA

Catalog and cast WebP images are captured from the actual engine with `npm run assets:art` while the Vite server runs at port 5179. These images are playable-asset previews, not independently generated concept art. Keep source scripts and licenses with asset changes. See `ASSET_PROVENANCE.md` and `KINETIC_IMPLEMENTATION.md` for provenance and acceptance boundaries.
