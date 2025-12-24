import os from 'os';
import { query, queryOne } from '../database/database.js';
import mediaMtxService from '../services/mediaMtxService.js';

export async function getDashboardStats(request, reply) {
    try {
        // 1. Get Camera Stats
        const cameraStats = queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled
            FROM cameras
        `);

        // 2. Get Area Stats
        const areaCount = queryOne('SELECT COUNT(*) as count FROM areas').count;

        // 3. Get MediaMTX Stats
        const mtxStats = await mediaMtxService.getStats();

        const cpus = os.cpus();

        // Helper to get CPU times
        const getCPUTimes = () => {
            const cpus = os.cpus();
            return cpus.reduce((acc, cpu) => {
                acc.idle += cpu.times.idle;
                acc.total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
                return acc;
            }, { idle: 0, total: 0 });
        };

        const startTimes = getCPUTimes();
        // Wait 100ms to get a delta
        await new Promise(resolve => setTimeout(resolve, 100));
        const endTimes = getCPUTimes();

        const idleDelta = endTimes.idle - startTimes.idle;
        const totalDelta = endTimes.total - startTimes.total;
        const cpuLoadPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;

        const systemInfo = {
            platform: os.platform(),
            arch: os.arch(),
            cpus: cpus.length,
            cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown CPU',
            cpuLoad: cpuLoadPercent,
            totalMem: os.totalmem(),
            freeMem: os.freemem(),
            uptime: os.uptime(),
            loadAvg: os.loadavg(), // [1, 5, 15] minute load averages
        };

        // 5. Calculate Active Viewers and Bandwidth
        // MediaMTX sessions list contains info about active viewers
        const activeViewers = mtxStats.sessions.length;

        // Map MediaMTX paths to our camera names for better UI
        const activeStreams = mtxStats.paths.map(p => {
            const cameraId = p.name.replace('camera', '');
            const cam = queryOne('SELECT name FROM cameras WHERE id = ?', [cameraId]);
            return {
                id: cameraId,
                name: cam ? cam.name : p.name,
                state: p.state,
                viewers: mtxStats.sessions.filter(s => s.path === p.name).length,
                bytesReceived: p.bytesReceived || 0,
                bytesSent: p.bytesSent || 0
            };
        });

        // 6. Recent Audit Logs
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
            }).format(new Date(log.created_at + ' Z')) // Append Z to treat as UTC
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
                mtxConnected: !mtxStats.error
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
