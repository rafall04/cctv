/**
 * Purpose: Validate recording recovery scanner folder traversal and non-destructive recovery decisions.
 * Caller: Vitest backend test suite.
 * Deps: recordingRecoveryScanner with mocked fs, DB, file operations, and recovery ownership checks.
 * MainFuncs: scanOnce.
 * SideEffects: All filesystem and recovery side effects are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { createRecordingRecoveryScanner } from '../services/recordingRecoveryScanner.js';

const base = join(process.cwd(), '..', 'recordings');
const fsMock = {
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
};
const queryRows = vi.fn();
const querySingle = vi.fn();
const deleteFileSafely = vi.fn();
const isFileOwned = vi.fn();
const onSegmentCreated = vi.fn();
const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createScanner(overrides = {}) {
    return createRecordingRecoveryScanner({
        recordingsBasePath: base,
        fs: fsMock,
        queryRows,
        querySingle,
        fileOperations: { deleteFileSafely },
        recoveryService: { isFileOwned },
        isFileBeingProcessed: () => false,
        onSegmentCreated,
        nowMs: () => Date.parse('2026-05-17T01:10:00.000Z'),
        logger,
        ...overrides,
    });
}

describe('recordingRecoveryScanner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fsMock.access.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({
            isDirectory: () => true,
            mtimeMs: Date.parse('2026-05-17T01:00:00.000Z'),
            size: 1024,
        });
        fsMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath === base) return ['camera7'];
            if (targetPath === join(base, 'camera7')) return [];
            if (targetPath === join(base, 'camera7', 'pending')) return ['20260517_010000.mp4.partial'];
            return [];
        });
        querySingle.mockReturnValue({ id: 7, enable_recording: 0 });
        queryRows.mockReturnValue([]);
        deleteFileSafely.mockResolvedValue({ success: true, size: 1024 });
        isFileOwned.mockReturnValue(false);
    });

    it('queues old pending partials even when recording is disabled but the camera still exists', async () => {
        const scanner = createScanner();

        const result = await scanner.scanOnce();

        expect(onSegmentCreated).toHaveBeenCalledWith(7, '20260517_010000.mp4.partial');
        expect(result.queuedSegments).toBe(1);
    });

    it('deletes only finalized duplicate pending partials through safe delete', async () => {
        queryRows.mockReturnValueOnce([{ filename: '20260517_010000.mp4' }]);
        const scanner = createScanner();

        const result = await scanner.scanOnce();

        expect(deleteFileSafely).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            reason: 'pending_partial_finalized_duplicate',
        }));
        expect(onSegmentCreated).not.toHaveBeenCalled();
        expect(result.duplicatePartialsDeleted).toBe(1);
    });

    it('queues unregistered final segments for recovery instead of deletion', async () => {
        fsMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath === base) return ['camera7'];
            if (targetPath === join(base, 'camera7')) return ['20260517_010000.mp4'];
            if (targetPath === join(base, 'camera7', 'pending')) return [];
            return [];
        });
        const scanner = createScanner();

        const result = await scanner.scanOnce();

        expect(onSegmentCreated).toHaveBeenCalledWith(7, '20260517_010000.mp4');
        expect(deleteFileSafely).not.toHaveBeenCalled();
        expect(result.queuedSegments).toBe(1);
    });
});
