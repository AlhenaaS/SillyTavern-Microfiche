// Hybrid font layer for Microfiche: Spleen 5x8 for Latin (font.js) + unscii-8 for Cyrillic (font-wide.js).
// Latin keeps its fixed 5 px advance; wide glyphs are drawn at their ink width + 1 px of spacing.

import { GLYPH_W, GLYPH_H, GLYPHS } from './font.js';

import { GLYPHS_WIDE } from './font-wide.js';

const ROW_CACHE = new Map;

export function glyphRows(code) {
    const hex = GLYPHS[code] ?? GLYPHS_WIDE[code];
    if (hex === undefined) return null;
    let rows = ROW_CACHE.get(hex);
    if (!rows) {
        rows = new Uint8Array(GLYPH_H);
        for (let r = 0; r < GLYPH_H; r++) rows[r] = parseInt(hex.slice(r * 2, r * 2 + 2), 16);
        ROW_CACHE.set(hex, rows);
    }
    return rows;
}

export function glyphWidth(code) {
    if (GLYPHS[code] !== undefined) return GLYPH_W;
    const rows = glyphRows(code);
    if (!rows) return GLYPH_W;
    let ink = 0;
    for (let r = 0; r < GLYPH_H; r++) {
        const b = rows[r];
        for (let x = 0; x < 8; x++) if (b & (128 >> x)) ink = Math.max(ink, x + 1);
    }
    return Math.min(8, Math.max(3, ink + 1));
}
