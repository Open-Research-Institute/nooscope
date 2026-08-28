# Linguistic diversity (word-level)

Plan for a new processor, computed from raw text — no embeddings involved.
The primary output is something to **look at**: a table of the most common
unigrams/bigrams/trigrams per snapshot source, normalized so sources of
different sizes are comparable. A single **range** score and pairwise
**overlap** score per source ride along as compact summaries on top of that
table, useful for tracking a source over time, but the table is the thing
you actually read to understand *what* changed. Not implemented yet; this is
the spec to build and test against.

## Where this sits in the architecture

Operates on the **raw layer** ([spec.md](spec.md)'s `{context, messages}`
collector export), same input `embed.mjs` takes via `loadStagedFiles()`. It's
a sibling to `embed.mjs`/`project.mjs`, not downstream of either — no API
key, no embedding model, no cache. This is exactly the "word frequency
processor" [fixed-axis-projection.md](fixed-axis-projection.md) anticipated:
consumes the raw layer, emits a bundle with no x/y and no 2D at all.

One **source** = one input collector-export file = one snapshot, matching
the `sources[]` entries already in `output.json`. A dataset with a Twitter
file, a Bluesky file, and a YouTube file gets three range scores and three
pairwise overlap scores — same grouping the viewer already uses via
`sourceId`.

New artifact (`lexicon.json`), new module (`src/pipeline/lexicon.mjs`), new
script (`scripts/lexicon.mjs`).

## The core problem: sample size

Raw vocabulary size and type-token ratio are both monotonic in token count —
a source with 5,000 words of text will look "more diverse" than one with
500 words even if their actual vocabulary breadth is identical. Any score
meant to be *compared* across sources has to control for this, or the
comparison is meaningless. Two mechanisms below handle it: rarefaction for
range, an abundance-weighted index for overlap.

## Tokenization

Deliberately simple for v1 — literal surface words, not lemmas:

- Lowercase.
- Strip URLs before tokenizing (never lexicon).
- Strip `@mentions` (addressing, not vocabulary).
- Keep `#hashtags` as words, minus the `#`.
- Split on a regex matching runs of unicode word characters (letters,
  digits, internal apostrophes) **or** a single emoji codepoint as its own
  token — emoji are part of this project's notion of lexicon (see the
  "render emojis" map work), so they shouldn't get silently dropped as
  punctuation.
- No stemming/lemmatization ("flock" and "flocking" count as different
  types) and no stopword removal (function words stay in the stream) at
  *this* layer — the raw token stream, unmodified, is what the range/overlap
  scores below are computed on. This isn't a punt: MTLD/HD-D and friends are
  conventionally computed on the raw surface stream, since they're measuring
  surface-level lexical variety ("run/running/ran" is more varied than
  "run/run/run") — matching standard practice, not skipping a step.

Stemming and stopword removal do show up, deliberately, one layer up — in
the n-gram tables below, which exist to be read by a human rather than
compared as a number. Both are standard, named techniques, not something to
design from scratch:

- **Stopwords**: a fixed reference list (the classic SMART list, or NLTK's
  English list — same lists everyone uses). Small enough (~200-400 words)
  to vendor as a static array rather than pull in a dependency.
- **Stemming**: the **Porter stemmer** algorithm (or its successor,
  **Snowball**) — deterministic, well-specified, and what collapses
  "flock"/"flocking"/"flocked" into one table row. Small existing
  implementations exist (`snowball-stemmers` on npm, or a vendored Porter).
  Full lemmatization (dictionary/POS-based, more accurate, heavier — e.g.
  `compromise` for JS) is the upgrade path if stemming turns out too crude
  in practice, not the v1 default.

## N-gram tables (the view)

The primary artifact: per source, the top unigrams, bigrams, and trigrams by
frequency, built from the raw tokens above but filtered/grouped for
readability rather than left as the literal surface stream:

- Unigrams: stemmed (so inflectional variants group into one row), stopwords
  dropped entirely.
