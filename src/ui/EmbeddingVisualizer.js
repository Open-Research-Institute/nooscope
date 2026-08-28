import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getColorForSource } from '../shared/sourceColors.js';
import { computeBounds, renderReachOnlyMask } from '../services/densityDiff.js';

export class EmbeddingVisualizer {
    constructor({ containerId }) {
        this.containerId = containerId;
        this.popup = null; // To hold the popup instance

        this.map = new maplibregl.Map({
            container: containerId,
            renderWorldCopies: false,
            attributionControl: false,
            style: {
                version: 8,
                glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
                sources: {},
                layers: [] // Layers will be added dynamically based on theme
            },
            center: [0, 0],
            zoom: 1
        });

        // MapLibre's 'load' event fires exactly once; a listener registered after it already
        // fired never gets called, so render() can't gate on `.once('load', ...)` more than
        // once. Track "has loaded at least once" ourselves instead. Note this is deliberately
        // NOT the same thing as map.isStyleLoaded(), which also goes false any time the style
        // has transient pending work (e.g. fetching a new glyph range while panning) — gating
        // on that instead caused an infinite microtask loop (each deferral re-checked, was
        // still transiently "not loaded", deferred again, forever).
        this._loaded = false;
        this._ready = new Promise((resolve) => {
            this.map.on('load', () => {
                this._setupBackground();
                this._setupInitialLayers();

                // Handle clicking on a point to open the post
                this.map.on('click', 'points-circles', (e) => {
                    if (e.features?.[0]?.properties?.url) {
                        window.open(e.features[0].properties.url, '_blank', 'noopener,noreferrer');
                    }
                });

                // Change cursor and show popup on hover, but not for points
                // greyed out by the search filter (match === false). Sort order
                // puts matched points above grey ones, but scan e.features rather
                // than trusting index 0 as an extra safeguard against a grey point
                // still winning the hover hit-test.
                this.map.on('mouseenter', 'points-circles', (e) => {
                    console.log(e)
                    const feature = e.features.find(f => f.properties.match !== false);
                    if (!feature) return;
                    this.map.getCanvas().style.cursor = 'pointer';
                    this._createPopup(e.lngLat, feature.properties);
                });
                this.map.on('mouseleave', 'points-circles', () => {
                    this.map.getCanvas().style.cursor = '';
                    this._removePopup();
                });

                this._loaded = true;
                resolve();
            });
        });
    }

