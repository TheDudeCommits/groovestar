#!/bin/bash
# Final key art: every game as a 2:3 card and a 16:9 hero.
cd "$(dirname "$0")"
OUT=${GROOVESTAR_KEYART:-~/Claude-Pro/groovestar-primetime/art3/keyart}
mkdir -p "$OUT"
for g in dance blade box rush fruit tennis bowl; do
  for v in card wide; do
    /Applications/Blender.app/Contents/MacOS/Blender -b -P keyart.py -- $g $v $OUT/$g-$v.png 1.0 ${SAMPLES:-128} 2>&1 | grep -E "SAVED|Traceback|Error:"
  done
done
echo ALLDONE
