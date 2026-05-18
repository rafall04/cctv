/**
 * Purpose: Validate ffmpeg remux wrapper resolves on exit 0 and surfaces stderr tail on non-zero exit.
 * Caller: Vitest backend suite.
 * Deps: createRecordingRemuxer with vi.mock('child_process') spawn.
 * MainFuncs: remuxToFile.
 * SideEffects: None; spawn is mocked.
 */
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('child_process', async () => {
    const actual = await vi.importActual('child_process');
    return { ...actual, spawn: spawnMock };
});

function fakeFfmpegProcess() {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
}

describe('createRecordingRemuxer.remuxToFile', () => {
    afterEach(() => spawnMock.mockReset());

    it('resolves when ffmpeg exits with code 0', async () => {
        const proc = fakeFfmpegProcess();
        spawnMock.mockReturnValue(proc);
        const { createRecordingRemuxer } = await import('../services/recordingRemuxer.js');
        const remuxer = createRecordingRemuxer();

        const promise = remuxer.remuxToFile('/src.mp4', '/dst.mp4');
        proc.emit('close', 0);
        await expect(promise).resolves.toBeUndefined();

        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            '-i', '/src.mp4', '-c', 'copy', '-movflags', '+faststart', '-y', '/dst.mp4',
        ]));
    });

    it('rejects with stderr tail on non-zero exit', async () => {
        const proc = fakeFfmpegProcess();
        spawnMock.mockReturnValue(proc);
        const { createRecordingRemuxer } = await import('../services/recordingRemuxer.js');
        const remuxer = createRecordingRemuxer();

        const promise = remuxer.remuxToFile('/src.mp4', '/dst.mp4');
        proc.stderr.emit('data', Buffer.from('boom: invalid mp4 atom'));
        proc.emit('close', 137);

        await expect(promise).rejects.toThrow(/code 137/);
        await promise.catch((err) => expect(err.message).toContain('invalid mp4 atom'));
    });

    it('rejects when ffmpeg fails to spawn', async () => {
        const proc = fakeFfmpegProcess();
        spawnMock.mockReturnValue(proc);
        const { createRecordingRemuxer } = await import('../services/recordingRemuxer.js');
        const remuxer = createRecordingRemuxer();

        const promise = remuxer.remuxToFile('/src.mp4', '/dst.mp4');
        proc.emit('error', new Error('ENOENT'));

        await expect(promise).rejects.toThrow('ENOENT');
    });
});
