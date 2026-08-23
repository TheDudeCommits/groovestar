# Build public/routines/index.json from extracted routine files, in the
# original popularity order, with cleaned display titles.
import json, os, re, sys, unicodedata

ROUT = '/Users/amir/Claude/groovestar/public/routines'
TOP = '/tmp/jd-top50.txt'
MIN_QUALITY = 0.72

# hand-curated title/artist for entries whose video titles are messy
CURATED = {
    'bMZAuhadz2Y': ('Watch Me (Whip/Nae Nae)', 'Silentó'),
    '8c4iKz6pdf8': ('Mi Mi Mi', 'SEREBRO'),
    '5J4OdXW3WQ4': ('Dame Tu Cosita', 'El Chombo'),
    'NI31AWYYuFI': ('...Baby One More Time', 'Britney Spears'),
    'zBzdeWM3VvE': ('Limbo', 'Daddy Yankee'),
    'YCDCwuGcEmA': ('Y.M.C.A.', 'The Village People'),
    'QwYqMzg6LfQ': ("Hips Don't Lie (Sumo)", 'Shakira'),
    'u3S8T3jZA6A': ('Timber', 'Pitbull ft. Ke$ha'),
    'qfeiJD6_JZw': ('That POWER', 'will.i.am ft. Justin Bieber'),
    'AFIqSaZM2D0': ('Blue (Da Ba Dee)', 'Eiffel 65'),
    'fq0GqiO-B74': ('Dragostea Din Tei', 'O-Zone'),
    'gVfgTw_W_JY': ('Waka Waka (Football Version)', 'Shakira'),
    '_1Gd5nXtcKQ': ('DDU-DU DDU-DU', 'BLACKPINK'),
    'G74_o_43_RQ': ('Happy', 'Pharrell Williams'),
    'eYMni0l8g6Y': ('Uptown Funk (Tuxedo)', 'Mark Ronson ft. Bruno Mars'),
    '4e33gj1W0EY': ("Don't Let Me Down", 'The Chainsmokers ft. Daya'),
    'jYoLNSzaUOQ': ("Hips Don't Lie", 'Shakira'),
    'RxozAnVBWio': ('Animals', 'Martin Garrix'),
    'HAaqFejias8': ('Policeman', 'Eva Simons ft. Konshens'),
    'y9WUm3QvHK0': ('Daddy', 'PSY ft. CL'),
    'Z9yFg55IVls': ('Worth It', 'Fifth Harmony ft. Kid Ink'),
    'Vf2s-fakSIo': ('Vodovorot', 'XS Project'),
    'eV4kPGM2RBo': ('Bailar', 'Deorro ft. Elvis Crespo'),
    '5pb-txxfRDk': ('Bangarang', 'Skrillex ft. Sirah'),
    '8jn_f5tVhR8': ('All I Want for Christmas Is You', 'Mariah Carey'),
    '834iwIuP124': ('What Makes You Beautiful', 'One Direction'),
    '0TlpP7wwgS8': ('PAC-MAN', 'Dancing Bros.'),
    'bl399rfzD5s': ("C'mon", 'Ke$ha'),
    'UDQLbRicvic': ('Girls Just Want to Have Fun', 'Cyndi Lauper'),
    'R9bMw6xpB50': ('Lean On', 'Major Lazer & DJ Snake ft. MØ'),
    '6XFom6EzkPk': ('Old Town Road', 'Lil Nas X'),
    'Ak2v_bJmRDY': ('Get Busy', 'Sean Paul'),
    'esLEZZLO7aw': ('HandClap', 'Fitz and the Tantrums'),
    'VyQ9uu9Ykdc': ('Rave in the Grave', 'AronChupa ft. Little Sis Nora'),
    'ETVdSfgXlw0': ('Make It Jingle', 'Big Freedia'),
    'bI7QZHzva-E': ('Dance Monkey', 'Tones and I'),
    'RxwziZzFef4': ('Just Mario', 'Ubisoft meets Nintendo'),
    'LgSwygAVqhc': ('Say So', 'Doja Cat'),
    'rfQ88eMDXaA': ('Con Calma', 'Daddy Yankee ft. Snow'),
    'sixARQZxsys': ('Who Let the Dogs Out?', 'Baha Men'),
    '-sLrRi5s8QM': ('Cola Song', 'INNA ft. J Balvin'),
    'peu6C23_2Ks': ('Oh No!', 'Marina and the Diamonds'),
    'jWdv2daMowE': ("Everybody (Backstreet's Back)", 'Backstreet Boys'),
    'MJTEt4aPhFQ': ('Run the Show', 'Kat DeLuna ft. Busta Rhymes'),
    'wvG9HFnjl6Q': ('Run the Show (Extreme)', 'Kat DeLuna ft. Busta Rhymes'),
    'nbYZH3Eu6hs': ('Finesse (Remix)', 'Bruno Mars ft. Cardi B'),
    'fkjUgVdAPlE': ('Old Town Road (Remix)', 'Lil Nas X ft. Billy Ray Cyrus'),
    'zi1qIeU_y6c': ('Beep Beep I’m a Sheep', 'LilDeuceDeuce'),
}
# ambiguous uploads (trailers/compilations) — never include
BLOCKLIST = {'OQL6k16JJl4', 'AompHPFPLEA'}

