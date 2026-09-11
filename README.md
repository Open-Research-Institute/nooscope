# Noöscope

Toolkit for visualizing idea spaces & their evolution over time.

1. Data is scraped by one or more sources and normalized into a standard message format
2. Semantic embeddings and 2D projection is computed
3. A stateless viewer can visualize that final output

The idea is that the input (the actual messages) can be scraped once and stored in an open database, all derived data (semantic embeddings) can be attached to the source and also cached for others to use.

Over time anyone can build custom frontends for this pipeline, and more and more people can connect their data to it.

## Supported collectors

Anything that collects message data and formats it using the standard spec [docs/spec.md](docs/spec.md) can use this pipeline. 

This repo contains the following scrapers/collectors:

- Twitter - a bookmarklet that runs on a specific tweet and scrapes all replies from the DOM
- Bluesky - takes a URL of a tweet and collects all top level replies
- YouTube - supports shorts or regular videos
- Hacker News - all replies (not just top level) 

To be worked on next:

- LinkedIn
- A reddit thread
- Substack comments 
- Instagram post
- Threads post
- Facebook post
- Signal group chat
- Whatsapp group chat
- Discord server
- TikTok video 
- NYT comment section or something like that?
   - Ars Technica 

## Development

```
npm install
npm run dev     # index.html / viewer.html / bluesky.html, live-reloaded
npm run build   # static production build, output in dist/
```

## Example run

Once data is scrapped and placed in `data/sources/`, the pipeline run computes semantic embeddings followed by a 2D projection like UMAP or PCA. 

```
node scripts/pipeline.mjs data/sources/twitter-bennjordan-flock-takes-357.json data/sources/bluesky-bennjordan-flock-takes-44.json -o data/benn-jordan
```

To recreate a computed output from the same sources:

```
node scripts/pipeline.mjs data/benn-jordan
```