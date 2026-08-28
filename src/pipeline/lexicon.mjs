// Word-level linguistic diversity — see docs/linguistic-diversity.md for the
// full plan this implements. Operates on the raw layer (same input
// embed.mjs takes), no embeddings/API key involved.
import { stemmer } from 'stemmer';
import { messagesToViewerItems } from '../shared/toViewerItem.js';

// Classic SMART/NLTK-style English stopword list — vendored rather than
// pulled in as a dependency, per docs/linguistic-diversity.md.
export const STOPWORDS = new Set(`
a about above after again against all am an and any are aren't as at be
because been before being below between both but by can't cannot could
couldn't did didn't do does doesn't doing don't down during each few for
from further had hadn't has hasn't have haven't having he he'd he'll he's
her here here's hers herself him himself his how how's i i'd i'll i'm i've
if in into is isn't it it's its itself let's me more most mustn't my
myself no nor not of off on once only or other ought our ours ourselves
out over own same shan't she she'd she'll she's should shouldn't so some
such than that that's the their theirs them themselves then there there's
these they they'd they'll they're they've this those through to too under
until up very was wasn't we we'd we'll we're we've were weren't what what's
when when's where where's which while who who's whom why why's with won't
would wouldn't you you'd you'll you're you've your yours yourself
yourselves
`.split(/\s+/).filter(Boolean));

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /@\w+/g;
// One extended-pictographic emoji (+ optional variation selector), or a run
// of letters/digits with optional internal apostrophes ("don't", "flock's")
// — both straight and curly, since scraped text mixes both.
const VARIATION_SELECTOR_16 = String.fromCodePoint(0xfe0f);
const APOSTROPHE = `['${String.fromCodePoint(0x2019)}]`;
const TOKEN_RE = new RegExp(
    `\\p{Extended_Pictographic}${VARIATION_SELECTOR_16}?|[\\p{L}\\p{N}]+(?:${APOSTROPHE}[\\p{L}]+)*`,
    'gu',
);

export function tokenize(text) {
    const cleaned = text.replace(URL_RE, ' ').replace(MENTION_RE, ' ').toLowerCase();
    return cleaned.match(TOKEN_RE) || [];
}

