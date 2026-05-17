/**
 * Purpose: Validate bounded, idempotent recording recovery queue behavior.
 * Caller: Vitest backend test suite.
 * Deps: recordingRecoveryService with mocked finalizer, diagnostics, and file operations.
 * MainFuncs: enqueue, recoverNow, drain, isFileOwned.
 * SideEffects: All side effects are mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingRecoveryService } from '../services/recordingRecoveryService.js';

function createService(overrides = {}) {
    return createRecordingRecoveryService({
        finalizer: overrides.finalizer || {
            finalizeSegment: vi.fn(async () => ({ success: true, finalFilename: '20260517_010000.mp4' })),
        },
        diagnosticsRepository: overrides.diagnosticsRepository || {
            incrementAttempt: vi.fn(),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        },
        fileOperations: overrides.fileOperations || {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        },
        maxConcurrent: overrides.maxConcurrent ?? 2,
        maxAttempts: overrides.maxAttempts ?? 3,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
}

describe('recordingRecoveryService', () => {
    it('deduplicates recovery for the same camera and final filename', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({ success: true, finalFilename: '20260517_010000.mp4' })),
        };
        const service = createService({ finalizer });

        const first = service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });
        const second = service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });

        await Promise.all([first, second]);

        expect(finalizer.finalizeSegment).toHaveBeenCalledTimes(1);
    });

    it('quarantines terminal files after retry exhaustion', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({
                success: false,
                reason: 'invalid_duration',
                finalFilename: '20260517_010000.mp4',
            })),
        };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn(() => ({ changes: 1 })),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        };
        const fileOperations = {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        };
        const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 1 });

        const result = await service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            sourcePath: 'final-path',
            sourceType: 'final_orphan',
            attemptCount: 1,
        });

        expect(result).toMatchObject({ success: false, terminal: true, reason: 'invalid_duration' });
        expect(fileOperations.quarantineFile).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: 'final-path',
            reason: 'terminal_recovery_failed',
        }));
        expect(diagnosticsRepository.markTerminal).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            quarantinedPath: 'quarantine-path',
        }));
    });

    it('uses persisted attempt count when repeated recovery calls omit input attemptCount', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({
                success: false,
                reason: 'invalid_duration',
                finalFilename: '20260517_010000.mp4',
            })),
        };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn()
                .mockReturnValueOnce({ attempt_count: 1 })
                .mockReturnValueOnce({ attempt_count: 2 })
                .mockReturnValueOnce({ attempt_count: 3 }),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        };
        const fileOperations = {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        };
        const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 3 });
        const input = {
            cameraId: 7,
            filename: '20260517_010000.mp4',
            sourcePath: 'final-path',
            sourceType: 'final_orphan',
        };

        await service.recoverNow(input);
        await service.recoverNow(input);
        const result = await service.recoverNow(input);

        expect(result).toMatchObject({ success: false, terminal: true, reason: 'invalid_duration' });
        expect(fileOperations.quarantineFile).toHaveBeenCalledTimes(1);
        expect(diagnosticsRepository.markTerminal).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4',
        }));
    });

    it('does not quarantine partial media failures after retry exhaustion', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({
                success: false,
                reason: 'invalid_duration',
                finalFilename: '20260517_211000.mp4',
            })),
        };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn(() => ({
                attempt_count: 99,
                detected_at: '2026-05-17T21:11:00.000Z',
                last_seen_at: '2026-05-17T21:12:00.000Z',
                updated_at: '2026-05-17T21:12:00.000Z',
            })),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
            getActiveDiagnostic: vi.fn(() => null),
        };
        const fileOperations = {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        };
        const service = createService({
            finalizer,
            diagnosticsRepository,
            fileOperations,
            maxAttempts: 3,
        });

        const result = await service.recoverNow({
            cameraId: 7,
            filename: '20260517_211000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });

        expect(result).toMatchObject({
            success: false,
            terminal: false,
            reason: 'invalid_duration',
        });
        expect(fileOperations.quarantineFile).not.toHaveBeenCalled();
        expect(diagnosticsRepository.markTerminal).not.toHaveBeenCalled();
    });

    it('still quarantines final orphan media failures after retry exhaustion', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({
                success: false,
                reason: 'invalid_duration',
                finalFilename: '20260517_211000.mp4',
            })),
        };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn(() => ({
                attempt_count: 3,
                detected_at: '2026-05-17T21:11:00.000Z',
                last_seen_at: '2026-05-17T21:12:00.000Z',
                updated_at: '2026-05-17T21:12:00.000Z',
            })),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
            getActiveDiagnostic: vi.fn(() => null),
        };
        const fileOperations = {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        };
        const service = createService({
            finalizer,
            diagnosticsRepository,
            fileOperations,
            maxAttempts: 3,
        });

        const result = await service.recoverNow({
            cameraId: 7,
            filename: '20260517_211000.mp4',
            sourcePath: 'final-path',
            sourceType: 'final_orphan',
        });

        expect(result).toMatchObject({
            success: false,
            terminal: true,
            reason: 'invalid_duration',
        });
        expect(fileOperations.quarantineFile).toHaveBeenCalledTimes(1);
    });

    it('does not count file_still_changing as a failed recovery attempt', async () => {
        const finalizer = {
            finalizeSegment: vi.fn(async () => ({
                success: false,
                reason: 'file_still_changing',
                finalFilename: '20260517_010000.mp4',
            })),
        };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn(),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        };
        const fileOperations = {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        };
        const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 1 });

        const result = await service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });

        expect(result).toMatchObject({
            success: false,
            terminal: false,
            reason: 'file_still_changing',
            pending: true,
        });
        expect(diagnosticsRepository.incrementAttempt).not.toHaveBeenCalled();
        expect(fileOperations.quarantineFile).not.toHaveBeenCalled();
    });

    it('reports retry backoff from active diagnostics', () => {
        const diagnosticsRepository = {
            getActiveDiagnostic: vi.fn(() => ({
                camera_id: 7,
                filename: '20260517_211000.mp4',
                state: 'retryable_failed',
                reason: 'invalid_duration',
                attempt_count: 3,
                last_seen_at: '2026-05-17T21:10:00.000Z',
            })),
            incrementAttempt: vi.fn(),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        };
        const service = createService({
            diagnosticsRepository,
            fileOperations: { quarantineFile: vi.fn() },
        });

        const decision = service.shouldRetryNow({
            cameraId: 7,
            filename: '20260517_211000.mp4.partial',
            sourceType: 'partial',
            nowMs: Date.parse('2026-05-17T21:11:00.000Z'),
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('retry_backoff');
        expect(decision.nextRetryAtMs).toBeGreaterThan(Date.parse('2026-05-17T21:11:00.000Z'));
    });
});
