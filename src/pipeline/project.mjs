import { UMAP } from 'umap-js';
import { Matrix } from 'ml-matrix';
import tsnejs from 'tsne';

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

// t-SNE, in the same spirit as the UMAP projector above but optimizing a very
// different objective: it matches pairwise similarities (not local neighbor
// graphs) between high- and low-D space, which tends to produce tighter,
// more separated clusters at the cost of meaningful inter-cluster distances
// (unlike PCA, and less directly comparable than UMAP's).
function projectTsne(items, embeddings, options = {}, onLog) {
    const n = embeddings.length;
    // Perplexity is roughly "expected neighbors per point" — the binary search
    // inside tsne.js that solves for it degenerates as perplexity approaches
    // n, so keep it well below that (same spirit as UMAP's nNeighbors clamp).
    const maxPerplexity = Math.floor((n - 1) / 3);
    if (maxPerplexity < 1) {
        throw new Error(`Not enough points to project (found ${n}, need at least 4).`);
    }
    const perplexity = Math.min(options.perplexity ?? 30, maxPerplexity);

    const tsne = new tsnejs.tSNE({
        dim: 2,
        perplexity,
        epsilon: options.epsilon ?? 10,
    });
    tsne.initDataRaw(embeddings);

    const nIter = options.nIter ?? 500;
    for (let i = 0; i < nIter; i++) {
        tsne.step();
        if (i % 50 === 0) onLog?.(`projecting: ${Math.round((i / nIter) * 100)}%`);
    }
    return tsne.getSolution().map(([x, y]) => ({ x, y }));
}

// Gram-Schmidt orthonormalization of a matrix's columns, in place. Returns
// each column's pre-normalization norm (converges to its eigenvalue estimate).
function orthonormalizeColumns(M) {
    const norms = [];
    for (let col = 0; col < M.columns; col++) {
        let v = M.getColumnVector(col);
        for (let prev = 0; prev < col; prev++) {
            const u = M.getColumnVector(prev);
            v = v.sub(u.mulS(u.transpose().mmul(v).get(0, 0)));
        }
        const norm = v.norm();
        norms.push(norm);
        M.setColumn(col, norm > 1e-12 ? v.div(norm) : v);
    }
    return norms;
}

// Top-`k` principal component scores of mean-centered `X` (n x d) via block
// power iteration. Each pass multiplies by X^T X without ever forming that
// d x d matrix (X^T(X v) instead), so cost stays O(n*d*k) per iteration
// instead of the O(n*d^2)+ a full SVD needs to produce every component. The
// only reason to hand-roll this rather than use a PCA library is that we
// only need k=2 of up to d components, and the iteration gives a natural
// place to report progress — same shape as the UMAP step loop above.
function powerIteratePca(X, k, { seed, maxIterations = 100, tolerance = 1e-6, onLog } = {}) {
    const random = mulberry32(seed ?? RANDOM_SEED);
    let V = Matrix.rand(X.columns, k, { random });
    orthonormalizeColumns(V);

    let prevEigenvalues = new Array(k).fill(0);
    for (let iter = 0; iter < maxIterations; iter++) {
        V = X.transpose().mmul(X.mmul(V));
        const eigenvalues = orthonormalizeColumns(V);

        const delta = Math.max(...eigenvalues.map((ev, i) =>
            Math.abs(ev - prevEigenvalues[i]) / Math.max(Math.abs(ev), 1e-12)));
        prevEigenvalues = eigenvalues;
        const converged = delta < tolerance;
        if (converged || iter % 5 === 0) {
            onLog?.(`projecting: iteration ${iter + 1}/${maxIterations} (Δ=${delta.toExponential(2)})`);
        }
        if (converged) break;
    }

    return X.mmul(V);
}

function projectPca(items, embeddings, options = {}, onLog) {
    if (embeddings[0].length < 2) {
        throw new Error(`Not enough embedding dimensions to project (found ${embeddings[0].length}, need at least 2).`);
    }

    const X = new Matrix(embeddings);
    const centered = X.subRowVector(X.mean('column'));
    const scores = powerIteratePca(centered, 2, {
        seed: options.seed,
        maxIterations: options.maxIterations,
        tolerance: options.tolerance,
        onLog,
    });

    return scores.to2DArray().map(([x, y]) => ({ x, y }));
}

const PROJECTORS = {
    umap: projectUmap,
    pca: projectPca,
    tsne: projectTsne,
};

/**
 * embedded: the exact output of embedItems() — { version, sources, items } where
 * each item carries an `embedding`.
 *
 * Returns the final viewer-ready contract { version, sources, points }, with
 * `embedding` stripped back out.
 */
export async function projectItems(embedded, { method = 'pca', onLog, ...options } = {}) {
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
