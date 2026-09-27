/** Standard ten-pin scoring: cumulative totals per frame, null while pending. */
export function bowlingTotals(rolls: number[][]): (number | null)[] {
  const flat: number[] = [];
  rolls.forEach((f) => flat.push(...f));
  const out: (number | null)[] = [];
  let i = 0,
    sum = 0;
  for (let f = 0; f < 10; f++) {
    const fr = rolls[f] ?? [];
    if (!fr.length) {
      out.push(null);
      continue;
    }
    if (f < 9 && fr[0] === 10) {
      if (flat.length < i + 3) out.push(null);
      else {
        sum += 10 + flat[i + 1] + flat[i + 2];
        out.push(sum);
      }
      i += 1;
    } else if (f < 9 && fr.length === 2 && fr[0] + fr[1] === 10) {
      if (flat.length < i + 3) out.push(null);
      else {
        sum += 10 + flat[i + 2];
        out.push(sum);
      }
      i += 2;
    } else if (f < 9) {
      if (fr.length < 2) out.push(null);
      else {
        sum += fr[0] + fr[1];
        out.push(sum);
      }
      i += 2;
    } else {
      const done = fr.length === 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
      if (!done) out.push(null);
      else {
        sum += fr.reduce((a, b) => a + b, 0);
        out.push(sum);
      }
      i += fr.length;
    }
  }
  return out;
}
