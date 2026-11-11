// Community Archive API v1 client — https://analytics.community-archive.org/v1/openapi.json
//
// Runs from Node only (scripts/collect-communityarchive.mjs), never in the browser: the API sends
// no CORS headers, and its own docs say "Keep keys on servers and in scripts; never ship one in
// browser or app code." The key comes from CA_API_KEY (env or .env).
//
// Limits (per key): 60 requests/minute, 20,000/UTC day, 2 concurrent per account. Requests here
// run one at a time and are spaced to stay under the per-minute limit; 429/503 honour Retry-After.

const API_BASE = 'https://analytics.community-archive.org/v1';
const PAGE_LIMIT = 100;
const MIN_REQUEST_GAP_MS = 1100; // ~54 requests/minute, under the default 60
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CommunityArchiveError extends Error {
    constructor(message, { status, code, requestId, path } = {}) {
        super(message);
        this.name = 'CommunityArchiveError';
        this.status = status;
        this.code = code;
        this.requestId = requestId;
        this.path = path;
    }
}

const KEYS_PAGE = 'https://www.community-archive.org/settings/api-keys';

// Catches a missing or obviously wrong key before any request is sent. Community Archive keys
// start with "cak_"; anything else would only come back as a 401.
export function checkKeyShape(apiKey) {
    if (!apiKey) throw new CommunityArchiveError(`No API key. Put CA_API_KEY=cak_... in .env (make one at ${KEYS_PAGE}).`, { code: 'no_key' });
    if (!/^cak_\S+$/.test(apiKey)) throw new CommunityArchiveError(`CA_API_KEY doesn't look like a Community Archive key (they start with "cak_"). Check .env.`, { code: 'bad_key_shape' });
}

export function createClient({ apiKey, onLog } = {}) {
    checkKeyShape(apiKey);

    let lastRequestAt = 0;
    let requestCount = 0;

    async function get(path, params = {}) {
        const url = new URL(API_BASE + path);
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        }

        for (let attempt = 0; ; attempt++) {
            const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
            if (wait > 0) await sleep(wait);
            lastRequestAt = Date.now();
            requestCount++;

            let res;
            try {
                res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
            } catch (err) {
                throw new CommunityArchiveError(`Network error calling ${path}: ${err.message}`, { path });
            }

            let body = null;
            try {
                body = await res.json();
            } catch {
                // Non-JSON body (proxy error page, etc.) — handled below by status.
            }

            if (res.ok) return body;

            const retryable = res.status === 429 || res.status === 503;
            if (retryable && attempt < MAX_RETRIES) {
                const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt * 5;
                onLog?.(`${res.status} on ${path}; waiting ${retryAfter}s (retry ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(retryAfter * 1000);
                continue;
            }

            const code = body?.error?.code ?? 'http_' + res.status;
            const message = body?.error?.message ?? res.statusText;
            const requestId = body?.request_id ?? res.headers.get('x-request-id');
            if (res.status === 401 || res.status === 403) {
                throw new CommunityArchiveError(`The API rejected your key (${res.status} ${code}). It may be mistyped, revoked, or expired: check CA_API_KEY in .env, or make a new one at ${KEYS_PAGE}. [request_id ${requestId}]`, {
                    status: res.status, code, requestId, path,
                });
            }
            throw new CommunityArchiveError(`${path} failed (${res.status} ${code}): ${message} [request_id ${requestId}]`, {
                status: res.status, code, requestId, path,
            });
        }
    }

    // Follows next_cursor until the API stops returning one (or maxTweets is reached).
    async function paginate(path, params, { maxTweets = Infinity } = {}) {
        const tweets = [];
        let cursor;
        let page = 0;
        do {
            const body = await get(path, { ...params, limit: PAGE_LIMIT, cursor });
            const data = Array.isArray(body?.data) ? body.data : [];
            tweets.push(...data);
            page++;
            onLog?.(`page ${page}: +${data.length} tweets (${tweets.length} total)`);
            cursor = body?.next_cursor || undefined;
        } while (cursor && tweets.length < maxTweets);
        return tweets.slice(0, maxTweets);
    }

    return {
        me: () => get('/me'),
        // Every tweet created in [since, until). The API caps the window at 31 days.
        tweetsInWindow: ({ since, until }, opts) => paginate('/tweets', { since, until, order: 'asc' }, opts),
        // One account's tweets, optionally within [since, until).
        accountTweets: ({ account, since, until }, opts) =>
            paginate(`/accounts/${encodeURIComponent(account)}/tweets`, { since, until, order: 'asc' }, opts),
        get requestCount() {
            return requestCount;
        },
    };
}
