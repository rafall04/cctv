/**
 * Purpose: Validate recording cleanup orchestration, locking, and counters.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs promises and segment repository.
 * MainFuncs: cleanupCamera.
 * SideEffects: Filesystem and database operations are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const repositoryMock = {
    findExpiredSegments: vi.fn(),
    findMissingFileCandidates: vi.fn(),
    listFilenamesByCamera: vi.fn(),
    deleteSegmentById: vi.fn(),
};

const fsMock = {
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
};

const safeDeleteMock = vi.fn();
const isProcessingMock = vi.fn();

const { createRecordingCleanupService } = await import('../services/recordingCleanupService.js');

const recordingsBasePath = join(process.cwd(), '..', 'recordings');

function createService() {
    return createRecordingCleanupService({
        repository: repositoryMock,
        fs: fsMock,
        recordingsBasePath,
        safeDelete: safeDeleteMock,
        isFileBeingProcessed: isProcessingMock,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
}

describe('recordingCleanupService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repositoryMock.findExpiredSegments.mockReturnValue([]);
        repositoryMock.findMissingFileCandidates.mockReturnValue([]);
        repositoryMock.listFilenamesByCamera.mockReturnValue([]);
        repositoryMock.deleteSegmentById.mockReturnValue(undefined);
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readdir.mockResolvedValue([]);
        fsMock.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.parse('2026-05-02T08:00:00.000Z') });
        safeDeleteMock.mockResolvedValue({ success: true, size: 1024 });
        isProcessingMock.mockReturnValue(false);
    });

    it('deletes expired DB-tracked files and rows in a bounded batch', async () => {
        const filePath = join(recordingsBasePath, 'camera7', '20260502_080000.mp4');
        repositoryMock.findExpiredSegments.mockReturnValueOnce([
            {
                id: 1,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: filePath,
            },
        ]);

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(repositoryMock.findExpiredSegments).toHaveBeenCalledWith({
            cameraId: 7,
            cutoffIso: '2026-05-02T08:50:00.000Z',
            limit: 6,
        });
        expect(safeDeleteMock).toHaveBeenCalledWith({
            cameraId: 7,
            filename: '20260502_080000.mp4',
            filePath,
            reason: 'retention_expired',
        });
        expect(repositoryMock.deleteSegmentById).toHaveBeenCalledWith(1);
        expect(result.deleted).toBe(1);
    });

    it('skips DB deletion when safe delete rejects an unsafe path', async () => {
        repositoryMock.findExpiredSegments.mockReturnValueOnce([
            {
                id: 2,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: join('C:\\escape', '20260502_080000.mp4'),
            },
        ]);
        safeDeleteMock.mockResolvedValueOnce({ success: false, reason: 'unsafe_path' });

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(repositoryMock.deleteSegmentById).not.toHaveBeenCalledWith(2);
        expect(result.unsafeSkipped).toBe(1);
    });

    it('prevents overlapping cleanup for the same camera', async () => {
        let releaseDelete;
        safeDeleteMock.mockReturnValueOnce(new Promise((resolve) => {
            releaseDelete = () => resolve({ success: true, size: 1024 });
        }));
        repositoryMock.findExpiredSegments.mockReturnValue([
            {
                id: 3,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: join(recordingsBasePath, 'camera7', '20260502_080000.mp4'),
            },
        ]);

        const service = createService();
        const firstRun = service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });
        const secondRun = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(secondRun.skippedReason).toBe('cleanup_in_flight');
        releaseDelete();
        await firstRun;
    });
});
