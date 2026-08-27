import { UMAP } from 'umap-js';

const RANDOM_SEED = 1991;
function mulberry32(a) {
    return function () {
        var t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One implementation of the `(items, embeddings, options, onLog) => {x, y}[]`
// projector interface. A "fixed semantic axis" projector (pole word embeddings +
// cosine-similarity distance, instead of an unsupervised layout) is a second
// implementation of this same interface — nothing else in the pipeline or the
// viewer needs to change to add it.
function projectUmap(items, embeddings, options = {}, onLog) {
    const nNeighbors = Math.min(options.nNeighbors ?? 15, embeddings.length - 1);
    if (nNeighbors < 2) {
        throw new Error(`Not enough points to project (found ${embeddings.length}, need at least 3).`);
    }

    const random = mulberry32(options.seed ?? RANDOM_SEED);
    const umap = new UMAP({ nComponents: 2, nNeighbors, minDist: options.minDist ?? 0.1, random });
    const nEpochs = umap.initializeFit(embeddings);
    for (let i = 0; i < nEpochs; i++) {
        umap.step();
        if (i % 50 === 0) onLog?.(`projecting: ${Math.round((i / nEpochs) * 100)}%`);
    }
    return umap.getEmbedding().map(([x, y]) => ({ x, y }));
}

const PROJECTORS = {
    umap: projectUmap,
};

/**
 * embedded: the exact output of embedItems() — { version, sources, items } where
 * each item carries an `embedding`.
 *
 * Returns the final viewer-ready contract { version, sources, points }, with
 * `embedding` stripped back out.
 */
export async function projectItems(embedded, { method = 'umap', onLog, ...options } = {}) {
    const projector = PROJECTORS[method];
    if (!projector) {
        throw new Error(`Unknown projection method "${method}". Available: ${Object.keys(PROJECTORS).join(', ')}`);
    }

    const { items, sources } = embedded;
    const embeddings = items.map(item => item.embedding);
    onLog?.(`projecting to 2D (${method})...`);
    const coords = await projector(items, embeddings, options, onLog);

    const points = items.map((item, i) => ({
        x: coords[i].x,
        y: coords[i].y,
        text: item.content,
        author: item.author,
        timestamp: item.timestamp,
        url: item.url,
        likes: item.likes,
        sourceId: item.sourceIndex,
    }));

    return { version: embedded.version || '0.1', sources, points };
}
