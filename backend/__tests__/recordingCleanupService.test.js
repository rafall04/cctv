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

    it('continues emergency cleanup after skipped processing files', async () => {
        repositoryMock.findOldestSegmentsForEmergency = vi.fn()
            .mockReturnValueOnce([
                {
                    id: 1,
                    camera_id: 7,
                    filename: '20260502_080000.mp4',
                    start_time: '2026-05-02T08:00:00.000Z',
                    file_path: join(recordingsBasePath, 'camera7', '20260502_080000.mp4'),
                },
                {
                    id: 2,
                    camera_id: 7,
                    filename: '20260502_081000.mp4',
                    start_time: '2026-05-02T08:10:00.000Z',
                    file_path: join(recordingsBasePath, 'camera7', '20260502_081000.mp4'),
                },
            ])
            .mockReturnValueOnce([]);
        isProcessingMock
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        const service = createService();
        const result = await service.emergencyCleanup({
            freeBytes: 100,
            targetFreeBytes: 2000,
            batchLimit: 2,
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
            getCameraRetentionHours: () => 1,
        });

        expect(repositoryMock.deleteSegmentById).toHaveBeenCalledWith(2);
        expect(result.processingSkipped).toBe(1);
        expect(result.deleted).toBe(1);
    });

    it('keeps recent filesystem orphans until retention expires', async () => {
        fsMock.readdir.mockResolvedValueOnce(['20260502_095800.mp4']);
        repositoryMock.listFilenamesByCamera.mockReturnValueOnce([]);
        fsMock.stat.mockResolvedValueOnce({
            size: 2048,
            mtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
        });

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 5, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(safeDeleteMock).not.toHaveBeenCalled();
        expect(result.orphanDeleted).toBe(0);
    });

    it('deletes filesystem orphans only after retention expires', async () => {
        fsMock.readdir.mockResolvedValueOnce(['20260502_020000.mp4']);
        repositoryMock.listFilenamesByCamera.mockReturnValueOnce([]);
        fsMock.stat.mockResolvedValueOnce({
            size: 2048,
            mtimeMs: Date.parse('2026-05-02T02:01:00.000Z'),
        });

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 5, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(safeDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'filesystem_orphan_retention_expired',
        }));
        expect(result.orphanDeleted).toBe(1);
    });

    it('does not emergency-delete DB segments that are inside retention', async () => {
        repositoryMock.findOldestSegmentsForEmergency = vi.fn()
            .mockReturnValueOnce([
                {
                    id: 9,
                    camera_id: 7,
                    filename: '20260502_095800.mp4',
                    start_time: '2026-05-02T09:58:00.000Z',
                    file_path: join(recordingsBasePath, 'camera7', '20260502_095800.mp4'),
                },
            ])
            .mockReturnValueOnce([]);
        fsMock.stat.mockResolvedValue({ size: 4096, mtimeMs: Date.parse('2026-05-02T09:59:00.000Z') });

        const service = createService();
        const result = await service.emergencyCleanup({
            freeBytes: 100,
            targetFreeBytes: 2000,
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
            getCameraRetentionHours: () => 5,
        });

        expect(safeDeleteMock).not.toHaveBeenCalled();
        expect(repositoryMock.deleteSegmentById).not.toHaveBeenCalledWith(9);
        expect(result.deleted).toBe(0);
    });
});
