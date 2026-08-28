# Fixed-axis projection

Plan for two new ways to turn embeddings into `{x, y}`, alongside the existing
`umap` projector in `src/pipeline/project.mjs` — and for mixing them per axis.
Not implemented yet; this is the spec to build and test against.

## Where this sits in the architecture

Three layers. Each is a complete, independently publishable artifact — not an
internal intermediate — so anyone can pick them up at whichever layer fits
what they're building, without needing the earlier stages.

1. **Raw / scraped.** Collector output — `{context, messages}`
   ([spec.md](spec.md)). Platform-specific collector, otherwise clean text.
   No embeddings, no visualization assumptions.

2. **Embedded.** `embed.mjs` output — adds one embedding vector per item.
   Still visualization-agnostic: nothing here assumes 2D, x/y, or any
   particular downstream use. Right now it doesn't record *which* embedding
   model produced the vectors — see [Embedded contract gap](#embedded-contract-gap)
   below, that has to be fixed first.

3. **Processed.** Anything that turns raw or embedded data into something
   visualization-ready. `project.mjs`'s `{x, y}` points bundle is *one*
   processor output, not the only shape a processor can produce — a
   "message volume over time" processor or a "word frequency" processor
   would consume the raw or embedded layer and emit a bundle with no x/y,
   no embeddings, and no 2D at all. Coupling to a specific visualization
   (a scatterplot) only happens at this layer, and only for processors that
   choose to produce that shape.

This doc specs two new members of the x/y-points processor family
(poles + reused-projection), swappable with `umap` via the same
`projectItems(embedded, { method })` interface. Other processor shapes
(volume, word frequency, ...) get their own doc when they're built — they
don't touch anything below.

## Embedded contract gap

`embedItems()` (`src/pipeline/embed.mjs`) returns `{version, sources, items}`
with no record of which embedding model produced the vectors. That's fine
while `embed.mjs` and `project.mjs` are always run back to back by the same
person, but it breaks both features in this doc:

- **Poles** must be embedded with the exact same model as the dataset —
  cosine similarity between vectors from two different embedding models is
  meaningless.
- **A reused/reference projection** is only valid for embeddings from the
  model it was fit on.

Prerequisite step: add `model` (e.g. `"text-embedding-3-small"`) and
`dimensions` to `embedItems()`'s output, and formalize `embedded.json` as a
public contract in `spec.md` (a new `## Embedded output` section, parallel to
the existing `## Visualization output`). Every downstream artifact described
below (reference projections, pole sets) records which embedding model it
was built against, and projectors must refuse to run if the embedded input's
model doesn't match.

## Two axis methods

### A. Pre-written poles (semantic axis)

Define an axis by two (or more) short exemplar phrases per pole —
e.g. `pro: ["surveillance keeps us safe", "we need more monitoring"]`,
`against: ["this is Orwellian overreach", "surveillance violates privacy"]`.
Embed the poles once (same model as the dataset, same `embed.mjs` cache),
average each pole's vectors into a centroid, then for each item:

```
score = cosineSim(item.embedding, poleB centroid) - cosineSim(item.embedding, poleA centroid)
```

Deterministic, no fitting, no network at project time (poles embedding is a
one-time cost, cacheable like everything else in `embed.mjs`). Two pole
pairs give you two independent axes (x from one pair, y from another).

New artifact: a **pole set** — named, versioned, tied to an embedding model:

```json
{
  "version": "0.1",
  "model": "text-embedding-3-small",
  "axes": {
    "surveillance-stance": {
      "poleA": { "label": "against", "phrases": ["...", "..."] },
      "poleB": { "label": "pro", "phrases": ["...", "..."] }
    }
  }
}
```

Stored under e.g. `poles/surveillance-stance.json`, reusable across runs and
datasets as long as the embedding model matches.

### B. Reused projection (fit once, transform new points)

Fit a UMAP model once on a reference dataset (e.g. "all emoji", or last
month's full corpus), persist its internal state, and for new data call
`.transform()` against the persisted model instead of `initializeFit()` on
just the new points. `umap-js` supports this natively (`fit()` then
`transform(newData)` for out-of-sample points).

New artifact: a **reference projection** — the serialized UMAP model plus the
embedding model it was fit against:

```json
{
  "version": "0.1",
  "model": "text-embedding-3-small",
  "method": "umap",
  "fitOptions": { "nNeighbors": 15, "minDist": 0.1, "seed": 1991 },
  "umapState": { /* whatever umap-js needs to reconstruct the fitted model */ }
}
```

Stored under e.g. `references/emoji.json`. Building one is a new mode (fit +
save, not fit + emit points); using one is a new projector that loads it and
transforms instead of fitting.

Caveat to test for, not assume: UMAP's `transform()` projects new points
into the space of the reference fit, but if the new data is semantically far
from the reference set the result can be meaningless (points get squashed
into whatever region is nearest in the reference layout, not placed
sensibly). This needs validating with real data before it's trusted, unlike
poles, which degrade more gracefully.

### C. Combining them (per-axis method selection)

The open question in the prompt — "or if we want both" — argues against a
single `--method` for the whole 2D layout. Better: let x and y be specified
independently, each pulling from a different method:

```
node scripts/project.mjs embedded.json -o out.json \
  --x poles:surveillance-stance \
  --y umap-fixed:emoji
```

with `--method umap` remaining as shorthand for "both axes from a fresh
unsupervised UMAP fit" (today's default, unchanged). This means
`projectItems` needs to grow an axis-provider concept — same
`(items, embeddings, options) => number[]` shape as today's projectors, but
returning one scalar per item instead of `{x, y}` per item — with UMAP's
existing 2-output behavior wrapped to fill both axes when no per-axis
override is given.

## Steps

1. Add `model`/`dimensions` to `embedItems()` output; add `## Embedded
   output` to `spec.md`.
2. Build a pole set format + a script to build/embed one
   (`scripts/build-poles.mjs`?), reusing `embed.mjs`'s cache/model plumbing.
3. Implement the poles projector (single-axis scorer) in `project.mjs`.
4. Build the reference-projection format + a script to fit and persist one
   (`scripts/build-reference.mjs`?).
5. Implement the umap-fixed projector (`transform()` against a loaded
   reference) in `project.mjs`.
6. Refactor `project.mjs`'s method dispatch to per-axis providers, keeping
   `--method umap` as the existing default path.
7. Update `spec.md`'s `points[].x/y` comment to mention poles/reference as
   concrete examples (it already gestures at "a fixed semantic axis" —
   make it point at this doc).

## Testing plan

- **Poles alone.** Synthetic sanity check first: embed a handful of
  obviously-pro and obviously-anti sentences that aren't in the pole set,
  confirm they land on the expected side. Then run on the real 1000-reply
  Benn Jordan dataset and spot-check a sample of each score quartile by eye
  — poles are expected to degrade on sarcasm/indirect language, so the goal
  here is characterizing *how much* noise, not zero noise.
- **Reused projection alone.** Fit a reference on one dataset, transform a
  different but related dataset onto it, and check whether the result is
  stable/sensible — cluster shapes roughly match a fresh UMAP fit on the
  combined data, and points aren't all collapsing into one corner (the
  out-of-distribution failure mode noted above).
- **Combined (x = poles, y = umap-fixed or fresh umap).** Confirm the two
  axes are actually adding independent information — e.g. that stance
  doesn't correlate 1:1 with the UMAP topic axis, which would mean the
  poles axis isn't contributing anything a plain topic clustering didn't
  already show.
- **Model-mismatch guard.** Confirm project.mjs actually refuses (not
  silently produces garbage) when a pole set or reference projection's
  recorded `model` doesn't match the embedded input's `model`.
