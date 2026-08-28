# Cloudflare deploy

Plan for a simple first deployment: one Cloudflare Worker serving the existing static site, a small embed+project API, and object storage for sharing results by link. Not implemented yet.

## Shape of it

One Worker, using Workers' static-assets binding (the current unified
replacement for Pages) so there's a single `wrangler.toml` and a single
`wrangler deploy` for both the frontend and the API — no separate Pages
project to keep in sync.

```
                 ┌───────────────────────────┐
  GET /              → dist/ (index.html, viewer.html, bluesky.html, assets)
  POST /api/pipeline  → Worker: embed + project, returns viz JSON
  POST /api/save       → Worker: writes viz JSON to R2
                 └───────────────────────────┘
                   R2 bucket: nooscope-viz (public — reads bypass the Worker)
```

Reads don't go through the Worker. R2 buckets can be made public directly
(a custom domain/subdomain mapped straight to the bucket, or Cloudflare's
`pub-<hash>.r2.dev` dev subdomain for testing — the latter is rate-limited
and explicitly not meant for links you'd actually share). `viewer.html?src=`
points straight at the object. Simpler than a proxy route, at the cost of
the public bucket living on its own hostname rather than under the same
domain as everything else — worth a `GET /v/:id` Worker route instead only
if that domain split becomes annoying, or if `/v/:id` ever needs to do more
than hand back the raw JSON (e.g. serve `viewer.html` pre-loaded instead).

```toml
# wrangler.toml
name = "nooscope"
main = "worker/index.mjs"
compatibility_date = "2026-08-28"

[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = ["/api/*"]
```

No `[[r2_buckets]]` binding — see [Portability](#portability-keeping-a-vps-option-open)
below for why storage goes through R2's S3-compatible API instead.
`OPENAI_API_KEY` and the R2 access key/secret are secrets (`wrangler secret
put ...`), never in `wrangler.toml`.

## Portability: keeping a VPS option open

Nothing here is needed to ship v1 — it's about which choices to make *while*
writing v1, so a later move to a plain VPS (a DigitalOcean droplet, say) is a
swap of a couple of adapters instead of a rewrite.

**Requirement: `worker/index.mjs`'s handler is a plain `fetch(request, env,
ctx)` function, using only Web-standard `Request`/`Response` — nothing
Workers-proprietary in the routing/handler layer.** This is what makes the
handler itself portable, not just easy to port: the exact same function can
be handed to a `node:http` listener on a VPS. It's also already idiomatic
Workers style, and exactly the shape [Hono](https://hono.dev) is built
around if a real router becomes worth it (same route code runs on Workers,
Node, Deno, Bun) — so this costs nothing even if the VPS move never happens.

For storage, the equally-easy choice (not a hard requirement, but do it
anyway): talk to R2 over its S3-compatible API, not the native R2 binding.
R2 and DigitalOcean Spaces both speak the S3 API, so code written against a
generic S3 client — [`aws4fetch`](https://github.com/mhart/aws4fetch) is a
good fit, tiny and built on `fetch`, runs unchanged in both Workers and
Node — points at either provider by swapping endpoint + access key, nothing
else. `env.VIZ_BUCKET.put()` (the native binding) is a little simpler but is
a dead end the moment Workers isn't the only place this runs.

What's genuinely *not* portable, and needs a small adapter on each side
regardless: static asset serving (`env.ASSETS.fetch()` on Workers vs. a
Node static-file server / nginx on a VPS) and the top-level entry point
(the Workers module export vs. a `node:http` listener calling the same
handler). On the order of 15-20 lines either way — the embed/project logic
and the cache interface below carry over untouched.

## Local dev

`wrangler dev` runs on `workerd`, the actual open-source runtime Workers
runs in production — not an approximation of it. R2 is emulated locally by
default too (writes land in `.wrangler/state`, not the real bucket, unless
`--remote` is passed), and local secrets go in a `.dev.vars` file (the
Wrangler equivalent of `.env`). In practice the dev loop ends up close to
`vite dev` today: no deploy step to iterate, hot reload included.

## Prerequisite: the pipeline needs to stop touching the filesystem

`embedItems()` (`src/pipeline/embed.mjs`) reads/writes `.cache/embeddings.json`
via `node:fs`. That's fine for the CLI scripts but doesn't run in a Worker —
there's no filesystem, and `nodejs_compat` doesn't change that. `projectItems()`
(`src/pipeline/project.mjs`) is already pure computation with no I/O, so it
needs no changes and can be imported into the Worker as-is.

Fix: pull the cache read/write out of `embedItems` into an injectable
interface, the same way the projector method is already pluggable:

```js
// embedItems(stagedFiles, { apiKey, cache, onLog })
// cache: { get(text) => entry | undefined, setMany(entries: Map) => Promise }
```

- Node CLI path: a small adapter that wraps the current `.cache/embeddings.json`
  file read/write behind that interface — `scripts/embed.mjs` barely changes.
- Worker path: a KV-backed adapter (`OPENAI_API_KEY`-keyed cache is
  overkill; key by the text itself, same as today). Optional for v1 — a
  no-op cache (`get` always misses) is a valid adapter and means every
  request re-embeds from scratch. Start with the no-op; add the KV adapter
  once real usage shows repeat text is common enough to matter.

This is the one required refactor. Everything else below is new code, not
changes to existing pipeline logic.

## API

### `POST /api/pipeline`

Body: a collector export, `{context, messages}` (same shape `loadStagedFiles`
validates today), or an array of those for multiple sources in one call.
Runs `embedItems` + `projectItems` in the request handler, returns the
visualization JSON (`spec.md`'s `## Visualization output` shape) directly —
nothing persisted. This is the "anyone can call it" endpoint: stateless,
no storage side effect, so it can't be used to fill up the bucket.

Query param `?method=umap` mirrors the CLI's `--method`.

No auth for v1 — this is "internal use," not a public launch: the URL isn't
posted anywhere, so the exposure is "someone stumbles onto it," not
"anyone can spend your OpenAI key on purpose." Skip size caps and rate
limiting for now. When this does get shared more widely, the natural next
step is a simple auth layer in front of `/api/pipeline` (a shared secret
header is enough to start — Cloudflare Access is the zero-code option if
it's just you and a few people hitting it) — see "Later, not v1" below.

### `POST /api/save`

Body: a visualization JSON (the output of `/api/pipeline`, or from the local
CLI pipeline — either way, same shape). Writes it to R2 (via its S3-compatible
API — see [Portability](#portability-keeping-a-vps-option-open)) under a
generated id (`PUT` with `Content-Type: application/json` set explicitly —
otherwise direct fetches/browser opens of the public object behave oddly), returns
`{ id, url }` where `url` is the object's public R2 URL. Separate from
`/api/pipeline` so a client can run the pipeline, look at the result, and
only save the ones worth keeping — and so the local CLI pipeline output can
be published this same way without re-running embed/project against the API.

Since reads bypass the Worker (see above), that public URL is what
`viewer.html?src=` points at directly — no `GET /v/:id` route needed. That
does mean `viewer.html` needs a small addition it doesn't have today: it
currently only loads files via drag-and-drop / file input (`viewer.html:65`),
no URL-param loading path. Add: on load, check `?src=`, and if present
`fetch()` it into the same code path the file input already feeds.

## Storage: R2 only, no DB, for v1

Object storage (R2) holds the actual visualization JSON — that's the
"static loading" the ask describes, and it's genuinely all that's needed to
make `/v/:id` work. No database required for that path.

Where a DB-shaped question actually shows up: **is there a "browse
everything that's been saved" page?** If not, v1 needs nothing beyond R2 —
ids are unlisted, shareable-by-link, and that's the whole index. If yes,
that's a listing/metadata problem, not a relational one — resist reaching
for a SQL schema for "id, created_at, label, point count." The simple
option there is a Cloudflare KV namespace, one entry per save
(`id → {createdAt, label, sourceCount, pointCount}`), read back with a
`list()` call for a gallery page. That's the "super simple index" — flat
key-value, no migrations, no query planning. Reach for D1 only if this ever
needs filtering/sorting by more than a couple of fields, which a browse
page for shared visualizations is unlikely to.

Recommendation: skip the index entirely for v1 (R2 + unlisted ids). Add the
KV metadata index only when a gallery/browse page is actually wanted.

## Minimal test page

A tiny page — not the real UI, just enough to exercise the API — with a
textarea for pasting a collector export JSON (or a file input reusing the
same drop handler as `viewer.html`), a submit button hitting
`POST /api/pipeline`, and on success a link to `viewer.html?src=...` (after
an implicit `/api/save`) plus the raw JSON dumped below it for inspection.
A few dozen lines, no framework beyond what's already in `index.html`.
Ship it at `/try` — one more static entry alongside `index.html` /
`viewer.html` / `bluesky.html` in `vite.config.js`'s `rollupOptions.input`.

## Steps

1. Refactor `embedItems`'s cache into the injectable interface described
   above; update `scripts/embed.mjs`/`scripts/pipeline.mjs` to pass the
   Node fs adapter (no behavior change for the CLI).
2. Write `worker/index.mjs` as a plain `fetch(request, env, ctx)` handler
   (Web-standard `Request`/`Response` only — see
   [Portability](#portability-keeping-a-vps-option-open)): route
   `/api/pipeline`, `/api/save`, fall through to `env.ASSETS.fetch()` for
   everything else.
3. Create the R2 bucket (`wrangler r2 bucket create nooscope-viz`), generate
   an S3 API token for it, implement `/api/save` against that S3-compatible
   endpoint (`aws4fetch` or similar), and make the bucket public (custom
   domain, or the `r2.dev` dev URL while testing).
4. Add `?src=` URL-param loading to `viewer.html`/`uiController.js`.
5. Build the `/try` test page.
6. `wrangler secret put OPENAI_API_KEY`; `wrangler secret put` the R2 access
   key/secret.
7. `wrangler deploy`.

## Later, not v1

- KV metadata index + gallery/browse page (see above).
- KV-backed embedding cache in the Worker, to cut repeat-text OpenAI cost.
- A simple auth layer in front of `/api/pipeline` — shared-secret header or
  Cloudflare Access — plus the size cap and rate limiting called out above,
  once the URL stops being "only people who already know it" and something
  resembling real/public traffic shows up.
