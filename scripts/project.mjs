#!/usr/bin/env node
// Usage: node scripts/project.mjs <embedded.json> -o <output.json> [--method umap]
// No network access — safe to rerun freely while iterating on projection.
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectItems } from '../src/pipeline/project.mjs';
import { parseArgs } from './lib/collectorFiles.mjs';

async function main() {
    const { _: [input], out, method } = parseArgs(process.argv.slice(2), { flags: ['method'] });
    if (!input || !out) {
        console.error('Usage: node scripts/project.mjs <embedded.json> -o <output.json> [--method umap]');
        process.exit(1);
    }

    const embedded = JSON.parse(await fs.readFile(input, 'utf-8'));
    const result = await projectItems(embedded, {
        method: method || 'umap',
        onLog: (msg) => console.log(`[project] ${msg}`),
    });

    await fs.mkdir(path.dirname(out) || '.', { recursive: true });
    await fs.writeFile(out, JSON.stringify(result));
    console.log(`[project] wrote ${out} (${result.points.length} points, ${result.sources.length} sources)`);
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
