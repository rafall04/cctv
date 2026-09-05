/**
 * Purpose: Lock the two pieces that let playback stay light without lying — the range a caller may
 *          ask for, and the coverage runs that keep the timeline whole-range regardless.
 * Caller: Vitest backend test suite.
 * Deps: playbackRangePolicy (pure), mocked connectionPool for recordingCoverageRunsService.
 * MainFuncs: parsePlaybackRange, intersectWithAccessWindow, isWithinRange, mergeIntoRuns, getCoverage.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    intersectWithAccessWindow,
    isWithinRange,
    parsePlaybackRange,
} from '../services/playbackRangePolicy.js';

const queryMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
}));

const { default: coverage, mergeIntoRuns } = await import('../services/recordingCoverageRunsService.js');

describe('parsePlaybackRange', () => {
    it('returns null when nothing was asked for, so the caller keeps its old behaviour', () => {
        expect(parsePlaybackRange({})).toBeNull();
        expect(parsePlaybackRange(undefined)).toBeNull();
        expect(parsePlaybackRange({ from: '', to: '' })).toBeNull();
    });

    it('normalises both bounds to ISO UTC, which is how the columns are stored', () => {
        expect(parsePlaybackRange({ from: '2026-08-03T00:00:00+07:00', to: '2026-08-03T23:59:59+07:00' })).toEqual({
            from: '2026-08-02T17:00:00.000Z',
            to: '2026-08-03T16:59:59.000Z',
        });
    });

    it('accepts a half-open range', () => {
        expect(parsePlaybackRange({ from: '2026-08-03T00:00:00.000Z' }))
            .toEqual({ from: '2026-08-03T00:00:00.000Z', to: null });
    });

    it('reads a reversed pair the wide way round rather than answering "no footage"', () => {
        expect(parsePlaybackRange({ from: '2026-08-05T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' })).toEqual({
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-05T00:00:00.000Z',
        });
    });

    it('ignores an unparseable bound instead of narrowing to nothing', () => {
        expect(parsePlaybackRange({ from: 'kemarin' })).toBeNull();
    });
});

describe('intersectWithAccessWindow', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');

    it('is a no-op when the caller has unlimited depth', () => {
        const range = { from: '2026-08-01T00:00:00.000Z', to: null };
        expect(intersectWithAccessWindow(range, { playbackWindowHours: null, now })).toBe(range);
    });

    it('clamps a request that reaches further back than the entitlement allows', () => {
        // A 7-day token naming a date three weeks ago must not get it just because it named it.
        expect(intersectWithAccessWindow(
            { from: '2026-07-16T00:00:00.000Z', to: '2026-07-17T00:00:00.000Z' },
            { playbackWindowHours: 168, now },
        )).toEqual({ from: '2026-07-30T12:00:00.000Z', to: '2026-07-17T00:00:00.000Z' });
    });

    it('keeps a request that already sits inside the window', () => {
        expect(intersectWithAccessWindow(
            { from: '2026-08-05T00:00:00.000Z', to: null },
            { playbackWindowHours: 168, now },
        )).toEqual({ from: '2026-08-05T00:00:00.000Z', to: null });
    });

    it('becomes the window itself when no range was requested', () => {
        expect(intersectWithAccessWindow(null, { playbackWindowHours: 24, now }))
            .toEqual({ from: '2026-08-05T12:00:00.000Z', to: null });
        expect(intersectWithAccessWindow(null, { playbackWindowHours: null, now })).toBeNull();
    });
});

describe('isWithinRange', () => {
    const range = { from: '2026-08-03T00:00:00.000Z', to: '2026-08-03T23:59:59.999Z' };

    it('keeps everything when there is no range', () => {
        expect(isWithinRange({ start_time: '2020-01-01T00:00:00.000Z' }, null)).toBe(true);
    });

    it('is half-open: includes the FROM bound, excludes the TO bound', () => {
        // Half-open [from, to): a segment starting exactly at range.to belongs to the NEXT window and
        // is excluded — this is the fix for the one-segment playback overshoot (08:00-10:00 → 10:10).
        expect(isWithinRange({ start_time: range.from }, range)).toBe(true);
        expect(isWithinRange({ start_time: range.to }, range)).toBe(false);
    });

    it('excludes either side and a row with no time at all', () => {
        expect(isWithinRange({ start_time: '2026-08-02T23:59:59.999Z' }, range)).toBe(false);
        expect(isWithinRange({ start_time: '2026-08-04T00:00:00.000Z' }, range)).toBe(false);
        expect(isWithinRange({}, range)).toBe(false);
    });
});

describe('mergeIntoRuns', () => {
    const ms = (iso) => Date.parse(iso);

    it('collapses clips recorded back to back into one unbroken run', () => {
        // This is the whole point: ten-minute clips in sequence are one stretch of footage, and
        // production holds ~1,400 of them per camera against 14-84 actual runs.
        expect(mergeIntoRuns([
            { from: ms('2026-08-06T01:00:00Z'), to: ms('2026-08-06T01:10:00Z') },
            { from: ms('2026-08-06T01:10:02Z'), to: ms('2026-08-06T01:20:00Z') },
            { from: ms('2026-08-06T01:20:01Z'), to: ms('2026-08-06T01:30:00Z') },
        ])).toEqual([{ from: '2026-08-06T01:00:00.000Z', to: '2026-08-06T01:30:00.000Z' }]);
    });

    it('keeps a real hole as a break between two runs', () => {
        expect(mergeIntoRuns([
            { from: ms('2026-08-06T01:00:00Z'), to: ms('2026-08-06T01:10:00Z') },
            { from: ms('2026-08-06T04:00:00Z'), to: ms('2026-08-06T04:10:00Z') },
        ])).toHaveLength(2);
    });

    it('absorbs the same footage arriving from both disk and archive', () => {
        expect(mergeIntoRuns([
            { from: ms('2026-08-06T01:00:00Z'), to: ms('2026-08-06T01:10:00Z') },
            { from: ms('2026-08-06T01:00:00Z'), to: ms('2026-08-06T01:10:00Z') },
        ])).toEqual([{ from: '2026-08-06T01:00:00.000Z', to: '2026-08-06T01:10:00.000Z' }]);
    });

    it('sorts before merging, so the caller may hand rows over in any order', () => {
        expect(mergeIntoRuns([
            { from: ms('2026-08-06T01:10:02Z'), to: ms('2026-08-06T01:20:00Z') },
            { from: ms('2026-08-06T01:00:00Z'), to: ms('2026-08-06T01:10:00Z') },
        ])).toEqual([{ from: '2026-08-06T01:00:00.000Z', to: '2026-08-06T01:20:00.000Z' }]);
    });

    it('drops intervals it cannot place instead of drawing them at the epoch', () => {
        expect(mergeIntoRuns([
            { from: NaN, to: ms('2026-08-06T01:10:00Z') },
            { from: ms('2026-08-06T02:00:00Z'), to: NaN },
        ])).toEqual([]);
    });
});

describe('recordingCoverageRunsService.getCoverage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMock.mockReturnValue([]);
        // getCoverage caches per (camera, range) for ~45 s; these cases reuse camera 7 with different
        // mocked rows, so clear it or the second read would return the first case's cached answer.
        coverage.invalidate();
    });

    it('reads both sources and reports the merged span', () => {
        queryMock
            .mockReturnValueOnce([{ from_at: '2026-08-06T01:00:00.000Z', to_at: '2026-08-06T01:10:00.000Z', duration: 600 }])
            .mockReturnValueOnce([{ from_at: '2026-08-06T01:10:01.000Z', to_at: '2026-08-06T01:20:00.000Z', duration: 600 }]);

        expect(coverage.getCoverage(7)).toEqual({
            start: '2026-08-06T01:00:00.000Z',
            end: '2026-08-06T01:20:00.000Z',
            runs: [{ from: '2026-08-06T01:00:00.000Z', to: '2026-08-06T01:20:00.000Z' }],
            segments: 2,
        });
    });

    it('derives a missing end from the duration rather than reading null as 1970', () => {
        // Eight archived rows on production have a null recorded_until. Read as the epoch, one of
        // them painted a 1.78-billion-second hole across the whole bar.
        queryMock
            .mockReturnValueOnce([{ from_at: '2026-08-06T01:00:00.000Z', to_at: null, duration: 600 }])
            .mockReturnValueOnce([]);

        expect(coverage.getCoverage(7).runs).toEqual([
            { from: '2026-08-06T01:00:00.000Z', to: '2026-08-06T01:10:00.000Z' },
        ]);
    });

    it('drops a row with neither an end nor a duration', () => {
        queryMock
            .mockReturnValueOnce([{ from_at: '2026-08-06T01:00:00.000Z', to_at: null, duration: null }])
            .mockReturnValueOnce([]);

        expect(coverage.getCoverage(7)).toEqual({ start: null, end: null, runs: [], segments: 0 });
    });

    it('still draws the disk half when the archive table is missing entirely', () => {
        queryMock
            .mockReturnValueOnce([{ from_at: '2026-08-06T01:00:00.000Z', to_at: '2026-08-06T01:10:00.000Z', duration: 600 }])
            .mockImplementationOnce(() => { throw new Error('no such table: telegram_archive_uploads'); });

        expect(coverage.getCoverage(7).runs).toHaveLength(1);
    });

    it('passes the entitlement bounds through to both queries', () => {
        coverage.getCoverage(7, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-06T00:00:00.000Z' });

        for (const [sql, params] of queryMock.mock.calls) {
            expect(sql).toContain('AND from_at >= ?');
            expect(sql).toContain('AND from_at <= ?');
            expect(params).toEqual([7, '2026-08-01T00:00:00.000Z', '2026-08-06T00:00:00.000Z']);
        }
    });

    it('clamps a run that spans the ceiling so the bar ends at the entitlement, not a segment past it', () => {
        // One merged run 08:00-10:10 (a 10:00 segment plays to 10:10) under a token whose range ends
        // at 10:00. Filtering by start alone cannot bound the drawn span — the clamp must.
        queryMock
            .mockReturnValueOnce([{ from_at: '2026-08-01T08:00:00.000Z', to_at: '2026-08-01T10:10:00.000Z', duration: 7800 }])
            .mockReturnValueOnce([]);

        const result = coverage.getCoverage(7, { from: '2026-08-01T08:00:00.000Z', to: '2026-08-01T10:00:00.000Z' });

        expect(result.runs).toHaveLength(1);
        expect(result.runs[0].from).toBe('2026-08-01T08:00:00.000Z');
        expect(result.runs[0].to).toBe('2026-08-01T10:00:00.000Z'); // clamped to the bound, not 10:10
    });

    it('rejects a non-camera id without touching the database', () => {
        expect(coverage.getCoverage('abc')).toEqual({ start: null, end: null, runs: [], segments: 0 });
        expect(queryMock).not.toHaveBeenCalled();
    });
});
