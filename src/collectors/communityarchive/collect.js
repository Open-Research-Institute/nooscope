// The whole Community Archive collector, start to finish (frame E, states 1 → 5):
// fetch (api.js) → reshape (tweetsToMessages.js) → package with a report → save and read back.
// Node only (see api.js). The command (scripts/collect-communityarchive.mjs) just parses options,
// calls collect() and saveExport(), and prints the summary.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from './api.js';
import { tweetsToMessages } from './tweetsToMessages.js';
import { createContext } from '../../shared/message-format.js';

const isExport = (p) => !!p && typeof p === 'object' && p.context?.collector && Array.isArray(p.messages);

// "--hours 24" → { since, until } as exact ISO times ending now.
export function windowFromHours(hours, now = new Date()) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) throw new Error(`--hours must be a positive number (got "${hours}")`);
    return { since: new Date(now.getTime() - h * 3600_000).toISOString(), until: now.toISOString() };
}

/**
 * Fetch, reshape, package. Returns { exportData, summary }.
 *   window:  { since, until } (either may be omitted with an account)
 *   account: username or account id (optional)
 */
export async function collect({ apiKey, window, account, maxTweets = Infinity, keepRetweets = false, onLog } = {}) {
    if (!window && !account) throw new Error('give a time window or an account');
    const client = createClient({ apiKey, onLog });
    const startedAt = new Date().toISOString();
    const source = { api: 'community-archive v1', ...(account ? { account } : {}), ...(window || {}) };
    onLog?.(`fetching ${JSON.stringify(source)}`);

    const tweets = account
        ? await client.accountTweets({ account, ...(window || {}) }, { maxTweets })
        : await client.tweetsInWindow(window, { maxTweets });

    const { messages, skipped } = tweetsToMessages(tweets, { keepRetweets });
    const report = {
        startedAt,
        finishedAt: new Date().toISOString(),
        requests: client.requestCount,
        fetched: tweets.length,
        kept: messages.length,
        threadedInBatch: messages.filter((m) => m.parent).length,
        repliesToTweetsOutsideBatch: messages.filter((m) => m.metadata.replyToTweetId && !m.parent).length,
        skipped,
    };
    const exportData = { context: createContext({ collector: 'communityarchive', source }), messages, report };
    return { exportData, summary: summarize(report) };
}

// Counts for the one summary line, plus skipped grouped by reason.
export function summarize(report) {
    const skippedByReason = {};
    for (const s of report.skipped) {
        const key = s.reason.startsWith('retweet of') ? 'retweet' : s.reason;
        skippedByReason[key] = (skippedByReason[key] || 0) + 1;
    }
    const { fetched, kept, threadedInBatch, repliesToTweetsOutsideBatch, requests } = report;
    return { fetched, kept, skipped: report.skipped.length, skippedByReason, threadedInBatch, repliesToTweetsOutsideBatch, requests };
}

// Write the export, then read it back: the save only counts if it parses as a valid export with
// every message. Returns the file size in bytes.
export async function saveExport(filePath, exportData) {
    await fs.mkdir(path.dirname(filePath) || '.', { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
    const reread = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    if (!isExport(reread) || reread.messages.length !== exportData.messages.length) {
        throw new Error(`wrote ${filePath} but it did not read back as a valid export`);
    }
    return (await fs.stat(filePath)).size;
}

// Default output path when -o isn't given, e.g. data/sources/ca-last-24h-20261111-1430.json
export function defaultOutPath({ hours, account, now = new Date() }) {
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const what = [account && `@${account}`, hours && `last-${hours}h`].filter(Boolean).join('-') || 'window';
    return `data/sources/ca-${what}-${stamp}.json`;
}
