/**
 * Purpose: Validate one UTC-first recording timestamp and age policy.
 * Caller: Vitest backend test suite.
 * Deps: recordingTimePolicy.
 * MainFuncs: parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    getRecordingAgeMs,
    parseRecordingDateMs,
    parseRecordingFilenameTimestampMs,
} from '../services/recordingTimePolicy.js';

describe('recordingTimePolicy', () => {
    it('parses segment filenames as UTC timestamps', () => {
        expect(parseRecordingFilenameTimestampMs('20260517_010203.mp4')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingFilenameTimestampMs('20260517_010203.mp4.partial')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingFilenameTimestampMs('../20260517_010203.mp4')).toBe(null);
    });

    it('parses ISO and SQL timestamps deterministically', () => {
        expect(parseRecordingDateMs('2026-05-17T01:02:03.000Z')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingDateMs('2026-05-17 01:02:03')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingDateMs(null)).toBe(null);
    });

    it('uses newest trustworthy timestamp to avoid premature deletion', () => {
        const nowMs = Date.UTC(2026, 4, 17, 2, 0, 0);
        const ageMs = getRecordingAgeMs({
            filename: '20260517_000000.mp4',
            startTime: '2026-05-17T00:00:00.000Z',
            fileMtimeMs: Date.UTC(2026, 4, 17, 1, 59, 0),
            nowMs,
        });

        expect(ageMs).toBe(60 * 1000);
    });
});
