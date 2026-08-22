# AIST++ → GrooveStar motion clips.
# Reads 3D COCO-17 keypoints (60fps), de-rotates each frame so the dancer faces
# the camera, converts to the game's FK pose parameters, cuts beat-aligned
# 2-beat clips, and greedily selects a diverse library per genre.
import pickle, os, json, math
import numpy as np

KP = '/tmp/aist/kp3d/keypoints3d'
OUT = '/Users/amir/Claude/groovestar/src/data/clips.json'
# COCO-17 indices
NOSE, LSHO, RSHO, LELB, RELB, LWRI, RWRI = 0, 5, 6, 7, 8, 9, 10
LHIP, RHIP, LKNE, RKNE, LANK, RANK = 11, 12, 13, 14, 15, 16
KF_PER_CLIP = 16          # keyframes per 2-beat clip
CLIP_BEATS = 2
PER_GENRE = 20

GENRES = {
    'gBR': 'break', 'gPO': 'pop', 'gLO': 'lock', 'gMH': 'hiphop', 'gLH': 'lahiphop',
    'gHO': 'house', 'gWA': 'waack', 'gKR': 'krump', 'gJS': 'streetjazz', 'gJB': 'balletjazz',
}

def bpm_of(name):
    music = name.split('_')[4]        # mBR0
    return 80 + 10 * int(music[3])

def wrap(a):
    return (a + 180.0) % 360.0 - 180.0

def seq_to_params(kp):
    """kp: (F,17,3) y-up. Returns (F,10) [lean,crouch,aL0,aL1,aR0,aR1,lL0,lL1,lR0,lR1]."""
    F = kp.shape[0]
    pelvis = (kp[:, LHIP] + kp[:, RHIP]) / 2
    neck = (kp[:, LSHO] + kp[:, RSHO]) / 2
    torso_len = np.linalg.norm(neck - pelvis, axis=1)
    tl = np.median(torso_len)
    # facing: hip axis in ground plane (x,z); rotate so it aligns with +x
    hip_axis = kp[:, LHIP] - kp[:, RHIP]
    face = np.arctan2(hip_axis[:, 2], hip_axis[:, 0])   # rotation of hips in xz
    cosf, sinf = np.cos(-face), np.sin(-face)
    def derot(pts):
        x = pts[:, 0] * cosf - pts[:, 2] * sinf
        return np.stack([x, pts[:, 1]], axis=1)          # (F,2): lateral, up
    P = {j: derot(kp[:, j] - pelvis) for j in
         [NOSE, LSHO, RSHO, LELB, RELB, LWRI, RWRI, LHIP, RHIP, LKNE, RKNE, LANK, RANK]}
    neck2 = (P[LSHO] + P[RSHO]) / 2

    def limb_angle(v, s):
        # game coords: gx = lateral (subject L -> viewer L when mirrored), gy = down
        gx, gy = v[:, 0], -v[:, 1]
        return np.degrees(np.arctan2(gx * s, gy))

    out = np.zeros((F, 10))
    # lean: torso up vector
    ux, uy = neck2[:, 0], -neck2[:, 1]
    out[:, 0] = np.degrees(np.arctan2(ux, -uy))
    # crouch: pelvis drop vs standing reference
    ank_y = (kp[:, LANK, 1] + kp[:, RANK, 1]) / 2
    pel_h = kp[:, LHIP, 1] * 0.5 + kp[:, RHIP, 1] * 0.5 - ank_y
    h_stand = np.percentile(pel_h, 85)
    out[:, 1] = np.clip((h_stand - pel_h) / (0.55 * tl), 0, 1.3)
    # arms/legs — subject Left drawn as viewer-left (s=-1), mirrored like a mirror
    for (sh, el, wr, s, i) in [(LSHO, LELB, LWRI, -1, 2), (RSHO, RELB, RWRI, 1, 4)]:
        a = limb_angle(P[el] - P[sh], s)
        b = limb_angle(P[wr] - P[el], s)
        out[:, i] = a
        out[:, i + 1] = wrap(b - a)
    for (hp, kn, an, s, i) in [(LHIP, LKNE, LANK, -1, 6), (RHIP, RKNE, RANK, 1, 8)]:
        a = limb_angle(P[kn] - P[hp], s)
        c = limb_angle(P[an] - P[kn], s)
        out[:, i] = a
        out[:, i + 1] = np.clip(wrap(a - c) / 0.9, -10, 150)
    # light smoothing (5-frame box) on angles, unwrap-free since values stay in range
    k = np.ones(5) / 5
    for c in range(10):
        out[:, c] = np.convolve(out[:, c], k, mode='same')
    return out

