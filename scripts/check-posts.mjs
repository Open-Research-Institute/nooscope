#!/usr/bin/env node
// Usage: node scripts/check-posts.mjs <collector-export.json...> [--json]
//
// Lists every post that doesn't fit docs/spec.md (missing id, duplicate id, empty text,
// unreadable timestamp), one line each: index, id, problem. --json prints the same list as JSON,
// for another program to read. Exit code 0 = all fit, 2 = some don't, 1 = a file couldn't be read.
import fs from 'node:fs/promises';
import { checkMessages, isCollectorExport } from './lib/collectorFiles.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const files = argv.filter((a) => a !== '--json');
if (files.length === 0) {
    console.error('Usage: node scripts/check-posts.mjs <collector-export.json...> [--json]');
    process.exit(1);
}

let total = 0;
const results = [];
for (const file of files) {
    let parsed;
    try {
        parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (err) {
        console.error(`[check] could not read ${file}: ${err.message}`);
        process.exit(1);
    }
    if (!isCollectorExport(parsed)) {
        console.error(`[check] ${file} is not a valid collector export ({context, messages}).`);
        process.exit(1);
    }
    const problems = checkMessages(parsed.messages);
    total += problems.length;
    results.push({ file, posts: parsed.messages.length, problems });
}

if (asJson) {
    console.log(JSON.stringify(results, null, 2));
} else {
    for (const { file, posts, problems } of results) {
        console.log(`[check] ${file}: ${posts} posts, ${problems.length} problem(s)`);
        for (const p of problems) console.log(`[check]   #${p.index}  id ${p.id ?? '(none)'}  ${p.problem}`);
    }
}
process.exit(total ? 2 : 0);
