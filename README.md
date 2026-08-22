# ⭐ GrooveStar

A camera-controlled dance game in the browser, built as a faithful recreation of the
**Just Dance** gameplay language — studied frame-by-frame from JD2014/JD2016 footage
(see [REFERENCE.md](REFERENCE.md) for the full breakdown).

**Play it:** allow the webcam, pick a song, stand back so your upper body is visible,
and mirror the on-screen coach. No webcam? Demo Mode runs the full show with
simulated scoring.

## The Just Dance DNA

| Reference system | GrooveStar implementation |
|---|---|
| Full-body coach, centered, locked camera | Canvas-rendered stylized dancer, blank glowing face, neon rim light, gloved tracked hand |
| Pictogram queue sliding to a "now" slot | Same move library renders coach pose, pictogram card, and scoring target |
| X / OK / GOOD / SUPER / PERFECT pops | Judgment pops under the player chip, per-move windows on the beat |
| Gold Moves ("YEAH", sunburst, freeze) | Gold pictograms → held pose, full-screen radial burst, sting, screen shake |
| Left star meter → 5 stars + superstar | 13,333-point scale with reference-style thresholds |
| Karaoke lyrics with sweep highlight | Original lyrics per song, word-sweep via CSS gradient |
| Beat-reactive stages that never occlude | 3 scenes: night-city geysers/aurora, gold bokeh, disco floor + neon letters |
| White-flash outro → count-up results | Congratulations banner, tabular count-up, stars popping at thresholds |

## Motion tracking & scoring

1. MediaPipe PoseLandmarker (lite, GPU) tracks 33 landmarks from the webcam at ~30 fps.
2. Landmarks are mirrored (you mirror the coach) and reduced to a limb-angle vector:
   upper arms, forearms, torso lean — the same feature the move library exports.
3. Each choreography move opens a ±0.85-beat window; the best blended similarity
   (70% pose accuracy, 30% motion energy) inside the window becomes the judgment.
4. Deliberately forgiving: enthusiasm scores; standing still doesn't.

## Songs

Three original tracks are synthesized live with WebAudio (kick/clap/hats, filtered
saw bass, supersaw pads, arp leads — zero audio assets):

- **Neon Nights** — 120 BPM, night-city scene
- **Gold Rush** — 128 BPM, gold bokeh scene
- **Letter Party** — 116 BPM, disco floor with G-R-V letter poses

## Dev

```bash
npm install
npm run dev     # local dev
npm run build   # typecheck + production build to dist/
```

Vanilla TypeScript + Vite + Canvas 2D. Only runtime dependency: `@mediapipe/tasks-vision`.
