# GrooveStar Primetime

Assessment and plan published 27 September 2026: https://claude.ai/artifact/9aaTXdWXUU3EU8bgPKyMFt (private to the owner's account). The owner answered all six decisions with "yes" the same day and asked for Phase 0 to start.

## Direction

Primetime keeps the Kinetic Broadcast brand DNA (Barlow Condensed type, numbered broadcast graphics, cobalt-left and coral-right hand code) and moves every venue from a daytime studio to a night concert show:

- The player's mirrored avatar is the headliner.
- A Show Director drives lights, LED walls, lasers, pyro, confetti, crowd and camera from song structure.
- A Hype meter escalates the show through five levels: Soundcheck, Warm-up, Headliner, Encore, Supernova.
- Characters are stylized toon models with ink outlines and two-tone rim light.
- Gameplay targets always stay brighter and more saturated than the background.

Palette: Stage Black `#07040F`, Midnight `#1A0B3A`, Hot Magenta `#FF3FB4`, Electric Cyan `#3FE0FF`, Star Gold `#FFD23E`, plus the existing Cobalt `#365FF5` (left hand) and Coral `#F35D42` (right hand).

## Owner decisions (27 September 2026)

1. Primetime is the look for every venue.
2. The 44 routines extracted from Just Dance gameplay videos leave the public build. They are archived outside the repository as local test data.
3. Music: commission or license an original catalog. AI-generated music is for prototypes only.
4. Scope: finish Dance, Beat Blade, Boxing and Rush first, then Fruit Slice, Tennis and Bowling.
5. Cast: rebuild all eight characters through the Higgsfield, Meshy and Blender pipeline, starting with Nova.
6. Platform: stay web-first on Vercel.

## Phases

| Phase | Scope | Gate |
| --- | --- | --- |
| 0 · Fix and foundations | IP cleanup, worker inference, one-pose calibration, model preload, Dance fixes, ribbon trails, draw calls, search hardening, real-motion QA | 60 fps with the camera on, setup under 10 s, no extracted third-party routines public, real-motion suite green |
| 1 · Dance Main Stage | Primetime render kit, Show Director, Hype levels, Nova 2.0, better retargeting, Main Stage venue kit, feedback effects, one original song | Captures match the concept frames, 60 fps with the camera on, owner signs off |
| 2 · Restyle the suite | Beat Blade Lightshow Cathedral, Boxing Rooftop Fight Night, Rush Groove City Run, couch-scale home and flow, Fruit into Three.js | Same capture, frame-time and real-motion checks per game |
| 3 · Replay layer | World Tour, mastery ladder, closet, daily and weekly events, couch battle, leaderboards, highlight clips | Every session shows a next goal |
| 4 · Content engine | 12 to 20 original songs with stems, filmed original choreography, remaining cast | Every catalog song is original or licensed |

## Phase 0 status

Implemented on branch `primetime/phase-0`; see `HANDOVER.md` for the change list and verification.

## Overhaul status (27 September 2026)

After seeing the Phase 0 preview, the owner asked for the visible overhaul straight away. Branch `primetime/overhaul` (on top of Phase 0) delivers most of Phases 1 and 2:

- **Render kit and show:** Primetime stage mode (night fog, toon key light, bloom, grade with a beat kick), the Show Director with five hype levels, moving heads, lasers, LED walls, crowds, confetti, sparks and pyro.
- **Nova 2.0:** the Meshy model, toon-shaded with an outline hull and two-color rim, with seven animation clips. Tracking and choreography drive the Meshy skeleton through rest-relative limb aiming; coaches use two-bone IK.
- **Venues:** Dance Main Stage (LED wall, hologram coach, pyro; YouTube songs play on the LED wall behind the dancer), Beat Blade cathedral, Boxing sunset arena, Rush Groove City, Tennis night stadium, Bowling cosmic lanes, Fruit Slice night market.
- **Interface:** lobby home with the live stage behind a game-card carousel, level and streak bar, key-art game pages, new setup, results, settings, crew and progress screens, chrome judgment callouts, combo counter, hype meter and level banners.

Still open from Phases 1 and 2: an original song for the Dance slice (decision 3), Fruit Slice in Three.js (it keeps its 2D simulation under a new painted arena), and the other seven characters (the crew screen shows them as arriving soon; every role is played by Nova for now). Phases 3 and 4 have not started.
