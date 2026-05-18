/**
 * Purpose: Verify emergency recording disk cleanup orchestration.
 * Caller: Vitest backend suite.
 * Deps: recordingEmergencyDiskService with injected disk reader, cleanup service, filesystem, and repository callbacks.
 * MainFuncs: createRecordingEmergencyDiskService.
 * SideEffects: None; dependencies are mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';

function createService(overrides = {}) {
    const cleanupService = {
        emergencyCleanup: vi.fn(async () => ({ deleted: 1, deletedBytes: 4096 })),
    };
    const diskSpaceService = {
        getFreeBytes: vi.fn(async () => 100),
    };
    const fs = {
        access: vi.fn(async () => undefined),
        readdir: vi.fn(async (targetPath) => {
            if (String(targetPath).endsWith('recordings')) return ['camera7'];
            return ['20260518_090000.mp4', '20260518_090100.temp.mp4'];
        }),
        stat: vi.fn(async (targetPath) => ({
            isDirectory: () => String(targetPath).endsWith('camera7'),
            mtimeMs: Date.parse('2026-05-18T02:00:00.000Z'),
            size: 1024,
        })),
    };
    const safeDelete = vi.fn(async () => ({ success: true, size: 1024 }));
    const onRecoverOrphan = vi.fn();

    return {
        cleanupService,
        diskSpaceService,
        fs,
        safeDelete,
        onRecoverOrphan,
        serviceOptions: {
            recordingsBasePath: join('C:\\', 'recordings'),
            cleanupService,
            diskSpaceService,
            fs,
            safeDelete,
            getCameraRetentionHours: () => 1,
            onRecoverOrphan,
            logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            now: () => Date.parse('2026-05-18T10:00:00.000Z'),
            ...overrides,
        },
    };
}

describe('recordingEmergencyDiskService', () => {
    it('skips cleanup when disk space is above threshold', async () => {
        const { createRecordingEmergencyDiskService } = await import('../services/recordingEmergencyDiskService.js');
        const diskSpaceService = { getFreeBytes: vi.fn(async () => 3 * 1024 * 1024 * 1024) };
        const { serviceOptions, cleanupService } = createService({ diskSpaceService });
        const service = createRecordingEmergencyDiskService(serviceOptions);

        const result = await service.runEmergencyCheck();

        expect(result.status).toBe('skipped_enough_space');
        expect(diskSpaceService.getFreeBytes).toHaveBeenCalled();
        expect(cleanupService.emergencyCleanup).not.toHaveBeenCalled();
    });

    it('uses cleanupService retention bypass before filesystem fallback', async () => {
        const { createRecordingEmergencyDiskService } = await import('../services/recordingEmergencyDiskService.js');
        const { serviceOptions, cleanupService } = createService();
        const service = createRecordingEmergencyDiskService(serviceOptions);

        const result = await service.runEmergencyCheck();

        expect(cleanupService.emergencyCleanup).toHaveBeenCalledWith(expect.objectContaining({
            freeBytes: 100,
            targetFreeBytes: 2 * 1024 * 1024 * 1024,
            batchLimit: 200,
            allowRetentionBypass: true,
        }));
        expect(result.deleted).toBeGreaterThanOrEqual(1);
        expect(result.deletedBytes).toBeGreaterThanOrEqual(4096);
    });

    it('queues final filesystem orphans for recovery instead of deleting them directly', async () => {
        const { createRecordingEmergencyDiskService } = await import('../services/recordingEmergencyDiskService.js');
        const { serviceOptions, onRecoverOrphan, safeDelete } = createService({
            cleanupService: { emergencyCleanup: vi.fn(async () => ({ deleted: 0, deletedBytes: 0 })) },
        });
        const service = createRecordingEmergencyDiskService(serviceOptions);

        await service.runEmergencyCheck();

        expect(onRecoverOrphan).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260518_090000.mp4',
            sourceType: 'final_orphan',
        }));
        expect(safeDelete).not.toHaveBeenCalledWith(expect.objectContaining({
            filename: '20260518_090000.mp4',
        }));
    });
});
