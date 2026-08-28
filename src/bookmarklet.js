// --- BOOKMARKLET LINK SETUP ---
// The actual scraper lives at src/collectors/twitter/scraper.js as a normal ES module
// (real imports, shares src/shared/message-format.js). `npm run build:bookmarklets`
// (also runs automatically before `dev`/`build`) bundles it into one flat, self-executing
// script (its own try/catch included) — that's the only shape a `javascript:` bookmarklet
// href can run, since there's no module loader available once it's injected into x.com's page.
import scraperCode from './generated/twitter-scraper.js?raw';

// One bookmarklet, dispatched by host: x.com/twitter.com can be scraped directly from the
// DOM, but bsky.app and youtube.com/youtu.be have nothing to scrape from — those collectors
// instead fetch via API from bluesky.html / youtube.html (src/collectors/*/main.js), so on
// those hosts this just hands the current URL to the matching page via ?import=.
//
// Resolved here — while this script runs on our own page — rather than from `location`
// inside the injected code below, where `location` would resolve to whatever page the
// bookmarklet was clicked on (x.com/bsky.app/youtube.com), not this app. Resolving relative
// to our own URL (matching the plain "bluesky.html"/"youtube.html" links elsewhere on this
// page, and the `base: './'` in vite.config.js) means it keeps working under a sub-path
// deployment, not just domain root, with no config needed — localhost:PORT in dev, the real
// domain (and path) once deployed.
const blueskyImportUrl = new URL('bluesky.html', window.location.href).href;
const youtubeImportUrl = new URL('youtube.html', window.location.href).href;
const dispatchCode = `if (location.hostname.indexOf('bsky.app') !== -1) {
    window.open('${blueskyImportUrl}?import=' + encodeURIComponent(location.href), '_blank');
} else if (location.hostname.indexOf('youtube.com') !== -1 || location.hostname.indexOf('youtu.be') !== -1) {
    window.open('${youtubeImportUrl}?import=' + encodeURIComponent(location.href), '_blank');
} else {
    ${scraperCode}
}`;

document.getElementById('bookmarklet').href = `javascript:${encodeURIComponent(dispatchCode)}`;
