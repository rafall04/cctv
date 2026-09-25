/*
 * Purpose: Pick a WCAG-contrasting foreground color for a given background hex.
 * Caller: BrandingContext (--primary-foreground var), meta-config pre-paint branding.
 * Deps: None (pure math).
 * MainFuncs: relativeLuminance, contrastRatio, pickContrastingForeground.
 * SideEffects: None.
 *
 * Why: --primary-color is admin-configurable branding, so a fixed "text-white on bg-primary"
 * fails WCAG AA whenever the brand color is light or saturated (prod's #fa3333 scored 3.75:1 —
 * a real Lighthouse color-contrast failure). Computing the foreground keeps buttons legible for
 * ANY brand color an operator picks.
 */

const ON_LIGHT = '#0b0e13'; // near-black token color used for bright/saturated primaries
const ON_DARK = '#ffffff';

/**
 * Relative luminance per WCAG 2.x (0 = black, 1 = white).
 * @param {number} r @param {number} g @param {number} b — 0..255
 */
export function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(hexA, hexB) {
    const [a, b] = [parseHex(hexA), parseHex(hexB)];
    if (!a || !b) return 1;
    const la = relativeLuminance(...a);
    const lb = relativeLuminance(...b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

/** Parse '#rgb' / '#rrggbb' (also tolerates a missing '#') into [r,g,b] or null. */
export function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) {
        h = h.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
    ];
}

/**
 * Choose the better AA foreground (near-black vs white) for a background color.
 * Returns '#ffffff' on any unparseable input so callers degrade to the old default.
 */
export function pickContrastingForeground(hex) {
    if (!parseHex(hex)) return ON_DARK;
    return contrastRatio(hex, ON_LIGHT) >= contrastRatio(hex, ON_DARK) ? ON_LIGHT : ON_DARK;
}
