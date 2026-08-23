# JD gameplay video -> GrooveStar routine JSON.
# Inputs: pose samples (pose_extract.mjs) + mono wav of the audio track.
# 1) beat grid: onset-strength autocorrelation -> bpm, comb alignment -> phase
# 2) FK conversion identical to process_aist.py, but from 2D screen coords
#    (viewer-left limb = MediaPipe subject-RIGHT indices -> armL, s=-1)
# 3) trim to the danced region, resample to 8 keyframes/beat, slice 2-beat
#    windows (16 kf = the game's clip format), pick peaks, place golds
# Usage: build_routine.py <pose.json> <audio.wav> <videoId> <title> <out.json>
import json, sys, wave, math
import numpy as np

pose_f, wav_f, vid, title, out_f = sys.argv[1:6]

# ---- pose samples -----------------------------------------------------------
P = json.load(open(pose_f))
frames = P['frames']
# columns after [t, present]: 13 pts x (x, y, vis)
NOSE, LSHO, RSHO, LELB, RELB, LWRI, RWRI, LHIP, RHIP, LKNE, RKNE, LANK, RANK = range(13)

def pt(row, j):
    return np.array([row[2 + j * 3], row[2 + j * 3 + 1]]), row[2 + j * 3 + 2]

# ---- audio beat grid --------------------------------------------------------
# 1) octave-family autocorrelation (defeats the 3:2 dotted-rhythm lock),
# 2) optional Claude tempo prior (argv[6]), 3) least-squares beat-snap refine.
w = wave.open(wav_f)
sr = w.getframerate()
pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
HOP = 512
n = len(pcm) // HOP
env = np.zeros(n)
for i in range(n):
    seg = pcm[i * HOP:(i + 1) * HOP]
    env[i] = np.sqrt((seg ** 2).mean())
flux = np.maximum(0, np.diff(env, prepend=0))
flux = flux - flux.mean()
fps_a = sr / HOP
prior = float(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] != '0' else None

STEP = 0.25
grid = np.arange(50, 321, STEP)
S = np.zeros(len(grid))
for gi, b in enumerate(grid):
    lag = int(round(fps_a * 60 / b))
    if 2 <= lag < len(flux) - 1:
        S[gi] = (flux[:-lag] * flux[lag:]).mean()
def s_at(b):
    gi = int(round((b - 50) / STEP))
    return S[gi] if 0 <= gi < len(grid) else 0.0
best_bpm, best_v = 120.0, -1e9
for b in np.arange(85, 171, STEP):
    v = s_at(b) + 0.7 * s_at(b * 2) + 0.7 * s_at(b / 2) + 0.4 * s_at(b * 4)
    if prior and min(abs(b / prior - 1), abs(b / (prior * 2) - 1), abs(b * 2 / prior - 1)) < 0.04:
        v *= 1.35
    if v > best_v: best_v, best_bpm = v, b
bpm = float(best_bpm)

# phase: comb over one beat of offsets
lag = fps_a * 60 / bpm
best_ph, best_pv = 0.0, -1
for ph in np.arange(0, lag, lag / 48):
    idxs = np.arange(ph, len(flux) - 1, lag).astype(int)
    v = flux[idxs].mean()
    if v > best_pv: best_pv, best_ph = v, ph
t_beat0 = best_ph / fps_a

# refine (bpm, phase) by snapping predicted beats to nearby onset peaks and
# least-squares fitting — kills the slow drift a 0.25-bpm error would cause
for _ in range(3):
    spb_f = fps_a * 60 / bpm
    ph_f = t_beat0 * fps_a
    ks, snaps = [], []
    k = 0
    while ph_f + k * spb_f < len(flux) - spb_f * 0.2:
        c = ph_f + k * spb_f
        w0 = int(max(0, c - spb_f * 0.15)); w1 = int(min(len(flux) - 1, c + spb_f * 0.15))
        if w1 > w0:
            j = w0 + int(np.argmax(flux[w0:w1]))
            if flux[j] > 0:
                ks.append(k); snaps.append(j)
        k += 1
    if len(ks) > 20:
        A = np.vstack([np.array(ks, float), np.ones(len(ks))]).T
        (m, c0), *_ = np.linalg.lstsq(A, np.array(snaps, float), rcond=None)
        bpm = float(fps_a * 60 / m)
        t_beat0 = float(c0 / fps_a)
t_beat0 = t_beat0 % (60.0 / bpm)

# ---- FK conversion ----------------------------------------------------------
def wrap(a): return (a + 180.0) % 360.0 - 180.0

rows, times = [], []
for row in frames:
    if row[1] != 1: rows.append(None); times.append(row[0]); continue
    rows.append(row); times.append(row[0])

