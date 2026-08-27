export class AppState {
    constructor() {
        this.visualizationName = "Untitled Visualization";
        this.allItems = [];
        this.data2D = [];
        this.arePointLabelsVisible = true;
        this.searchQuery = '';

        // Which input file each item in allItems came from (parallel array).
        this.sourceLabels = [];
        // Descriptors for each input file: { id, label, collector, source, fileName }
        this.sources = [];
        // Per-source customizations, keyed directly by sourceLabel: { name, visible }
        this.customizations = new Map();

        // Date range state
        this.globalMinDate = 0;
        this.globalMaxDate = 0;
        this.currentStartDate = 0;
        this.currentEndDate = 0;
    }

    // --- GETTERS ---
    getVisualizationName = () => this.visualizationName;
    getAllItems = () => this.allItems;
    getData2D = () => this.data2D;
    getLabels = () => this.sourceLabels;
    getArePointLabelsVisible = () => this.arePointLabelsVisible;
    getSources = () => this.sources;
    getSourceCount = () => this.sources.length;
    getSearchQuery = () => this.searchQuery;

    getTimeRange = () => ({
        globalMin: this.globalMinDate,
        globalMax: this.globalMaxDate,
        currentStart: this.currentStartDate,
        currentEnd: this.currentEndDate
    });

    // --- SETTERS & STATE MODIFIERS ---
    setVisualizationName = (name) => { this.visualizationName = name; };
    setArePointLabelsVisible = (isVisible) => { this.arePointLabelsVisible = isVisible; };
    setSearchQuery = (query) => { this.searchQuery = (query || '').trim().toLowerCase(); };

    setTimeRange(start, end) {
        this.currentStartDate = start;
        this.currentEndDate = end;
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
        this.searchQuery = '';

        // Calculate global date range
        let minTime = Infinity;
        let maxTime = -Infinity;
        let hasTime = false;

        this.allItems.forEach(item => {
            if (item.timestamp) {
                const t = new Date(item.timestamp).getTime();
                if (!isNaN(t)) {
                    if (t < minTime) minTime = t;
                    if (t > maxTime) maxTime = t;
                    hasTime = true;
                }
            }
        });

        if (hasTime) {
            this.globalMinDate = minTime;
            this.globalMaxDate = maxTime;
            this.currentStartDate = minTime;
            this.currentEndDate = maxTime;
        } else {
            this.globalMinDate = 0;
            this.globalMaxDate = 100;
            this.currentStartDate = 0;
            this.currentEndDate = 100;
        }
    }

    /**
     * Calculates histogram bins for the timeline.
     * @param {number} binCount Number of bars in the histogram
     * @returns {number[]} Array of counts per bin
     */
    getHistogramData(binCount = 60) {
        if (!this.allItems.length || this.globalMaxDate <= this.globalMinDate) {
            return new Array(binCount).fill(0);
        }

        const range = this.globalMaxDate - this.globalMinDate;
        const bins = new Array(binCount).fill(0);

        this.allItems.forEach(item => {
            if (!item.timestamp) return;
            const t = new Date(item.timestamp).getTime();
            if (isNaN(t)) return;

            // Calculate bin index
            let i = Math.floor(((t - this.globalMinDate) / range) * binCount);

            // Clamp to last bin if exactly on max date
            i = Math.min(i, binCount - 1);
            i = Math.max(i, 0); // Safety check

            bins[i]++;
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

            let itemTime = 0;
            if (item.timestamp) {
                itemTime = new Date(item.timestamp).getTime();
            }
            const isValidTime = !isNaN(itemTime) && itemTime > 0;
            // Items without a valid timestamp are always kept, regardless of time range.
            if (isValidTime && (itemTime < this.currentStartDate || itemTime > this.currentEndDate)) return;

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
}