def clip_energy(kp, f0, f1):
    j = [LWRI, RWRI, LANK, RANK]
    v = np.linalg.norm(np.diff(kp[f0:f1, j], axis=0), axis=2).mean()
    return v

clips = []
files = sorted(os.listdir(KP))
for genre_code, genre in GENRES.items():
    cand = []
    gfiles = [f for f in files if f.startswith(genre_code) and f.endswith('.pkl')]
    for f in gfiles:
        try:
            d = pickle.load(open(os.path.join(KP, f), 'rb'))
            kp = d.get('keypoints3d_optim', d.get('keypoints3d'))
            if kp is None or np.isnan(kp).any():
                kp = np.nan_to_num(kp) if kp is not None else None
            if kp is None or kp.shape[0] < 240:
                continue
        except Exception:
            continue
        bpm = bpm_of(f)
        fpb = 3600.0 / bpm
        params = seq_to_params(kp)
        F = kp.shape[0]
        span = int(round(fpb * CLIP_BEATS))
        # skip intro/outro beats; step by 2 beats
        start = int(fpb * 2)
        while start + span < F - int(fpb):
            frames_idx = [start + int(round(kf * span / KF_PER_CLIP)) for kf in range(KF_PER_CLIP)]
            fr = params[frames_idx]                       # (16,10)
            en = clip_energy(kp, start, start + span)
            # reject glitchy clips (angle jumps between keyframes)
            jump = np.abs(np.diff(fr[:, 2:], axis=0)).max()
            travel = np.abs(np.diff(fr[:, 2:6], axis=0)).sum()  # arm movement amount
            lean_ok = np.abs(fr[:, 0]).max() < 55 and np.abs(fr[:, 1]).max() < 1.15
            if jump < 95 and travel > 60 and lean_ok:
                cand.append({'src': f, 'start': start, 'frames': fr, 'energy': en})
            start += span
    if not cand:
        continue
    # normalize energy within genre to 0..1
    ens = np.array([c['energy'] for c in cand])
    lo, hi = np.percentile(ens, 5), np.percentile(ens, 95)
    for c in cand:
        c['e'] = float(np.clip((c['energy'] - lo) / max(1e-6, hi - lo), 0.05, 1.0))
    # greedy max-min diversity on flattened params
    X = np.stack([c['frames'].flatten() for c in cand])
    X = X / (X.std(axis=0) + 1e-6)
    chosen = [int(np.argmax(ens))]
    while len(chosen) < min(PER_GENRE, len(cand)):
        dmin = np.full(len(cand), np.inf)
        for ci in chosen:
            d = np.linalg.norm(X - X[ci], axis=1)
            dmin = np.minimum(dmin, d)
        dmin[chosen] = -1
        chosen.append(int(np.argmax(dmin)))
    for rank, ci in enumerate(chosen):
        c = cand[ci]
        fr = np.round(c['frames'] * 2) / 2               # 0.5 precision
        # peak keyframe: max total arm extension/height for the pictogram
        peak = int(np.argmax(np.abs(fr[:, 2]) + np.abs(fr[:, 4])))
        clips.append({
            'id': f'{genre}_{rank:02d}',
            'g': genre,
            'e': round(c['e'], 2),
            'b': CLIP_BEATS,
            'pk': peak,
            'f': [[float(x) for x in row] for row in fr],
        })

print('total clips:', len(clips))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as fp:
    json.dump({'v': 1, 'kf': KF_PER_CLIP, 'clips': clips}, fp, separators=(',', ':'))
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
# sanity: print param ranges
allf = np.concatenate([np.array(c['f']) for c in clips])
print('param mins:', np.round(allf.min(axis=0), 1))
print('param maxs:', np.round(allf.max(axis=0), 1))
