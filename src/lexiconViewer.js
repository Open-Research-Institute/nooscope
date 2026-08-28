// Super basic viewer for lexicon.json (src/pipeline/lexicon.mjs output) —
// see docs/linguistic-diversity.md. Loads via ?data=<url>, drag/drop, or a
// file picker, same as viewer.html.

const emptyState = document.getElementById('empty-state');
const statusArea = document.getElementById('status-area');
const content = document.getElementById('lexicon-content');
const loadFileInput = document.getElementById('load-file-input');

function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showStatus(message, isError = false) {
    statusArea.textContent = message;
    statusArea.className = `mt-4 text-center ${isError ? 'text-red-600 font-medium' : 'text-slate-500'}`;
}

function sourceLabel(sources, id) {
    return sources.find((s) => s.id === id)?.label ?? `#${id}`;
}

function renderOverview(sources, range) {
    const rows = sources.map((source) => {
        const r = range.find((x) => x.sourceId === source.id);
        const rangeCell = r?.insufficientData
            ? `<span class="text-amber-600" title="fewer than the rarefaction target's worth of tokens">insufficient data</span>`
            : (r?.rangeScore ?? '—');
        return `
            <tr class="border-t border-slate-200">
                <td class="px-3 py-2 font-medium text-slate-800">${esc(source.label)}</td>
                <td class="px-3 py-2 text-slate-500">${esc(source.collector)}</td>
                <td class="px-3 py-2 text-right">${esc(source.tokenCount)}</td>
                <td class="px-3 py-2 text-right">${esc(source.vocabSize)}</td>
                <td class="px-3 py-2 text-right font-semibold text-sky-700">${rangeCell}</td>
            </tr>`;
    }).join('');

    return `
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-bold text-slate-800 px-4 pt-4">Sources</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-sm mt-2">
                    <thead>
                        <tr class="text-left text-xs uppercase tracking-wide text-slate-400">
                            <th class="px-3 py-2">Source</th>
                            <th class="px-3 py-2">Collector</th>
                            <th class="px-3 py-2 text-right">Tokens</th>
                            <th class="px-3 py-2 text-right">Vocab size</th>
                            <th class="px-3 py-2 text-right">Range score</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
}

function renderOverlap(sources, overlap) {
    if (overlap.length === 0) return '';
    const rows = overlap
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((pair) => `
            <tr class="border-t border-slate-200">
                <td class="px-3 py-2 font-medium text-slate-800">${esc(sourceLabel(sources, pair.a))}</td>
                <td class="px-3 py-2 font-medium text-slate-800">${esc(sourceLabel(sources, pair.b))}</td>
                <td class="px-3 py-2 text-right font-semibold text-sky-700">${esc(pair.score)}</td>
            </tr>`)
        .join('');

    return `
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-bold text-slate-800 px-4 pt-4">Overlap</h2>
            <p class="px-4 text-sm text-slate-500">Morisita–Horn index, 0 = disjoint vocabularies, 1 = identical relative-frequency distributions.</p>
            <div class="overflow-x-auto">
                <table class="w-full text-sm mt-2">
                    <thead>
                        <tr class="text-left text-xs uppercase tracking-wide text-slate-400">
                            <th class="px-3 py-2">Source A</th>
                            <th class="px-3 py-2">Source B</th>
                            <th class="px-3 py-2 text-right">Overlap</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
}

function renderNgramTable(title, rows, limit = 25) {
    const body = rows.slice(0, limit).map((row) => `
        <tr class="border-t border-slate-100">
            <td class="px-2 py-1 text-slate-800">${esc(row.ngram)}</td>
            <td class="px-2 py-1 text-right text-slate-500">${esc(row.count)}</td>
            <td class="px-2 py-1 text-right text-slate-400">${esc(row.per1k)}</td>
        </tr>`).join('');

    return `
        <div>
            <h3 class="text-sm font-semibold text-slate-600 mb-1">${esc(title)}</h3>
            <div class="border border-slate-200 rounded-lg overflow-hidden">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="text-left text-slate-400 bg-slate-50">
                            <th class="px-2 py-1 font-medium">n-gram</th>
                            <th class="px-2 py-1 font-medium text-right">count</th>
                            <th class="px-2 py-1 font-medium text-right">/1k tok</th>
                        </tr>
                    </thead>
                    <tbody>${body || `<tr><td class="px-2 py-2 text-slate-400" colspan="3">no data</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
}

function renderSourceNgrams(source, ngrams) {
    const tableFor = (n) => ngrams.find((g) => g.sourceId === source.id && g.n === n)?.top ?? [];
    return `
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
            <h2 class="text-lg font-bold text-slate-800 mb-3">${esc(source.label)}</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                ${renderNgramTable('Unigrams', tableFor(1))}
                ${renderNgramTable('Bigrams', tableFor(2))}
                ${renderNgramTable('Trigrams', tableFor(3))}
            </div>
        </section>`;
}

function renderLexicon(data) {
    const { sources = [], range = [], overlap = [], ngrams = [] } = data;

    content.innerHTML = [
        renderOverview(sources, range),
        renderOverlap(sources, overlap),
        ...sources.map((source) => renderSourceNgrams(source, ngrams)),
    ].join('');

    emptyState.classList.add('hidden');
    content.classList.remove('hidden');
}

function loadFromData(data) {
    try {
        renderLexicon(data);
        showStatus('');
    } catch (err) {
        showStatus(`Could not render lexicon data: ${err.message}`, true);
    }
}

async function loadFromFile(file) {
    try {
        loadFromData(JSON.parse(await file.text()));
    } catch (err) {
        showStatus(`Could not read "${file.name}": ${err.message}`, true);
    }
}

async function loadFromUrl(url) {
    showStatus(`Loading ${url}...`);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        loadFromData(await response.json());
    } catch (err) {
        showStatus(`Could not load "${url}": ${err.message}`, true);
    }
}

loadFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadFromFile(file);
    e.target.value = null;
});

['dragenter', 'dragover'].forEach((eventName) => {
    document.body.addEventListener(eventName, (e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    });
});
document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFromFile(file);
});

const dataUrl = new URLSearchParams(window.location.search).get('data');
if (dataUrl) loadFromUrl(dataUrl);
