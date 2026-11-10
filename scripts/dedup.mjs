#!/usr/bin/env node
// Usage: node scripts/dedup.mjs <embedded.json> -o <deduped.json> [--epsilon 0.02]
//
// Collapses near-duplicate items in embedding space (e.g. a pile of near-
// identical comments under a popular video) down to one representative
// each, before projection. Optional — run it yourself between embed.mjs
// and project.mjs; pipeline.mjs does not call it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { dedupeItems } from '../src/pipeline/dedup.mjs';
import { parseArgs } from './lib/collectorFiles.mjs';

async function main() {
    const { _: [input], out, epsilon } = parseArgs(process.argv.slice(2), { flags: ['epsilon'] });
    if (!input || !out) {
        console.error('Usage: node scripts/dedup.mjs <embedded.json> -o <deduped.json> [--epsilon 0.02]');
        process.exit(1);
    }

    const embedded = JSON.parse(await fs.readFile(input, 'utf-8'));
    const result = await dedupeItems(embedded, {
        epsilon: epsilon !== undefined ? Number(epsilon) : undefined,
        onLog: (msg) => console.log(`[dedup] ${msg}`),
    });

    await fs.mkdir(path.dirname(out) || '.', { recursive: true });
    await fs.writeFile(out, JSON.stringify(result));
    console.log(`[dedup] wrote ${out} (${result.items.length}/${embedded.items.length} items kept)`);
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
