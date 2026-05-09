/*
Purpose: Regression coverage for camera update driven recording lifecycle reconciliation.
Caller: Vitest backend suite.
Deps: cameraService.updateCamera(), mocked connectionPool, MediaMTX, recordingService, audit/cache services.
MainFuncs: createExistingCamera(), runUpdate(), recording restart/start/stop assertions.
SideEffects: Mocks database, MediaMTX, cache, audit, and recording lifecycle calls.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();
const queryMock = vi.fn();
const executeMock = vi.fn();
const updateCameraPathMock = vi.fn();
const removeCameraPathByKeyMock = vi.fn();
const restartRecordingMock = vi.fn();
const startRecordingMock = vi.fn();
const stopRecordingMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
    transaction: vi.fn((fn) => fn()),
}));

vi.mock('../services/mediaMtxService.js', () => ({
    default: {
        updateCameraPath: updateCameraPathMock,
        removeCameraPathByKey: removeCameraPathByKeyMock,
    },
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        restartRecording: restartRecordingMock,
        startRecording: startRecordingMock,
        stopRecording: stopRecordingMock,
        getRecordingStatus: vi.fn(() => ({ status: 'recording', isRecording: true })),
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: vi.fn(),
    logCameraCreated: vi.fn(),
    logCameraUpdated: vi.fn(),
    logCameraDeleted: vi.fn(),
}));

vi.mock('../middleware/cacheMiddleware.js', () => ({
    invalidateCache: vi.fn(),
}));

vi.mock('../services/cacheService.js', () => ({
    cacheGetOrSetSync: vi.fn((key, factory) => factory()),
    cacheInvalidate: vi.fn(),
    cacheKey: vi.fn((...parts) => parts.join(':')),
    CacheNamespace: {
        CAMERAS: 'cameras',
        PUBLIC: 'public',
    },
}));

vi.mock('../services/thumbnailPathService.js', () => ({
    sanitizeCameraThumbnail: vi.fn((camera) => camera),
    sanitizeCameraThumbnailList: vi.fn((cameras) => cameras),
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        checkCamera: vi.fn(),
    },
}));

vi.mock('../services/cameraRuntimeStateService.js', () => ({
    default: {
        updateState: vi.fn(),
    },
}));

function createExistingCamera(overrides = {}) {
    return {
        id: 7,
        name: 'Gate Camera',
        private_rtsp_url: 'rtsp://user:pass@10.0.0.7/stream1',
        area_id: 2,
        enabled: 1,
        stream_key: 'stream-key-7',
        enable_recording: 1,
        stream_source: 'internal',
        delivery_type: 'internal_hls',
        external_hls_url: null,
        external_stream_url: null,
        external_embed_url: null,
        external_snapshot_url: null,
        external_origin_mode: 'direct',
        external_use_proxy: 1,
        external_tls_mode: 'strict',
        external_health_mode: 'default',
        public_playback_mode: 'inherit',
        public_playback_preview_minutes: 10,
        internal_ingest_policy_override: 'default',
        internal_on_demand_close_after_seconds_override: null,
        internal_rtsp_transport_override: 'default',
        thumbnail_strategy: 'default',
        source_profile: null,
        video_codec: 'h264',
        recording_status: 'recording',
        ...overrides,
    };
}

async function runUpdate(payload, existing = createExistingCamera()) {
    vi.resetModules();
    queryOneMock.mockImplementation((sql) => {
        if (sql.includes('FROM cameras WHERE id = ?')) {
            return existing;
        }
        if (sql.includes('FROM areas WHERE id = ?')) {
            return {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: 30,
                internal_rtsp_transport_default: 'default',
            };
        }
        return null;
    });
    const cameraService = (await import('../services/cameraService.js')).default;
    await cameraService.updateCamera(7, payload, {
        user: { id: 3, username: 'admin' },
        ip: '127.0.0.1',
    });
}

describe('cameraService.updateCamera recording lifecycle reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMock.mockReturnValue([]);
        executeMock.mockReturnValue({ changes: 1, lastInsertRowid: 7 });
        updateCameraPathMock.mockResolvedValue({ success: true, action: 'updated' });
        removeCameraPathByKeyMock.mockResolvedValue({ success: true });
        restartRecordingMock.mockResolvedValue({ success: true });
        startRecordingMock.mockResolvedValue({ success: true });
        stopRecordingMock.mockResolvedValue({ success: true });
    });

    it('restarts active recording after RTSP URL changes', async () => {
        await runUpdate({ private_rtsp_url: 'rtsp://user:pass@10.0.0.8/stream1' });

        expect(updateCameraPathMock).toHaveBeenCalledWith(
            'stream-key-7',
            'rtsp://user:pass@10.0.0.8/stream1',
            expect.objectContaining({ private_rtsp_url: 'rtsp://user:pass@10.0.0.8/stream1' })
        );
        expect(restartRecordingMock).toHaveBeenCalledWith(7, 'camera_source_updated');
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('restarts active recording after video codec changes', async () => {
        await runUpdate({ video_codec: 'h265' });

        expect(restartRecordingMock).toHaveBeenCalledWith(7, 'camera_source_updated');
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('stops recording when delivery changes to a non-recordable type', async () => {
        await runUpdate({
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            external_stream_url: 'https://example.test/live.mjpeg',
        });

        expect(removeCameraPathByKeyMock).toHaveBeenCalledWith('stream-key-7');
        expect(stopRecordingMock).toHaveBeenCalledWith(7, expect.objectContaining({
            reason: 'camera_source_updated',
        }));
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(startRecordingMock).not.toHaveBeenCalled();
    });

    it('starts recording when an enabled recordable camera is enabled from disabled state', async () => {
        await runUpdate({ enabled: 1 }, createExistingCamera({
            enabled: 0,
            recording_status: 'stopped',
        }));

        expect(startRecordingMock).toHaveBeenCalledWith(7);
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });

    it('does not restart recording for metadata-only edits', async () => {
        await runUpdate({ name: 'Gate Camera Updated', location: 'North Gate' });

        expect(updateCameraPathMock).not.toHaveBeenCalled();
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
    });
});
