#!/usr/bin/env node
// Usage: node scripts/embed.mjs <collector-export.json...> -o <embedded.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedItems } from '../src/pipeline/embed.mjs';
import { loadStagedFiles, parseArgs } from './lib/collectorFiles.mjs';
import { loadEnv } from './lib/loadEnv.mjs';

async function main() {
    loadEnv();

    const { _: files, out } = parseArgs(process.argv.slice(2));
    if (files.length === 0 || !out) {
        console.error('Usage: node scripts/embed.mjs <collector-export.json...> -o <embedded.json>');
        process.exit(1);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('Error: OPENAI_API_KEY environment variable is not set.');
        process.exit(1);
    }

    const stagedFiles = await loadStagedFiles(files);

    const result = await embedItems(stagedFiles, {
        apiKey,
        cacheDir: process.env.NOOSCOPE_CACHE_DIR || '.cache',
        onLog: (msg) => console.log(`[embed] ${msg}`),
    });

    await fs.mkdir(path.dirname(out) || '.', { recursive: true });
    await fs.writeFile(out, JSON.stringify(result));
    console.log(`[embed] wrote ${out} (${result.items.length} items, ${result.sources.length} sources)`);
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
