/**
 * Purpose: Verify idempotent MP4 segment finalization from pending/final orphan files into DB-backed playback rows.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs, child_process, segment repository, diagnostics repository.
 * MainFuncs: createRecordingSegmentFinalizer, finalizeSegment, drain.
 * SideEffects: Uses mocks only.
 */
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
const spawnMock = vi.fn();
const fsPromisesMock = {
    access: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
};
const repository = { upsertSegment: vi.fn() };
const diagnostics = { upsertDiagnostic: vi.fn(), clearDiagnostic: vi.fn() };

vi.mock('child_process', () => ({ exec: execMock, spawn: spawnMock }));
vi.mock('fs', () => ({ promises: fsPromisesMock, existsSync: vi.fn(() => true), unlinkSync: vi.fn() }));

function createProcess(exitCode = 0) {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit('close', exitCode), 0);
    return child;
}

describe('recordingSegmentFinalizer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '240.2\n', stderr: '' }));
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.mkdir.mockResolvedValue(undefined);
        fsPromisesMock.stat
            .mockResolvedValueOnce({ size: 1000, mtimeMs: Date.now() - 60000 })
            .mockResolvedValueOnce({ size: 1000, mtimeMs: Date.now() - 60000 })
            .mockResolvedValue({ size: 2048, mtimeMs: Date.now() - 60000 });
        fsPromisesMock.rename.mockResolvedValue(undefined);
        fsPromisesMock.copyFile.mockResolvedValue(undefined);
        fsPromisesMock.unlink.mockResolvedValue(undefined);
        spawnMock.mockImplementation(() => createProcess(0));
        repository.upsertSegment.mockReturnValue({ changes: 1 });
    });

    it('finalizes a stable partial into final MP4 and upserts the DB segment', async () => {
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const promise = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        const result = await promise;

        expect(result).toMatchObject({ success: true, finalFilename: '20260511_211000.mp4' });
        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            '-i',
            'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            'C:\\recordings\\camera9\\20260511_211000.tmp.mp4',
        ]));
        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            '-f',
            'mp4',
            'C:\\recordings\\camera9\\20260511_211000.tmp.mp4',
        ]));
        expect(fsPromisesMock.rename).toHaveBeenCalledWith(
            'C:\\recordings\\camera9\\20260511_211000.tmp.mp4',
            'C:\\recordings\\camera9\\20260511_211000.mp4'
        );
        expect(repository.upsertSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 9,
            filename: '20260511_211000.mp4',
            duration: 240,
            filePath: 'C:\\recordings\\camera9\\20260511_211000.mp4',
        }));
        expect(fsPromisesMock.unlink).toHaveBeenCalledWith(
            'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial'
        );
        expect(diagnostics.clearDiagnostic).toHaveBeenCalledWith({ cameraId: 9, filename: '20260511_211000.mp4' });
    });

    it('serializes duplicate finalization requests for the same camera and final filename', async () => {
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const first = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        const second = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        await Promise.all([first, second]);

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(repository.upsertSegment).toHaveBeenCalledTimes(1);
    });

    it('keeps finalization successful when finalized partial cleanup fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fsPromisesMock.unlink.mockRejectedValueOnce(new Error('busy'));
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const promise = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        const result = await promise;

        expect(result).toMatchObject({ success: true, finalFilename: '20260511_211000.mp4' });
        expect(repository.upsertSegment).toHaveBeenCalledTimes(1);
        expect(diagnostics.upsertDiagnostic).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to cleanup finalized partial'));
    });

    it('records retryable diagnostic when ffprobe returns zero duration', async () => {
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '0\n', stderr: '' }));
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const promise = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        const result = await promise;

        expect(result).toMatchObject({ success: false, reason: 'invalid_duration' });
        expect(repository.upsertSegment).not.toHaveBeenCalled();
        expect(diagnostics.upsertDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 9,
            filename: '20260511_211000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
        }));
    });

    it('keeps partial source and removes temp when remux fails', async () => {
        spawnMock.mockImplementation(() => createProcess(1));
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const promise = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        const result = await promise;

        expect(result.success).toBe(false);
        expect(repository.upsertSegment).not.toHaveBeenCalled();
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(
            'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial'
        );
        expect(fsPromisesMock.unlink).toHaveBeenCalledWith(
            'C:\\recordings\\camera9\\20260511_211000.tmp.mp4'
        );
    });
});
