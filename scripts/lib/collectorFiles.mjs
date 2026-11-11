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
        warnAboutMessages(filePath, parsed.messages);
        stagedFiles.push({ fileName: path.basename(filePath), context: parsed.context, messages: parsed.messages });
    }
    return stagedFiles;
}

// Per-message check against docs/spec.md. Warns only — it never drops or changes a message, so
// what the pipeline receives is exactly what was in the file. The point is that a message that
// doesn't fit is reported instead of slipping through silently.
// Returns every problem as { index, id, problem }; `npm run check -- <file>` lists them.
export function checkMessages(messages) {
    const problems = [];
    const seen = new Set();
    const add = (i, m, problem) => problems.push({ index: i, id: m?.id ?? null, problem });
    messages.forEach((m, i) => {
        if (!m || typeof m !== 'object') return add(i, m, 'not an object');
        if (!m.id) add(i, m, 'missing id');
        else if (seen.has(m.id)) add(i, m, 'duplicate id');
        else seen.add(m.id);
        if (typeof m.text !== 'string' || !m.text.trim()) add(i, m, 'empty text');
        if (m.timestamp !== undefined && isNaN(new Date(m.timestamp).getTime())) add(i, m, `unreadable timestamp "${m.timestamp}"`);
    });
    return problems;
}

// One line per file: just the count, and how to see the list.
function warnAboutMessages(filePath, messages) {
    const problems = checkMessages(messages);
    if (problems.length === 0) return;
    const posts = new Set(problems.map((p) => p.index)).size;
    console.warn(`[check] ${path.basename(filePath)}: ${posts} post(s) don't fit the spec (${problems.length} problem(s)). List them: npm run check -- ${filePath}`);
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
