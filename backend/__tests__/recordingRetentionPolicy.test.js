/**
 * Purpose: Validate pure retention cutoff, filename parsing, and safe filename checks.
 * Caller: Vitest backend test suite.
 * Deps: recordingRetentionPolicy service.
 * MainFuncs: computeRetentionWindow, parseSegmentFilenameTimeMs, isSafeRecordingFilename.
 * SideEffects: None; pure function tests only.
 */
import { describe, expect, it } from 'vitest';
import {
    computeRetentionWindow,
    isExpiredByRetention,
    isSafeRecordingFilename,
    parseSegmentFilenameTimeMs,
} from '../services/recordingRetentionPolicy.js';

describe('recordingRetentionPolicy', () => {
    it('computes retention cutoff with the larger grace value', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');

        const result = computeRetentionWindow({
            retentionHours: 1,
            nowMs,
        });

        expect(result.retentionMs).toBe(60 * 60 * 1000);
        expect(result.graceMs).toBe(10 * 60 * 1000);
        expect(result.cutoffMs).toBe(nowMs - (70 * 60 * 1000));
        expect(result.cutoffIso).toBe(new Date(nowMs - (70 * 60 * 1000)).toISOString());
    });

    it('defaults invalid retention hours to five hours', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');

        const result = computeRetentionWindow({
            retentionHours: 0,
            nowMs,
        });

        expect(result.retentionHours).toBe(5);
        expect(result.retentionMs).toBe(5 * 60 * 60 * 1000);
    });

    it('parses segment filenames deterministically as UTC timestamps', () => {
        expect(parseSegmentFilenameTimeMs('20260502_174501.mp4')).toBe(
            Date.UTC(2026, 4, 2, 17, 45, 1)
        );
    });

    it('rejects filenames that only contain temp or remux fragments', () => {
        expect(isSafeRecordingFilename('20260502_174501.mp4')).toBe(true);
        expect(isSafeRecordingFilename('20260502_174501.mp4.remux.mp4')).toBe(true);
        expect(isSafeRecordingFilename('20260502_174501.mp4.temp.mp4')).toBe(true);
        expect(isSafeRecordingFilename('x.temp.mp4')).toBe(false);
        expect(isSafeRecordingFilename('20260502_174501.mp4.temp.mp4.exe')).toBe(false);
        expect(isSafeRecordingFilename('../20260502_174501.mp4')).toBe(false);
    });

    it('marks a segment expired only after retention plus grace', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');
        const window = computeRetentionWindow({ retentionHours: 1, nowMs });

        expect(isExpiredByRetention('2026-05-02T08:40:00.000Z', window)).toBe(true);
        expect(isExpiredByRetention('2026-05-02T09:00:00.000Z', window)).toBe(false);
    });
});
