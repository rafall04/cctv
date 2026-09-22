/**
 * Purpose: Regression — POST /api/viewer/start must apply the same canViewLive gate as live HLS.
 *          Without it, anonymous callers could open sessions on private/suspended cameras and
 *          inflate the public view counters feeding /api/public/trending-cameras.
 * Caller: Backend Vitest suite.
 * Deps: Vitest; all services mocked — only the controller wiring is under test.
 * MainFuncs: startViewerSession.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getCameraByIdMock,
    startSessionMock,
    getAccessInfoMock,
    canViewLiveMock,
} = vi.hoisted(() => ({
    getCameraByIdMock: vi.fn(),
    startSessionMock: vi.fn(),
    getAccessInfoMock: vi.fn(),
    canViewLiveMock: vi.fn(),
}));

vi.mock('../services/cameraService.js', () => ({
    default: { getCameraById: getCameraByIdMock },
}));

vi.mock('../services/viewerSessionService.js', () => ({
    default: { startSession: startSessionMock, hasActiveSessionForCamera: () => false },
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: { recordRuntimeSignal: vi.fn() },
}));

vi.mock('../services/cameraAccessService.js', () => ({
    getAccessInfo: getAccessInfoMock,
    canViewLive: canViewLiveMock,
}));

vi.mock('../services/hlsProxyService.js', () => ({
    resolveHlsViewerUser: () => null,
}));

vi.mock('../services/voucherPass.js', () => ({
    readVoucherDeviceHash: () => null,
}));

const { startViewerSession } = await import('../controllers/viewerController.js');

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

const ENABLED_CAM = { id: 9, enabled: 1, delivery_type: 'internal_hls' };

describe('startViewerSession access gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCameraByIdMock.mockReturnValue(ENABLED_CAM);
        getAccessInfoMock.mockReturnValue(ENABLED_CAM);
        startSessionMock.mockReturnValue('sess-1');
    });

    it('creates a session when the live gate allows', async () => {
        canViewLiveMock.mockReturnValue({ allowed: true });
        const reply = createReply();

        await startViewerSession({ body: { cameraId: 9 } }, reply);

        expect(reply.payload.success).toBe(true);
        expect(startSessionMock).toHaveBeenCalled();
    });

    it('refuses a session when the live gate denies (private/suspended camera)', async () => {
        canViewLiveMock.mockReturnValue({ allowed: false, statusCode: 403 });
        const reply = createReply();

        await startViewerSession({ body: { cameraId: 9 } }, reply);

        expect(reply.statusCode).toBe(403);
        expect(reply.payload.success).toBe(false);
        expect(startSessionMock).not.toHaveBeenCalled();
    });

    it('refuses voucher-gated cameras without a pass (402)', async () => {
        canViewLiveMock.mockReturnValue({ allowed: false, statusCode: 402 });
        const reply = createReply();

        await startViewerSession({ body: { cameraId: 9 } }, reply);

        expect(reply.statusCode).toBe(402);
        expect(startSessionMock).not.toHaveBeenCalled();
    });
});
