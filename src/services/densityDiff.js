// "Negative space": a literal radius check, not a density estimate. For each
// point in source A, stamp a filled circle of a fixed radius around it (its
// "reach") onto a mask; do the same for source B; erase B's reach from A's.
// What's left is a hard-edged black/transparent shape: everywhere within
// range of an A point but not within range of any B point. No blur, no
// gradient, no per-pixel opacity — a location is either covered or it isn't.

export function computeBounds(pointsList, padFraction = 0.08) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const points of pointsList) {
        for (const [x, y] of points) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (!isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const padX = (maxX - minX) * padFraction || 1;
    const padY = (maxY - minY) * padFraction || 1;
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

function stampCircles(ctx, points, toPixel, radiusPx) {
    ctx.beginPath();
    for (const p of points) {
        const [px, py] = toPixel(p);
        ctx.moveTo(px + radiusPx, py);
        ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    }
    ctx.fill();
}

/**
 * Returns a canvas: solid `color` wherever a point of A is within
 * `radiusFraction` (as a fraction of the plotted area's span) of that
 * location and no point of B is, transparent everywhere else.
 */
export function renderReachOnlyMask(coordsA, coordsB, bounds, { gridSize = 400, radiusFraction = 0.015, color = '#0f172a', opacity = 0.85 } = {}) {
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    const radiusPx = radiusFraction * gridSize;

    // Canvas rows go top-to-bottom; we want +y up (to match the map's image
    // source corner order in EmbeddingVisualizer), so flip here.
    const toPixel = ([x, y]) => [
        ((x - bounds.minX) / spanX) * gridSize,
        gridSize - ((y - bounds.minY) / spanY) * gridSize,
    ];

    const reachA = document.createElement('canvas');
    reachA.width = gridSize; reachA.height = gridSize;
    const ctxA = reachA.getContext('2d');
    ctxA.fillStyle = '#000';
    stampCircles(ctxA, coordsA, toPixel, radiusPx);

    const reachB = document.createElement('canvas');
    reachB.width = gridSize; reachB.height = gridSize;
    const ctxB = reachB.getContext('2d');
    ctxB.fillStyle = '#000';
    stampCircles(ctxB, coordsB, toPixel, radiusPx);

    // Cut B's reach out of A's — opaque circles either fully overlap or
    // don't, so this leaves a hard 0-or-255 alpha mask, never a gradient.
    ctxA.globalCompositeOperation = 'destination-out';
    ctxA.drawImage(reachB, 0, 0);

    // Recolor the mask to the requested color/opacity: fill a solid rect in
    // that color, then keep only where the mask (still just used as a
    // stencil) was opaque.
    const result = document.createElement('canvas');
    result.width = gridSize; result.height = gridSize;
    const rctx = result.getContext('2d');
    rctx.fillStyle = color;
    rctx.globalAlpha = opacity;
    rctx.fillRect(0, 0, gridSize, gridSize);
    rctx.globalCompositeOperation = 'destination-in';
    rctx.globalAlpha = 1;
    rctx.drawImage(reachA, 0, 0);

    return result;
}
