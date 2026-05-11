/**
 * Purpose: Tests Camera controller response contracts for source lifecycle operations.
 * Caller: Backend Vitest suite for camera route/controller behavior.
 * Deps: Vitest, mocked cameraService, cameraController handlers.
 * MainFuncs: Validates update response data, manual stream refresh, and lifecycle event reads.
 * SideEffects: None; cameraService is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateCameraMock = vi.fn();
const refreshCameraStreamMock = vi.fn();
const getCameraSourceLifecycleEventsMock = vi.fn();

vi.mock('../services/cameraService.js', () => ({
    default: {
        updateCamera: updateCameraMock,
        refreshCameraStream: refreshCameraStreamMock,
        getCameraSourceLifecycleEvents: getCameraSourceLifecycleEventsMock,
    },
}));

function createReply() {
    return {
        statusCode: 200,
        payload: null,
        code(value) {
            this.statusCode = value;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return payload;
        },
    };
}

describe('cameraController source lifecycle responses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('includes lifecycle data in update response', async () => {
        updateCameraMock.mockResolvedValue({
            cameraId: 7,
            sourceLifecycle: { sourceChanged: true, status: 'refreshed' },
        });
        const { updateCamera } = await import('../controllers/cameraController.js');
        const reply = createReply();

        await updateCamera({ params: { id: 7 }, body: { private_rtsp_url: 'rtsp://new' } }, reply);

        expect(reply.payload).toEqual({
            success: true,
            message: 'Camera updated successfully',
            data: {
                cameraId: 7,
                sourceLifecycle: { sourceChanged: true, status: 'refreshed' },
            },
        });
    });

    it('refreshes one camera stream manually', async () => {
        refreshCameraStreamMock.mockResolvedValue({
            cameraId: 7,
            sourceLifecycle: { sourceChanged: true, reason: 'manual_refresh', status: 'refreshed' },
        });
        const { refreshCameraStream } = await import('../controllers/cameraController.js');
        const reply = createReply();
        const request = { params: { id: 7 }, user: { id: 3 }, ip: '127.0.0.1' };

        await refreshCameraStream(request, reply);

        expect(refreshCameraStreamMock).toHaveBeenCalledWith(7, request);
        expect(reply.payload).toMatchObject({
            success: true,
            message: 'Camera stream refreshed successfully',
            data: {
                cameraId: 7,
                sourceLifecycle: { reason: 'manual_refresh', status: 'refreshed' },
            },
        });
    });

    it('returns recent camera source lifecycle events', async () => {
        getCameraSourceLifecycleEventsMock.mockReturnValue([
            { id: 1, camera_id: 7, status: 'refreshed' },
        ]);
        const { getCameraSourceLifecycleEvents } = await import('../controllers/cameraController.js');
        const reply = createReply();

        await getCameraSourceLifecycleEvents({ params: { id: 7 } }, reply);

        expect(getCameraSourceLifecycleEventsMock).toHaveBeenCalledWith(7);
        expect(reply.payload).toEqual({
            success: true,
            data: [{ id: 1, camera_id: 7, status: 'refreshed' }],
        });
    });
});
