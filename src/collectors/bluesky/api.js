const API_BASE = 'https://public.api.bsky.app/xrpc';

export function parseBlueskyPostUrl(url) {
    const match = url.trim().match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!match) throw new Error('Not a recognizable Bluesky post URL (expected something like https://bsky.app/profile/<handle>/post/<id>)');
    return { actor: match[1], rkey: match[2] };
}

export async function resolveDid(actor) {
    if (actor.startsWith('did:')) return actor;
    const res = await fetch(`${API_BASE}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Could not resolve handle "${actor}"`);
    return data.did;
}

// depth=1000 is the max the public API allows.
export async function fetchThread(atUri, depth = 1000) {
    const res = await fetch(`${API_BASE}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=${depth}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Bluesky API error (${res.status})`);
    return data.thread;
}

export async function fetchThreadForUrl(url) {
    const { actor, rkey } = parseBlueskyPostUrl(url);
    const did = await resolveDid(actor);
    return fetchThread(`at://${did}/app.bsky.feed.post/${rkey}`);
}
