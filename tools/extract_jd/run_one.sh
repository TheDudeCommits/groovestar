#!/bin/bash
# Extract one JD routine: run_one.sh <videoId> <title>
set -e
ID="$1"; TITLE="$2"
DIR=/tmp/jd
OUT=/Users/amir/Claude/groovestar/public/routines
TOOLS=/Users/amir/Claude/groovestar/tools/extract_jd
mkdir -p "$DIR"

if [ ! -f "$DIR/$ID.mp4" ]; then
  yt-dlp -q -S "res:480,vcodec:h264" --merge-output-format mp4 \
    -o "$DIR/$ID.mp4" "https://www.youtube.com/watch?v=$ID"
fi
# headless Chrome needs h264 — transcode anything else
CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$DIR/$ID.mp4")
if [ "$CODEC" != "h264" ]; then
  ffmpeg -y -loglevel error -i "$DIR/$ID.mp4" -c:v libx264 -preset veryfast -crf 26 -vf "scale=-2:480" -c:a copy "$DIR/$ID.h264.mp4"
  mv "$DIR/$ID.h264.mp4" "$DIR/$ID.mp4"
fi
if [ ! -f "$DIR/$ID.wav" ]; then
  ffmpeg -y -loglevel error -i "$DIR/$ID.mp4" -ac 1 -ar 22050 "$DIR/$ID.wav"
fi
if [ ! -f "$DIR/$ID.pose.json" ]; then
  (cd /Users/amir/Claude/groovestar && node "$TOOLS/pose_extract.mjs" "$DIR/$ID.mp4" "$DIR/$ID.pose.json")
fi
# Claude tempo prior (best-effort; 0 = none)
PRIOR=$(curl -s --max-time 20 -H "Origin: https://groovestar.vercel.app" \
  "https://groovestar.vercel.app/api/songmeta?t=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$TITLE")" \
  | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('bpm') or 0)
except: print(0)" 2>/dev/null || echo 0)
/tmp/jdvenv/bin/python "$TOOLS/build_routine.py" "$DIR/$ID.pose.json" "$DIR/$ID.wav" "$ID" "$TITLE" "$OUT/$ID.json" "$PRIOR"
