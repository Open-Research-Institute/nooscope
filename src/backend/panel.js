import { createBackend, toDatasetName } from './client.js';

// Wires the #backend-panel in viewer.html to a backend Worker.
//   loadVisualization(data) – hands a file to the viewer (returns true if it loaded)
//   getCurrent()            – { data, title } of what's on screen, or null
export function setupBackendPanel({ backendUrl, initialDataset, loadVisualization, getCurrent, showLoading, showError }) {
    const backend = createBackend(backendUrl);

    const panel = document.getElementById('backend-panel');
    const select = document.getElementById('backend-dataset-select');
    const nameInput = document.getElementById('backend-save-name');
    const keyInput = document.getElementById('backend-key-input');
    const saveButton = document.getElementById('backend-save-button');
    const status = document.getElementById('backend-status');
    const copyButton = document.getElementById('backend-copy-link');

    // tone: 'info' (grey), 'ok' (green), 'error' (red)
    const TONES = { info: 'text-slate-600', ok: 'text-green-600', error: 'text-red-600' };
    function setStatus(message, tone = 'info') {
        status.textContent = message;
        status.classList.remove(...Object.values(TONES));
        status.classList.add(TONES[tone]);
    }

    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            copyButton.textContent = 'Copied!';
        } catch {
            copyButton.textContent = 'Copy failed: copy it from the address bar';
        }
        setTimeout(() => { copyButton.textContent = 'Copy share link'; }, 2000);
    });

    panel.classList.remove('hidden');
    document.getElementById('backend-url').textContent = backend.url;
    keyInput.value = backend.getSavedKey();
    keyInput.addEventListener('input', () => backend.setSavedKey(keyInput.value.trim()));

    // Keep ?dataset= in the address bar so the current URL is the share link.
    function setUrlDataset(name) {
        const params = new URLSearchParams(window.location.search);
        if (name) params.set('dataset', name); else params.delete('dataset');
        // ":" and "/" are legal in a query string, so un-escape them for a readable
        // share link. Everything else (&, =, %, spaces) stays encoded.
        const query = params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/');
        history.replaceState(null, '', `${window.location.pathname}?${query}`);
        copyButton.classList.toggle('hidden', !name);
    }

    async function refreshList(selected) {
        select.innerHTML = '<option value="">Loading…</option>';
        try {
            const datasets = await backend.list();
            select.innerHTML = datasets.length
                ? '<option value="">— choose —</option>'
                : '<option value="">(no datasets saved yet)</option>';
            for (const d of datasets) {
                const option = document.createElement('option');
                option.value = d.name;
                const count = d.pointCount ? ` · ${d.pointCount} posts` : '';
                option.textContent = `${d.title || d.name}${count}`;
                select.appendChild(option);
            }
            select.value = selected || '';
        } catch (err) {
            select.innerHTML = '<option value="">(could not list datasets)</option>';
            setStatus(err.message, 'error');
        }
    }

    async function open(name) {
        showLoading(`Loading "${name}" from ${backend.url}...`);
        try {
            if (loadVisualization(await backend.load(name))) {
                setUrlDataset(name);
                nameInput.value = name;
            }
        } catch (err) {
            showError(`Could not load "${name}" from the backend: ${err.message}`);
        }
    }

    select.addEventListener('change', () => { if (select.value) open(select.value); });

    saveButton.addEventListener('click', async () => {
        const current = getCurrent();
        if (!current) { setStatus('Load a visualization first (choose a file or drop one in).', 'error'); return; }

        const name = toDatasetName(nameInput.value || current.title);
        const key = keyInput.value.trim();
        if (!name) { setStatus('Give the dataset a name.', 'error'); return; }
        if (!key) { setStatus('Paste the write key first.', 'error'); return; }

        saveButton.disabled = true;
        setStatus(`Saving "${name}"...`);
        try {
            await backend.save(name, current.data, { key, title: current.title });
            setUrlDataset(name);
            nameInput.value = name;
            setStatus(`Saved "${name}". Use "Copy share link" below to share it.`, 'ok');
            await refreshList(name);
        } catch (err) {
            setStatus(`Save failed: ${err.message}`, 'error');
        } finally {
            saveButton.disabled = false;
        }
    });

    refreshList(initialDataset);
    if (initialDataset) open(initialDataset);
}