def clean(title):
    t = unicodedata.normalize('NFKC', title)
    t = re.sub(r'[\U0001F000-\U0001FAFF⭐⚔▶★☆️]', '', t)
    t = re.sub(r'(?i)just\s*dance\s*(20\d\d|[1-4]|now|unlimited)?', '', t)
    t = re.sub(r'(?i)\b(wii u|xbox one|kinect|playstation( camera)?|gameplay|megastar|superstar|5 stars?( rating)?|full gameplay|hacked|fan made|uncensored|original song)\b', '', t)
    t = re.sub(r'[\[\](){}|•·]+', ' ', t)
    t = re.sub(r'\s*[-–:]\s*$', '', re.sub(r'^\s*[-–:]\s*', '', t.strip()))
    t = re.sub(r'\s{2,}', ' ', t).strip(' -–:•')
    # "Song - Artist" or "Artist - Song": leave as-is, just tidy
    return t.strip() or title

order = []
with open(TOP) as f:
    for line in f:
        parts = line.strip().split('|')
        if len(parts) >= 3:
            order.append((parts[0], parts[2]))

index = []
for vid, raw_title in order:
    if vid in BLOCKLIST:
        continue
    path = os.path.join(ROUT, vid + '.json')
    if not os.path.exists(path):
        continue
    r = json.load(open(path))
    if r.get('quality', 0) < MIN_QUALITY or r.get('beats', 0) < 96:
        print('CULL %s quality=%.2f beats=%d' % (vid, r.get('quality', 0), r.get('beats', 0)))
        os.remove(path)
        continue
    if vid in CURATED:
        title, artist = CURATED[vid]
    else:
        title, artist = clean(raw_title), ''
        m = re.match(r'^(.*?)\s+(?:by|ft\.?|feat\.?)\s+(.*)$', title, re.I)
        if m and m.group(2):
            title, artist = m.group(1).strip(), m.group(2).strip()
        else:
            m2 = re.match(r'^(.*?)\s*-\s*(.*)$', title)
            if m2 and 2 < len(m2.group(2)) < 40:
                title, artist = m2.group(1).strip(), m2.group(2).strip()
    index.append({'v': vid, 'title': title[:60], 'artist': artist[:40],
                  'bpm': r['bpm'], 'beats': r['beats']})

json.dump(index, open(os.path.join(ROUT, 'index.json'), 'w'), separators=(',', ':'))
print('index: %d routines' % len(index))
for e in index[:60]:
    print('  %s | %s | %s | %.1f bpm' % (e['v'], e['title'], e['artist'] or '-', e['bpm']))
