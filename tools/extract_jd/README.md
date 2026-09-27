# Routine extraction

Builds a GrooveStar routine from a performance video: `pose_extract.mjs` runs the game's MediaPipe pose model over the video, and `build_routine.py` beat-aligns the motion into 2-beat clips with gold moves and energy.

Use it only on footage you own or have licensed, such as dancers filmed performing original GrooveStar choreography. The routines extracted earlier came from third-party game videos. They were removed from the repository on 27 September 2026 and are kept offline as local test data.

Output goes to `public/routines/`, which is gitignored and read only by development builds (`src/routines.ts`). Shipping new routines publicly requires original or licensed choreography and a change to that gate.

`run_one.sh` still contains paths from the original author's machine; adjust `OUT` and `TOOLS` before running it.
