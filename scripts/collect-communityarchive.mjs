#!/usr/bin/env node
// Community Archive collector command. Run with no options to see the help.
// The work happens in src/collectors/communityarchive/collect.js; this file only reads options,
// calls it, and prints what happened.
import { collect, saveExport, windowFromHours, defaultOutPath } from '../src/collectors/communityarchive/collect.js';
import { CommunityArchiveError } from '../src/collectors/communityarchive/api.js';
import { parseArgs } from './lib/collectorFiles.mjs';
import { loadEnv } from './lib/loadEnv.mjs';

const HELP = `Collect tweets from the Community Archive into a nooscope posts file.

  npm run collect:ca -- --hours 24                   tweets from the last 24 hours
  npm run collect:ca -- --account <name>             one account's tweets
  npm run collect:ca -- --account <name> --hours 168 one account, last 7 days

Options (combine freely):
  --hours <n>            last n hours, ending now
  --since <t> --until <t>  an exact window instead (YYYY-MM-DD or ISO time; at most 31 days)
  --account <name>       only this account (username or numeric id)
  --max <n>              stop after n tweets
  --keep-retweets        keep retweets (skipped by default)
  -o <file.json>         where to save (default: data/sources/ca-<what>-<time>.json)
  --help                 this text

Needs CA_API_KEY=cak_... in .env (make one at https://www.community-archive.org/settings/api-keys).`;

const log = (msg) => console.log(`[collect:ca] ${msg}`);
const fail = (msg) => { console.error(`[collect:ca] ${msg}`); process.exit(1); };

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return;
    }
    loadEnv();
    const keepRetweets = argv.includes('--keep-retweets');
    const args = parseArgs(argv.filter((a) => a !== '--keep-retweets'), { flags: ['hours', 'since', 'until', 'account', 'max'] });

    let window = null;
    try {
        if (args.hours) window = windowFromHours(args.hours);
        else if (args.since) window = { since: args.since, until: args.until || new Date().toISOString() };
    } catch (err) {
        fail(err.message);
    }
    if (!window && !args.account) fail('nothing to collect: give --hours, --since, or --account (run with --help for examples)');

    const out = args.out || defaultOutPath({ hours: args.hours, account: args.account });
    const { exportData, summary } = await collect({
        apiKey: process.env.CA_API_KEY,
        window,
        account: args.account,
        maxTweets: args.max ? Number(args.max) : Infinity,
        keepRetweets,
        onLog: log,
    });
    const bytes = await saveExport(out, exportData);

    log(`fetched ${summary.fetched} · kept ${summary.kept} · threaded ${summary.threadedInBatch} · replies to outside tweets ${summary.repliesToTweetsOutsideBatch} · ${summary.requests} requests`);
    log(summary.skipped ? `skipped tweets: ${summary.skipped} ${JSON.stringify(summary.skippedByReason)} (each listed in report.skipped)` : 'skipped tweets: 0');
    log(`saved ${out} (${bytes} bytes), read back OK`);
}

main().catch((err) => {
    if (err instanceof CommunityArchiveError) fail(err.message);
    console.error(err.stack || err.message);
    process.exit(1);
});
