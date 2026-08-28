const API_BASE = 'https://hacker-news.firebaseio.com/v0';

// Bounds how many item fetches run at once per tree level — a popular story can have
// hundreds of top-level comments, and firing them all at once isn't worth the risk.
const CONCURRENCY = 20;

export function parseHackerNewsUrl(url) {
    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch {
        throw new Error('Not a recognizable Hacker News URL');
    }

    if (!parsed.hostname.endsWith('ycombinator.com')) {
        throw new Error('Not a recognizable Hacker News URL (expected a news.ycombinator.com/item link)');
    }

    const id = parsed.searchParams.get('id');
    if (!id) throw new Error('Not a recognizable Hacker News URL (expected .../item?id=<id>)');
    return id;
}

async function fetchItem(id) {
    const res = await fetch(`${API_BASE}/item/${id}.json`);
    if (!res.ok) throw new Error(`Hacker News API error (${res.status}) fetching item ${id}`);
    return res.json();
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

// Breadth-first walk of the comment tree: a level's ids all come from the previous
// level's `kids`, so the frontier can only be known one level at a time. Ids that
// resolve to null (never existed) are dropped; deleted/dead items are kept in the map
// so threadToMessages can still see their kids and reparent around them.
async function fetchTree(rootId, onProgress) {
    const itemsById = new Map();
    let frontier = [rootId];
    let fetched = 0;

    while (frontier.length > 0) {
        const items = await mapWithConcurrency(frontier, CONCURRENCY, async (id) => {
            const item = await fetchItem(id);
            fetched++;
            onProgress?.(`Fetched ${fetched} item${fetched === 1 ? '' : 's'}...`);
            return item;
        });

        frontier = [];
        for (const item of items) {
            if (!item) continue;
            itemsById.set(item.id, item);
            if (item.kids) frontier.push(...item.kids);
        }
    }

    onProgress?.(`Done — ${itemsById.size} items.`);
    return itemsById;
}

export async function fetchThreadForUrl(url, onProgress) {
    const rootId = Number(parseHackerNewsUrl(url));
    const itemsById = await fetchTree(rootId, onProgress);
    return { rootId, itemsById };
}
