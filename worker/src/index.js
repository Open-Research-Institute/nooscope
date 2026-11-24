// A "bring your own backend" for the nooscope viewer.
//
// Whoever deploys this Worker owns the data. The static viewer talks to it via
// viewer.html?backend=<this worker's URL>.
//
//   GET  /datasets          -> [{ name, title, pointCount, savedAt }]   (anyone)
//   GET  /datasets/:name    -> the visualization file, as saved         (anyone)
//   PUT  /datasets/:name    -> save/overwrite a visualization file      (needs the write key)
//
// The write key is a secret set by the owner (`wrangler secret put WRITE_KEY`)
// and shared out of band. Requests send it as `Authorization: Bearer <key>`.
//
// Storage is Workers KV (binding DATASETS): one key per dataset, with the list
// fields kept in KV metadata so listing never has to read the files themselves.
// The body is stored as-is and never parsed here: a large JSON.parse would blow
// the free plan's 10 ms CPU budget. The viewer validates files when it loads them.

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BYTES = 25 * 1024 * 1024; // KV's per-value limit

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Nooscope-Title, X-Nooscope-Points',
    'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });
}

function error(status, message) {
    return json({ error: message }, status);
}

async function keyMatches(request, env) {
    if (!env.WRITE_KEY) return false; // no key configured = read-only backend
    const header = request.headers.get('Authorization') || '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    const enc = new TextEncoder();
    const a = enc.encode(given);
    const b = enc.encode(env.WRITE_KEY);
    if (a.byteLength !== b.byteLength) return false;
    return crypto.subtle.timingSafeEqual(a, b);
}

async function listDatasets(env) {
    const datasets = [];
    let cursor;
    do {
        const page = await env.DATASETS.list({ cursor });
        for (const k of page.keys) datasets.push({ name: k.name, ...(k.metadata || {}) });
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    datasets.sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0));
    return json(datasets);
}

async function getDataset(env, name) {
    const body = await env.DATASETS.get(name, 'stream');
    if (body === null) return error(404, `No dataset named "${name}".`);
    return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function putDataset(request, env, name) {
    if (!env.WRITE_KEY) return error(403, 'This backend is read-only (its owner has not set a write key).');
    if (!(await keyMatches(request, env))) return error(401, 'Missing or wrong write key.');

    const length = Number(request.headers.get('Content-Length'));
    if (!length) return error(411, 'Content-Length is required.');
    if (length > MAX_BYTES) return error(413, `File is ${length} bytes; the limit is ${MAX_BYTES}.`);

    let title = '';
    try { title = decodeURIComponent(request.headers.get('X-Nooscope-Title') || ''); } catch { /* keep empty */ }
    const metadata = {
        title: title.slice(0, 200) || name,
        pointCount: Number(request.headers.get('X-Nooscope-Points')) || null,
        savedAt: Date.now(),
    };

    await env.DATASETS.put(name, request.body, { metadata });
    return json({ name, ...metadata }, 201);
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        const { pathname } = new URL(request.url);
        const parts = pathname.split('/').filter(Boolean);

        if (parts[0] !== 'datasets' || parts.length > 2) return error(404, 'Not found. Try GET /datasets.');

        if (parts.length === 1) {
            if (request.method === 'GET') return listDatasets(env);
            return error(405, 'Use GET on /datasets.');
        }

        const name = decodeURIComponent(parts[1]);
        if (!NAME_RE.test(name)) return error(400, 'Dataset names are 1-64 chars of a-z, 0-9, "-" or "_", starting with a letter or digit.');

        if (request.method === 'GET') return getDataset(env, name);
        if (request.method === 'PUT') return putDataset(request, env, name);
        return error(405, 'Use GET or PUT on /datasets/:name.');
    },
};
