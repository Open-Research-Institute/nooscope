// Renders emoji as MapLibre icon images instead of glyph text.
//
// MapLibre's text-field/glyphs pipeline draws monochrome glyphs baked from a
// font's vector outlines, fetched per-codepoint from a `glyphs` PBF server.
// Color emoji glyphs are usually bitmap/COLR data with no simple outline to
// extract, and most glyph servers (including the demotiles one this viewer
// uses) don't carry emoji Unicode ranges anyway — so text-field just renders
// tofu for emoji. Browsers already render color emoji correctly in <canvas>
// via native system font fallback, so instead: rasterize each distinct
// emoji once, register it as a MapLibre image, and reference it from an
// icon-image layer. That sidesteps the glyph pipeline entirely.

const EMOJI_TEST = /\p{Extended_Pictographic}/u;
const EMOJI_FONT_STACK = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';
const ICON_DISPLAY_SIZE = 24; // CSS px

let segmenter = null;
function firstGrapheme(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        const { value } = segmenter.segment(text)[Symbol.iterator]().next();
        return value?.segment ?? null;
    }
    // Fallback for environments without Intl.Segmenter: code-point-aware
    // (handles surrogate pairs) but not ZWJ/variation-selector sequences —
    // close enough for simple, single-codepoint emoji.
    return [...text][0] ?? null;
}

// Returns the leading emoji grapheme cluster if `text` starts with one
// (after trimming leading whitespace), else null.
export function extractLeadingEmoji(text) {
    if (!text) return null;
    const trimmed = text.trimStart();
    if (!trimmed) return null;
    const grapheme = firstGrapheme(trimmed);
    return grapheme && EMOJI_TEST.test(grapheme) ? grapheme : null;
}

function iconIdFor(emoji) {
    const codepoints = [...emoji].map(ch => ch.codePointAt(0).toString(16)).join('-');
    return `emoji-icon-${codepoints}`;
}

function rasterizeEmoji(emoji, pixelRatio) {
    const size = ICON_DISPLAY_SIZE * pixelRatio;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${Math.round(size * 0.8)}px ${EMOJI_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Small downward nudge — emoji glyphs tend to sit visually high when
    // centered purely by font metrics.
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
    return ctx.getImageData(0, 0, size, size);
}

// Lazily rasterizes and registers emoji as MapLibre images on a given map.
// One instance per map — icons persist for the map's lifetime; there's only
// ever a handful of distinct emoji in practice, so no eviction is needed.
export class EmojiIconRegistry {
    constructor(map) {
        this.map = map;
        this._registered = new Set();
    }

    // Returns the icon id to use in an `icon-image` expression, registering
    // the rasterized image on first use.
    ensureIcon(emoji) {
        const id = iconIdFor(emoji);
        if (this._registered.has(id) || this.map.hasImage(id)) return id;
        const pixelRatio = window.devicePixelRatio || 1;
        this.map.addImage(id, rasterizeEmoji(emoji, pixelRatio), { pixelRatio });
        this._registered.add(id);
        return id;
    }
}
