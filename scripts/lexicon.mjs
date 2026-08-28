#!/usr/bin/env node
// Usage:
//   node scripts/lexicon.mjs <collector-export.json...> -o <dataset-dir> [--rarefy 500]
//   node scripts/lexicon.mjs <dataset-dir | sources.json> [--rarefy 500]
//
// Same two-mode shape as pipeline.mjs, minus embeddings — no API key, no
// network, no cache. See docs/linguistic-diversity.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import { lexiconItems } from '../src/pipeline/lexicon.mjs';
import { loadStagedFiles, parseArgs } from './lib/collectorFiles.mjs';

const SOURCES_FILE = 'sources.json';
const OUTPUT_FILE = 'lexicon.json';
const DEFAULT_RAREFACTION_TARGET = 500;

const USAGE = `Usage:
  node scripts/lexicon.mjs <collector-export.json...> -o <dataset-dir> [--rarefy 500]
  node scripts/lexicon.mjs <dataset-dir | sources.json> [--rarefy 500]   # regenerate`;

async function statOrNull(p) {
    try {
        return await fs.stat(p);
    } catch {
        return null;
    }
}

async function resolveRun(argv) {
    const { _: positional, out, rarefy } = parseArgs(argv, { flags: ['rarefy'] });
    const rarefactionTarget = rarefy ? Number(rarefy) : DEFAULT_RAREFACTION_TARGET;

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
                rarefactionTarget,
            };
        }
    }

    if (positional.length === 0 || !out) {
        console.error(USAGE);
        process.exit(1);
    }

    const outputPath = out.endsWith('.json') ? out : path.join(out, OUTPUT_FILE);
    return { files: positional, outputPath, rarefactionTarget };
}

async function main() {
    const run = await resolveRun(process.argv.slice(2));
    const stagedFiles = await loadStagedFiles(run.files);
    const result = lexiconItems(stagedFiles, { rarefactionTarget: run.rarefactionTarget });

    await fs.mkdir(path.dirname(run.outputPath) || '.', { recursive: true });
    await fs.writeFile(run.outputPath, JSON.stringify(result, null, 2));

    const flagged = result.range.filter((r) => r.insufficientData).length;
    console.log(`[lexicon] wrote ${run.outputPath} (${result.sources.length} sources, rarefaction target ${run.rarefactionTarget}${flagged ? `, ${flagged} below target` : ''})`);
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
