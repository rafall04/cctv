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
