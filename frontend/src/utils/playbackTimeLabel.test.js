import { describe, expect, it } from 'vitest';
import { boundsSpanDays, formatBoundLabel } from './playbackTimeLabel.js';

/*
 * The bound labels lied by omission: a 26 Agu 02:10 -> 31 Agu 00:00 range rendered "02.10 -> 00.00",
 * which reads BACKWARDS even though start < end. The fix is to name the day once the span crosses
 * midnight. The labels now render in the app's CONFIGURED timezone (Asia/Jakarta here), so we build
 * each instant from its Jakarta wall clock (WIB = UTC+7, no DST) to keep these assertions independent
 * of the test machine's own timezone.
 */
const TZ = 'Asia/Jakarta';
const jakartaMs = (y, m, d, h, min) => Date.UTC(y, m, d, h - 7, min);

describe('boundsSpanDays', () => {
    it('is false when both bounds fall on the same day in the configured tz', () => {
        expect(boundsSpanDays(jakartaMs(2026, 7, 26, 2, 10), jakartaMs(2026, 7, 26, 21, 50), TZ)).toBe(false);
    });

    it('is true the moment the range crosses midnight', () => {
        expect(boundsSpanDays(jakartaMs(2026, 7, 26, 2, 10), jakartaMs(2026, 7, 31, 0, 0), TZ)).toBe(true);
        // Adjacent days count too — 23:55 -> 00:05 next day.
        expect(boundsSpanDays(jakartaMs(2026, 7, 26, 23, 55), jakartaMs(2026, 7, 27, 0, 5), TZ)).toBe(true);
    });

    it('is false for non-finite input rather than throwing', () => {
        expect(boundsSpanDays(NaN, jakartaMs(2026, 7, 26, 2, 10), TZ)).toBe(false);
        expect(boundsSpanDays(null, undefined, TZ)).toBe(false);
    });
});

describe('formatBoundLabel', () => {
    it('drops seconds and shows time only within a single day', () => {
        expect(formatBoundLabel(jakartaMs(2026, 7, 26, 2, 10), false, TZ)).toBe('02.10');
        expect(formatBoundLabel(jakartaMs(2026, 7, 26, 14, 0), false, TZ)).toBe('14.00');
    });

    it('prepends the date once the span crosses days', () => {
        expect(formatBoundLabel(jakartaMs(2026, 7, 26, 2, 10), true, TZ)).toBe('26 Agu 02.10');
        expect(formatBoundLabel(jakartaMs(2026, 7, 31, 0, 0), true, TZ)).toBe('31 Agu 00.00');
    });

    it('is blank for non-finite input', () => {
        expect(formatBoundLabel(NaN, true, TZ)).toBe('');
        expect(formatBoundLabel(null, false, TZ)).toBe('');
    });
});
