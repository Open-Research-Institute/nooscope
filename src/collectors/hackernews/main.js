import { fetchThreadForUrl } from './api.js';
import { threadToMessages } from './threadToMessages.js';
import { createContext } from '../../shared/message-format.js';

window.addEventListener('load', () => {
    const form = document.getElementById('import-form');
    const input = document.getElementById('thread-url-input');
    const runBtn = document.getElementById('run-btn');
    const statusArea = document.getElementById('status-area');
    const resultArea = document.getElementById('result-area');
    const downloadLink = document.getElementById('download-btn');

    const slug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export';

    // A real <a href download> (not a click handler) so right-click -> "Save Link As..." works too.
    const offerDownload = (exportData) => {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const rootText = exportData.messages[0]?.text || '';
        const wordsSlug = rootText ? slug(rootText).split('-').filter(Boolean).slice(0, 3).join('-') : '';
        const count = exportData.messages.length;
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = `hackernews-${wordsSlug ? wordsSlug + '-' : ''}${count}.json`;
        downloadLink.classList.remove('hidden');
    };

    const runImport = async (url) => {
        downloadLink.classList.add('hidden');
        resultArea.textContent = '';

        const onProgress = (message) => {
            statusArea.textContent = message;
            console.log('[hackernews collector]', message);
        };
        onProgress('Fetching thread...');

        try {
            const thread = await fetchThreadForUrl(url, onProgress);
            const messages = threadToMessages(thread);
            const context = createContext({ collector: 'hackernews', source: url });
            const exportData = { context, messages };
            statusArea.textContent = `Done — ${messages.length} messages.`;
            resultArea.textContent = JSON.stringify(exportData, null, 2);
            offerDownload(exportData);
        } catch (err) {
            statusArea.textContent = `Error: ${err.message}`;
            console.error(err);
        }
    };

    // Nothing runs on load, even if ?import= is present — only an explicit Run click
    // triggers a fetch. A busy HN thread can mean thousands of item requests, so this
    // shouldn't fire silently on page load (same reasoning as the YouTube collector).
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = input.value.trim();
        if (!url) return;
        runBtn.disabled = true;
        runBtn.textContent = 'Running...';
        try {
            await runImport(url);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = 'Run';
        }
    });

    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get('import');
    if (!importUrl) return;
    input.value = importUrl;
    statusArea.textContent = 'Ready — click Run.';
});
