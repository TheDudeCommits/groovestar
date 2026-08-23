#!/bin/bash
# Extract every routine in /tmp/jd-top50.txt with 3 parallel workers.
# Skips already-built routines; logs to /tmp/jd/batch.log
TOOLS=/Users/amir/Claude/groovestar/tools/extract_jd
OUT=/Users/amir/Claude/groovestar/public/routines
LOG=/tmp/jd/batch.log
: > "$LOG"

worker() {
  while IFS='|' read -r id views title; do
    [ -f "$OUT/$id.json" ] && { echo "SKIP $id (built)" >> "$LOG"; continue; }
    echo "START $id $title" >> "$LOG"
    if "$TOOLS/run_one.sh" "$id" "$title" >> "$LOG" 2>&1; then
      echo "OK   $id" >> "$LOG"
    else
      echo "FAIL $id" >> "$LOG"
    fi
    rm -f "/tmp/jd/$id.mp4" "/tmp/jd/$id.wav"   # keep disk bounded
  done
}

rm -f /tmp/jd/part-*
awk '{ print > ("/tmp/jd/part-" (NR % 3)) }' /tmp/jd-top50.txt
for f in /tmp/jd/part-0 /tmp/jd/part-1 /tmp/jd/part-2; do
  worker < "$f" &
done
wait
echo "BATCH DONE" >> "$LOG"
ls "$OUT"/*.json | wc -l
