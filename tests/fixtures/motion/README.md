# Motion fixtures

Short clips of a person moving in front of a static camera. `tools/kinetic/realmotion.mjs` serves each one to Chrome as the webcam, so every game can be played by a recorded body in automated QA.

| Clip | Movement | Used for |
| --- | --- | --- |
| `dance.mp4` | Both hands up (setup pose), then free dancing | Dance |
| `box.mp4` | Setup pose, guard, jabs and crosses toward the camera | Boxing |
| `rush.mp4` | Setup pose, side steps, a jump, a squat | Rush |
| `slash.mp4` | Setup pose, two-handed slashing sweeps (holding prop swords) | Beat Blade, Fruit Slice |
| `swing.mp4` | Setup pose, underarm bowling swings, forehand swings | Bowling, Tennis |
| `bowl-real.mp4` | Setup pose holding a bowling ball, then pendulum bowling swings | Bowling |
| `tennis-real.mp4` | Setup pose with a racket, forehands, backhands and an overhead | Tennis |
| `boxing-real.mp4` | Setup pose, guard, jabs, crosses, hooks, blocks, a duck | Boxing |

Each clip opens with the setup pose (both hands raised), which the one-pose calibration requires.

Provenance: generated on 27 September 2026 with Higgsfield (Kling 3.0, standard, silent, 12 s, 16:9), then center-cropped to 4:3 and encoded at 640×480 for test use. The `*-real` clips were generated the same way for the round 4 gameplay rebuild. The people shown are AI-generated, not real individuals. These clips are QA material only and are not shipped with the game.
