#!/usr/bin/env node
// Usage:
//   node scripts/pipeline.mjs <collector-export.json...> -o <dataset-dir> [--method umap]
//   node scripts/pipeline.mjs <dataset-dir | sources.json> [--method umap]
//
// The first form runs a fresh pipeline over explicit source files and records
// them as <dataset-dir>/sources.json, alongside <dataset-dir>/output.json —
// so the sources an output came from are never a mystery. Passing -o a plain
// "*.json" path instead of a directory skips the manifest for one-off runs.
//
// The second form re-reads an existing dataset's sources.json and regenerates
// its output.json — that's how you re-run a dataset later.
//
// Convenience wrapper that just chains embed.mjs + project.mjs. If you want to
// iterate on projection without re-embedding, use those two directly instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedItems } from '../src/pipeline/embed.mjs';
import { projectItems } from '../src/pipeline/project.mjs';
import { loadStagedFiles, parseArgs } from './lib/collectorFiles.mjs';
import { loadEnv } from './lib/loadEnv.mjs';

const SOURCES_FILE = 'sources.json';
const OUTPUT_FILE = 'output.json';

const USAGE = `Usage:
  node scripts/pipeline.mjs <collector-export.json...> -o <dataset-dir> [--method umap]
  node scripts/pipeline.mjs <dataset-dir | sources.json> [--method umap]   # regenerate`;

async function statOrNull(p) {
    try {
        return await fs.stat(p);
    } catch {
        return null;
    }
}

// Figures out whether this is a fresh run (explicit source files + -o) or a
// regenerate run (pointed at a dataset dir / its sources.json), and returns
// what to embed/project plus where the output (and manifest, if any) go.
async function resolveRun(argv) {
    const { _: positional, out, method } = parseArgs(argv, { flags: ['method'] });

    if (positional.length === 1 && !out) {
        const target = positional[0];
        const stat = await statOrNull(target);
        let datasetDir = null;
        if (stat?.isDirectory()) datasetDir = target;
        else if (stat?.isFile() && path.basename(target) === SOURCES_FILE) datasetDir = path.dirname(target);

        if (datasetDir) {
            const manifestPath = path.join(datasetDir, SOURCES_FILE);
            let manifest;
            try {
                manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
            } catch (err) {
                console.error(`Could not read ${manifestPath}: ${err.message}`);
                process.exit(1);
            }
            return {
                files: manifest.map((p) => path.resolve(datasetDir, p)),
                outputPath: path.join(datasetDir, OUTPUT_FILE),
                method,
            };
        }
    }

    if (positional.length === 0 || !out) {
        console.error(USAGE);
        process.exit(1);
    }

    if (out.endsWith('.json')) {
        // Literal output file: quick/ad-hoc run, no manifest recorded.
        return { files: positional, outputPath: out, method };
    }

    const datasetDir = out;
    const manifestEntries = positional.map((p) => path.relative(path.resolve(datasetDir), path.resolve(p)));
    return {
        files: positional,
        outputPath: path.join(datasetDir, OUTPUT_FILE),
        manifestPath: path.join(datasetDir, SOURCES_FILE),
        manifestEntries,
        method,
    };
}

async function main() {
    loadEnv();

    const run = await resolveRun(process.argv.slice(2));

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('Error: OPENAI_API_KEY environment variable is not set.');
        process.exit(1);
    }

    const stagedFiles = await loadStagedFiles(run.files);

    const embedded = await embedItems(stagedFiles, {
        apiKey,
        cacheDir: process.env.NOOSCOPE_CACHE_DIR || '.cache',
        onLog: (msg) => console.log(`[embed] ${msg}`),
    });
    const result = await projectItems(embedded, {
        method: run.method || 'umap',
        onLog: (msg) => console.log(`[project] ${msg}`),
    });

    await fs.mkdir(path.dirname(run.outputPath) || '.', { recursive: true });
    await fs.writeFile(run.outputPath, JSON.stringify(result, null, 2));
    console.log(`[pipeline] wrote ${run.outputPath} (${result.points.length} points, ${result.sources.length} sources)`);

    if (run.manifestPath) {
        await fs.writeFile(run.manifestPath, JSON.stringify(run.manifestEntries, null, 2) + '\n');
        console.log(`[pipeline] wrote ${run.manifestPath}`);
    }
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
