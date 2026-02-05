import os from 'os';
import { query, queryOne } from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';
import viewerSessionService from '../services/viewerSessionService.js';
import { 
    sendTestNotification, 
    getTelegramStatus, 
    isTelegramConfigured,
    saveTelegramSettings
} from '../services/telegramService.js';
import cache from '../services/cacheService.js';
import { getTimezone, setTimezone, TIMEZONE_MAP, formatDateTime } from '../services/timezoneService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';
import backupService from '../services/backupService.js';

export async function getDashboardStats(request, reply) {
    try {
        const cameraStats = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled
            FROM cameras
        `);

        const areaCount = queryOne('SELECT COUNT(*) as count FROM areas').count;

        const mtxStats = await mediaMtxService.getStats();

        const cpusList = os.cpus();
        
        // Calculate CPU usage
        let cpuLoadPercent = 0;
        try {
            const getCPUTimes = () => {
                return os.cpus().reduce((acc, cpu) => {
                    acc.idle += cpu.times.idle;
                    acc.total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
                    return acc;
                }, { idle: 0, total: 0 });
            };

            const startTimes = getCPUTimes();
            await new Promise(resolve => setTimeout(resolve, 100));
            const endTimes = getCPUTimes();

            const idleDelta = endTimes.idle - startTimes.idle;
            const totalDelta = endTimes.total - startTimes.total;
            cpuLoadPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
        } catch (e) {
            cpuLoadPercent = 0;
        }

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsagePercent = Math.round((usedMem / totalMem) * 100);

        const systemInfo = {
            platform: os.platform(),
            arch: os.arch(),
            cpus: cpusList.length,
            cpuModel: cpusList.length > 0 ? cpusList[0].model : 'Unknown CPU',
            cpuLoad: cpuLoadPercent,
            totalMem: totalMem,
            freeMem: freeMem,
            usedMem: usedMem,
            memUsagePercent: memUsagePercent,
            uptime: os.uptime(),
            loadAvg: os.loadavg(),
        };

        // Get viewer data from viewerSessionService (frontend-based tracking)
        const viewerStats = viewerSessionService.getViewerStats();
        const activeViewers = viewerStats.activeViewers;
        const activeSessions = viewerStats.activeSessions || [];
        
        // Group sessions by camera for quick lookup
        const viewersByCamera = {};
        const sessionsByCamera = {};
        viewerStats.viewersByCamera.forEach(v => {
            viewersByCamera[v.camera_id] = v.viewer_count;
        });
        activeSessions.forEach(session => {
            if (!sessionsByCamera[session.camera_id]) {
                sessionsByCamera[session.camera_id] = [];
            }
            sessionsByCamera[session.camera_id].push({
                sessionId: session.session_id,
                ipAddress: session.ip_address,
                deviceType: session.device_type,
                startedAt: session.started_at,
                durationSeconds: session.duration_seconds
            });
        });

        // Build lookup map for stream_key -> camera info
        const camerasByStreamKey = {};
        const allCameras = query('SELECT id, name, stream_key FROM cameras WHERE enabled = 1');
        allCameras.forEach(cam => {
            if (cam.stream_key) {
                camerasByStreamKey[cam.stream_key] = cam;
            }
        });

        const activeStreams = (mtxStats.paths || []).map(p => {
            const cam = camerasByStreamKey[p.name];
            const cameraId = cam ? cam.id : null;
            
            // Determine stream state
            let state = 'idle';
            if (p.sourceReady || p.ready) {
                state = 'ready';
            } else if (p.readers && p.readers.length > 0) {
                state = 'buffering';
            }
            
            // Get viewer count and sessions from viewerSessionService
            const cameraIdInt = cameraId ? parseInt(cameraId) : null;
            const viewers = cameraIdInt ? (viewersByCamera[cameraIdInt] || 0) : 0;
            const sessions = cameraIdInt ? (sessionsByCamera[cameraIdInt] || []) : [];
            
            // Only show bandwidth when there are active viewers
            // When no viewers, bandwidth should be 0 (stream is just being kept warm)
            const hasActiveViewers = viewers > 0;
            
            return {
                id: cameraId || p.name,
                name: cam ? cam.name : `Unknown (${p.name.substring(0, 8)}...)`,
                ready: p.ready || false,
                state: state,
                viewers: viewers,
                sessions: sessions, // Include session details with IP
                // Show actual bandwidth only when viewers are watching
                // Otherwise show 0 to indicate no active consumption
                bytesReceived: hasActiveViewers ? (p.bytesReceived || 0) : 0,
                bytesSent: hasActiveViewers ? (p.bytesSent || 0) : 0
            };
        });

        // Camera status breakdown (online/offline/maintenance)
        const cameraStatusBreakdown = {
            online: 0,
            offline: 0,
            maintenance: 0
        };
        
        allCameras.forEach(cam => {
            const streamKey = cam.stream_key;
            const hasStream = mtxStats.paths?.some(p => p.name === streamKey && (p.ready || p.sourceReady));
            
            if (hasStream) {
                cameraStatusBreakdown.online++;
            } else {
                cameraStatusBreakdown.offline++;
            }
        });
        
        // Top 5 cameras by viewer count
        const topCameras = allCameras
            .map(cam => ({
                id: cam.id,
                name: cam.name,
                viewers: viewersByCamera[cam.id] || 0
            }))
            .sort((a, b) => b.viewers - a.viewers)
            .slice(0, 5);

        const recentLogs = query(`
            SELECT l.*, u.username 
            FROM audit_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT 10
        `).map(log => {
            return {
                ...log,
                created_at_wib: formatDateTime(log.created_at).split(' ')[1] // Get time part only
            };
        });

        return reply.send({
            success: true,
            data: {
                summary: {
                    totalCameras: cameraStats.total,
                    activeCameras: cameraStats.active,
                    disabledCameras: cameraStats.disabled,
                    totalAreas: areaCount,
                    activeViewers: activeViewers,
                },
                system: systemInfo,
                streams: activeStreams,
                recentLogs: recentLogs,
                mtxConnected: !mtxStats.error,
                // Phase 1 additions
                cameraStatusBreakdown: cameraStatusBreakdown,
                topCameras: topCameras,
                // Include all active sessions for "All Viewers" view
                allSessions: activeSessions.map(s => ({
                    sessionId: s.session_id,
                    cameraId: s.camera_id,
                    cameraName: s.camera_name,
                    ipAddress: s.ip_address,
                    deviceType: s.device_type,
                    startedAt: s.started_at,
                    durationSeconds: s.duration_seconds
                }))
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}


/**
 * Get today's quick stats with comparison to yesterday
 * For dashboard mini cards
 * Supports period parameter: 'today', 'yesterday', '7days', '30days'
 */
export async function getTodayStats(request, reply) {
    try {
        const { period = 'today' } = request.query;
        
        // Helper function to get date with offset in configured timezone
        const getDateWithOffset = (days) => {
            const timezone = getTimezone();
            const date = new Date();
            date.setDate(date.getDate() + days);
            return date.toLocaleDateString('sv-SE', { 
                timeZone: timezone
            });
        };
        
        // Check if viewer_session_history table exists
        const tableExists = queryOne(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='viewer_session_history'
        `);
        
        if (!tableExists) {
            // Table doesn't exist yet - return empty stats
            console.warn('viewer_session_history table does not exist - returning empty stats');
            
            // Get current active viewers from viewerSessionService
            const viewerStats = viewerSessionService.getViewerStats();
            const activeNow = viewerStats.activeViewers;
            
            // Get camera status
            const cameraStatus = queryOne(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
                FROM cameras
            `);
            
            // Calculate offline cameras
            const mtxStats = await mediaMtxService.getStats();
            const activeCameras = query('SELECT id, stream_key FROM cameras WHERE enabled = 1');
            let onlineCount = 0;
            activeCameras.forEach(cam => {
                const hasStream = mtxStats.paths?.some(p => p.name === cam.stream_key && (p.ready || p.sourceReady));
                if (hasStream) onlineCount++;
            });
            const offlineCount = cameraStatus.active - onlineCount;
            
            return reply.send({
                success: true,
                data: {
                    current: {
                        totalSessions: 0,
                        uniqueViewers: 0,
                        avgDuration: 0,
                        totalWatchTime: 0,
                        activeNow: activeNow,
                    },
                    compare: {
                        totalSessions: 0,
                        uniqueViewers: 0,
                        avgDuration: 0,
                        totalWatchTime: 0,
                    },
                    comparison: {
                        sessionsChange: 0,
                        viewersChange: 0,
                        durationChange: 0,
                    },
                    cameras: {
                        total: cameraStatus.total,
                        online: onlineCount,
                        offline: offlineCount,
                        maintenance: cameraStatus.maintenance,
                    },
                    period: period,
                    warning: 'Analytics table not initialized - run migration: add_viewer_sessions.js'
                }
            });
        }
        
        // Determine date filters using configured timezone dates (consistent with Analytics)
        let dateFilter = '';
        let previousDateFilter = '';
        const todayDate = getDateWithOffset(0);
        
        switch (period) {
            case 'yesterday':
                dateFilter = `AND date(started_at) = '${getDateWithOffset(-1)}'`;
                previousDateFilter = `AND date(started_at) = '${getDateWithOffset(-2)}'`;
                break;
            case '7days':
                dateFilter = `AND date(started_at) >= '${getDateWithOffset(-7)}'`;
                previousDateFilter = `AND date(started_at) >= '${getDateWithOffset(-14)}' AND date(started_at) < '${getDateWithOffset(-7)}'`;
                break;
            case '30days':
                dateFilter = `AND date(started_at) >= '${getDateWithOffset(-30)}'`;
                previousDateFilter = `AND date(started_at) >= '${getDateWithOffset(-60)}' AND date(started_at) < '${getDateWithOffset(-30)}'`;
                break;
            case 'today':
            default:
                dateFilter = `AND date(started_at) = '${todayDate}'`;
                previousDateFilter = `AND date(started_at) = '${getDateWithOffset(-1)}'`;
                break;
        }
        
        // Get current period viewer sessions from database (use history table for consistency)
        const currentSessionsResult = query(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                AVG(duration_seconds) as avg_duration,
                SUM(duration_seconds) as total_watch_time
            FROM viewer_session_history
            WHERE 1=1 ${dateFilter}
        `);
        
        // Get comparison period stats
        const compareSessionsResult = query(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                AVG(duration_seconds) as avg_duration,
                SUM(duration_seconds) as total_watch_time
            FROM viewer_session_history
            WHERE 1=1 ${previousDateFilter}
        `);
        
        // Get current active viewers from viewerSessionService
        const viewerStats = viewerSessionService.getViewerStats();
        const activeNow = viewerStats.activeViewers;
        
        // Get camera status
        const cameraStatus = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
            FROM cameras
        `);
        
        // Calculate offline cameras (need to check MediaMTX)
        const mtxStats = await mediaMtxService.getStats();
        const activeCameras = query('SELECT id, stream_key FROM cameras WHERE enabled = 1');
        let onlineCount = 0;
        activeCameras.forEach(cam => {
            const hasStream = mtxStats.paths?.some(p => p.name === cam.stream_key && (p.ready || p.sourceReady));
            if (hasStream) onlineCount++;
        });
        const offlineCount = cameraStatus.active - onlineCount;
        
        // Calculate percentage changes
        const calculateChange = (current, compare) => {
            if (!compare || compare === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - compare) / compare) * 100);
        };
        
        const currentData = currentSessionsResult[0] || { total_sessions: 0, unique_viewers: 0, avg_duration: 0, total_watch_time: 0 };
        const compareData = compareSessionsResult[0] || { total_sessions: 0, unique_viewers: 0, avg_duration: 0, total_watch_time: 0 };
        
        return reply.send({
            success: true,
            data: {
                current: {
                    totalSessions: currentData.total_sessions || 0,
                    uniqueViewers: currentData.unique_viewers || 0,
                    avgDuration: Math.round(currentData.avg_duration || 0),
                    totalWatchTime: currentData.total_watch_time || 0,
                    activeNow: activeNow,
                },
                compare: {
                    totalSessions: compareData.total_sessions || 0,
                    uniqueViewers: compareData.unique_viewers || 0,
                    avgDuration: Math.round(compareData.avg_duration || 0),
                    totalWatchTime: compareData.total_watch_time || 0,
                },
                comparison: {
                    sessionsChange: calculateChange(currentData.total_sessions, compareData.total_sessions),
                    viewersChange: calculateChange(currentData.unique_viewers, compareData.unique_viewers),
                    durationChange: calculateChange(currentData.avg_duration, compareData.avg_duration),
                },
                cameras: {
                    total: cameraStatus.total,
                    online: onlineCount,
                    offline: offlineCount,
                    maintenance: cameraStatus.maintenance,
                },
                period: period // Include period in response for debugging
            }
        });
    } catch (error) {
        console.error('Get today stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Test Telegram notification
 */
export async function testTelegramNotification(request, reply) {
    try {
        const { type = 'monitoring' } = request.body || {};
        
        if (type === 'monitoring' && !isTelegramConfigured()) {
            return reply.code(400).send({
                success: false,
                message: 'Telegram monitoring belum dikonfigurasi',
            });
        }

        const sent = await sendTestNotification(type);
        
        if (sent) {
            return reply.send({
                success: true,
                message: 'Notifikasi test berhasil dikirim ke Telegram',
            });
        } else {
            return reply.code(500).send({
                success: false,
                message: 'Gagal mengirim notifikasi test. Periksa konfigurasi bot token dan chat ID.',
            });
        }
    } catch (error) {
        console.error('Test Telegram notification error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get Telegram configuration status
 */
export async function getTelegramConfig(request, reply) {
    try {
        const status = getTelegramStatus();
        
        return reply.send({
            success: true,
            data: status,
        });
    } catch (error) {
        console.error('Get Telegram config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Update Telegram configuration
 */
export async function updateTelegramConfig(request, reply) {
    try {
        const { botToken, monitoringChatId, feedbackChatId } = request.body;

        const settings = {
            botToken: botToken || '',
            monitoringChatId: monitoringChatId || '',
            feedbackChatId: feedbackChatId || '',
            enabled: !!(botToken && (monitoringChatId || feedbackChatId))
        };

        const saved = saveTelegramSettings(settings);
        
        if (saved) {
            return reply.send({
                success: true,
                message: 'Konfigurasi Telegram berhasil disimpan',
                data: getTelegramStatus(),
            });
        } else {
            return reply.code(500).send({
                success: false,
                message: 'Gagal menyimpan konfigurasi',
            });
        }
    } catch (error) {
        console.error('Update Telegram config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get viewer analytics data
 * Query params: period (today, yesterday, 7days, 30days, all, or date:YYYY-MM-DD)
 */
export async function getViewerAnalytics(request, reply) {
    try {
        const { period = '7days' } = request.query;
        
        // Validate period - allow standard periods or custom date format
        const validPeriods = ['today', 'yesterday', '7days', '30days', 'all'];
        const isCustomDate = period.startsWith('date:') && /^date:\d{4}-\d{2}-\d{2}$/.test(period);
        
        if (!validPeriods.includes(period) && !isCustomDate) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid period. Use: today, yesterday, 7days, 30days, all, or date:YYYY-MM-DD',
            });
        }

        const analytics = viewerSessionService.getAnalytics(period);

        return reply.send({
            success: true,
            data: analytics,
        });
    } catch (error) {
        console.error('Get viewer analytics error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get real-time viewer data (for live dashboard updates)
 */
export async function getRealTimeViewers(request, reply) {
    try {
        const data = viewerSessionService.getRealTimeData();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get real-time viewers error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}


/**
 * Get cache statistics (admin only)
 */
export async function getCacheStats(request, reply) {
    try {
        const stats = cache.stats();

        return reply.send({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error('Get cache stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Clear all cache (admin only)
 */
export async function clearCache(request, reply) {
    try {
        const cleared = cache.clear();

        return reply.send({
            success: true,
            message: `Cache cleared successfully. ${cleared} entries removed.`,
            data: { cleared },
        });
    } catch (error) {
        console.error('Clear cache error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get timezone configuration
 */
export async function getTimezoneConfig(request, reply) {
    try {
        const timezone = getTimezone();
        const shortName = Object.keys(TIMEZONE_MAP).find(
            key => TIMEZONE_MAP[key] === timezone
        ) || 'WIB';
        
        return reply.send({
            success: true,
            data: {
                timezone,
                shortName
            }
        });
    } catch (error) {
        console.error('Get timezone config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Update timezone configuration
 */
export async function updateTimezoneConfig(request, reply) {
    try {
        const { timezone } = request.body;
        
        if (!['WIB', 'WITA', 'WIT'].includes(timezone)) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid timezone. Use: WIB, WITA, or WIT',
            });
        }
        
        setTimezone(timezone);
        
        logAdminAction({
            action: 'timezone_updated',
            details: { timezone },
            userId: request.user?.id
        }, request);
        
        return reply.send({
            success: true,
            message: 'Timezone berhasil diupdate',
            data: { timezone }
        });
    } catch (error) {
        console.error('Update timezone config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Export database backup
 */
export async function exportDatabaseBackup(request, reply) {
    try {
        const result = backupService.exportBackup();
        
        if (!result.success) {
            return reply.code(500).send({
                success: false,
                message: 'Gagal export backup: ' + result.error,
            });
        }

        const stats = backupService.getBackupStats(result.backup);
        
        logAdminAction({
            action: 'backup_exported',
            details: { stats },
            userId: request.user?.id
        }, request);

        // Return as downloadable JSON
        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', `attachment; filename="rafnet-cctv-backup-${new Date().toISOString().split('T')[0]}.json"`);
        
        return reply.send(result.backup);
    } catch (error) {
        console.error('Export database backup error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Import database backup
 */
export async function importDatabaseBackup(request, reply) {
    try {
        const { backup, mode = 'merge', tables = null } = request.body;
        
        if (!backup || !backup.version || !backup.data) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid backup format',
            });
        }

        const result = backupService.importBackup(backup, { mode, tables });
        
        if (!result.success) {
            return reply.code(500).send({
                success: false,
                message: 'Gagal import backup: ' + result.error,
            });
        }

        logAdminAction({
            action: 'backup_imported',
            details: { 
                mode,
                imported: result.imported,
                skipped: result.skipped,
                errors: result.errors
            },
            userId: request.user?.id
        }, request);

        return reply.send({
            success: true,
            message: 'Backup berhasil diimport',
            data: result
        });
    } catch (error) {
        console.error('Import database backup error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get backup preview/stats
 */
export async function getBackupPreview(request, reply) {
    try {
        const { backup } = request.body;
        
        if (!backup || !backup.version || !backup.data) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid backup format',
            });
        }

        const stats = backupService.getBackupStats(backup);

        return reply.send({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get backup preview error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
