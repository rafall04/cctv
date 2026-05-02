/*
 * Purpose: Verifies playback timestamp-to-segment matching and fallback behavior.
 * Caller: Vitest frontend utility test suite.
 * Deps: vitest, playbackSegmentSelection.
 * MainFuncs: playback segment selection behavior coverage.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import {
    findClosestSegmentByStartTime,
    findSegmentForTimestamp,
} from './playbackSegmentSelection.js';

const segments = [
    {
        id: 1,
        start_time: '2026-05-02T01:00:00.000Z',
        end_time: '2026-05-02T01:10:00.000Z',
    },
    {
        id: 2,
        start_time: '2026-05-02T01:20:00.000Z',
        end_time: '2026-05-02T01:30:00.000Z',
    },
    {
        id: 3,
        start_time: '2026-05-02T01:40:00.000Z',
        end_time: '2026-05-02T01:50:00.000Z',
    },
];

describe('playbackSegmentSelection', () => {
    it('finds the segment containing a shared timestamp', () => {
        const target = new Date('2026-05-02T01:25:00.000Z').getTime();
        expect(findSegmentForTimestamp(segments, target)?.id).toBe(2);
    });

    it('returns null when no segment covers the timestamp', () => {
        const target = new Date('2026-05-02T01:35:00.000Z').getTime();
        expect(findSegmentForTimestamp(segments, target)).toBeNull();
        expect(findSegmentForTimestamp([], target)).toBeNull();
    });

    it('falls back to the closest start time when timestamp is outside ranges', () => {
        const target = new Date('2026-05-02T01:33:00.000Z').getTime();
        expect(findClosestSegmentByStartTime(segments, target)?.id).toBe(3);
    });

    it('keeps legacy fallback for invalid timestamps by returning the first segment', () => {
        expect(findClosestSegmentByStartTime(segments, 'bad')?.id).toBe(1);
        expect(findClosestSegmentByStartTime(null, Date.now())).toBeNull();
    });
});
