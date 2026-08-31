import { describe, expect, it } from 'vitest';
import { boundsSpanDays, formatBoundLabel } from './playbackTimeLabel.js';

/*
 * The bound labels lied by omission: a 26 Agu 02:10 -> 31 Agu 00:00 range rendered "02.10 -> 00.00",
 * which reads BACKWARDS even though start < end. The fix is to name the day once the span crosses
 * midnight. Local Date construction keeps these assertions timezone-independent.
 */
const localMs = (y, m, d, h, min) => new Date(y, m, d, h, min).getTime();

describe('boundsSpanDays', () => {
    it('is false when both bounds fall on the same local day', () => {
        expect(boundsSpanDays(localMs(2026, 7, 26, 2, 10), localMs(2026, 7, 26, 21, 50))).toBe(false);
    });

    it('is true the moment the range crosses midnight', () => {
        expect(boundsSpanDays(localMs(2026, 7, 26, 2, 10), localMs(2026, 7, 31, 0, 0))).toBe(true);
        // Adjacent days count too — 23:55 -> 00:05 next day.
        expect(boundsSpanDays(localMs(2026, 7, 26, 23, 55), localMs(2026, 7, 27, 0, 5))).toBe(true);
    });

    it('is false for non-finite input rather than throwing', () => {
        expect(boundsSpanDays(NaN, localMs(2026, 7, 26, 2, 10))).toBe(false);
        expect(boundsSpanDays(null, undefined)).toBe(false);
    });
});

describe('formatBoundLabel', () => {
    it('drops seconds and shows time only within a single day', () => {
        expect(formatBoundLabel(localMs(2026, 7, 26, 2, 10), false)).toBe('02.10');
        expect(formatBoundLabel(localMs(2026, 7, 26, 14, 0), false)).toBe('14.00');
    });

    it('prepends the date once the span crosses days', () => {
        expect(formatBoundLabel(localMs(2026, 7, 26, 2, 10), true)).toBe('26 Agu 02.10');
        expect(formatBoundLabel(localMs(2026, 7, 31, 0, 0), true)).toBe('31 Agu 00.00');
    });

    it('is blank for non-finite input', () => {
        expect(formatBoundLabel(NaN, true)).toBe('');
        expect(formatBoundLabel(null, false)).toBe('');
    });
});
