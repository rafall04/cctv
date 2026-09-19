/**
 * Purpose: Freeze the presence gate on POST /api/viewer/runtime-signal. The endpoint is public
 *          (anonymous viewers report playback health), but applying a signal mutates camera health
 *          state and can trigger recording reconcile — so it must only apply while the camera has a
 *          live viewer session. A bare forge is acknowledged but ignored.
 * Caller: Vitest backend suite.
 * Deps: controllers/viewerController.js reportViewerRuntimeSignal (services mocked).
 * MainFuncs: reportViewerRuntimeSignal.
 * SideEffects: None.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/viewerSessionService.js', () => ({
    default: { hasActiveSessionForCamera: vi.fn() },
}));
vi.mock('../services/cameraService.js', () => ({
    default: { getCameraById: vi.fn() },
}));
vi.mock('../services/cameraHealthService.js', () => ({
    default: { recordRuntimeSignal: vi.fn() },
}));
vi.mock('../middleware/rateLimiter.js', () => ({
    checkRateLimit: vi.fn(),
}));

import viewerSessionService from '../services/viewerSessionService.js';
import cameraService from '../services/cameraService.js';
import cameraHealthService from '../services/cameraHealthService.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';
import { reportViewerRuntimeSignal } from '../controllers/viewerController.js';

function makeReply() {
    const reply = {
        statusCode: null,
        payload: null,
        headers: {},
        code(status) {
            this.statusCode = status;
            return this;
        },
        header(name, value) {
            this.headers[name] = value;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
    return reply;
}

function makeRequest(body) {
    return { body, ip: '203.0.113.9' };
}

beforeEach(() => {
    vi.clearAllMocks();
    cameraService.getCameraById.mockReturnValue({ id: 1, enabled: 1 });
    checkRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    viewerSessionService.hasActiveSessionForCamera.mockReturnValue(false);
});

describe('runtime-signal presence gate', () => {
    it('rejects an unknown camera with 404 and never records', async () => {
        // getCameraById THROWS a 404-carrying error for unknown ids (it does not return null).
        cameraService.getCameraById.mockImplementation(() => {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        });
        const reply = makeReply();
        await reportViewerRuntimeSignal(makeRequest({ cameraId: 999999, success: true }), reply);
        expect(reply.statusCode).toBe(404);
        expect(cameraHealthService.recordRuntimeSignal).not.toHaveBeenCalled();
    });

    it('acknowledges but IGNORES a signal with no active viewer session', async () => {
        const reply = makeReply();
        await reportViewerRuntimeSignal(makeRequest({ cameraId: 1, success: true }), reply);
        expect(reply.statusCode).toBeNull();
        expect(reply.payload).toMatchObject({ success: true, ignored: true });
        expect(cameraHealthService.recordRuntimeSignal).not.toHaveBeenCalled();
    });

    it('applies the signal while a viewer session is live', async () => {
        viewerSessionService.hasActiveSessionForCamera.mockReturnValue(true);
        const reply = makeReply();
        await reportViewerRuntimeSignal(makeRequest({ cameraId: 1, success: true, signalType: 'external_hls_runtime_playing' }), reply);
        expect(reply.statusCode).toBeNull();
        expect(reply.payload).toMatchObject({ success: true });
        expect(reply.payload.ignored).toBeUndefined();
        expect(cameraHealthService.recordRuntimeSignal).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ success: true, signalType: 'external_hls_runtime_playing' }),
        );
    });

    it('rate-limits per camera and does not record when the gate is closed', async () => {
        viewerSessionService.hasActiveSessionForCamera.mockReturnValue(true);
        checkRateLimit.mockReturnValue({ allowed: false, retryAfter: 42 });
        const reply = makeReply();
        await reportViewerRuntimeSignal(makeRequest({ cameraId: 1, success: true }), reply);
        expect(reply.statusCode).toBe(429);
        expect(cameraHealthService.recordRuntimeSignal).not.toHaveBeenCalled();
    });
});
