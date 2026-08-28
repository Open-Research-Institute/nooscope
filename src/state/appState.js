import { timeToPercent } from '../shared/logTimeScale.js';

export class AppState {
    constructor() {
        this.visualizationName = "Untitled Visualization";
        this.allItems = [];
        this.data2D = [];
        this.arePointLabelsVisible = false;
        this.searchQuery = '';
        this.isSearchCaseSensitive = false;

        // Which input file each item in allItems came from (parallel array).
        this.sourceLabels = [];
        // Descriptors for each input file: { id, label, collector, source, fileName }
        this.sources = [];
        // Per-source customizations, keyed directly by sourceLabel: { name, visible }
        this.customizations = new Map();
        // Source labels in z-order, bottom to top — index 0 draws first (bottom),
        // the last entry draws last (front-most on the map). Defaults to load order.
        this.sourceOrder = [];

        // Time range state. Normalized per source (each source's own first/last item maps
        // to 0%/100%) rather than by absolute date, so sources that started at wildly
        // different real times — a video from last year vs. a thread from yesterday —
        // become comparable by how far each has progressed through its own lifespan.
        // sourceLabel -> { min, max } (raw timestamps, ms).
        this.sourceTimeRanges = new Map();
        this.hasTimeData = false;
        this.currentStartPercent = 0;
        this.currentEndPercent = 100;
    }

    // --- GETTERS ---
    getVisualizationName = () => this.visualizationName;
    getAllItems = () => this.allItems;
    getData2D = () => this.data2D;
    getLabels = () => this.sourceLabels;
    getArePointLabelsVisible = () => this.arePointLabelsVisible;
    getSources = () => this.sources;
    getSourceCount = () => this.sources.length;
    getSourceOrder = () => this.sourceOrder;
    getSearchQuery = () => this.searchQuery;
    getIsSearchCaseSensitive = () => this.isSearchCaseSensitive;

    getTimeRange = () => ({
        hasTimeData: this.hasTimeData,
        currentStart: this.currentStartPercent,
        currentEnd: this.currentEndPercent,
    });

    // --- SETTERS & STATE MODIFIERS ---
    setVisualizationName = (name) => { this.visualizationName = name; };
    setArePointLabelsVisible = (isVisible) => { this.arePointLabelsVisible = isVisible; };
    setSearchQuery = (query, caseSensitive = false) => {
        this.searchQuery = (query || '').trim();
        this.isSearchCaseSensitive = caseSensitive;
    };

    setTimeRange(startPercent, endPercent) {
        this.currentStartPercent = startPercent;
        this.currentEndPercent = endPercent;
    }

    /**
     * An item's position, as a percent, through its own source's lifespan (log-scaled —
     * see shared/logTimeScale.js) — or null if it or its source has no valid timestamp.
     */
    getItemTimePercent(item, sourceLabel) {
        if (!item.timestamp) return null;
        const t = new Date(item.timestamp).getTime();
        if (isNaN(t)) return null;
        const range = this.sourceTimeRanges.get(sourceLabel);
        if (!range) return null;
        return timeToPercent(t, range.min, range.max);
    }

    /**
     * Loads a pipeline output file (see src/pipeline/project.mjs): { version,
     * sources, points }. This is the viewer's only data entry point — no
     * embedding, no analysis, just what it's given.
     */
    loadFromPipelineOutput(data) {
        this.sources = data.sources || [];
        this.allItems = (data.points || []).map(p => ({
            content: p.text,
            author: p.author,
            timestamp: p.timestamp,
            likes: p.likes || 0,
            url: p.url,
            sourceIndex: p.sourceId,
        }));
        this.data2D = (data.points || []).map(p => [p.x, p.y]);
        this.sourceLabels = this.allItems.map(item => item.sourceIndex ?? 0);
        this.customizations = new Map();
        this.sourceOrder = this.sources.map((_, i) => i);
        this.searchQuery = '';

        // Per-source time range, for the normalization described above.
        this.sourceTimeRanges = new Map();
        this.hasTimeData = false;

        this.allItems.forEach((item, i) => {
            if (!item.timestamp) return;
            const t = new Date(item.timestamp).getTime();
            if (isNaN(t)) return;
            this.hasTimeData = true;

            const sourceLabel = this.sourceLabels[i];
            const range = this.sourceTimeRanges.get(sourceLabel);
            if (!range) {
                this.sourceTimeRanges.set(sourceLabel, { min: t, max: t });
            } else {
                if (t < range.min) range.min = t;
                if (t > range.max) range.max = t;
            }
        });

        this.currentStartPercent = 0;
        this.currentEndPercent = 100;
    }

    /**
     * Calculates histogram bins for the timeline.
     * @param {number} binCount Number of bars in the histogram
     * @returns {number[]} Array of counts per bin
     */
    getHistogramData(binCount = 60) {
        if (!this.hasTimeData) {
            return new Array(binCount).fill(0);
        }

        const bins = new Array(binCount).fill(0);

        this.allItems.forEach((item, i) => {
            const percent = this.getItemTimePercent(item, this.sourceLabels[i]);
            if (percent === null) return;

            let bin = Math.floor((percent / 100) * binCount);
            // Clamp to last bin if exactly on the source's max date
            bin = Math.min(bin, binCount - 1);
            bin = Math.max(bin, 0); // Safety check

            bins[bin]++;
        });

        return bins;
    }

    /**
     * Returns subsets of items, coords, and labels: within the selected time range
     * and belonging to a currently-visible source. Maintains parallel array
     * structure. Search does NOT filter here — it only dims non-matching points
     * (see EmbeddingVisualizer.render), so the map view never jumps/refits as you
     * type.
     */
    getFilteredData() {
        const items = [];
        const coords = [];
        const labels = [];

        this.allItems.forEach((item, i) => {
            const sourceLabel = this.sourceLabels[i];
            if (this.customizations.get(sourceLabel)?.visible === false) return;

            const percent = this.getItemTimePercent(item, sourceLabel);
            // Items without a valid timestamp are always kept, regardless of time range.
            if (percent !== null && (percent < this.currentStartPercent || percent > this.currentEndPercent)) return;

            items.push(item);
            coords.push(this.data2D[i]);
            labels.push(sourceLabel);
        });

        return { items, coords, labels };
    }

    getDefaultGroupName(label) {
        return this.sources[label]?.label ?? `Source ${label + 1}`;
    }

    /**
     * Returns the customization for a source label, creating a default one on first access.
     */
    getCustomization(label) {
        let customization = this.customizations.get(label);
        if (!customization) {
            customization = { name: this.getDefaultGroupName(label), visible: true };
            this.customizations.set(label, customization);
        }
        return customization;
    }

    setSourceName(label, newName) {
        this.getCustomization(label).name = newName;
    }

    setSourceVisibility(label, isVisible) {
        this.getCustomization(label).visible = isVisible;
    }

    // direction: +1 moves the source one step toward the front (top of the map stack),
    // -1 moves it one step toward the back. No-op at either end of the order.
    moveSourceInOrder(label, direction) {
        const i = this.sourceOrder.indexOf(label);
        const j = i + direction;
        if (i === -1 || j < 0 || j >= this.sourceOrder.length) return;
        [this.sourceOrder[i], this.sourceOrder[j]] = [this.sourceOrder[j], this.sourceOrder[i]];
    }
}