- Bigrams/trigrams: **not** stemmed — collocations are about exact phrasing,
  and stemming mangles readability ("surveil technolog" instead of
  "surveillance technology"). Instead, drop any n-gram whose first or last
  token is a stopword (a standard collocation-extraction heuristic — kills
  noise like "in the" or "a surveillance" while keeping internal function
  words that are actually part of the phrase, like "expectation of
  privacy").

Each row carries both a raw count and a per-1,000-token frequency, so tables
from sources of very different sizes are still comparable at a glance
without doing the rarefaction math from the range score:

```
{ n: 2, ngram: "surveillance technology", count: 14, per1k: 1.7 }
```

Top-100 per n per source is a reasonable default cutoff — enough to spot
patterns, small enough to actually read.

**This table is also how you see overlap**, not just measure it: put two
sources' top-N trigram tables side by side (or diff them, highlighting
shared rows) and the Morisita–Horn number below stops being an abstraction —
you can point at which specific phrases are shared vs. unique to one
community.

A natural v2 upgrade, once raw-frequency tables are in hand and useful:
**keyness** (log-likelihood or chi-square comparing a source's frequency for
each n-gram against a reference — the other sources in the run, or a
background corpus) instead of raw frequency. That's the standard
corpus-linguistics way to answer "what's *distinctive* about this source,"
which raw frequency (even stopword-filtered) doesn't — a word can be common
in every source and still top the raw-frequency list. Not needed for v1;
raw frequency is enough to start reading tables and see if this whole
direction is useful.

## Metric: range

Rarefied Hill number of order 1 (exponentiated Shannon entropy) — the
"effective vocabulary size" of a source, controlling for token count.

```
tokens = tokenize(all message text for this source)
N = tokens.length

T = RAREFACTION_TARGET   // fixed constant, not derived per-run — see below

if N < T: source is flagged insufficientData, no score computed

repeat 200 times:
    sample = draw T tokens from `tokens` without replacement
    freq   = frequency count of each type in `sample`
    p_i    = freq[i] / T
    H      = -sum(p_i * ln(p_i))
    hill1  = exp(H)
    record hill1

rangeScore = mean(hill1 across the 200 draws)
```

`rangeScore` is interpretable directly: "this source behaves as if it used
`rangeScore` equally-common distinct words," which downweights a handful of
words repeated constantly (unlike raw vocab size, which just counts).

**`RAREFACTION_TARGET` must be a fixed constant, not `min(N)` over whatever
sources happen to be in one run.** The original goal is tracking a
community's range over time and across separately-run datasets — if T
floats with each run's smallest source, two `lexicon.json` outputs from
different runs aren't comparable to each other, only within themselves. Pick
one constant up front (default e.g. `500` tokens, override via CLI flag),
based on typical snapshot size in real data — see testing plan.

## Metric: overlap

Morisita–Horn index, pairwise over every pair of sources in the run.
Abundance-weighted and — unlike Jaccard/Sørensen on raw sets — tolerant of
unequal sample sizes between the two sources being compared, so it doesn't
need rarefaction:

```
X = total tokens in source A, Y = total tokens in source B
x_i = count of word i in A, y_i = count of word i in B

overlap(A, B) = 2 * sum(x_i * y_i)
                / ( (sum(x_i^2)/X^2 + sum(y_i^2)/Y^2) * X * Y )
```

Bounded [0, 1]: 0 = disjoint vocabularies, 1 = identical relative-frequency
distributions. Computed on full (non-rarefied) frequency counts — deliberate
simplification for v1, flagged below as worth revisiting if it turns out to
bias comparisons between very unequal sources.

## Output artifact shape

```json
{
  "version": "0.1",
  "rarefactionTarget": 500,
  "sources": [
    { "id": 0, "label": "Twitter (@bennjordan)", "tokenCount": 8213, "vocabSize": 1401 }
  ],
  "ngrams": [
    {
      "sourceId": 0,
      "n": 1,
      "top": [ { "ngram": "flock", "count": 22, "per1k": 2.7 } ]
    },
    {
      "sourceId": 0,
      "n": 2,
      "top": [ { "ngram": "surveillance technology", "count": 14, "per1k": 1.7 } ]
    }
  ],
  "range": [
    { "sourceId": 0, "rangeScore": 187.4, "insufficientData": false }
  ],
  "overlap": [
    { "a": 0, "b": 1, "score": 0.42 },
    { "a": 0, "b": 2, "score": 0.11 },
    { "a": 1, "b": 2, "score": 0.09 }
  ]
}
```

`overlap` is a flat list of pairs rather than a matrix — most datasets have
few sources, and a pair list stays easy to append to later (e.g. once
sources start spanning time buckets, not just platforms) without resizing a
matrix. `sources[].tokenCount`/`vocabSize` are raw, unrarefied — kept for
sanity-checking scores against the underlying text, not for comparison.
`ngrams[].top` is truncated to the top-100 rows per `(sourceId, n)`, sorted
by count descending — the table entries are what get rendered/read; `range`
and `overlap` are the compact numbers that summarize them.

