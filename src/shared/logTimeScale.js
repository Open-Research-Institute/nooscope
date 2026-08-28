// Maps time <-> a [0,100] percent using a log scale on elapsed time since `min`, rather
// than linear. Comment/reply activity tends to burst right after a post goes up and then
// trail off for days or weeks — a linear scale crushes that whole burst into a sliver at
// the left edge. Log-scaling elapsed time spreads the burst out while still fitting the
// long tail, at the cost of the axis no longer being "evenly spaced = evenly spaced time".
//
// log1p/expm1 (not log/exp) so elapsed = 0 (the very first item) maps to percent = 0
// instead of -Infinity.
export function timeToPercent(time, min, max) {
    const maxElapsed = max - min;
    if (maxElapsed <= 0) return 0;
    const elapsed = Math.max(0, time - min);
    return (Math.log1p(elapsed) / Math.log1p(maxElapsed)) * 100;
}

export function percentToTime(percent, min, max) {
    const maxElapsed = max - min;
    if (maxElapsed <= 0) return min;
    const logMaxElapsed = Math.log1p(maxElapsed);
    return min + Math.expm1((percent / 100) * logMaxElapsed);
}
