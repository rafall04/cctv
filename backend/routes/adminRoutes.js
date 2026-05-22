/**
 * Purpose: Register protected admin endpoints for dashboard, analytics, settings, cache, and operational tooling.
 * Caller: backend/server.js under the /api/admin prefix.
 * Deps: admin controllers, API key controller, playback token controller, auth middleware, MediaMTX service.
 * MainFuncs: adminRoutes.
 * SideEffects: Adds authenticated admin routes to Fastify.
 */

import { getDashboardStats, getTodayStats, testTelegramNotification, getTelegramConfig, updateTelegramConfig, previewNotificationDiagnostics, runNotificationDiagnosticsDrill, listNotificationDiagnosticsRuns, getViewerAnalytics, getViewerHistoryPage, getRealTimeViewers, getCameraHealthDebug, getRecordingHealth, getCacheStats, clearCache, getTimezoneConfig, updateTimezoneConfig, exportDatabaseBackup, importDatabaseBackup, getBackupPreview } from '../controllers/adminController.js';
import { generateApiKey, listApiKeys, deleteApiKey } from '../controllers/apiKeyController.js';
import { clearPlaybackTokenSessions, createPlaybackToken, listPlaybackTokenAuditLogs, listPlaybackTokens, revokePlaybackToken, sharePlaybackToken, updatePlaybackToken } from '../controllers/playbackTokenController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import { createApiKeySchema, apiKeyIdParamSchema } from '../middleware/schemaValidators.js';
import mediaMtxService from '../services/mediaMtxService.js';