## Script

Mirrors `pipeline.mjs`'s two-mode CLI:

```
node scripts/lexicon.mjs <collector-export.json...> -o data/my-dataset/lexicon.json [--rarefy 500]
node scripts/lexicon.mjs data/my-dataset [--rarefy 500]   # reads sources.json, regenerate
```

No API key, no network, no cache — pure computation, fast even on large
datasets. `pipeline.mjs`'s `resolveRun()` (explicit files + `-o` vs.
dataset-dir regenerate) is worth factoring into a shared helper at this
point rather than duplicating it a second time; flagged as a small refactor
to do alongside this script, not before it.

## Steps

1. `src/pipeline/lexicon.mjs`: `tokenize(text)`.
2. Vendor a standard English stopword list + a Porter/Snowball stemmer
   (small existing implementation, not hand-rolled).
3. `buildNgramTable(tokensBySource, { n, stem, dropEdgeStopwords })` —
   frequency counts + the filtering rules from the n-gram section above, run
   for n = 1, 2, 3.
4. `computeRange(tokensBySource, { rarefactionTarget })` — rarefaction loop
   + Hill number, on the raw (unstemmed, unfiltered) tokens.
5. `computeOverlap(tokensBySource)` — pairwise Morisita–Horn, also on raw
   tokens.
6. `lexiconItems(stagedFiles, options)` — top-level function mirroring
   `embedItems()`'s signature (stagedFiles in, bundle out), reusing
   `messagesToViewerItems()` for text extraction so empty-message filtering
   stays consistent with the rest of the pipeline.
7. `scripts/lexicon.mjs` CLI wrapper.
8. Extract `pipeline.mjs`'s dataset-dir resolution into
   `scripts/lib/resolveDatasetRun.mjs`, used by both scripts.

Consuming the output (rendering the n-gram tables, maybe side-by-side per
source, alongside the existing viewer) is a separate, later concern — not
detailed here.

## Testing plan

- **Synthetic range sanity.** One fake corpus repeating 10 words, one using
  hundreds of distinct words once each — confirm `rangeScore` ranks them the
  way intuition expects.
- **Synthetic overlap sanity.** Identical corpora → overlap ≈ 1. Disjoint
  vocabularies → overlap ≈ 0.
- **Rarefaction stability.** Check `rangeScore` variance across repeated
  runs on the same source is small at 200 draws; bump the iteration count if
  scores swing noticeably.
- **Real data.** Run against `data/benn-jordan` (Twitter/Bluesky/YouTube on
  the same topic/author) — use it to pick a sane default
  `RAREFACTION_TARGET` (look at real `tokenCount`s across sources, several
  should clear the floor) and to spot-check whether `insufficientData`
  triggers on the thinner sources (YouTube comments are likely much shorter
  than the Twitter thread).
- **Tokenization spot-check.** Eyeball the actual token list for one source
  against the raw text — confirms URL/mention stripping and emoji handling
  are doing what's intended before trusting scores built on top of them.
- **N-gram table read-through.** The actual point of this feature: run
  against `data/benn-jordan`, read the top-100 unigram/bigram/trigram tables
  per source, and check whether they look like a sane summary of what's
  actually being discussed — not whether a number "looks right," whether a
  human reading the table learns something true about the source.
- **Edge-stopword heuristic check.** Spot-check a sample of dropped bigrams/
  trigrams (edge token is a stopword) to confirm the heuristic isn't
  discarding genuinely meaningful phrases along with the noise.

## Open questions

- The edge-stopword heuristic for bigrams/trigrams is a cheap approximation,
  not the standard "collocation strength" approach (PMI or log-likelihood
  between adjacent words) — worth upgrading to if raw-frequency-plus-
  edge-filtering turns out to still surface too much junk.
- Overlap computed on non-rarefied counts — may need the same fixed-T
  rarefaction as range if sources of very different sizes produce
  suspicious overlap scores.
- Cross-run comparability lives entirely in keeping `RAREFACTION_TARGET`
  fixed — there's no guard today stopping someone from re-running with a
  different `--rarefy` value and silently getting incomparable numbers.
  Worth recording the target used inside `lexicon.json` (already in the
  shape above) and having downstream tooling warn/refuse on a mismatch,
  the way `project.mjs` is planned to refuse on embedding-model mismatches.
