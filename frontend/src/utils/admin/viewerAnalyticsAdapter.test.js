/*
 * Purpose: Pin watch-time formatting, which used to report most real viewing as zero.
 * Caller: Frontend Vitest suite.
 * MainFuncs: formatWatchTime cases.
 * SideEffects: None.
 *
 * The bug: it floored everything to whole minutes, so a 37-second view rendered "0m" — identical to
 * a session that never played. Production data shows most playback views ARE short, which meant the
 * analytics were quietly reporting the bulk of genuine viewing as nothing at all.
 */

import { describe, expect, it } from 'vitest';
import { formatWatchTime } from './viewerAnalyticsAdapter';

describe('formatWatchTime', () => {
    it.each([
        [37, '37 dtk'],
        [26, '26 dtk'],
        [59, '59 dtk'],
    ])('reports %s seconds as "%s" rather than collapsing it to zero', (seconds, expected) => {
        expect(formatWatchTime(seconds)).toBe(expected);
    });

    it.each([
        [60, '1m'],
        [90, '1m 30dtk'],
        [600, '10m'],
    ])('keeps the seconds beside the minutes: %s -> "%s"', (seconds, expected) => {
        // "1m" and "1m 59dtk" are very different viewings; rounding hides that.
        expect(formatWatchTime(seconds)).toBe(expected);
    });

    it.each([
        [3600, '1h 0m'],
        [3660, '1h 1m'],
        [17400, '4h 50m'],
    ])('drops to hours and minutes once it is long: %s -> "%s"', (seconds, expected) => {
        expect(formatWatchTime(seconds)).toBe(expected);
    });

    it.each([[0], [null], [undefined], ['']])('says zero plainly for %s', (value) => {
        expect(formatWatchTime(value)).toBe('0 dtk');
    });

    it('never renders a negative or fractional duration as nonsense', () => {
        expect(formatWatchTime(-5)).toBe('0 dtk');
        expect(formatWatchTime(36.6)).toBe('37 dtk');
    });
});
