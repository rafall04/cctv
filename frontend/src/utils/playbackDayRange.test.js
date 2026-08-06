/*
 * Purpose: Lock the day boundaries to the operator's clock, not the server's.
 * Caller: Vitest frontend suite.
 * Deps: utils/playbackDayRange (pure).
 * SideEffects: None.
 *
 * Written timezone-agnostically on purpose: the assertions read the LOCAL parts back, so they hold
 * in CI (pinned to Asia/Jakarta) and on a laptop set to anything else. Asserting a literal UTC
 * string here would just re-encode the very bug this module exists to avoid — for WIB (+7) any
 * moment before 07:00 lands on the previous UTC day, so "hari ini" would mean yesterday all morning.
 */

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_RANGE_HOURS,
    dateInputValue,
    dayKeyOf,
    localDayRange,
    rangeForDateInput,
    rangesEqual,
    rollingRange,
    shiftDay,
} from './playbackDayRange';

describe('rollingRange', () => {
    it('ends open at now and reaches back the asked-for hours', () => {
        const now = Date.parse('2026-08-06T12:00:00.000Z');
        expect(rollingRange(24, now)).toEqual({
            from: '2026-08-05T12:00:00.000Z',
            to: null,
            key: 'rolling:24',
        });
    });

    it('defaults to the window the page opens on', () => {
        expect(rollingRange().key).toBe(`rolling:${DEFAULT_RANGE_HOURS}`);
    });
});

describe('localDayRange', () => {
    const noon = new Date(2026, 7, 3, 12, 30, 0);

    it('starts at local midnight of the day the instant falls in', () => {
        const start = new Date(localDayRange(noon).from);
        expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 7, 3]);
        expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    });

    it('ends on the last millisecond of that same local day', () => {
        const end = new Date(localDayRange(noon).to);
        expect(end.getDate()).toBe(3);
        expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
    });

    it('keeps the local day for an instant that sits in a different UTC one', () => {
        // 01:00 local is the previous day in UTC for any positive offset; the operator's day wins.
        expect(localDayRange(new Date(2026, 7, 3, 1, 0, 0)).key).toBe('day:2026-08-03');
    });

    it('falls back to the rolling window rather than producing an unusable range', () => {
        expect(localDayRange('bukan tanggal').key).toBe(`rolling:${DEFAULT_RANGE_HOURS}`);
    });
});

describe('dayKeyOf and dateInputValue', () => {
    it('zero-pads to the format a date input speaks', () => {
        expect(dayKeyOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('reads the day back out of a day range, and stays blank for a rolling one', () => {
        expect(dateInputValue(localDayRange(new Date(2026, 7, 3)))).toBe('2026-08-03');
        expect(dateInputValue(rollingRange())).toBe('');
        expect(dateInputValue(null)).toBe('');
    });
});

describe('rangeForDateInput', () => {
    it('builds the whole local day the input names', () => {
        expect(rangeForDateInput('2026-08-03').key).toBe('day:2026-08-03');
    });

    it('refuses anything that is not a date, so a cleared field does not silently jump', () => {
        expect(rangeForDateInput('')).toBeNull();
        expect(rangeForDateInput('03/08/2026')).toBeNull();
        expect(rangeForDateInput(undefined)).toBeNull();
    });
});

describe('shiftDay', () => {
    it('steps a day range backwards and forwards', () => {
        const day = localDayRange(new Date(2026, 7, 3));
        expect(shiftDay(day, -1).key).toBe('day:2026-08-02');
        expect(shiftDay(day, 1).key).toBe('day:2026-08-04');
    });

    it('crosses a month boundary', () => {
        expect(shiftDay(localDayRange(new Date(2026, 7, 1)), -1).key).toBe('day:2026-07-31');
    });

    it('has nothing to step when the range is rolling', () => {
        expect(shiftDay(rollingRange(), -1)).toBeNull();
    });
});

describe('rangesEqual', () => {
    it('treats two rolling windows built moments apart as the same slice', () => {
        // Otherwise every re-render would look like a new request and refetch the list.
        expect(rangesEqual(rollingRange(24, 1), rollingRange(24, 2))).toBe(true);
    });

    it('separates different days and a day from a rolling window', () => {
        expect(rangesEqual(localDayRange(new Date(2026, 7, 3)), localDayRange(new Date(2026, 7, 4)))).toBe(false);
        expect(rangesEqual(localDayRange(new Date(2026, 7, 3)), rollingRange())).toBe(false);
        expect(rangesEqual(null, rollingRange())).toBe(false);
    });
});
