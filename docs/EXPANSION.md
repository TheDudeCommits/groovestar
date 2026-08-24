# GrooveStar Movement Suite — Expansion Blueprint

From a dance game to a full camera-motion arcade (Kinect / Wii Motion / PS Eye
spiritual successor), all in the browser on the existing MediaPipe + canvas +
PeerJS stack.

## Games, ranked by feasibility

1. Fruit Slice (Fruit Ninja) — wrist-velocity slicing. Reuses trails +
   particles. Pure 2D. BUILD FIRST.
2. Beat Blade (Beat Saber) — beat-timed note blocks sliced per lane/direction.
   Reuses the beat clock, YouTube audio, mic sync.
3. Rush (Subway-style runner) — hip x = lane, hip-y spike = jump, crouch =
   slide. Pseudo-3D corridor.
4. Bowling — pendulum swing: speed = power, path curvature = spin, angle =
   aim. Turn-based multiplayer (latency-free).
5. Tennis — timing-window contact, swing vector shapes the shot. AI rally
   first, then 1v1.
6. Boxing — needs the depth toolkit (below). Fitness-first design.

Also strong: Hole-in-the-Wall (pose matching IS the game), ski slalom,
goalkeeper, whack-a-target cardio, volleyball bump, archery, pose Simon-says.

## Tracking roadmap

- Switch gesture logic to MediaPipe worldLandmarks (meters, true 3D).
- Punch depth = z-velocity + 2D arm foreshortening + wrist scale, fused.
- Couch 2P: numPoses: 2, person assignment by hip x. No networking.
- pose_landmarker_full for precision games on capable machines.
- Shared gesture library: swing / punch / jump / duck / lean classifiers over
  One-Euro-filtered joints.

## Multiplayer models

- Turn-based: bowling (send throw results).
- Parallel race: fruit / beat blade / runner (same seeded spawns, live rival
  score + ghost hands, latency-immune).
- Head-to-head: tennis & boxing (host-authoritative state, hit events only).

## Art direction

In-house vector art in the house style (flat color, warm sky, gold accent)
for all 2D games — cohesion over asset-pack patchwork. If a game graduates to
WebGL: Quaternius Downtown City Megakit + Kenney sports/food packs (both CC0).
