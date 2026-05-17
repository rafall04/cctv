/**
 * Purpose: Verify recording recovery diagnostic persistence uses bounded upserts and reads.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool, recordingRecoveryDiagnosticsRepository.
 * MainFuncs: upsertDiagnostic, clearDiagnostic, listActiveByCamera, summarizeActive.
 * SideEffects: Uses mocks only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('recordingRecoveryDiagnosticsRepository', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        executeMock.mockReturnValue({ changes: 1 });
        queryMock.mockReturnValue([]);
        queryOneMock.mockReturnValue(null);
    });

    it('upserts active diagnostic by camera and filename', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.upsertDiagnostic({
            cameraId: 7,
            filename: '20260511_211000.mp4',
            filePath: 'C:\\recordings\\camera7\\pending\\20260511_211000.mp4.partial',
            state: 'retryable_failed',
            reason: 'invalid_duration',
            fileSize: 4096,
            detectedAt: '2026-05-11T21:14:00.000Z',
        });

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO recording_recovery_diagnostics'), [
            7,
            '20260511_211000.mp4',
            'C:\\recordings\\camera7\\pending\\20260511_211000.mp4.partial',
            'retryable_failed',
            'invalid_duration',
            4096,
            '2026-05-11T21:14:00.000Z',
            '2026-05-11T21:14:00.000Z',
            1,
        ]);
    });

    it('clears diagnostic after successful registration', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.clearDiagnostic({ cameraId: 7, filename: '20260511_211000.mp4' });

        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE recording_recovery_diagnostics SET active = 0, resolved_at = CURRENT_TIMESTAMP WHERE camera_id = ? AND filename = ? AND active = 1',
            [7, '20260511_211000.mp4']
        );
    });

    it('returns an active diagnostic by camera and filename', async () => {
        queryOneMock.mockReturnValue({
            camera_id: 7,
            filename: '20260517_211000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
        });
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        const row = repository.getActiveDiagnostic({
            cameraId: 7,
            filename: '20260517_211000.mp4',
        });

        expect(row).toMatchObject({
            camera_id: 7,
            filename: '20260517_211000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
        });
        expect(queryOneMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND filename = ? AND active = 1'),
            [7, '20260517_211000.mp4']
        );
    });

    it('summarizes active diagnostics by state', async () => {
        queryMock.mockReturnValue([{ state: 'retryable_failed', count: 2 }, { state: 'unrecoverable', count: 1 }]);
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        expect(repository.summarizeActive()).toEqual({ retryable_failed: 2, unrecoverable: 1 });
    });

    it('returns oldest active recovery diagnostic metadata', async () => {
        queryOneMock.mockReturnValue({
            oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
            max_attempt_count: 3,
            active_total: 4,
        });
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        const result = repository.getActiveHealthSummary();

        expect(result).toEqual({
            oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
            max_attempt_count: 3,
            active_total: 4,
        });
    });

    it('increments active recovery attempts for one file', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.incrementAttempt({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: 'C:\\recordings\\camera7\\20260517_010000.mp4',
            reason: 'invalid_duration',
            attemptedAt: '2026-05-17T01:30:00.000Z',
        });

        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('attempt_count = attempt_count + 1'),
            [
                7,
                '20260517_010000.mp4',
                'C:\\recordings\\camera7\\20260517_010000.mp4',
                'retryable_failed',
                'invalid_duration',
                '2026-05-17T01:30:00.000Z',
                '2026-05-17T01:30:00.000Z',
            ]
        );
    });

    it('returns the latest active attempt count after incrementing', async () => {
        queryOneMock.mockReturnValue({
            camera_id: 7,
            filename: '20260517_010000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
            attempt_count: 2,
        });
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        const row = repository.incrementAttempt({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: 'C:\\recordings\\camera7\\20260517_010000.mp4',
            reason: 'invalid_duration',
            attemptedAt: '2026-05-17T01:30:00.000Z',
        });

        expect(row).toEqual(expect.objectContaining({
            camera_id: 7,
            filename: '20260517_010000.mp4',
            attempt_count: 2,
        }));
        expect(queryOneMock).toHaveBeenCalledWith(
            expect.stringContaining('camera_id'),
            [7, '20260517_010000.mp4']
        );
    });

    it('returns timing fields when incrementing recovery attempts', async () => {
        queryOneMock.mockReturnValue({
            camera_id: 7,
            filename: '20260517_211500.mp4',
            reason: 'invalid_duration',
            attempt_count: 1,
            detected_at: '2026-05-17T21:16:00.000Z',
            last_seen_at: '2026-05-17T21:16:00.000Z',
            updated_at: '2026-05-17T21:16:00.000Z',
        });
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        const row = repository.incrementAttempt({
            cameraId: 7,
            filename: '20260517_211500.mp4',
            filePath: 'C:\\recordings\\camera7\\pending\\20260517_211500.mp4.partial',
            reason: 'invalid_duration',
            attemptedAt: '2026-05-17T21:16:00.000Z',
        });

        expect(row).toMatchObject({
            camera_id: 7,
            filename: '20260517_211500.mp4',
            reason: 'invalid_duration',
            attempt_count: 1,
        });
        expect(row.detected_at).toBeTruthy();
        expect(row.last_seen_at).toBeTruthy();
        expect(row.updated_at).toBeTruthy();
        expect(queryOneMock).toHaveBeenCalledWith(
            expect.stringContaining('updated_at'),
            [7, '20260517_211500.mp4']
        );
    });

    it('marks a file terminal and quarantined', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.markTerminal({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            reason: 'retry_limit_exhausted',
            quarantinedPath: 'C:\\recordings\\.quarantine\\camera7\\x.mp4',
        });

        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('terminal_state = ?'),
            [
                'unrecoverable',
                'retry_limit_exhausted',
                'unrecoverable',
                'C:\\recordings\\.quarantine\\camera7\\x.mp4',
                7,
                '20260517_010000.mp4',
            ]
        );
    });
});
