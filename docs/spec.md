# Specification

v0.1

## Message

Each message a collector produces:

```
{
  id,               // required — collector assigns this, unique within the batch
  author,
  text,
  timestamp,
  parent,           // optional — id of the message this replies to
  children,         // optional — ids of direct replies
  metadata          // optional — collector-specific extra fields (e.g. sourceUrl, likes, profilePic)
}
```

`parent`/`children` reference `id`, not array position — arrays get filtered, sorted, and merged across collectors, ids don't.

There's no top-level `url`/permalink field on a message. A collector that does have per-message permalinks puts it in `metadata.sourceUrl`.

## Context

One per batch/export, describing where the messages came from.

```
{
  version,          // schema version, e.g. "0.1"
  collector,        // which collector software produced this
  source            // whatever identifies where this batch came from — the thread/post/video/channel URL, etc.
}
```

Kept intentionally loose for now — `source` isn't typed further yet.

## Visualization output

The other public contract: what `scripts/pipeline.mjs` (or `embed.mjs` +
`project.mjs` run separately — see the repo README) writes out, and what a viewer
reads. This is deliberately generic — anyone can write a viewer against this shape
without knowing anything about collectors, embeddings, or how the 2D layout was
computed.

```
{
  version,          // schema version, e.g. "0.1"
  sources: [
    { id, label, collector, source, fileName }   // one per input file
  ],
  points: [
    {
      x, y,          // 2D position — meaning depends on the projector used
                      // (e.g. "umap" for an unsupervised layout, or a fixed
                      // semantic axis for something like a happy↔angry scale)
      text, author, timestamp, url, likes,
      sourceId        // index into `sources`
    }
  ]
}
```