function round(n, places) {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

function freqMap(tokens) {
    const freq = new Map();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
    return freq;
}

// Fisher-Yates partial shuffle, first `count` slots.
function sampleWithoutReplacement(tokens, count, rng) {
    const arr = tokens.slice();
    const n = Math.min(count, arr.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (arr.length - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
}

function hill1(sample) {
    const freq = freqMap(sample);
    const T = sample.length;
    let H = 0;
    for (const count of freq.values()) {
        const p = count / T;
        H -= p * Math.log(p);
    }
    return Math.exp(H);
}

// Rarefied Hill number (order 1) — see "Metric: range" in the plan doc.
// Computed on the raw, unstemmed, unfiltered token stream (standard
// practice for lexical diversity indices).
export function computeRange(tokens, { rarefactionTarget, iterations = 200, rng = Math.random } = {}) {
    if (tokens.length < rarefactionTarget) {
        return { rangeScore: null, insufficientData: true };
    }
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
        sum += hill1(sampleWithoutReplacement(tokens, rarefactionTarget, rng));
    }
    return { rangeScore: round(sum / iterations, 1), insufficientData: false };
}

// Morisita-Horn overlap — see "Metric: overlap" in the plan doc. Computed on
// full (non-rarefied) frequency counts; tolerant of unequal sample sizes.
export function computeOverlap(tokensA, tokensB) {
    const freqA = freqMap(tokensA);
    const freqB = freqMap(tokensB);
    const X = tokensA.length;
    const Y = tokensB.length;
    if (X === 0 || Y === 0) return 0;

    const vocab = new Set([...freqA.keys(), ...freqB.keys()]);
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (const word of vocab) {
        const x = freqA.get(word) || 0;
        const y = freqB.get(word) || 0;
        sumXY += x * y;
        sumX2 += x * x;
        sumY2 += y * y;
    }
    const denom = (sumX2 / (X * X) + sumY2 / (Y * Y)) * X * Y;
    return denom === 0 ? 0 : round((2 * sumXY) / denom, 3);
}

// n-gram frequency table — see "N-gram tables (the view)" in the plan doc.
// Unigrams are stemmed (variants collapse into one row, labeled with the
// most common surface form) and stopwords dropped; bigrams/trigrams stay
// unstemmed but drop any n-gram whose first or last token is a stopword.
export function buildNgramTable(tokens, n, { limit = 100 } = {}) {
    const stem = n === 1;
    const dropEdgeStopwords = n > 1;
    const counts = new Map(); // key -> { count, labelCounts: Map<surface, count> }

    for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        if (n === 1 && STOPWORDS.has(gram[0])) continue;
        if (dropEdgeStopwords && (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1]))) continue;

        const surface = gram.join(' ');
        const key = stem ? gram.map((w) => stemmer(w)).join(' ') : surface;

        let entry = counts.get(key);
        if (!entry) {
            entry = { count: 0, labelCounts: new Map() };
            counts.set(key, entry);
        }
        entry.count++;
        entry.labelCounts.set(surface, (entry.labelCounts.get(surface) || 0) + 1);
    }

    const totalTokens = tokens.length;
    return [...counts.values()]
        .map((entry) => {
            const label = [...entry.labelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            return { ngram: label, count: entry.count, per1k: round((entry.count / totalTokens) * 1000, 2) };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

function sourceLabelFor(context, fileName, usedLabels) {
    const base = (context.collector === 'twitter' && context.source?.author)
        ? `Twitter (@${context.source.author})`
        : context.collector.charAt(0).toUpperCase() + context.collector.slice(1);
    const label = usedLabels.has(base) ? `${base} (${fileName})` : base;
    usedLabels.add(label);
    return label;
}

/**
 * stagedFiles: [{ fileName, context, messages }, ...] — same shape
 * embedItems() takes (src/pipeline/embed.mjs), via loadStagedFiles().
 *
 * Returns { version, rarefactionTarget, sources, ngrams, range, overlap } —
 * see "Output artifact shape" in docs/linguistic-diversity.md.
 */
export function lexiconItems(stagedFiles, { rarefactionTarget = 500, ngramLimit = 100 } = {}) {
    if (!stagedFiles || stagedFiles.length === 0) throw new Error('lexiconItems: no input files given');

    const usedLabels = new Set();
    const sources = [];
    const tokensBySource = [];

    stagedFiles.forEach((file, i) => {
        const { context, messages, fileName } = file;
        const items = messagesToViewerItems(messages, i);
        const text = items.map((item) => item.content).filter(Boolean).join('\n');
        const tokens = tokenize(text);

        tokensBySource.push(tokens);
        sources.push({
            id: i,
            label: sourceLabelFor(context, fileName, usedLabels),
            collector: context.collector,
            fileName,
            tokenCount: tokens.length,
            vocabSize: new Set(tokens).size,
        });
    });

    const ngrams = [];
    tokensBySource.forEach((tokens, sourceId) => {
        for (const n of [1, 2, 3]) {
            ngrams.push({ sourceId, n, top: buildNgramTable(tokens, n, { limit: ngramLimit }) });
        }
    });

    const range = tokensBySource.map((tokens, sourceId) => ({
        sourceId,
        ...computeRange(tokens, { rarefactionTarget }),
    }));

    const overlap = [];
    for (let a = 0; a < tokensBySource.length; a++) {
        for (let b = a + 1; b < tokensBySource.length; b++) {
            overlap.push({ a, b, score: computeOverlap(tokensBySource[a], tokensBySource[b]) });
        }
    }

    return { version: '0.1', rarefactionTarget, sources, ngrams, range, overlap };
}
