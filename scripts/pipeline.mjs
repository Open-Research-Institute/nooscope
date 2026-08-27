#!/usr/bin/env node
// Usage: node scripts/pipeline.mjs <collector-export.json...> -o <output.json> [--method umap]
// Convenience wrapper that just chains embed.mjs + project.mjs. If you want to
// iterate on projection without re-embedding, use those two directly instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedItems } from '../src/pipeline/embed.mjs';
import { projectItems } from '../src/pipeline/project.mjs';
import { loadStagedFiles, parseArgs } from './lib/collectorFiles.mjs';
import { loadEnv } from './lib/loadEnv.mjs';

async function main() {
    loadEnv();

    const { _: files, out, method } = parseArgs(process.argv.slice(2), { flags: ['method'] });
    if (files.length === 0 || !out) {
        console.error('Usage: node scripts/pipeline.mjs <collector-export.json...> -o <output.json> [--method umap]');
        process.exit(1);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('Error: OPENAI_API_KEY environment variable is not set.');
        process.exit(1);
    }

    const stagedFiles = await loadStagedFiles(files);
    if (stagedFiles.length === 0) {
        console.error('No valid collector export files found.');
        process.exit(1);
    }

    const embedded = await embedItems(stagedFiles, {
        apiKey,
        cacheDir: process.env.NOOSCOPE_CACHE_DIR || '.cache',
        onLog: (msg) => console.log(`[embed] ${msg}`),
    });
    const result = await projectItems(embedded, {
        method: method || 'umap',
        onLog: (msg) => console.log(`[project] ${msg}`),
    });

    await fs.mkdir(path.dirname(out) || '.', { recursive: true });
    await fs.writeFile(out, JSON.stringify(result, null, 2));
    console.log(`[pipeline] wrote ${out} (${result.points.length} points, ${result.sources.length} sources)`);
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
