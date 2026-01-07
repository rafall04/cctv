import os from 'os';
import { query, queryOne } from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';
import viewerSessionService from '../services/viewerSessionService.js';
import { sendTestNotification, getTelegramStatus, isTelegramConfigured } from '../services/telegramService.js';

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

        const recentLogs = query(`
            SELECT l.*, u.username 
            FROM audit_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT 10
        `).map(log => ({
            ...log,
            created_at_wib: new Intl.DateTimeFormat('id-ID', {
                timeZone: 'Asia/Jakarta',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(new Date(log.created_at + ' Z'))
        }));

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
 * Test Telegram notification
 */
export async function testTelegramNotification(request, reply) {
    try {
        if (!isTelegramConfigured()) {
            return reply.code(400).send({
                success: false,
                message: 'Telegram bot belum dikonfigurasi. Silakan atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env',
            });
        }

        const sent = await sendTestNotification();
        
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
 * Get viewer analytics data
 * Query params: period (today, 7days, 30days, all)
 */
export async function getViewerAnalytics(request, reply) {
    try {
        const { period = '7days' } = request.query;
        
        // Validate period
        const validPeriods = ['today', '7days', '30days', 'all'];
        if (!validPeriods.includes(period)) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid period. Use: today, 7days, 30days, or all',
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
