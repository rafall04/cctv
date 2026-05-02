/*
Purpose: Regression coverage for camera CRUD recording eligibility across HLS delivery types.
Caller: Backend Vitest suite before changing camera recording persistence behavior.
Deps: cameraService, connectionPool mocks, mediaMtxService, recordingService.
MainFuncs: cameraService.updateCamera() recording field persistence for external HLS cameras.
SideEffects: Mocks database writes and recording side effects.
*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';
import mediaMtxService from '../services/mediaMtxService.js';
import { recordingService } from '../services/recordingService.js';

const request = {
    user: { id: 1, username: 'admin' },
    ip: '127.0.0.1',
};

function createExternalHlsCamera(overrides = {}) {
    return {
        id: 12,
        name: 'External HLS Cam',
        enabled: 1,
        status: 'active',
        stream_key: 'stream-key-12',
        private_rtsp_url: null,
        enable_recording: 0,
        stream_source: 'external',
        delivery_type: 'external_hls',
        external_hls_url: 'https://example.com/live/index.m3u8',
        external_stream_url: 'https://example.com/live/index.m3u8',
        external_embed_url: null,
        external_snapshot_url: null,
        external_origin_mode: 'direct',
        external_use_proxy: 1,
        external_tls_mode: 'strict',
        external_health_mode: 'default',
        public_playback_mode: 'inherit',
        public_playback_preview_minutes: null,
        internal_ingest_policy_override: 'default',
        internal_on_demand_close_after_seconds_override: null,
        source_profile: null,
        ...overrides,
    };
}

describe('cameraService recording eligibility', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('persists enable_recording when Camera Management updates an external HLS camera', async () => {
        const executeSpy = vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue(createExternalHlsCamera());
        vi.spyOn(mediaMtxService, 'removeCameraPathByKey').mockResolvedValue({ success: true });
        vi.spyOn(recordingService, 'startRecording').mockResolvedValue({ success: true });

        await cameraService.updateCamera(12, {
            delivery_type: 'external_hls',
            stream_source: 'external',
            external_stream_url: 'https://example.com/live/index.m3u8',
            external_hls_url: 'https://example.com/live/index.m3u8',
            enable_recording: 1,
            recording_duration_hours: 24,
        }, request);

        const updateCall = executeSpy.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE cameras SET'));

        expect(updateCall).toBeTruthy();
        expect(updateCall[0]).toContain('enable_recording = ?');
        expect(updateCall[1][0]).toBe(1);
        expect(recordingService.startRecording).toHaveBeenCalledWith(12);
    });
});
