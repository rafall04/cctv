/**
 * Purpose: Validate boot-time stray-recording-ffmpeg reaper: matching, kill call, guards.
 * Caller: Vitest backend suite.
 * Deps: reapStrayRecordingProcesses with injected runCommand/platform/logger.
 * SideEffects: None; runCommand is mocked (no real ps/kill).
 */
import { describe, expect, it, vi } from 'vitest';
import { reapStrayRecordingProcesses } from '../services/recordingOrphanReaper.js';

const BASE = '/srv/rafnet/recordings';

function psOutput() {
    return [
        '  101 ffmpeg -rtsp_transport tcp -i rtsp://cam1/stream -c:v copy -f segment /srv/rafnet/recordings/camera1/pending/a.mp4.partial',
        '  102 ffmpeg -rtsp_transport tcp -i rtsp://cam2/stream -c:v copy -f segment /srv/rafnet/recordings/camera22/pending/b.mp4.partial',
        '  103 ffmpeg -i rtsp://cam1/stream -vframes 1 /srv/rafnet/backend/data/thumbnails/1_temp.jpg', // thumbnail, not recording
        '  200 node /srv/rafnet/backend/server.js',
        '',
    ].join('\n');
}

function makeRun(out = psOutput()) {
    return vi.fn(async (cmd) => {
        if (String(cmd).startsWith('ps ')) return { stdout: out };
        return { stdout: '' };
    });
}

describe('reapStrayRecordingProcesses', () => {
    it('kills only recording ffmpeg (cameraN/pending), not thumbnails or non-ffmpeg', async () => {
        const runCommand = makeRun();
        const logger = { log: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger,
        });

        expect(result.killed).toEqual([101, 102]);
        expect(runCommand).toHaveBeenCalledWith('kill -9 101 102');
    });

    it('no-ops when nothing matches (no kill call)', async () => {
        const runCommand = makeRun('  200 node /srv/rafnet/backend/server.js\n');

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux',
        });

        expect(result.killed).toEqual([]);
        expect(runCommand).toHaveBeenCalledTimes(1); // only the ps call, no kill
    });

    it('skips entirely on non-Linux platforms', async () => {
        const runCommand = makeRun();

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'win32',
        });

        expect(result).toEqual({ skipped: 'unsupported_platform', killed: [] });
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('never throws — reports error if the command fails', async () => {
        const runCommand = vi.fn(async () => { throw new Error('ps not found'); });
        const logger = { log: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger,
        });

        expect(result.killed).toEqual([]);
        expect(result.error).toMatch(/ps not found/);
        expect(logger.error).toHaveBeenCalled();
    });
});
