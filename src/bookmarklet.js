// --- BOOKMARKLET LINK SETUP ---
// The actual scraper lives at src/collectors/twitter/scraper.js as a normal ES module
// (real imports, shares src/shared/message-format.js). `npm run build:bookmarklets`
// (also runs automatically before `dev`/`build`) bundles it into one flat, self-executing
// script (its own try/catch included) — that's the only shape a `javascript:` bookmarklet
// href can run, since there's no module loader available once it's injected into x.com's page.
import scraperCode from './generated/twitter-scraper.js?raw';

document.getElementById('bookmarklet').href = `javascript:${encodeURIComponent(scraperCode)}`;
