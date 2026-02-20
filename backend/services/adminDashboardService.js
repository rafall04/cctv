import os from 'os';
import { query, queryOne } from '../database/database.js';
import mediaMtxService from './mediaMtxService.js';
import viewerSessionService from './viewerSessionService.js';
import { getTimezone, formatDateTime } from './timezoneService.js';

class AdminDashboardService {

    async getDashboardStats() {
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

        const viewerStats = viewerSessionService.getViewerStats();
        const activeViewers = viewerStats.activeViewers;
        const activeSessions = viewerStats.activeSessions || [];

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

            let state = 'idle';
            if (p.sourceReady || p.ready) {
                state = 'ready';
            } else if (p.readers && p.readers.length > 0) {
                state = 'buffering';
            }

            const cameraIdInt = cameraId ? parseInt(cameraId) : null;
            const viewers = cameraIdInt ? (viewersByCamera[cameraIdInt] || 0) : 0;
            const sessions = cameraIdInt ? (sessionsByCamera[cameraIdInt] || []) : [];

            const hasActiveViewers = viewers > 0;

            return {
                id: cameraId || p.name,
                name: cam ? cam.name : `Unknown (${p.name.substring(0, 8)}...)`,
                ready: p.ready || false,
                state: state,
                viewers: viewers,
                sessions: sessions,
                bytesReceived: hasActiveViewers ? (p.bytesReceived || 0) : 0,
                bytesSent: hasActiveViewers ? (p.bytesSent || 0) : 0
            };
        });

        const cameraStatusBreakdown = { online: 0, offline: 0, maintenance: 0 };

        allCameras.forEach(cam => {
            const streamKey = cam.stream_key;
            const hasStream = mtxStats.paths?.some(p => p.name === streamKey && (p.ready || p.sourceReady));

            if (hasStream) {
                cameraStatusBreakdown.online++;
            } else {
                cameraStatusBreakdown.offline++;
            }
        });

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
                created_at_wib: formatDateTime(log.created_at).split(' ')[1]
            };
        });

        return {
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
            cameraStatusBreakdown: cameraStatusBreakdown,
            topCameras: topCameras,
            allSessions: activeSessions.map(s => ({
                sessionId: s.session_id,
                cameraId: s.camera_id,
                cameraName: s.camera_name,
                ipAddress: s.ip_address,
                deviceType: s.device_type,
                startedAt: s.started_at,
                durationSeconds: s.duration_seconds
            }))
        };
    }

    async getTodayStats(period = 'today') {
        const getDateWithOffset = (days) => {
            const timezone = getTimezone();
            const date = new Date();
            date.setDate(date.getDate() + days);
            return date.toLocaleDateString('sv-SE', {
                timeZone: timezone
            });
        };

        const tableExists = queryOne(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='viewer_session_history'
        `);

        if (!tableExists) {
            console.warn('viewer_session_history table does not exist - returning empty stats');
            const viewerStats = viewerSessionService.getViewerStats();
            const activeNow = viewerStats.activeViewers;

            const cameraStatus = queryOne(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
                FROM cameras
            `);

            const mtxStats = await mediaMtxService.getStats();
            const activeCameras = query('SELECT id, stream_key FROM cameras WHERE enabled = 1');
            let onlineCount = 0;
            activeCameras.forEach(cam => {
                const hasStream = mtxStats.paths?.some(p => p.name === cam.stream_key && (p.ready || p.sourceReady));
                if (hasStream) onlineCount++;
            });
            const offlineCount = cameraStatus.active - onlineCount;

            return {
                current: { totalSessions: 0, uniqueViewers: 0, avgDuration: 0, totalWatchTime: 0, activeNow: activeNow },
                compare: { totalSessions: 0, uniqueViewers: 0, avgDuration: 0, totalWatchTime: 0 },
                comparison: { sessionsChange: 0, viewersChange: 0, durationChange: 0 },
                cameras: { total: cameraStatus.total, online: onlineCount, offline: offlineCount, maintenance: cameraStatus.maintenance },
                period: period,
                warning: 'Analytics table not initialized - run migration: add_viewer_sessions.js'
            };
        }

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

        const currentSessionsResult = query(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                AVG(duration_seconds) as avg_duration,
                SUM(duration_seconds) as total_watch_time
            FROM viewer_session_history
            WHERE 1=1 ${dateFilter}
        `);

        const compareSessionsResult = query(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                AVG(duration_seconds) as avg_duration,
                SUM(duration_seconds) as total_watch_time
            FROM viewer_session_history
            WHERE 1=1 ${previousDateFilter}
        `);

        const viewerStats = viewerSessionService.getViewerStats();
        const activeNow = viewerStats.activeViewers;

        const cameraStatus = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
            FROM cameras
        `);

        const mtxStats = await mediaMtxService.getStats();
        const activeCameras = query('SELECT id, stream_key FROM cameras WHERE enabled = 1');
        let onlineCount = 0;
        activeCameras.forEach(cam => {
            const hasStream = mtxStats.paths?.some(p => p.name === cam.stream_key && (p.ready || p.sourceReady));
            if (hasStream) onlineCount++;
        });
        const offlineCount = cameraStatus.active - onlineCount;

        const calculateChange = (current, compare) => {
            if (!compare || compare === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - compare) / compare) * 100);
        };

        const currentData = currentSessionsResult[0] || { total_sessions: 0, unique_viewers: 0, avg_duration: 0, total_watch_time: 0 };
        const compareData = compareSessionsResult[0] || { total_sessions: 0, unique_viewers: 0, avg_duration: 0, total_watch_time: 0 };

        return {
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
            period: period
        };
    }
}

export default new AdminDashboardService();
