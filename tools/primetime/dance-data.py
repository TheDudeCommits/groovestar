# Nova dance data: turns the dance lab bake (tools/primetime/bake-dances.mjs)
# into src/data/nova-dances.json for the Dance coach.
#
# For each Meshy dance clip it stores the natural tempo (from the hip bounce
# and joint speed periodograms, checked by eye), the beat phase (the hips'
# lowest point, where a groove lands), per-beat energy and facing, and the
# game pose parameters (moves.ts convention, as the coach appears to the
# camera) at 8 samples per beat.
#
#   python3 tools/primetime/dance-data.py tools/primetime/scratch/dance-bake.json
import json, sys
import numpy as np

FPS = 60
SPB = 8  # pose samples per beat
# Natural tempo of each clip. Clips with no clear tempo, or that face away
# from the camera for long stretches, are left out.
BPM = {
    "D22": 127.2, "D23": 124.0, "D24": 129.0, "D63": 110.0, "D65": 116.0,
    "D68": 124.0, "D70": 141.5, "D72": 120.0, "D79": 123.0, "D83": 130.5,
    "Dance": 104.0, "Dance2": 139.5, "Dance3": 112.0,
}


def hp(x, w=91):
    k = np.ones(w) / w
    pad = np.pad(x, (w // 2, w // 2), mode="edge")
    return x - np.convolve(pad, k, mode="valid")


src = json.load(open(sys.argv[1]))
out = []
all_speed = np.concatenate([np.array(c["speed"]) for c in src if c["name"] in BPM])
speed_ref = np.percentile(all_speed, 95)
for c in src:
    name = c["name"]
    if name not in BPM:
        continue
    bpm = BPM[name]
    period = 60.0 / bpm
    P = period * FPS
    rows = np.array(c["rows"])
    hip = hp(np.array(c["hip"]))
    speed = np.array(c["speed"])
    face = np.array(c["face"], dtype=float)
    n = len(hip)
    # fold the hip signal at the beat period; the groove lands where it is lowest
    bins = 48
    acc = np.zeros(bins)
    cnt = np.zeros(bins)
    for i in range(n):
        b = int(((i % P) / P) * bins) % bins
        acc[b] += hip[i]
        cnt[b] += 1
    fold = acc / np.maximum(cnt, 1)
    fold = np.convolve(np.concatenate([fold[-3:], fold, fold[:3]]), np.ones(5) / 5, mode="same")[3:-3]
    phase = (int(np.argmin(fold)) + 0.5) / bins * period
    dur = c["dur"]
    beats = int((dur - phase) / period) - 1
    t_rows = np.arange(n) / FPS

    def sample(arr, t):
        return np.interp(t, t_rows, arr)

    ks = np.arange(beats * SPB + 1)
    ts = phase + ks / SPB * period
    f = np.stack([sample(rows[:, p], ts) for p in range(10)], axis=1)
    f[:, [0] + list(range(2, 10))] = np.round(f[:, [0] + list(range(2, 10))] * 2) / 2
    f[:, 1] = np.round(f[:, 1] * 100) / 100
    e, fc = [], []
    for b in range(beats):
        m = (t_rows >= phase + b * period) & (t_rows < phase + (b + 1) * period)
        e.append(round(float(np.clip(speed[m].mean() / speed_ref, 0.05, 1.0)), 2))
        fc.append(int(round(float(np.abs(face[m]).mean()))))
    out.append({"id": name, "bpm": bpm, "phase": round(phase, 4), "beats": beats, "e": e, "face": fc, "f": f.tolist()})
    print(f"{name:7s} bpm {bpm:6.1f} phase {phase:.3f}s beats {beats:2d} energy {np.mean(e):.2f} face max {max(fc)}")

json.dump({"v": 1, "spb": SPB, "clips": out}, open("src/data/nova-dances.json", "w"), separators=(",", ":"))
import os
print("wrote src/data/nova-dances.json", os.path.getsize("src/data/nova-dances.json"), "bytes")
