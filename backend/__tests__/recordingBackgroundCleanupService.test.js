/**
 * Purpose: Verify slow background reconciliation of unregistered recording files.
 * Caller: Vitest backend suite.
 * Deps: recordingBackgroundCleanupService with mocked filesystem, DB reads, and ffprobe.
 * MainFuncs: createRecordingBackgroundCleanupService.
 * SideEffects: None; dependencies are mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';

function createService(overrides = {}) {
    const scheduledCallbacks = [];
    const scheduleTimeout = vi.fn((callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
    });
    const fs = {
        access: vi.fn(async () => undefined),
        readdir: vi.fn(async (targetPath) => {
            if (String(targetPath).endsWith('recordings')) return ['camera7'];
            return ['20260518_170000.mp4'];
        }),
        stat: vi.fn(async (targetPath) => ({
            isDirectory: () => String(targetPath).endsWith('camera7'),
            mtimeMs: Date.parse('2026-05-18T09:59:00.000Z'),
            size: 1024,
        })),
    };
    const query = vi.fn((sql) => {
        if (sql.includes('SELECT filename FROM recording_segments')) return [];
        return [];
    });
    const queryOne = vi.fn(() => ({ recording_duration_hours: 5 }));
    const onSegmentCreated = vi.fn();
    const ffprobe = vi.fn(async () => ({ stdout: '', stderr: '' }));

    return {
        scheduleTimeout,
        scheduledCallbacks,
        fs,
        query,
        queryOne,
        onSegmentCreated,
        ffprobe,
        serviceOptions: {
            recordingsBasePath: join('C:\\', 'recordings'),
            fs,
            query,
            queryOne,
            ffprobe,
            recoveryService: { isFileOwned: () => false },
            onSegmentCreated,
            logger: { log: vi.fn(), error: vi.fn() },
            now: () => Date.parse('2026-05-18T10:40:00.000Z'),
            ...overrides,
        },
    };
}

describe('recordingBackgroundCleanupService', () => {
    it('uses timezone-aware retention age for unregistered final files', async () => {
        const { createRecordingBackgroundCleanupService } = await import('../services/recordingBackgroundCleanupService.js');
        const { serviceOptions, scheduleTimeout, scheduledCallbacks, onSegmentCreated } = createService();
        const service = createRecordingBackgroundCleanupService(serviceOptions);

        await service.buildQueue();
        await service.processOneQueueItem();

        expect(onSegmentCreated).toHaveBeenCalledWith(7, '20260518_170000.mp4');
    });

    it('does not process a file currently being finalized', async () => {
        const { createRecordingBackgroundCleanupService } = await import('../services/recordingBackgroundCleanupService.js');
        const { serviceOptions, scheduleTimeout, scheduledCallbacks, onSegmentCreated } = createService({
            recoveryService: { isFileOwned: () => true },
        });
        const service = createRecordingBackgroundCleanupService(serviceOptions);

        await service.buildQueue();
        await service.processOneQueueItem();

        expect(onSegmentCreated).not.toHaveBeenCalled();
    });

    it('keeps corrupt unregistered final files until retention cleanup owns deletion', async () => {
        const { createRecordingBackgroundCleanupService } = await import('../services/recordingBackgroundCleanupService.js');
        const ffprobe = vi.fn(async () => {
            throw new Error('invalid mp4');
        });
        const { serviceOptions, scheduleTimeout, scheduledCallbacks, onSegmentCreated } = createService({
            ffprobe,
            now: () => Date.parse('2026-05-18T10:40:00.000Z'),
        });
        const service = createRecordingBackgroundCleanupService(serviceOptions);

        await service.buildQueue();
        await service.processOneQueueItem();

        expect(ffprobe).toHaveBeenCalled();
        expect(onSegmentCreated).not.toHaveBeenCalled();
    });
});
