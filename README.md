# Noöscope

Toolkit for visualizing the evolving territories in social media discourse.

1. **Scrape.** Click the bookmarklet on a post/profile/timeline (Twitter) or paste
   a thread URL into `bluesky.html` (Bluesky), and save the downloaded JSON into
   `data/sources/`.
2. **Run the pipeline.**
   ```
   node scripts/pipeline.mjs data/sources/scrape-1.json data/sources/scrape-2.json -o data/my-dataset
   ```
   This writes `data/my-dataset/output.json`, plus `data/my-dataset/sources.json`
   recording which sources went in — so later you can re-run the same dataset
   (e.g. after adding more sources to it) with just:
   ```
   node scripts/pipeline.mjs data/my-dataset
   ```
3. **Visualize.** Open `viewer.html`, drag in `data/my-dataset/output.json`.
   That's it — the file is the whole artifact; share it, host it, commit it.

## Development

```
npm install
npm run dev     # index.html / viewer.html / bluesky.html, live-reloaded
npm run build   # static production build, output in dist/
```

## Example run

Initial:

```
node scripts/pipeline.mjs data/sources/twitter-bennjordan-flock-takes-357.json data/sources/bluesky-bennjordan-flock-takes-44.json -o data/benn-jordan
```

To recreate:

```
node scripts/pipeline.mjs data/benn-jordan
```