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
});
