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
    daysWithRecordings,
    localDayRange,
    rangeForDateInput,
    rangesEqual,
    rollingRange,
    shiftDay,
} from './playbackDayRange';

/* Local parts in, wire format out — the same direction the real coverage payload is read. */
const iso = (year, month, day, hour, minute = 0) => new Date(year, month, day, hour, minute).toISOString();

describe('daysWithRecordings', () => {
    it('claims every local day a run spans, not just the day it started on', () => {
        const days = daysWithRecordings([{ from: iso(2026, 7, 1, 9), to: iso(2026, 7, 3, 17) }]);
        expect([...days].sort()).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    });

    it('counts a run that crosses local midnight as both days', () => {
        const days = daysWithRecordings([{ from: iso(2026, 7, 5, 23, 40), to: iso(2026, 7, 6, 0, 20) }]);
        expect([...days].sort()).toEqual(['2026-08-05', '2026-08-06']);
    });

    it('leaves the hole between two runs out', () => {
        const days = daysWithRecordings([
            { from: iso(2026, 7, 1, 9), to: iso(2026, 7, 1, 17) },
            { from: iso(2026, 7, 4, 9), to: iso(2026, 7, 4, 17) },
        ]);
        expect(days.has('2026-08-02')).toBe(false);
        expect(days.has('2026-08-03')).toBe(false);
        expect(days.has('2026-08-04')).toBe(true);
    });

    it('skips runs it cannot place instead of dotting the epoch', () => {
        const days = daysWithRecordings([
            { from: null, to: iso(2026, 7, 6, 9) },
            { from: 'not-a-date', to: 'nonsense' },
            { from: iso(2026, 7, 6, 12), to: iso(2026, 7, 6, 9) }, // ends before it starts
        ]);
        expect(days.size).toBe(0);
    });

    it('survives a corrupt span without spinning', () => {
        // A `from` at the epoch would walk ~20k days; the guard stops it well short.
        const days = daysWithRecordings([{ from: new Date(0).toISOString(), to: iso(2026, 7, 6, 9) }]);
        expect(days.size).toBeLessThanOrEqual(3660);
    });

    it('is empty for anything that is not a list of runs', () => {
        expect(daysWithRecordings(null).size).toBe(0);
        expect(daysWithRecordings(undefined).size).toBe(0);
        expect(daysWithRecordings([]).size).toBe(0);
    });
});

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
