/**
 * Purpose: Adversarially verify the ABSOLUTE playback range entitlement — a token cut to "1–5 Aug"
 *          must see exactly that window and NEVER leak footage newer than its ceiling or older than
 *          its floor, whatever date the caller names.
 * Caller: Backend focused test gate for playback access control.
 * Deps: vitest, playbackRangePolicy (pure).
 */
import { describe, expect, it } from 'vitest';
import {
    resolveAccessBounds,
    intersectWithAccessWindow,
    isWithinRange,
} from '../services/playbackRangePolicy.js';

const FROM = '2026-08-01T00:00:00.000Z';
const TO = '2026-08-05T23:59:59.000Z';
const now = Date.parse('2026-08-20T12:00:00.000Z');

describe('resolveAccessBounds', () => {
    it('rolling window → floor at now−N, no ceiling', () => {
        const b = resolveAccessBounds({ playbackWindowHours: 24 }, now);
        expect(b.toIso).toBeNull();
        expect(Date.parse(b.fromIso)).toBe(now - 24 * 3600 * 1000);
    });

    it('absolute range → exactly [from, to]', () => {
        expect(resolveAccessBounds({ playbackFrom: FROM, playbackTo: TO }, now)).toEqual({ fromIso: FROM, toIso: TO });
    });

    it('absolute range WINS over a rolling window when both are present', () => {
        const b = resolveAccessBounds({ playbackWindowHours: 720, playbackFrom: FROM, playbackTo: TO }, now);
        expect(b).toEqual({ fromIso: FROM, toIso: TO });
    });

    it('neither → unlimited (both null)', () => {
        expect(resolveAccessBounds({}, now)).toEqual({ fromIso: null, toIso: null });
    });
});

describe('intersectWithAccessWindow — absolute range is a hard [floor, ceiling]', () => {
    const access = { playbackFrom: FROM, playbackTo: TO };

    it('a request INSIDE the window is tightened to the request', () => {
        const r = intersectWithAccessWindow({ from: '2026-08-02T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' }, access, now);
        expect(r).toEqual({ from: '2026-08-02T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' });
    });

    it('a request NEWER than the ceiling collapses to an empty range (no leak past `to`)', () => {
        // Caller names 19 Aug (three weeks after the sold window ends 5 Aug).
        const r = intersectWithAccessWindow({ from: '2026-08-19T00:00:00.000Z', to: '2026-08-19T23:59:59.000Z' }, access, now);
        // from (19 Aug) is now LATER than to (5 Aug) → nothing can satisfy both → no footage.
        expect(r.from > r.to).toBe(true);
        expect(isWithinRange({ start_time: '2026-08-19T10:00:00.000Z' }, r)).toBe(false);
    });

    it('a request OLDER than the floor is clamped up to the floor', () => {
        const r = intersectWithAccessWindow({ from: '2026-07-01T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' }, access, now);
        expect(r.from).toBe(FROM); // clamped to 1 Aug, not 1 Jul
    });

    it('no request → the entitlement window itself', () => {
        expect(intersectWithAccessWindow(null, access, now)).toEqual({ from: FROM, to: TO });
    });

    it('a live segment newer than the ceiling is refused even with no request narrowing', () => {
        const r = intersectWithAccessWindow(null, access, now);
        expect(isWithinRange({ start_time: '2026-08-04T12:00:00.000Z' }, r)).toBe(true); // inside
        expect(isWithinRange({ start_time: '2026-08-20T12:00:00.000Z' }, r)).toBe(false); // today, past ceiling → refused
    });
});
