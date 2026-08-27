import fs from 'node:fs/promises';
import path from 'node:path';

export function isCollectorExport(parsed) {
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.context && parsed.context.collector && Array.isArray(parsed.messages);
}

// Reads and validates each collector export file off disk into the
// { fileName, context, messages } shape embedItems() expects. Invalid files are
// skipped with a warning rather than aborting the whole run.
export async function loadStagedFiles(filePaths) {
    const stagedFiles = [];
    for (const filePath of filePaths) {
        let parsed;
        try {
            parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (err) {
            console.error(`Skipping ${filePath}: ${err.message}`);
            continue;
        }
        if (!isCollectorExport(parsed)) {
            console.error(`Skipping ${filePath}: not a valid collector export ({context, messages}).`);
            continue;
        }
        stagedFiles.push({ fileName: path.basename(filePath), context: parsed.context, messages: parsed.messages });
    }
    return stagedFiles;
}

export function parseArgs(argv, { flags = [] } = {}) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const flagName = arg.startsWith('--') ? arg.slice(2) : arg === '-o' ? 'out' : null;
        if (flagName && (flags.includes(flagName) || flagName === 'out')) {
            args[flagName] = argv[++i];
        } else {
            args._.push(arg);
        }
    }
    return args;
}
