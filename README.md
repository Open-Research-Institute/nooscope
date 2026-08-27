# Noöscope

Toolkit for visualizing the evolving territories in social media discourse.

1. **Scrape.** Collectors turn a platform (Twitter/X, Bluesky, ...) into the shared
   message schema. See [docs/spec.md](docs/spec.md).
   - Twitter: drag the bookmarklet from `index.html` to your bookmarks bar, click it
     on a post/profile/timeline, and save the downloaded JSON.
   - Bluesky: open `bluesky.html`, paste a thread URL.
2. **Embed & project.** Turn one or more scraped files into a single visualization
   file, from the terminal. Put `OPENAI_API_KEY=sk-...` in a `.env` file at the repo
   root (already gitignored), or export it in your shell:
   ```
   node scripts/pipeline.mjs your-scrape-1.json your-scrape-2.json -o out.json
   ```
   Embedding (calls OpenAI, cached on disk at `.cache/embeddings.json`) and
   projection (2D layout, local/no network) are separable if you want to iterate on
   the layout without re-embedding:
   ```
   node scripts/embed.mjs your-scrape-1.json your-scrape-2.json -o embedded.json
   node scripts/project.mjs embedded.json -o out.json [--method umap]
   ```
   Output shape is documented in [docs/spec.md](docs/spec.md#visualization-output)
   — it's deliberately generic, so any tool can read it.
3. **Visualize.** Open `viewer.html`, drop in `out.json`. That's it — the file is
   the whole artifact; share it, host it, commit it.

## Development

```
npm install
npm run dev     # index.html / viewer.html / bluesky.html, live-reloaded
npm run build   # static production build, output in dist/
```
