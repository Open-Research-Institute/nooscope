import fs from 'node:fs/promises';
import path from 'node:path';
import { messagesToViewerItems } from '../shared/toViewerItem.js';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const MODEL_NAME = 'text-embedding-3-small';
const BATCH_SIZE = 100;

function sourceLabelFor(context, fileName, usedLabels) {
    const base = (context.collector === 'twitter' && context.source?.author)
        ? `Twitter (@${context.source.author})`
        : context.collector.charAt(0).toUpperCase() + context.collector.slice(1);
    const label = usedLabels.has(base) ? `${base} (${fileName})` : base;
    usedLabels.add(label);
    return label;
}

async function loadCache(cacheFile) {
    try {
        return JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
    } catch {
        return {};
    }
}

async function saveCache(cacheFile, cache) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(cache));
}

// One shared cache file, keyed by the literal text string — not per input file or
// per run. Every call reads it first, only sends genuinely-uncached text to OpenAI,
// then merges the new entries back in and rewrites it.
async function embedTexts(texts, { apiKey, cacheFile, onProgress }) {
    const cache = await loadCache(cacheFile);
    const results = new Array(texts.length);
    const uncachedIndices = [];
    const uncachedTexts = [];

    texts.forEach((text, i) => {
        const cached = cache[text];
        if (cached) {
            results[i] = cached.embedding;
        } else {
            uncachedIndices.push(i);
            uncachedTexts.push(text);
        }
    });

    for (let start = 0; start < uncachedTexts.length; start += BATCH_SIZE) {
        const batch = uncachedTexts.slice(start, start + BATCH_SIZE);
        onProgress?.(Math.min(start + BATCH_SIZE, uncachedTexts.length), uncachedTexts.length);

        const response = await fetch(OPENAI_EMBEDDINGS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model: MODEL_NAME, input: batch }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || `OpenAI embeddings request failed (${response.status})`);
        }

        const vectors = new Array(batch.length);
        for (const item of data.data) vectors[item.index] = item.embedding;

        for (let j = 0; j < batch.length; j++) {
            cache[batch[j]] = { embedding: vectors[j], model: MODEL_NAME, timestamp: Date.now() };
            results[uncachedIndices[start + j]] = vectors[j];
        }
    }

    if (uncachedTexts.length > 0) await saveCache(cacheFile, cache);

    return { vectors: results, cachedCount: texts.length - uncachedTexts.length, newCount: uncachedTexts.length };
}

/**
 * stagedFiles: [{ fileName, context, messages }, ...] — one entry per collector
 * export file (each already the `{context, messages}` shape from
 * src/shared/message-format.js).
 *
 * Returns { version, sources, items } where each item is a flat viewer item
 * (see src/shared/toViewerItem.js) plus its `embedding`. This is the embed↔project
 * boundary — keep it around to iterate on projection without re-embedding.
 */
export async function embedItems(stagedFiles, { apiKey, cacheDir = '.cache', onLog } = {}) {
    if (!apiKey) throw new Error('embedItems: apiKey is required (set OPENAI_API_KEY)');
    if (!stagedFiles || stagedFiles.length === 0) throw new Error('embedItems: no input files given');

    const usedLabels = new Set();
    const sources = [];
    const allItems = [];

    stagedFiles.forEach((file, i) => {
        const { context, messages, fileName } = file;
        const items = messagesToViewerItems(messages, i);
        const kept = items.filter(item => item.content && item.content.trim());
        const skipped = items.length - kept.length;
        onLog?.(`${fileName}: ${kept.length} messages${skipped ? ` (${skipped} skipped, empty text)` : ''}`);

        allItems.push(...kept);
        sources.push({
            id: i,
            collector: context.collector,
            source: context.source,
            fileName,
            label: sourceLabelFor(context, fileName, usedLabels),
        });
    });

    if (allItems.length === 0) throw new Error('No messages with text to embed.');

    const cacheFile = path.join(cacheDir, 'embeddings.json');
    const texts = allItems.map(item => item.content);
    const { vectors, cachedCount, newCount } = await embedTexts(texts, {
        apiKey,
        cacheFile,
        onProgress: (done, total) => onLog?.(`embedding ${done} / ${total} new items...`),
    });
    onLog?.(`embedding ${allItems.length} items... (cached: ${cachedCount}, new: ${newCount})`);

    const items = allItems.map((item, i) => ({ ...item, embedding: vectors[i] }));

    return { version: '0.1', sources, items };
}
