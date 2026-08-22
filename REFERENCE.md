# Reference breakdown — Just Dance footage study

Source footage studied frame-by-frame (contact sheets at 4s intervals across full
runtime + 4fps bursts on key moments):

- **Just Dance 2016 — Beauty And A Beat** (solo coach, night-city sky stage)
- **Just Dance 2014 — Timber** (duet, western saloon, day→night progression)
- **Just Dance 2014 — Y.M.C.A.** (4-coach crew, disco floor, neon letter set)

## Camera & framing
- Single locked full-body camera; zero cuts or camera moves during choreography.
- Coach occupies ~55–65% of frame height, feet visible, centered (solo) or evenly
  spaced (crew). Slight low-angle "stage" perspective; floor visible as a glowing
  platform anchoring the dancer in space.

## Coach presentation
- Stylized, high-contrast dancer with a **blank glowing face** (no readable identity),
  strong silhouette, neon rim-light outline separating them from a *darker* background.
- One hand wears a bright **glove** (the tracked hand) — it flashes gold/orange when a
  score event lands.
- Poses are big, readable, snapped to the beat; transitions are springy with slight
  anticipation and overshoot. Freeze on Gold Move.

## Background / stage
- Always darker and lower-contrast than the coach. Beat-reactive but never occluding:
  light geysers erupt on downbeats, aurora ribbons, constellation lines, bokeh fields,
  hue-shifting smoke, neon signage. Scene "evolves" every ~8 bars (verse/chorus themes).
- Beauty And A Beat: night city seen from above, glowing flower-shaped platform,
  purple clouds, star streaks; chorus switches to gold bokeh.
- Timber: saloon porch at sunset → night with string lights → neon carnival wall.
- YMCA: mirrored disco floor, giant neon Y-M-C-A letters colored per coach, colored fog.

## HUD (observed layout)
- **Top (per player)**: player name chip; judgment pops in directly beneath it —
  `OK` (white) → `GOOD` (cyan) → `PERFECT` (green) → `YEAH` (gold, with firework
  sparks, Gold Move only). Pops scale in, drift up, fade ~0.8s.
- **Left edge**: vertical progress meter filling upward (cyan in JD2016, green in
  JD2014) with up to 5 stars accumulating alongside; star pop = sparkle flash.
- **Bottom-left**: two-line karaoke lyrics; current line highlighted word-by-word in
  song accent color; next line dimmed below. Tiny mic/camera indicator in corner.
- **Bottom-right**: **pictogram queue** — simplified white stick-figure move cards
  sliding right→left along a baseline, arriving at the "now" slot exactly on the move's
  beat, then popping/fading. Direction arrows in yellow accent the moving limb.
  Gold Moves appear as a filled gold pictogram.

## Gold Moves
- Announced by the gold pictogram, executed as a held/accent pose.
- On hit: full-screen radial **sunburst rays**, gold particle burst, `YEAH` pop,
  background bloom flash. Roughly at section climaxes and the finale.

## Scoring model (as observable)
- Judgment cadence ≈ every 1–2 beats (per pictogram move).
- Forgiving: mostly upper-body/arm driven; player mirror-matches the coach.
- Score builds a hidden total mapped to the 5-star meter; JD2016 shows a
  "megastar/superstar" beyond 5.

## Flow
1. Title card (coach art + song/artist banner) → "Get ready!" → loading tip.
2. Countdown into first pictogram; song plays start→finish, no interruptions.
3. Outro: coach holds final pose, white "JUST DANCE" flash.
4. Results: dark starfield → player banner (avatar + name) slides in on a cyan light
   streak → "Congratulations!" → score counts up, stars pop with sparkles at
   thresholds → buttons (dance again / song list).

## Translation to camera control (this project)
- MediaPipe pose landmarks → limb-angle vector (upper arms, forearms, torso lean,
  thighs), mirrored to match the coach.
- Per move window (±0.45 beat around the pictogram beat) keep the best similarity;
  blend with a motion-energy term so an energetic-but-imprecise player still lands
  OK/GOOD (fun > motion-capture strictness).
- Thresholds → X / OK / GOOD / SUPER / PERFECT (+YEAH on gold), score → 13333-point
  scale with 5-star thresholds like the reference.