export default async function adminRoutes(fastify, options) {
    // Dashboard stats
    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getDashboardStats,
    });

    // Today's quick stats with comparison
    fastify.get('/stats/today', {
        onRequest: [authMiddleware],
        handler: getTodayStats,
    });

    // Viewer Analytics endpoints
    fastify.get('/analytics/viewers', {
        onRequest: [authMiddleware],
        handler: getViewerAnalytics,
    });

    fastify.get('/analytics/viewers/history', {
        onRequest: [authMiddleware],
        handler: getViewerHistoryPage,
    });

    fastify.get('/analytics/realtime', {
        onRequest: [authMiddleware],
        handler: getRealTimeViewers,
    });

    fastify.get('/debug/camera-health', {
        onRequest: [authMiddleware],
        handler: getCameraHealthDebug,
    });

    // Recording-pipeline health snapshot (scheduler/recovery/restart telemetry)
    fastify.get('/recording-health', {
        onRequest: [authMiddleware],
        handler: getRecordingHealth,
    });

    // Telegram notification endpoints
    fastify.post('/telegram/test', {
        onRequest: [authMiddleware, requireAdmin],
        handler: testTelegramNotification,
    });

    fastify.get('/telegram/status', {
        onRequest: [authMiddleware, requireAdmin],
        handler: getTelegramConfig,
    });

    fastify.put('/telegram/config', {
        onRequest: [authMiddleware, requireAdmin],
        handler: updateTelegramConfig,
    });

    fastify.post('/notification-diagnostics/preview', {
        onRequest: [authMiddleware, requireAdmin],
        handler: previewNotificationDiagnostics,
    });

    fastify.post('/notification-diagnostics/drill', {
        onRequest: [authMiddleware, requireAdmin],
        handler: runNotificationDiagnosticsDrill,
    });

    fastify.get('/notification-diagnostics/runs', {
        onRequest: [authMiddleware, requireAdmin],
        handler: listNotificationDiagnosticsRuns,
    });

    fastify.get('/playback-tokens', {
        onRequest: [authMiddleware, requireAdmin],
        handler: listPlaybackTokens,
    });

    fastify.get('/playback-tokens/audit', {
        onRequest: [authMiddleware, requireAdmin],
        handler: listPlaybackTokenAuditLogs,
    });

    fastify.post('/playback-tokens', {
        onRequest: [authMiddleware, requireAdmin],
        handler: createPlaybackToken,
    });

    fastify.put('/playback-tokens/:id', {
        onRequest: [authMiddleware, requireAdmin],
        handler: updatePlaybackToken,
    });

    fastify.post('/playback-tokens/:id/share', {
        onRequest: [authMiddleware, requireAdmin],
        handler: sharePlaybackToken,
    });

    fastify.post('/playback-tokens/:id/sessions/clear', {
        onRequest: [authMiddleware, requireAdmin],
        handler: clearPlaybackTokenSessions,
    });

    fastify.post('/playback-tokens/:id/revoke', {
        onRequest: [authMiddleware, requireAdmin],
        handler: revokePlaybackToken,
    });

    // Debug endpoint - raw MediaMTX data (for troubleshooting viewer count)
    fastify.get('/debug/mediamtx-readers', {
        onRequest: [authMiddleware, requireAdmin],
        handler: async (request, reply) => {
            try {
                const axios = (await import('axios')).default;
                const pathsRes = await axios.get('http://localhost:9997/v3/paths/list', { timeout: 5000 });
                const paths = pathsRes.data?.items || [];
                
                // Get raw readers data for debugging
                const rawData = paths.map(path => ({
                    name: path.name,
                    ready: path.ready,
                    sourceReady: path.sourceReady,
                    readers: path.readers || [],
                    readerCount: (path.readers || []).length
                }));
                
                // Get filtered stats
                const filteredStats = await mediaMtxService.getStats(true);
                
                return reply.send({
                    success: true,
                    raw: rawData,
                    filtered: {
                        totalSessions: filteredStats.sessions.length,
                        paths: filteredStats.paths.map(p => ({
                            name: p.name,
                            originalReaders: p._originalReaderCount,
                            filteredReaders: p._filteredReaderCount,
                            readers: p.readers
                        }))
                    }
                });
            } catch (error) {
                return reply.code(500).send({
                    success: false,
                    message: error.message
                });
            }
        }
    });

    // Debug endpoint - MediaMTX path configurations
    fastify.get('/debug/mediamtx-paths', {
        onRequest: [authMiddleware, requireAdmin],
        handler: async (request, reply) => {
            try {
                const axios = (await import('axios')).default;
                
                // Get configured paths from MediaMTX
                const configRes = await axios.get('http://localhost:9997/v3/config/paths/list', { timeout: 5000 });
                const configuredPaths = configRes.data?.items || [];
                
                // Get database cameras
                const dbCameras = mediaMtxService.getDatabaseCameras();
                
                // Compare
                const comparison = dbCameras.map(cam => {
                    const mtxPath = configuredPaths.find(p => p.name === cam.path_name);
                    return {
                        cameraId: cam.id,
                        cameraName: cam.name,
                        pathName: cam.path_name,
                        dbRtspUrl: cam.rtsp_url,
                        sourceProfile: cam.source_profile || null,
                        policyMode: cam.internal_ingest_policy_override || 'default',
                        closeAfterSeconds: cam.internal_on_demand_close_after_seconds_override || cam.area_internal_on_demand_close_after_seconds || null,
                        mtxSource: mtxPath?.source || null,
                        inMediaMTX: !!mtxPath,
                        sourceMatch: mtxPath?.source === cam.rtsp_url,
                        sourceOnDemand: mtxPath?.sourceOnDemand ?? null,
                        sourceOnDemandCloseAfter: mtxPath?.sourceOnDemandCloseAfter ?? null,
                    };
                });
                
                return reply.send({
                    success: true,
                    data: {
                        dbCamerasCount: dbCameras.length,
                        mtxPathsCount: configuredPaths.length,
                        comparison,
                        orphanedPaths: configuredPaths
                            .filter(p => p.name.startsWith('camera') && !dbCameras.some(c => c.path_name === p.name))
                            .map(p => ({ name: p.name, source: p.source }))
                    }
                });
            } catch (error) {
                return reply.code(500).send({
                    success: false,
                    message: error.message
                });
            }
        }
    });

    // Force sync MediaMTX paths with database
    fastify.post('/mediamtx/sync', {
        onRequest: [authMiddleware, requireAdmin],
        handler: async (request, reply) => {
            try {
                const { forceUpdate } = request.body || {};
                
                console.log(`[Admin] Force sync MediaMTX requested by ${request.user.username}, forceUpdate=${forceUpdate}`);
                
                await mediaMtxService.syncCameras(3, forceUpdate === true);
                
                return reply.send({
                    success: true,
                    message: 'MediaMTX sync completed'
                });
            } catch (error) {
                console.error('MediaMTX sync error:', error);
                return reply.code(500).send({
                    success: false,
                    message: error.message
                });
            }
        }
    });

    // API Key Management Endpoints
    // POST /api/admin/api-keys - Generate new API key
    fastify.post('/api-keys', {
        schema: createApiKeySchema,
        onRequest: [authMiddleware, requireAdmin],
        handler: generateApiKey,
    });

    // GET /api/admin/api-keys - List active API keys
    fastify.get('/api-keys', {
        onRequest: [authMiddleware, requireAdmin],
        handler: listApiKeys,
    });

    // DELETE /api/admin/api-keys/:id - Revoke API key
    fastify.delete('/api-keys/:id', {
        schema: apiKeyIdParamSchema,
        onRequest: [authMiddleware, requireAdmin],
        handler: deleteApiKey,
    });

    // Cache Management Endpoints
    // GET /api/admin/cache/stats - Get cache statistics
    fastify.get('/cache/stats', {
        onRequest: [authMiddleware, requireAdmin],
        handler: getCacheStats,
    });

    // POST /api/admin/cache/clear - Clear all cache
    fastify.post('/cache/clear', {
        onRequest: [authMiddleware, requireAdmin],
        handler: clearCache,
    });

    // Timezone Configuration Endpoints
    // GET /api/admin/settings/timezone - Get timezone configuration
    fastify.get('/settings/timezone', {
        onRequest: [authMiddleware, requireAdmin],
        handler: getTimezoneConfig,
    });

    // PUT /api/admin/settings/timezone - Update timezone configuration
    fastify.put('/settings/timezone', {
        onRequest: [authMiddleware, requireAdmin],
        schema: {
            body: {
                type: 'object',
                required: ['timezone'],
                properties: {
                    timezone: { 
                        type: 'string',
                        enum: ['WIB', 'WITA', 'WIT']
                    }
                }
            }
        },
        handler: updateTimezoneConfig,
    });

    // Backup/Restore Endpoints
    // GET /api/admin/backup/export - Export database backup
    fastify.get('/backup/export', {
        onRequest: [authMiddleware, requireAdmin],
        handler: exportDatabaseBackup,
    });

    // POST /api/admin/backup/import - Import database backup
    fastify.post('/backup/import', {
        onRequest: [authMiddleware, requireAdmin],
        handler: importDatabaseBackup,
    });

    // POST /api/admin/backup/preview - Preview backup stats
    fastify.post('/backup/preview', {
        onRequest: [authMiddleware, requireAdmin],
        handler: getBackupPreview,
    });
}
