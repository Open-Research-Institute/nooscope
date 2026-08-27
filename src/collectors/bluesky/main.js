import { fetchThreadForUrl, parseBlueskyPostUrl } from './api.js';
import { threadToMessages } from './threadToMessages.js';
import { createContext } from '../../shared/message-format.js';

window.addEventListener('load', () => {
    const form = document.getElementById('import-form');
    const input = document.getElementById('thread-url-input');
    const statusArea = document.getElementById('status-area');
    const resultArea = document.getElementById('result-area');
    const downloadLink = document.getElementById('download-btn');

    const slug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export';

    // A real <a href download> (not a click handler) so right-click -> "Save Link As..." works too.
    const offerDownload = (exportData, sourceUrl) => {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const rootText = exportData.messages[0]?.text || '';
        const wordsSlug = rootText ? slug(rootText).split('-').filter(Boolean).slice(0, 2).join('-') : '';
        const count = exportData.messages.length;
        const handle = parseBlueskyPostUrl(sourceUrl).actor.split('.')[0];
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = `bluesky-${handle}-${wordsSlug ? wordsSlug + '-' : ''}${count}.json`;
        downloadLink.classList.remove('hidden');
    };

    // Navigating (rather than fetching in place) makes ?import=<url> the one entry point,
    // usable by hand via this form or programmatically by linking straight to it.
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = input.value.trim();
        if (!url) return;
        window.location.href = `bluesky.html?import=${encodeURIComponent(url)}`;
    });

    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get('import');
    if (!importUrl) return;

    input.value = importUrl;
    statusArea.textContent = 'Fetching thread...';

    fetchThreadForUrl(importUrl)
        .then(thread => {
            const messages = threadToMessages(thread);
            const context = createContext({ collector: 'bluesky', source: importUrl });
            const exportData = { context, messages };
            statusArea.textContent = `Done — ${messages.length} messages.`;
            resultArea.textContent = JSON.stringify(exportData, null, 2);
            offerDownload(exportData, importUrl);
        })
        .catch(err => {
            statusArea.textContent = `Error: ${err.message}`;
            console.error(err);
        });
});
