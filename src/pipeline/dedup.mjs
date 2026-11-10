const DEFAULT_EPSILON = 0.02;

function cosineDistance(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * embedded: the exact output of embedItems() — { version, sources, items } where
 * each item carries an `embedding`.
 *
 * Greedy epsilon-net over cosine distance: walks items in order, keeping each
 * one as a new "representative" unless it falls within `epsilon` of a
 * representative already kept, in which case it's dropped. Everything within
 * epsilon of a kept point collapses onto it — no averaging, no synthetic
 * points, so every surviving item is still a real comment with real metadata.
 *
 * Brute-force (O(items * representatives)) — fine at the thousands-of-items
 * scale this pipeline runs at today. Past tens of thousands of items this
 * would need an ANN index (e.g. HNSW) instead of scanning every kept point.
 *
 * Returns the same { version, sources, items } shape, so it composes with
 * embedItems()/projectItems() as an optional stage between the two.
 */
export async function dedupeItems(embedded, { epsilon = DEFAULT_EPSILON, onLog } = {}) {
    const { items } = embedded;
    const kept = [];
    const keptEmbeddings = [];
    let dropped = 0;

    items.forEach((item, i) => {
        const isDuplicate = keptEmbeddings.some((e) => cosineDistance(e, item.embedding) < epsilon);
        if (isDuplicate) {
            dropped++;
        } else {
            kept.push(item);
            keptEmbeddings.push(item.embedding);
        }
        if (onLog && i > 0 && i % 500 === 0) {
            onLog(`scanned ${i}/${items.length}, dropped ${dropped} near-duplicates so far...`);
        }
    });

    onLog?.(`kept ${kept.length}/${items.length} items (dropped ${dropped} within epsilon=${epsilon})`);

    return { ...embedded, items: kept };
}
