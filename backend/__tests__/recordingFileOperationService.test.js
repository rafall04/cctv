/**
 * Purpose: Validate safe recording delete and quarantine side effects.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs promises and recordingFileOperationService.
 * MainFuncs: deleteFileSafely, quarantineFile.
 * SideEffects: Filesystem operations are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const fsMock = {
    stat: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
};

const { createRecordingFileOperationService } = await import('../services/recordingFileOperationService.js');

describe('recordingFileOperationService', () => {
    const recordingsBasePath = join(process.cwd(), '..', 'recordings');

    beforeEach(() => {
        vi.clearAllMocks();
        fsMock.stat.mockResolvedValue({ size: 4096 });
        fsMock.unlink.mockResolvedValue(undefined);
        fsMock.access.mockResolvedValue(undefined);
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);
        fsMock.copyFile.mockResolvedValue(undefined);
    });

    it('deletes only safe recording paths', async () => {
        const service = createRecordingFileOperationService({ fs: fsMock, recordingsBasePath });
        const result = await service.deleteFileSafely({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            reason: 'retention_expired',
        });

        expect(result).toEqual({ success: true, size: 4096 });
        expect(fsMock.unlink).toHaveBeenCalledWith(join(recordingsBasePath, 'camera7', '20260517_010000.mp4'));
    });

    it('refuses unsafe delete paths', async () => {
        const service = createRecordingFileOperationService({
            fs: fsMock,
            recordingsBasePath,
            logger: { warn: vi.fn(), error: vi.fn() },
        });
        const result = await service.deleteFileSafely({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera8', '20260517_010000.mp4'),
            reason: 'retention_expired',
        });

        expect(result).toMatchObject({ success: false, skipped: true, reason: 'unsafe_path' });
        expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('quarantines safe files before permanent deletion', async () => {
        const service = createRecordingFileOperationService({ fs: fsMock, recordingsBasePath, now: () => 12345 });
        const result = await service.quarantineFile({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            reason: 'terminal_recovery_failed',
        });

        expect(result.success).toBe(true);
        expect(fsMock.mkdir).toHaveBeenCalledWith(join(recordingsBasePath, '.quarantine', 'camera7'), { recursive: true });
        expect(fsMock.rename).toHaveBeenCalledWith(
            join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            join(recordingsBasePath, '.quarantine', 'camera7', '12345_terminal_recovery_failed_20260517_010000.mp4')
        );
    });
});
