import { describe, expect, it } from 'vitest';
import { RecordingRuntimeState } from '../services/recordingRuntimeState.js';

describe('RecordingRuntimeState', () => {
    it('tracks active process metadata and stop intent', () => {
        const state = new RecordingRuntimeState();
        const process = { pid: 1234 };

        state.setActive(5, { process, streamSource: 'internal', startedAt: new Date('2026-05-01T00:00:00.000Z') });
        state.markStopping(5, 'server_shutdown', new Date('2026-05-01T00:00:01.000Z'));

        expect(state.get(5)).toMatchObject({
            cameraId: 5,
            pid: 1234,
            status: 'stopping',
            stopReason: 'server_shutdown',
            forcedKill: false,
        });
    });

    it('prevents overlapping restarts with a per-camera lock', () => {
        const state = new RecordingRuntimeState();

        expect(state.tryBeginRestart(7)).toBe(true);
        expect(state.tryBeginRestart(7)).toBe(false);

        state.endRestart(7);
        expect(state.tryBeginRestart(7)).toBe(true);
    });

    it('records exit facts before clearing active state', () => {
        const state = new RecordingRuntimeState();
        state.setActive(9, { process: { pid: 999 }, streamSource: 'internal' });

        state.markForcedKill(9);
        state.markExited(9, { exitCode: 255, exitSignal: null });

        expect(state.get(9)).toMatchObject({
            forcedKill: true,
            lastExitCode: 255,
            lastExitSignal: null,
        });

        state.remove(9);
        expect(state.get(9)).toBe(null);
    });
});
