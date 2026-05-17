/**
 * Purpose: Regression coverage for recording assurance health classification and batch DB reads.
 * Caller: Vitest backend suite.
 * Deps: Mocked database query helpers, recording runtime service, and filesystem stat checks.
 * MainFuncs: recordingAssuranceService.getSnapshot().
 * SideEffects: No real database, recording process, or filesystem access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';

const queryMock = vi.fn();
const getRecordingStatusMock = vi.fn();
const existsSyncMock = vi.fn();
const statSyncMock = vi.fn();
const summarizeActiveMock = vi.fn();
const getActiveHealthSummaryMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        getRecordingStatus: getRecordingStatusMock,
    },
}));

vi.mock('../services/recordingRecoveryDiagnosticsRepository.js', () => ({
    default: {
        summarizeActive: summarizeActiveMock,
        getActiveHealthSummary: getActiveHealthSummaryMock,
    },
}));

vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    statSync: statSyncMock,
}));

const { default: recordingAssuranceService } = await import('../services/recordingAssuranceService.js');

describe('recordingAssuranceService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ size: 1048576 });
        summarizeActiveMock.mockReturnValue({});
        getActiveHealthSummaryMock.mockReturnValue({
            oldest_active_seen_at: null,
            max_attempt_count: 0,
            active_total: 0,
        });
    });

    it('classifies enabled recording cameras from batched latest segment and gap queries', () => {
        queryMock
            .mockReturnValueOnce([
                {
                    id: 1,
                    name: 'Gate',
                    stream_source: 'internal',
                    recording_status: 'recording',
                    last_recording_start: '2026-05-02T00:00:00.000Z',
                },
                {
                    id: 2,
                    name: 'Market',
                    stream_source: 'internal',
                    recording_status: 'recording',
                    last_recording_start: '2026-05-02T00:00:00.000Z',
                },
            ])
            .mockReturnValueOnce([
                {
                    camera_id: 1,
                    filename: '20260502_014000.mp4',
                    start_time: '2026-05-02T01:40:00.000Z',
                    end_time: '2026-05-02T01:50:00.000Z',
                    file_size: 1048576,
                    duration: 600,
                    file_path: '/recordings/camera1/20260502_014000.mp4',
                },
                {
                    camera_id: 2,
                    filename: '20260502_010000.mp4',
                    start_time: '2026-05-02T01:00:00.000Z',
                    end_time: '2026-05-02T01:10:00.000Z',
                    file_size: 2048,
                    duration: 600,
                    file_path: '/recordings/camera2/20260502_010000.mp4',
                },
            ])
            .mockReturnValueOnce([
                {
                    camera_id: 2,
                    gap_count: 1,
                    max_gap_seconds: 900,
                },
            ]);

        getRecordingStatusMock
            .mockReturnValueOnce({ isRecording: true, status: 'recording' })
            .mockReturnValueOnce({ isRecording: true, status: 'recording' });

        const result = recordingAssuranceService.getSnapshot({
            now: new Date('2026-05-02T01:52:00.000Z'),
            staleAfterMs: 15 * 60 * 1000,
            gapToleranceSeconds: 180,
        });

        expect(queryMock).toHaveBeenCalledTimes(3);
        expect(queryMock.mock.calls[1][0]).toContain('ROW_NUMBER() OVER');
        expect(queryMock.mock.calls[2][0]).toContain('LAG(rs.end_time)');
        expect(result.summary).toEqual(expect.objectContaining({
            total_monitored: 2,
            healthy: 1,
            warning: 0,
            critical: 1,
            recording_down: 0,
            stale_segments: 1,
            recent_gap_cameras: 1,
        }));
        expect(result.cameras[0]).toEqual(expect.objectContaining({
            id: 1,
            health: 'healthy',
            reasons: [],
        }));
        expect(result.cameras[1]).toEqual(expect.objectContaining({
            id: 2,
            health: 'critical',
            reasons: expect.arrayContaining(['segment_stale', 'recent_segment_gap']),
        }));
    });

    it('flags recording process down and missing first segment without failing the whole snapshot', () => {
        queryMock
            .mockReturnValueOnce([
                {
                    id: 9,
                    name: 'Bridge',
                    stream_source: 'internal',
                    recording_status: 'recording',
                    last_recording_start: '2026-05-02T01:00:00.000Z',
                },
            ])
            .mockReturnValueOnce([])
            .mockReturnValueOnce([]);

        getRecordingStatusMock.mockReturnValue({ isRecording: false, status: 'stopped' });

        const result = recordingAssuranceService.getSnapshot({
            now: new Date('2026-05-02T01:30:00.000Z'),
            staleAfterMs: 15 * 60 * 1000,
        });

        expect(result.summary.critical).toBe(1);
        expect(result.summary.recording_down).toBe(1);
        expect(result.summary.missing_segments).toBe(1);
        expect(result.cameras[0].reasons).toEqual(expect.arrayContaining([
            'recording_process_down',
            'no_segments_after_start',
        ]));
    });

    it('uses connectionPool query helpers instead of legacy database.js helpers', async () => {
        const source = await readFile(new URL('../services/recordingAssuranceService.js', import.meta.url), 'utf8');

        expect(source).toContain("../database/connectionPool.js");
        expect(source).not.toContain("../database/database.js");
    });

    it('includes recovery diagnostic summary in assurance snapshot', () => {
        summarizeActiveMock.mockReturnValue({ pending: 2, retryable_failed: 1, unrecoverable: 1 });
        queryMock.mockReturnValueOnce([]);

        const snapshot = recordingAssuranceService.getSnapshot();

        expect(snapshot.recoveryDiagnostics).toEqual({
            pending: 2,
            retryable_failed: 1,
            unrecoverable: 1,
        });
    });

    it('includes recovery health metadata in assurance snapshot', () => {
        summarizeActiveMock.mockReturnValue({ pending: 2, retryable_failed: 1 });
        getActiveHealthSummaryMock.mockReturnValue({
            oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
            max_attempt_count: 2,
            active_total: 3,
        });
        queryMock.mockReturnValueOnce([]);

        const snapshot = recordingAssuranceService.getSnapshot();

        expect(snapshot.recoveryHealth).toEqual({
            oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
            max_attempt_count: 2,
            active_total: 3,
        });
    });
});
