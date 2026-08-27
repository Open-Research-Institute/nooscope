import { AppState } from './state/appState.js';
import { UIController } from './ui/uiController.js';
import { EmbeddingVisualizer } from './ui/EmbeddingVisualizer.js';

document.addEventListener('DOMContentLoaded', () => {
    const appState = new AppState();
    const visualizer = new EmbeddingVisualizer({ containerId: 'visualization-container' });

    const emptyState = document.getElementById('empty-state');
    const loadFileInput = document.getElementById('load-file-input');
    const visualizationContainer = document.getElementById('visualization-container');

    const ui = new UIController({
        onSearchChange: (query) => {
            appState.setSearchQuery(query);
            // No fit-bounds — search dims non-matching points in place, it never
            // changes the map view.
            ui.render(appState, visualizer, false);
        },
        onTitleChange: (newName) => {
            appState.setVisualizationName(newName);
            ui.setVisualizationTitle(newName);
        },
        onNameChange: (label, newName) => {
            appState.setSourceName(label, newName);
            // Do NOT fit bounds on name change
            ui.render(appState, visualizer, false);
        },
        onVisibilityChange: (label, isVisible) => {
            appState.setSourceVisibility(label, isVisible);
            ui.render(appState, visualizer, false);
        },
        onToggleLabels: () => {
            const newVisibility = visualizer.togglePointLabels();
            appState.setArePointLabelsVisible(newVisibility);
            ui.updateToggleLabelsButton(newVisibility);
        },
        onPostSelect: (index) => {
            if (index === null) {
                visualizer.highlightPoint(null);
                return;
            }
            const coords = appState.getData2D()[index];
            if (coords) visualizer.highlightPoint(coords);
        },
        onTimeRangeChange: (start, end) => {
            appState.setTimeRange(start, end);
            ui.render(appState, visualizer, false);
        },
        getMapInstance: () => visualizer.getMapInstance()
    });

    function deriveTitle(sources) {
        if (!sources || sources.length === 0) return 'Untitled Visualization';
        if (sources.length === 1) return sources[0].label;
        return `${sources.length} sources: ${sources.map(s => s.label).join(', ')}`;
    }

    // The viewer's only data entry point: a pipeline output file
    // (see src/pipeline/project.mjs) — { version, sources, points }. No embedding,
    // no analysis, no session — it just renders whatever shape of data it's given.
    function loadVisualization(data) {
        if (!data || !Array.isArray(data.points) || !Array.isArray(data.sources)) {
            ui.showError('That file doesn’t look like a visualization output (expected { sources, points }).');
            return;
        }

        appState.loadFromPipelineOutput(data);

        const title = deriveTitle(appState.getSources());
        appState.setVisualizationName(title);
        ui.setVisualizationTitle(title);
        ui.setSourceInfo(appState.getSources(), appState.getAllItems().length);
        ui.initializeTimeline(appState);
        ui.render(appState, visualizer, true);
        ui.updateToggleLabelsButton(appState.getArePointLabelsVisible());

        const sourceCount = appState.getSourceCount();
        ui.hideLoading(`Loaded ${appState.getAllItems().length} posts from ${sourceCount} source${sourceCount === 1 ? '' : 's'}.`);
        ui.enableControls();

        emptyState.classList.add('hidden');
    }

    async function loadFromFile(file) {
        try {
            loadVisualization(JSON.parse(await file.text()));
        } catch (err) {
            ui.showError(`Could not read "${file.name}": ${err.message}`);
        }
    }

    async function loadFromUrl(url) {
        ui.showLoading(`Loading ${url}...`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            loadVisualization(await response.json());
        } catch (err) {
            ui.showError(`Could not load "${url}": ${err.message}`);
        }
    }

    loadFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFromFile(file);
        e.target.value = null;
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        visualizationContainer.addEventListener(eventName, (e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        });
    });
    visualizationContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) loadFromFile(file);
    });

    ui.disableControls();

    const dataUrl = new URLSearchParams(window.location.search).get('data');
    if (dataUrl) loadFromUrl(dataUrl);
});