    _setupBackground() {
        if (!this.map || !this.map.isStyleLoaded()) return;

        this.map.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': '#f1f5f9' } // slate-100
        }, this.map.getStyle().layers[0]?.id); // Add it at the bottom
    }

    getMapInstance = () => this.map;

    _createPopup(coordinates, properties) {
        this._removePopup(); // Remove any existing popup

        let timestampHtml = '';
        if (properties.timestamp) {
            try {
                const date = new Date(properties.timestamp);
                const formattedDate = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                timestampHtml = `<span class="popup-timestamp">${formattedDate}</span>`;
            } catch (e) { /* ignore invalid date */ }
        }

        const authorName = properties.author ?? 'Unknown';
        const avatarHtml = `<div class="popup-avatar-placeholder">${authorName.charAt(0).toUpperCase()}</div>`;

        const popupContent = `
            <div class="post-popup-content">
                <div class="popup-header-row">
                    <div class="popup-avatar-container">
                        ${avatarHtml}
                    </div>
                    <div class="popup-meta">
                        <strong class="popup-author">@${authorName}</strong>
                        ${timestampHtml}
                    </div>
                </div>
                <div class="popup-body">${properties.text}</div>
                <div class="popup-footer">
                    <span class="popup-likes">❤️ ${properties.likes}</span>
                </div>
            </div>
        `;

        this.popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'post-popup',
            maxWidth: '320px',
            offset: 15
        })
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(this.map);
    }

    _removePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    _setupInitialLayers() {
        this.map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addSource('highlight-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        const pointLabelTextColor = '#0f172a'; // slate-900
        const pointLabelHaloColor = 'rgba(255, 255, 255, 0.9)';

        this.map.addLayer({
            id: 'point-labels',
            type: 'symbol',
            source: 'points',
            minzoom: 3,
            layout: {
                'text-field': ['get', 'text'],
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': ['+', 1.0, ['*', 0.1, ['log10', ['+', 1, ['coalesce', ['get', 'likes'], 0]]]]],
                'text-justify': 'auto',
                'text-size': 12,
                'symbol-sort-key': ['*', -1, ['coalesce', ['get', 'likes'], 0]],
                'text-allow-overlap': false,
                'text-ignore-placement': false
            },
            paint: { 'text-color': pointLabelTextColor, 'text-halo-color': pointLabelHaloColor, 'text-halo-width': 1 }
        });

        this.map.addLayer({
            id: 'highlight-point-circle', type: 'circle', source: 'highlight-point',
            paint: {
                'circle-radius': 18,
                'circle-color': 'rgba(0,0,0,0)',
                'circle-stroke-width': 4,
                'circle-stroke-color': '#0ea5e9' // sky-500
            }
        });
    }

    // Colors come from the label + the total source count (via getColorForSource,
    // see src/shared/sourceColors.js — edit SOURCE_COLOR_PALETTE there to customize),
    // not from which labels happen to be present in the current (possibly filtered/
    // hidden) view — otherwise a source's color would shift whenever another source
    // gets hidden or filtered out.
    _generateColorScale(labels, sourceCount) {
        const uniqueLabels = [...new Set(labels)];
        const colorScale = ['match', ['get', 'cluster_label']];
        uniqueLabels.forEach(label => {
            colorScale.push(label, getColorForSource(label, sourceCount));
        });
        colorScale.push('#0f172a'); // Fallback
        return colorScale;
    }

    // sourceOrder: source labels bottom-to-top (see appState.sourceOrder). Maps each
    // point's cluster_label to its position in that order, for use as the dominant term
    // of the circle-sort-key expression above.
    _generateSourceRankExpression(sourceOrder) {
        if (sourceOrder.length === 0) return 0; // 'match' requires at least one pair
        const rankExpr = ['match', ['get', 'cluster_label']];
        sourceOrder.forEach((label, rank) => rankExpr.push(label, rank));
        rankExpr.push(0); // Fallback rank for a label not in sourceOrder
        return rankExpr;
    }

    render(pointsData, twoDimCoords, labels, sourceCount, areLabelsVisible, shouldFitBounds = false, searchQuery = '', searchCaseSensitive = false, showPoints = true, sourceOrder = []) {
        if (!this._loaded) {
            this._ready.then(() => this.render(pointsData, twoDimCoords, labels, sourceCount, areLabelsVisible, shouldFitBounds, searchQuery, searchCaseSensitive, showPoints, sourceOrder));
            return;
        }
        if (twoDimCoords.length === 0) return;

        // Search never filters or re-fits the map — it just dims (greys out + lowers
        // opacity) points that don't match, so the view stays put as you type. The query
        // is treated as a regex; an invalid pattern matches nothing rather than
        // throwing, since the user may still be mid-edit.
        const query = (searchQuery || '').trim();
        let searchRegex = null;
        if (query) {
            try { searchRegex = new RegExp(query, searchCaseSensitive ? '' : 'i'); } catch { searchRegex = null; }
        }

        const geojson = {
            type: "FeatureCollection", features: pointsData.map((point, i) => ({
                type: "Feature", geometry: { type: "Point", coordinates: [twoDimCoords[i][0], twoDimCoords[i][1]] },
                properties: {
                    text: point.content,
                    author: point.author,
                    timestamp: point.timestamp,
                    likes: point.likes || 0,
                    url: point.url,
                    cluster_label: labels[i],
                    match: searchRegex ? (searchRegex.test(point.content || '') || searchRegex.test(point.author || '')) : true,
                }
            }))
        };
        this.map.getSource('points').setData(geojson);

        // Remove the layer to refresh it if needed, but here we just ensure it exists
        if (this.map.getLayer('points-circles')) this.map.removeLayer('points-circles');

        const radiusExpression = ['+', 5, ['*', 3, ['log10', ['+', 1, ['coalesce', ['get', 'likes'], 0]]]]];

        const isMatch = ['get', 'match'];
        const colorExpression = query
            ? ['case', isMatch, this._generateColorScale(labels, sourceCount), '#cbd5e1']
            : this._generateColorScale(labels, sourceCount);
        const opacityExpression = query ? ['case', isMatch, 1, 0.25] : 1;

        this.map.addLayer({
            id: 'points-circles', type: 'circle', source: 'points',
            // Source order dominates the sort key (1e8 per rank step dwarfs the match/likes
            // terms below it), so which source is "on top" is decided by the source list's
            // ordering first — matched-vs-greyed-out and likes only break ties within a
            // source. Matched points still sort above greyed-out ones (the +1e6 offset is a
            // no-op when there's no search query, since `match` is true for everyone then),
            // so a grey point never visually — or for hover hit-testing — sits on top of a
            // matched point underneath it.
            layout: { 'circle-sort-key': ['+', ['*', 1e8, this._generateSourceRankExpression(sourceOrder)], ['case', isMatch, 1e6, 0], ['coalesce', ['get', 'likes'], 0]] },
            paint: {
                //'circle-radius': radiusExpression,
                'circle-color': colorExpression,
                'circle-opacity': opacityExpression,
            }
        }, 'point-labels');

        this.map.setLayoutProperty('points-circles', 'visibility', showPoints ? 'visible' : 'none');

        if (this.map.getLayer('point-labels')) {
            this.map.setLayoutProperty('point-labels', 'visibility', (showPoints && areLabelsVisible) ? 'visible' : 'none');
            // Push the text label out past the circle radius, with a small gap.
            // text-radial-offset is in ems, and point-labels' text-size is 12px.
            this.map.setLayoutProperty('point-labels', 'text-radial-offset', ['/', ['+', radiusExpression, 4], 12]);
            this.map.setPaintProperty('point-labels', 'text-opacity', opacityExpression);
        }

        if (shouldFitBounds) {
            const bounds = new maplibregl.LngLatBounds();
            twoDimCoords.forEach(coord => bounds.extend(coord));

            this.map.resize();
            if (!bounds.isEmpty()) {
                this.map.fitBounds(bounds, { padding: 50, maxZoom: 8, duration: 1000 }); // Added duration
            }
        }
    }

    highlightPoint(coords) {
        if (!this._loaded) {
            this._ready.then(() => this.highlightPoint(coords));
            return;
        }
        const source = this.map.getSource('highlight-point');
        if (!source) return;

        if (!coords) {
            source.setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        source.setData({
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                geometry: { type: "Point", coordinates: coords },
                properties: {}
            }]
        });

        this.map.flyTo({
            center: coords,
            zoom: 6.5,
            speed: 2.5,
            curve: 1,
            essential: true
        });
    }

    // "Negative space" overlay: a hard-edged, flat-opacity shape covering
    // wherever a coordsA point is within a fixed radius and no coordsB point
    // is — a literal radius check, not a density gradient. See
    // src/services/densityDiff.js.
    showDensityDiff(coordsA, coordsB, color = '#0f172a') {
        if (!this._loaded) {
            this._ready.then(() => this.showDensityDiff(coordsA, coordsB, color));
            return;
        }
        if (coordsA.length === 0) {
            this.hideDensityDiff();
            return;
        }

        const bounds = computeBounds([coordsA, coordsB]);
        const canvas = renderReachOnlyMask(coordsA, coordsB, bounds, { color });

        const coordinates = [
            [bounds.minX, bounds.maxY],
            [bounds.maxX, bounds.maxY],
            [bounds.maxX, bounds.minY],
            [bounds.minX, bounds.minY],
        ];

        const existing = this.map.getSource('density-diff');
        if (existing) {
            existing.updateImage({ url: canvas.toDataURL(), coordinates });
        } else {
            this.map.addSource('density-diff', { type: 'image', url: canvas.toDataURL(), coordinates });
            // Sit below points-circles (points stay legible on top) but above
            // the plain background. points-circles is removed/re-added on
            // every render() call, always reinserted right before
            // point-labels, so anchoring here (rather than to points-circles
            // itself) keeps this layer's position stable across re-renders.
            const beforeId = this.map.getLayer('points-circles') ? 'points-circles' : 'point-labels';
            this.map.addLayer({
                id: 'density-diff-layer', type: 'raster', source: 'density-diff',
                // Opacity is already baked into the mask's pixel alpha, and
                // 'nearest' keeps the radius-check edge crisp instead of
                // blurring it on zoom — this is meant to read as a hard
                // black/transparent shape, not a smooth gradient.
                paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest' }
            }, beforeId);
        }
    }

    hideDensityDiff() {
        if (!this._loaded) return;
        if (this.map.getLayer('density-diff-layer')) this.map.removeLayer('density-diff-layer');
        if (this.map.getSource('density-diff')) this.map.removeSource('density-diff');
    }

    togglePointLabels() {
        const layerId = 'point-labels';
        if (!this.map.getLayer(layerId)) return;
        const visibility = this.map.getLayoutProperty(layerId, 'visibility');
        const newVisibility = (visibility === 'visible' || visibility === undefined) ? 'none' : 'visible';
        this.map.setLayoutProperty(layerId, 'visibility', newVisibility);
        return newVisibility === 'visible';
    }
}
