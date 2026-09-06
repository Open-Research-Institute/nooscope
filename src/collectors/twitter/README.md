# Twitter / X

**Capture method:** bookmarklet only (`Postscope`, built from `src/bookmarklet.js` +
`scraper.js` via `scripts/build-bookmarklet.mjs`, published from `index.html`). No
manual-URL mode — X has no public read API this project uses, so scraping happens by
running JS against the logged-in DOM.

Long term this should switch to listening to the GraphQL network requests like in https://github.com/ri72miieop/community-archive-stream. 

**Supported pages:** single post, home timeline, profile (tweets/replies/likes),
search, bookmarks, lists, communities (including a profile's communities tab).

**Known limitations:**
- **Threading is flat.** The DOM gives no reliable reply-to marker, so every captured
  reply is parented directly to the root post instead of to the tweet it actually
  replied to. See `twitter_threading_limitation` in project memory — a GraphQL-based
  approach (`ri72miieop/community-archive-stream`) could fix this properly later.