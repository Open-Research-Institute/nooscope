# Community Archive

**Capture method:** command line only: `scripts/collect-communityarchive.mjs` (or `npm run collect:ca`).
It uses the [Community Archive API v1](https://analytics.community-archive.org/v1/openapi.json), which
needs a personal key (create one at https://www.community-archive.org/settings/api-keys). This
collector has no browser page, because the API sends no CORS headers and its docs ask that keys stay
in scripts and on servers, never in browser code. Put the key in `.env` as `CA_API_KEY=cak_...`
(`.env` is gitignored), or export it.

**Supported input:**
- a time window: `--hours 24`, or `--since <date|ISO time> [--until …]` (at most 31 days apart)
- one account: `--account <username>`, optionally with a window
- `--max <n>` stops after n tweets; `--keep-retweets` keeps retweets (they're skipped by default)

```
npm run collect:ca                     # shows the help
npm run collect:ca -- --hours 24       # saves to data/sources/ca-last-24h-<time>.json
```

**Code:** `collect.js` does the whole job (fetch → reshape → package → save); `api.js` talks to the API; `tweetsToMessages.js` reshapes. The command only reads options and prints.

**Output:** a standard collector export (`docs/spec.md`) plus a `report` section: requests made,
tweets fetched and kept, how many replies were threaded, and every skipped tweet with its reason
(missing id, duplicate, retweet, empty text). The file is read back after writing to confirm it is a
valid export. A missing, malformed (not `cak_…`) or rejected key gets its own clear message.

**Threading:** `parent` and `children` are set when the replied-to tweet is in the same batch (the
spec requires ids within the batch). The raw `reply_to_tweet_id` is always kept in
`metadata.replyToTweetId`, so replies to tweets outside the batch keep their link.

**Limits:** 60 requests/minute and 20,000/day per key. The client sends one request at a time,
about 1.1 s apart, and waits as told on 429/503 (`Retry-After`).
