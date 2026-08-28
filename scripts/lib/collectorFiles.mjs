import fs from 'node:fs/promises';
import path from 'node:path';

export function isCollectorExport(parsed) {
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.context && parsed.context.collector && Array.isArray(parsed.messages);
}

// Reads and validates each collector export file off disk into the
// { fileName, context, messages } shape embedItems() expects. Throws on the
// first missing/invalid file rather than silently dropping it from the run.
export async function loadStagedFiles(filePaths) {
    const stagedFiles = [];
    for (const filePath of filePaths) {
        let parsed;
        try {
            parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (err) {
            throw new Error(`Could not read ${filePath}: ${err.message}`);
        }
        if (!isCollectorExport(parsed)) {
            throw new Error(`${filePath} is not a valid collector export ({context, messages}).`);
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
