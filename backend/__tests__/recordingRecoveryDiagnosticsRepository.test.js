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

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
}));

describe('recordingRecoveryDiagnosticsRepository', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        executeMock.mockReturnValue({ changes: 1 });
        queryMock.mockReturnValue([]);
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

    it('summarizes active diagnostics by state', async () => {
        queryMock.mockReturnValue([{ state: 'retryable_failed', count: 2 }, { state: 'unrecoverable', count: 1 }]);
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        expect(repository.summarizeActive()).toEqual({ retryable_failed: 2, unrecoverable: 1 });
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
