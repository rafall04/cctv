/**
 * Purpose: Validate recorder discovery (scan/parse) and the selective, SIGINT-first
 *          retirement of recorders this instance does not want to keep.
 * Caller: Vitest backend suite.
 * Deps: scanRecordingProcesses / parseRecordingProcesses / reapStrayRecordingProcesses
 *       with injected runCommand/platform/logger/wait.
 * SideEffects: None; runCommand is mocked (no real ps/kill).
 */
import { describe, expect, it, vi } from 'vitest';
import {
    parseRecordingProcesses,
    reapStrayRecordingProcesses,
    scanRecordingProcesses,
} from '../services/recordingOrphanReaper.js';

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

const noWait = vi.fn(async () => {});

describe('parseRecordingProcesses', () => {
    it('extracts pid + cameraId for recording ffmpeg only', () => {
        expect(parseRecordingProcesses(psOutput(), BASE)).toEqual([
            { pid: 101, cameraId: 1 },
            { pid: 102, cameraId: 22 },
        ]);
    });

    it('returns nothing without a base-path marker', () => {
        expect(parseRecordingProcesses(psOutput(), '')).toEqual([]);
    });
});

describe('scanRecordingProcesses', () => {
    it('lists running recorders without touching them', async () => {
        const runCommand = makeRun();

        const result = await scanRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux',
        });

        expect(result.processes).toEqual([
            { pid: 101, cameraId: 1 },
            { pid: 102, cameraId: 22 },
        ]);
        expect(runCommand).toHaveBeenCalledTimes(1); // ps only — never a kill
    });

    it('skips entirely on non-Linux platforms', async () => {
        const runCommand = makeRun();

        const result = await scanRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'win32',
        });

        expect(result).toEqual({ skipped: 'unsupported_platform', processes: [] });
        expect(runCommand).not.toHaveBeenCalled();
    });
});

describe('reapStrayRecordingProcesses', () => {
    it('SIGINTs unwanted recorders so ffmpeg can write the moov atom', async () => {
        // Second ps call (the survivor re-check) reports both gone.
        const runCommand = vi.fn(async (cmd) => {
            if (String(cmd).startsWith('ps ')) {
                return { stdout: runCommand.mock.calls.filter((c) => String(c[0]).startsWith('ps ')).length === 1
                    ? psOutput()
                    : '  200 node /srv/rafnet/backend/server.js\n' };
            }
            return { stdout: '' };
        });
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger, wait: noWait,
        });

        expect(result.killed).toEqual([101, 102]);
        expect(runCommand).toHaveBeenCalledWith('kill -INT 101 102');
        // Nothing survived the SIGINT, so no SIGKILL was needed.
        expect(runCommand).not.toHaveBeenCalledWith(expect.stringContaining('kill -9'));
    });

    it('keeps adopted recorders alive — they are the ones still writing good video', async () => {
        const runCommand = makeRun();
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger,
            keepPids: [101, 102], wait: noWait,
        });

        expect(result.killed).toEqual([]);
        expect(runCommand).toHaveBeenCalledTimes(1); // ps only, no signal at all
    });

    it('escalates to SIGKILL only for recorders that ignored SIGINT', async () => {
        // 101 exits on SIGINT; 102 hangs and is still present on the re-scan.
        let psCalls = 0;
        const runCommand = vi.fn(async (cmd) => {
            if (String(cmd).startsWith('ps ')) {
                psCalls += 1;
                return { stdout: psCalls === 1
                    ? psOutput()
                    : '  102 ffmpeg -i rtsp://cam2/stream -f segment /srv/rafnet/recordings/camera22/pending/b.mp4.partial\n' };
            }
            return { stdout: '' };
        });
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger, wait: noWait,
        });

        expect(runCommand).toHaveBeenCalledWith('kill -INT 101 102');
        expect(runCommand).toHaveBeenCalledWith('kill -9 102');
        expect(result.forceKilled).toEqual([102]);
    });

    it('no-ops when nothing matches (no kill call)', async () => {
        const runCommand = makeRun('  200 node /srv/rafnet/backend/server.js\n');

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', wait: noWait,
        });

        expect(result.killed).toEqual([]);
        expect(runCommand).toHaveBeenCalledTimes(1); // only the ps call, no kill
    });

    it('skips entirely on non-Linux platforms', async () => {
        const runCommand = makeRun();

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'win32', wait: noWait,
        });

        expect(result.killed).toEqual([]);
        expect(result.skipped).toBe('unsupported_platform');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('never throws — reports error if the command fails', async () => {
        const runCommand = vi.fn(async () => { throw new Error('ps not found'); });
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        const result = await reapStrayRecordingProcesses({
            recordingsBasePath: BASE, runCommand, platform: 'linux', logger, wait: noWait,
        });

        expect(result.killed).toEqual([]);
        expect(result.error).toMatch(/ps not found/);
        expect(logger.error).toHaveBeenCalled();
    });
});
