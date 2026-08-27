// Edit this to customize source colors. Index = source label (0, 1, 2, ...), the
// stable id the pipeline assigns per input file, in the order the files were given.
// If there are more sources than colors here, the extras fall back to an evenly
// spaced hue instead of erroring.
export const SOURCE_COLOR_PALETTE = [
    '#ef4444', // red
    '#22c55e', // green
    '#3b82f6', // blue
    '#f59e0b', // amber
    '#a855f7', // purple
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#84cc16', // lime
];

export function getColorForSource(label, sourceCount) {
    if (SOURCE_COLOR_PALETTE[label]) return SOURCE_COLOR_PALETTE[label];
    const hue = (label * (360 / (sourceCount + 1))) % 360;
    return `hsl(${hue}, 80%, 50%)`;
}
