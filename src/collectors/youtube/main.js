import { parseYoutubeVideoUrl, fetchAllCommentsForVideo } from './api.js';
import { commentsToMessages } from './commentsToMessages.js';
import { createContext } from '../../shared/message-format.js';

const KEY_STORAGE = 'noscope:youtube-api-key';

window.addEventListener('load', () => {
    const form = document.getElementById('import-form');
    const input = document.getElementById('video-url-input');
    const keyInput = document.getElementById('api-key-input');
    const runBtn = document.getElementById('run-btn');
    const statusArea = document.getElementById('status-area');
    const resultArea = document.getElementById('result-area');
    const downloadLink = document.getElementById('download-btn');

    const slug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export';

    keyInput.value = localStorage.getItem(KEY_STORAGE) || '';
    keyInput.addEventListener('input', () => {
        localStorage.setItem(KEY_STORAGE, keyInput.value.trim());
    });

    // A real <a href download> (not a click handler) so right-click -> "Save Link As..." works too.
    const offerDownload = (exportData, videoTitle, channelTitle) => {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const wordsSlug = videoTitle ? slug(videoTitle).split('-').filter(Boolean).slice(0, 2).join('-') : '';
        const count = exportData.messages.length;
        const channelSlug = slug(channelTitle);
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = `youtube-${channelSlug}-${wordsSlug ? wordsSlug + '-' : ''}${count}.json`;
        downloadLink.classList.remove('hidden');
    };

    const runImport = async (url) => {
        downloadLink.classList.add('hidden');
        resultArea.textContent = '';

        const apiKey = keyInput.value.trim();
        if (!apiKey) {
            statusArea.textContent = 'Paste your YouTube API key above first.';
            return;
        }

        const onProgress = (message) => {
            statusArea.textContent = message;
            console.log('[youtube collector]', message);
        };
        onProgress('Fetching comments...');

        let videoId;
        try {
            videoId = parseYoutubeVideoUrl(url);
        } catch (err) {
            statusArea.textContent = `Error: ${err.message}`;
            return;
        }

        try {
            const { video, threads } = await fetchAllCommentsForVideo(videoId, apiKey, onProgress);
            const messages = commentsToMessages({ video, threads });
            const context = createContext({ collector: 'youtube', source: url });
            const exportData = { context, messages };
            statusArea.textContent = `Done — ${messages.length} messages.`;
            resultArea.textContent = JSON.stringify(exportData, null, 2);
            offerDownload(exportData, video.snippet.title, video.snippet.channelTitle);
        } catch (err) {
            statusArea.textContent = `Error: ${err.message}`;
            console.error(err);
        }
    };

    // Nothing runs on load, even if ?import= and a saved key are both present — only an
    // explicit Run click triggers a fetch (this hits the YouTube API quota, unlike the
    // read-only Bluesky/Twitter collectors, so it shouldn't fire silently on page load).
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
    statusArea.textContent = keyInput.value ? 'Ready — click Run.' : 'Paste your YouTube API key above, then click Run.';
});