def convert(row):
    # viewer-left = subject RIGHT (coach faces camera, mirror-teaching like JD)
    shL, vshL = pt(row, RSHO); shR, vshR = pt(row, LSHO)
    elL, _ = pt(row, RELB); elR, _ = pt(row, LELB)
    wrL, vwL = pt(row, RWRI); wrR, vwR = pt(row, LWRI)
    hipL, vhL = pt(row, RHIP); hipR, vhR = pt(row, LHIP)
    knL, _ = pt(row, RKNE); knR, _ = pt(row, LKNE)
    anL, vaL = pt(row, RANK); anR, vaR = pt(row, LANK)
    if min(vshL, vshR, vhL, vhR) < 0.4: return None
    pel = (hipL + hipR) / 2
    neck = (shL + shR) / 2
    tl = np.linalg.norm(neck - pel)
    if tl < 0.02: return None
    def limb(a, b, s):
        v = b - a
        return math.degrees(math.atan2(v[0] * s, v[1]))  # screen y is already "down"
    o = np.zeros(11)
    up = pel - neck
    o[0] = math.degrees(math.atan2(neck[0] - pel[0], up[1]))       # lean
    ank_y = (anL[1] + anR[1]) / 2
    o[1] = (ank_y - pel[1]) / tl                                    # pelvis height ratio (crouch later)
    o[2] = limb(shL, elL, -1); o[3] = wrap(limb(elL, wrL, -1) - o[2])
    o[4] = limb(shR, elR, 1);  o[5] = wrap(limb(elR, wrR, 1) - o[4])
    o[6] = limb(hipL, knL, -1)
    o[7] = np.clip(wrap(o[6] - limb(knL, anL, -1)) / 0.9, -10, 150)
    o[8] = limb(hipR, knR, 1)
    o[9] = np.clip(wrap(o[8] - limb(knR, anR, 1)) / 0.9, -10, 150)
    o[10] = np.linalg.norm(np.array([wrL, wrR, anL, anR]).reshape(4, 2) - pel, axis=1).mean() / tl
    return o

params = [convert(r) if r else None for r in rows]
valid = np.array([p is not None for p in params])

# ---- trim to the danced region ---------------------------------------------
# longest run where >=70% of a sliding 4 s window has a pose
W = int(4 * P['fps'])
good = np.convolve(valid.astype(float), np.ones(W) / W, mode='same') > 0.7
if not good.any():
    print('NO DANCED REGION', file=sys.stderr); sys.exit(2)
runs, s = [], None
for i, g in enumerate(good):
    if g and s is None: s = i
    if (not g or i == len(good) - 1) and s is not None:
        runs.append((s, i)); s = None
r0, r1 = max(runs, key=lambda r: r[1] - r[0])
t_start, t_end = times[r0], times[r1]
# also require some margin from the absolute video ends (menus/score screens)
t_end = min(t_end, P['dur'] - 2)

# ---- interpolate params onto a uniform track --------------------------------
T = np.array(times)
V = np.array([i for i, p in enumerate(params) if p is not None])
PM = np.array([params[i] for i in V])
def sample(t):
    tv = T[V]
    j = np.searchsorted(tv, t)
    if j <= 0: return PM[0]
    if j >= len(tv): return PM[-1]
    u = (t - tv[j - 1]) / max(1e-6, tv[j] - tv[j - 1])
    a, b = PM[j - 1], PM[j]
    r = a + (b - a) * u
    # angles: shortest-path blend
    for c in [0, 2, 3, 4, 5, 6, 8]:
        d = wrap(b[c] - a[c]); r[c] = a[c] + d * u
    return r

# crouch normalization from pelvis-height ratios inside the danced region
ratios = PM[:, 1][(T[V] >= t_start) & (T[V] <= t_end)]
r_stand = np.percentile(ratios, 85)

# ---- beat grid & window slicing --------------------------------------------
spb = 60.0 / bpm
b_start = math.ceil((t_start - t_beat0) / spb / 2) * 2   # start on an even audio beat
b_end = math.floor((t_end - t_beat0) / spb / 2) * 2
n_beats = b_end - b_start
if n_beats < 48:
    print('TOO SHORT: %d beats' % n_beats, file=sys.stderr); sys.exit(2)
t_of_beat = lambda b: t_beat0 + (b_start + b) * spb
# the game grid: beat = t*bpm/60 - lead  ->  lead makes game-beat 0 = our beat 0
lead = t_of_beat(0) * bpm / 60.0

windows, peaks, energies = [], [], []
for wstart in range(0, n_beats - 1, 2):
    kfs, spread = [], []
    for k in range(16):
        p = sample(t_of_beat(wstart + k / 8.0))
        crouch = float(np.clip((r_stand - p[1]) / 0.55, 0, 1.3))
        row = [round(float(np.clip(wrap(p[0]), -60, 60))),
               round(crouch * 100) / 100,
               round(float(p[2])), round(float(p[3])), round(float(p[4])), round(float(p[5])),
               round(float(np.clip(p[6], -60, 130))), round(float(p[7])),
               round(float(np.clip(p[8], -60, 130))), round(float(p[9]))]
        kfs.append(row)
        spread.append(p[10])
    windows.append(kfs)
    peaks.append(int(np.argmax(spread)))
    # energy: mean absolute inter-kf angle change of the arms
    arr = np.array(kfs, dtype=float)
    energies.append(float(np.abs(np.diff(arr[:, 2:6], axis=0)).mean()))

en = np.array(energies)
e_norm = np.clip((en - np.percentile(en, 10)) / max(1e-6, np.percentile(en, 90) - np.percentile(en, 10)), 0, 1)

# golds: 5-7 windows at local energy peaks, spaced >= 12 windows apart
order = np.argsort(-e_norm)
golds, taken = [], []
for i in order:
    if len(golds) >= 6: break
    if all(abs(int(i) - t2) >= 12 for t2 in taken) and i > 2 and i < len(windows) - 1:
        golds.append(int(i)); taken.append(int(i))
golds.sort()

qual = float(valid[r0:r1].mean())
routine = {
    'v': vid, 'title': title, 'bpm': round(bpm, 2), 'lead': round(lead, 3),
    'beats': n_beats, 'quality': round(qual, 3),
    'e': [round(float(x), 2) for x in e_norm],
    'pk': peaks, 'golds': golds, 'windows': windows,
}
json.dump(routine, open(out_f, 'w'), separators=(',', ':'))
print('%s: bpm %.1f lead %.2f beats %d windows %d quality %.0f%% golds %s'
      % (vid, bpm, lead, n_beats, len(windows), qual * 100, golds))
