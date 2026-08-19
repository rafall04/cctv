/*
Purpose: Validate pure recording lifecycle desired-state decisions.
Caller: Vitest backend suite.
Deps: recordingLifecyclePolicy.
MainFuncs: decideRecordingLifecycleAction and isRecordableCamera tests.
SideEffects: None; pure unit tests.
*/

import { describe, expect, it } from 'vitest';
import {
    decideRecordingLifecycleAction,
    isRecordableCamera,
} from '../services/recordingLifecyclePolicy.js';

function camera(overrides = {}) {
    return {
        id: 1,
        enabled: 1,
        enable_recording: 1,
        is_online: 1,
        delivery_type: 'internal_hls',
        ...overrides,
    };
}

function status(overrides = {}) {
    return {
        status: 'stopped',
        isRecording: false,
        ...overrides,
    };
}

describe('recordingLifecyclePolicy', () => {
    it('treats only enabled recordable HLS cameras as recordable', () => {
        expect(isRecordableCamera(camera())).toBe(true);
        expect(isRecordableCamera(camera({ delivery_type: 'external_hls' }))).toBe(true);
        expect(isRecordableCamera(camera({ delivery_type: 'external_mjpeg' }))).toBe(false);
        expect(isRecordableCamera(camera({ enabled: 0 }))).toBe(false);
        expect(isRecordableCamera(camera({ enable_recording: 0 }))).toBe(false);
    });

    it('starts a stopped eligible online camera', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 0, suspendedReason: null },
            now: 1000,
        })).toMatchObject({
            action: 'start',
            clearCooldown: true,
            reason: 'eligible_online_stopped',
        });
    });

    it('waits during non-offline cooldown instead of starting immediately', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 5000, suspendedReason: 'waiting_retry' },
            now: 1000,
        })).toMatchObject({
            action: 'wait_cooldown',
            reason: 'cooldown_active',
        });
    });

    it('allows an offline suspension to clear when the camera is online again', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 5000, suspendedReason: 'camera_offline' },
            now: 1000,
        })).toMatchObject({
            action: 'start',
            clearCooldown: true,
            reason: 'camera_back_online',
        });
    });

    it('stops a running process when the camera is offline', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera({ is_online: 0 }),
            processStatus: status({ status: 'recording', isRecording: true }),
            recordingStatus: {},
            now: 1000,
        })).toMatchObject({
            action: 'stop_offline',
            reason: 'camera_offline',
        });
    });

    it('does not start while an existing process is still stopping', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status({ status: 'stopping', isRecording: false }),
            recordingStatus: {},
            now: 1000,
        })).toMatchObject({
            action: 'noop_recording',
            reason: 'process_not_stopped',
        });
    });

    it('does nothing for disabled, unrecordable, offline-stopped, and already-recording cameras', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera({ enabled: 0 }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_disabled');

        expect(decideRecordingLifecycleAction({
            camera: camera({ delivery_type: 'external_mjpeg' }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_unrecordable');

        expect(decideRecordingLifecycleAction({
            camera: camera({ is_online: 0 }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_not_online');

        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status({ status: 'recording', isRecording: true }),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_recording');
    });
});

/*
 * REGRESSION (production, 2026-08-19): cameras 7 and 8 (UTARA PASAR NGITIK) filled their tiny
 * firmware session tables with zombie connections left by our own retries. MediaMTX and the health
 * probe were both refused, so health declared them offline — while the recorder, holding a session
 * opened before the table filled, was still pulling video and closing segments normally. This
 * branch then stopped that recorder, releasing the only slot that worked; on a camera whose table
 * is full, it could not be won back. The recording health monitor already refuses to stop a
 * recorder that is being fed; the 60s reconciler did not, and overruled it.
 */
describe('stop_offline tidak boleh membunuh perekam yang masih disuapi kamera', () => {
    const offlineCamera = {
        id: 8,
        enabled: 1,
        enable_recording: 1,
        delivery_type: 'internal_hls',
        is_online: 0,
    };
    const now = 1_700_000_000_000;

    it('mempertahankan perekam yang datanya masih segar meski kamera divonis offline', () => {
        const decision = decideRecordingLifecycleAction({
            camera: offlineCamera,
            processStatus: { status: 'recording', lastDataAt: now - 5_000 },
            now,
        });

        expect(decision.action).toBe('noop_recording_offline_but_fed');
    });

    it('tetap menghentikan perekam yang datanya sudah basi', () => {
        const decision = decideRecordingLifecycleAction({
            camera: offlineCamera,
            processStatus: { status: 'recording', lastDataAt: now - 45_000 },
            now,
        });

        expect(decision.action).toBe('stop_offline');
    });

    /* Tanpa bukti, tak ada veto — kalau tidak, proses basi jadi mustahil dimatikan. */
    it('menghentikan perekam yang tidak bisa dipertanggungjawabkan kesegarannya', () => {
        for (const processStatus of [
            { status: 'recording' },
            { status: 'recording', lastDataAt: null },
            { status: 'recording', lastDataAt: 0 },
            { status: 'recording', lastDataAt: 'bukan-angka' },
        ]) {
            expect(decideRecordingLifecycleAction({ camera: offlineCamera, processStatus, now }).action)
                .toBe('stop_offline');
        }
    });

    /* Kamera tunnel punya ambang lebih ketat (10s) — harus ikut ambangnya sendiri. */
    it('memakai ambang tunnel yang lebih ketat untuk kamera tunnel', () => {
        const tunnel = { ...offlineCamera, is_tunnel: 1 };

        expect(decideRecordingLifecycleAction({
            camera: tunnel, processStatus: { status: 'recording', lastDataAt: now - 5_000 }, now,
        }).action).toBe('noop_recording_offline_but_fed');

        expect(decideRecordingLifecycleAction({
            camera: tunnel, processStatus: { status: 'recording', lastDataAt: now - 20_000 }, now,
        }).action).toBe('stop_offline');
    });

    /* Veto ini HANYA untuk offline. Disabled/unrecordable tetap wajib berhenti. */
    it('tidak pernah memveto penghentian yang disengaja', () => {
        const fed = { status: 'recording', lastDataAt: now - 1_000 };

        expect(decideRecordingLifecycleAction({
            camera: { ...offlineCamera, enable_recording: 0 }, processStatus: fed, now,
        }).action).toBe('stop_disabled');

        expect(decideRecordingLifecycleAction({
            camera: { ...offlineCamera, is_online: 1, delivery_type: 'external_embed' }, processStatus: fed, now,
        }).action).toBe('stop_unrecordable');
    });

    it('kamera offline tanpa proses jalan tetap noop, bukan start', () => {
        expect(decideRecordingLifecycleAction({
            camera: offlineCamera, processStatus: { status: 'stopped' }, now,
        }).action).toBe('noop_not_online');
    });
});
