/**
 * Purpose: Pin the auth wiring on GET /api/admin/system-health — it publishes host internals
 *          (paths, memory, pm2 process table), so requireAdmin must stay on the route.
 * Caller: backend test gate.
 * Deps: Fastify injection; every controller/service/middleware import is stubbed.
 * MainFuncs: adminRoutes registration for /system-health.
 * SideEffects: None — in-memory inject only.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSystemHealthMock, authMiddlewareMock, requireAdminMock } = vi.hoisted(() => ({
    getSystemHealthMock: vi.fn((request, reply) => reply.send({ success: true, data: { status: 'ok' } })),
    authMiddlewareMock: vi.fn(async () => {}),
    requireAdminMock: vi.fn(async () => {}),
}));

const stub = () => vi.fn((request, reply) => reply.send({ success: true }));

vi.mock('../controllers/adminController.js', () => ({
    getDashboardStats: stub(), getDashboardStreams: stub(), getTodayStats: stub(),
    testTelegramNotification: stub(), getTelegramConfig: stub(), updateTelegramConfig: stub(),
    previewNotificationDiagnostics: stub(), runNotificationDiagnosticsDrill: stub(),
    listNotificationDiagnosticsRuns: stub(), getViewerAnalytics: stub(),
    getViewerHistoryPage: stub(), getRealTimeViewers: stub(), getCameraHealthDebug: stub(),
    getRecordingHealth: stub(), getSystemHealth: getSystemHealthMock,
    getSecurityLogs: stub(), getSecurityStats: stub(), getCacheStats: stub(), clearCache: stub(),
    getTimezoneConfig: stub(), updateTimezoneConfig: stub(),
    exportDatabaseBackup: stub(), importDatabaseBackup: stub(), getBackupPreview: stub(),
}));
vi.mock('../controllers/apiKeyController.js', () => ({ generateApiKey: stub(), listApiKeys: stub(), deleteApiKey: stub() }));
vi.mock('../controllers/playbackTokenController.js', () => ({
    clearPlaybackTokenSessions: stub(), createPlaybackToken: stub(), deletePlaybackTokenById: stub(),
    listPlaybackTokenAuditLogs: stub(), listPlaybackTokens: stub(), revokePlaybackToken: stub(),
    sharePlaybackToken: stub(), updatePlaybackToken: stub(),
}));
vi.mock('../controllers/playbackProductController.js', () => ({ createPlaybackProduct: stub(), listPlaybackProducts: stub(), updatePlaybackProduct: stub() }));
vi.mock('../controllers/cameraSourceHealthController.js', () => ({ listDeadSources: stub() }));
vi.mock('../controllers/recordingCapacityController.js', () => ({ getRecordingCapacity: stub() }));
vi.mock('../controllers/adminCameraFeedbackController.js', () => ({ listCameraReactionSummary: stub(), listCameraReports: stub(), updateCameraReport: stub() }));
vi.mock('../middleware/authMiddleware.js', () => ({ authMiddleware: authMiddlewareMock, requireAdmin: requireAdminMock }));
vi.mock('../middleware/schemaValidators.js', () => ({ createApiKeySchema: {}, apiKeyIdParamSchema: {} }));
vi.mock('../services/mediaMtxService.js', () => ({ default: { getStats: vi.fn(), getDatabaseCameras: vi.fn(() => []), syncCameras: vi.fn(), listPaths: vi.fn(() => []) } }));
vi.mock('../utils/logRedaction.js', () => ({ stripUrlCredentials: (v) => v, redactUrlCredentials: (v) => v }));
vi.mock('../routes/vehicleCountAdminRoutes.js', () => ({ default: async () => {} }));
vi.mock('../routes/cameraTimeRoutes.js', () => ({ default: async () => {} }));

const buildApp = async () => {
    const { default: adminRoutes } = await import('../routes/adminRoutes.js');
    const app = Fastify();
    await app.register(adminRoutes, { prefix: '/api/admin' });
    return app;
};

describe('GET /api/admin/system-health', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireAdminMock.mockImplementation(async () => {});
        authMiddlewareMock.mockImplementation(async () => {});
    });

    it('serves the snapshot to an admin (both guards pass)', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/admin/system-health' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.payload).data.status).toBe('ok');
        expect(getSystemHealthMock).toHaveBeenCalledTimes(1);
        expect(authMiddlewareMock).toHaveBeenCalled();
        expect(requireAdminMock).toHaveBeenCalled();
    });

    it('never reaches the handler when requireAdmin rejects', async () => {
        requireAdminMock.mockImplementation(async (request, reply) => reply.code(403).send({ success: false }));
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/admin/system-health' });
        expect(res.statusCode).toBe(403);
        expect(getSystemHealthMock).not.toHaveBeenCalled();
    });
});
