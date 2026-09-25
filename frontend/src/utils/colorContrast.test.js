import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex, pickContrastingForeground, relativeLuminance } from './colorContrast';

describe('parseHex', () => {
    it('parses 6-digit and 3-digit hex, tolerates missing #', () => {
        expect(parseHex('#fa3333')).toEqual([250, 51, 51]);
        expect(parseHex('0ea5e9')).toEqual([14, 165, 233]);
        expect(parseHex('#fff')).toEqual([255, 255, 255]);
    });

    it('rejects junk', () => {
        expect(parseHex('#12345')).toBeNull();
        expect(parseHex('red')).toBeNull();
        expect(parseHex(null)).toBeNull();
    });
});

describe('contrastRatio', () => {
    it('computes WCAG ratios', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
        expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 0);
        // The production brand red that failed Lighthouse at 3.75:1 against white.
        expect(contrastRatio('#ffffff', '#fa3333')).toBeLessThan(4.5);
        expect(contrastRatio('#0b0e13', '#fa3333')).toBeGreaterThanOrEqual(4.5);
    });
});

describe('pickContrastingForeground', () => {
    it('picks dark text on the production brand red', () => {
        expect(pickContrastingForeground('#fa3333')).toBe('#0b0e13');
    });

    it('picks dark text on the default sky blue', () => {
        expect(pickContrastingForeground('#0ea5e9')).toBe('#0b0e13');
    });

    it('picks white on a dark navy', () => {
        expect(pickContrastingForeground('#1e3a8a')).toBe('#ffffff');
    });

    it('falls back to white for unparseable input', () => {
        expect(pickContrastingForeground('bogus')).toBe('#ffffff');
        expect(pickContrastingForeground(undefined)).toBe('#ffffff');
    });
});

describe('relativeLuminance', () => {
    it('bounds: black=0, white=1', () => {
        expect(relativeLuminance(0, 0, 0)).toBe(0);
        expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    });
});
